import {assertManualMultiWorkTarget} from './manual-step-input-core.mjs';
import {manualPreparationBase,isManualStepInput,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA} from './manual-step-input-format.mjs';
import {assertManualReplyCorrelation,inspectManualReplyCorrelation} from './manual-handoff-correlation.mjs';
// Standalone proposal protocol. Not wired into evidence-map storage, controller or UI.
import {readManualArchive} from './manual-archive-core.mjs';
import {createLocalPreparation,validatePreparationTrace} from './local-preparation-core.mjs';
import {sha256,importWorkflow} from './custom-core.mjs';
export const MANUAL_REPLY_REFERENCE_LIMIT=524288;
const fail=c=>{throw Error(c)},keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.split(',').sort().join(','),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),text=(x,n)=>typeof x==='string'&&x.length<=n,bytes=x=>new TextEncoder().encode(x).length,clone=x=>JSON.parse(JSON.stringify(x));
function sourceCheck(s){if(!keys(s,'namespace,paperId,title,documentSha256,snapshotSha256')||!text(s.namespace,300)||!s.namespace||!text(s.paperId,100)||!s.paperId||!text(s.title,1000)||!hash(s.documentSha256)||!hash(s.snapshotSha256))fail('MANUAL_TARGET_SOURCE_INVALID')}
function traceCheck(t){const trace=validatePreparationTrace(t);if(trace.documentOrigin!=='workspace_copy'||!['workspace_copy','custom_graph'].includes(trace.stepOrigin)||trace.promptEdited||trace.stepNameEdited||!Number.isSafeInteger(trace.promptVersion)||trace.promptVersion<1||trace.stepOrigin==='workspace_copy'&&!Number.isSafeInteger(trace.stepIndex))fail('MANUAL_REFERENCE_REQUIRES_UNEDITED_WORKSPACE_TRACE');return trace}
function replyText(s){if(!text(s,64000)||!s.trim())fail('MANUAL_REPLY_INVALID');for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=s.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('MANUAL_REPLY_ENCODING')}else if(n>=0xdc00&&n<=0xdfff)fail('MANUAL_REPLY_ENCODING')}}
/** Validate persisted projected reference; hashes do NOT authenticate its author or omitted preparation. */
export async function readManualReplyReference(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||bytes(raw)>MANUAL_REPLY_REFERENCE_LIMIT)fail('MANUAL_REFERENCE_SIZE');const x=JSON.parse(raw);
 if(!keys(x,'schema,kind,authority,verification,platformVerified,researchAccepted,targetSource,origin,recordId,reply,preparation')||x.schema!=='prism-manual-reply-reference/v1'||x.kind!=='manual-reply'||x.authority!=='none'||x.verification!=='unverified'||x.platformVerified!==false||x.researchAccepted!==false||!text(x.recordId,128)||!x.recordId)fail('MANUAL_REFERENCE_SCHEMA');sourceCheck(x.targetSource);
 if(!keys(x.origin,'namespace,projectId,paperId,paperTitle')||Object.values(x.origin).some(v=>!text(v,512))||x.origin.namespace!==x.targetSource.namespace||x.origin.paperId!==x.targetSource.paperId||x.origin.paperTitle!==x.targetSource.title)fail('MANUAL_REFERENCE_ORIGIN');
 if(!keys(x.reply,'id,byteLength,sha256,source,verification')||!text(x.reply.id,128)||!x.reply.id||x.reply.source!=='user_pasted'||x.reply.verification!=='unverified'||!hash(x.reply.sha256))fail('MANUAL_REPLY_INVALID');if(!Number.isSafeInteger(x.reply.byteLength)||x.reply.byteLength<1||x.reply.byteLength>192000)fail('MANUAL_REPLY_SIZE');
 if(!keys(x.preparation,'integritySha256,documentSha256,promptSha256,trace,originalIncluded')||!hash(x.preparation.integritySha256)||!hash(x.preparation.documentSha256)||!hash(x.preparation.promptSha256)||x.preparation.originalIncluded!==false||x.preparation.documentSha256!==x.targetSource.documentSha256)fail('MANUAL_REFERENCE_PREPARATION');traceCheck(x.preparation.trace);
 return {reference:x,replyIntegrityChecked:false,preparationReverified:false,authenticated:false,authority:'none'};
}
/** Compare supplied originals only. This neither authenticates them nor checks a current workspace. */
export async function verifyManualReplyOriginals(input,crypto=globalThis.crypto){
 if(!keys(input,'referenceRaw,archiveRaw'))fail('MANUAL_ORIGINALS_INPUT');
 // Strings are immutable; capture both before readers or hashing can yield.
 const {referenceRaw,archiveRaw}=input;
 if(typeof referenceRaw!=='string'||typeof archiveRaw!=='string')fail('MANUAL_ORIGINALS_INPUT');
 let reference,records;
 try{({reference}=await readManualReplyReference(referenceRaw,crypto))}catch{fail('MANUAL_ORIGINALS_REFERENCE_INVALID')}
 try{({records}=await readManualArchive(archiveRaw,{crypto,prepare:createLocalPreparation}))}catch{fail('MANUAL_ORIGINALS_ARCHIVE_INVALID')}
 const record=records.find(r=>r.id===reference.recordId);
 if(!record)fail('MANUAL_ORIGINALS_RECORD_MISSING');
 if(!record.origin)fail('MANUAL_ORIGINALS_ORIGIN_MISSING');
 if(['namespace','projectId','paperId','paperTitle'].some(k=>record.origin[k]!==reference.origin[k]))fail('MANUAL_ORIGINALS_ORIGIN_MISMATCH');
 if(isManualStepInput(record.prepared)&&Object.keys(reference.targetSource).some(k=>record.prepared.source[k]!==reference.targetSource[k]))fail('MANUAL_ORIGINALS_SOURCE_MISMATCH');
 const p=manualPreparationBase(record.prepared),rp=reference.preparation;
 let trace,referenceTrace;
 try{trace=traceCheck(p.trace);referenceTrace=traceCheck(rp.trace)}catch{fail('MANUAL_ORIGINALS_TRACE_INVALID')}
 if(JSON.stringify(trace)!==JSON.stringify(referenceTrace))fail('MANUAL_ORIGINALS_TRACE_MISMATCH');
 if(record.prepared.integritySha256!==rp.integritySha256||p.document.sha256!==rp.documentSha256||p.step.sha256!==rp.promptSha256)fail('MANUAL_ORIGINALS_PREPARATION_MISMATCH');
 const reply=record.replies.find(r=>r.id===reference.reply.id);
 if(!reply)fail('MANUAL_REPLY_MISSING');
 // Reject malformed UTF-16 before TextEncoder can replace it with U+FFFD.
 replyText(reply.content);
 const byteLength=bytes(reply.content);
 if(byteLength>192000||byteLength!==reference.reply.byteLength)fail('MANUAL_ORIGINALS_REPLY_SIZE_MISMATCH');
 let replyHash;try{replyHash=await sha256(reply.content,crypto)}catch{fail('MANUAL_ORIGINALS_HASH_FAILED')}
 if(replyHash!==reference.reply.sha256)fail('MANUAL_ORIGINALS_REPLY_HASH_MISMATCH');
 return {matched:true,replyIntegrityChecked:true,preparationReverified:true,originMatched:true,readOnly:true,authority:'none',authenticated:false,platformVerified:false,researchAccepted:false,originalsPersisted:false,currentSourceChecked:false};
}
/** Takes an explicit current target snapshot. No storage access; caller must recheck drift before any future commit. */
export async function prepareManualReplyReference(input,crypto=globalThis.crypto){
 // Snapshot all caller-controlled values before the first await.
 const q=clone(input);if(!keys(q,'record,replyId,paper,source,workflowRaw')||!text(q.replyId,128)||!q.replyId||!(q.workflowRaw===null||typeof q.workflowRaw==='string'))fail('MANUAL_REFERENCE_INPUT');sourceCheck(q.source);
 const {record,paper,source}=q;const archive=JSON.stringify({schema:'prism-manual-research-records-v1',authority:'none',executionAllowed:false,records:[record]});const checked=(await readManualArchive(archive,{crypto,prepare:createLocalPreparation})).records[0];
 if(!checked.origin||checked.origin.namespace!==source.namespace||checked.origin.paperId!==source.paperId||checked.origin.paperTitle!==source.title||paper?.id!==source.paperId||paper.title!==source.title||await sha256(JSON.stringify(paper),crypto)!==source.snapshotSha256)fail('MANUAL_TARGET_MISMATCH');
 if(isManualStepInput(checked.prepared)&&Object.keys(source).some(k=>checked.prepared.source[k]!==source[k]))fail('MANUAL_COMPOSED_SOURCE_STALE');
 const p=manualPreparationBase(checked.prepared),t=traceCheck(p.trace);if(typeof paper.document?.text!=='string'||p.document.text!==paper.document.text||paper.document.sha256!==source.documentSha256||p.document.sha256!==source.documentSha256||await sha256(paper.document.text,crypto)!==source.documentSha256)fail('MANUAL_DOCUMENT_MISMATCH');
 let step,graph;if(t.stepOrigin==='workspace_copy'){step=paper.steps?.[t.stepIndex]}else{if(q.workflowRaw===null)fail('MANUAL_GRAPH_REQUIRED');await importWorkflow(q.workflowRaw,crypto);const w=JSON.parse(q.workflowRaw).state,g=w.graphs.at(-1);if(w.source?.namespace!==source.namespace||w.source.paperId!==source.paperId||w.source.paperTitle!==source.title||w.source.documentSha256!==source.documentSha256||g.version!==w.currentVersion||g.version!==t.graphVersion||g.sha256!==t.graphSha256)fail('MANUAL_GRAPH_STALE');graph=g;step=g.nodes.find(n=>n.id===t.nodeId)}
 if(!step||step.promptVersion!==t.promptVersion||step.name!==t.stepNameAtRead||step.name!==p.step.name||step.prompt!==p.step.prompt||await sha256(step.prompt,crypto)!==p.step.sha256)fail('MANUAL_PROMPT_STALE');
 // A v2 material digest binds every input, but a digest alone cannot prove that
 // those entries describe the actual current graph. Recheck each direct work node.
 if(step.kind==='work'&&step.dependsOn?.length>1&&checked.prepared.schema!==MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA)fail('MANUAL_MULTI_WORK_COMPOSED_INPUT_REQUIRED');
 if([MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA].includes(checked.prepared.schema)){
  const composed=checked.prepared,isWork=composed.schema===MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA;
  if(isWork)assertManualMultiWorkTarget(graph,step.id);
  if(!graph||step.kind!==(isWork?'work':'review')||step.dependsOn.length!==composed.upstreams.length||JSON.stringify(step.dependsOn)!==JSON.stringify(composed.target.dependsOn)||!isWork&&!step.dependsOn.includes(step.reviewTarget))fail(isWork?'MANUAL_MULTI_WORK_TARGET_STALE':'MANUAL_MULTI_REVIEW_TARGET_STALE');
  for(const [index,upstream] of composed.upstreams.entries()){
   const r=upstream.reference,u=traceCheck(r.preparation.trace),node=graph.nodes.find(n=>n.id===u.nodeId);
   if(u.stepOrigin!=='custom_graph'||u.nodeId!==step.dependsOn[index]||!node||node.kind!=='work'||u.graphVersion!==graph.version||u.graphSha256!==graph.sha256)fail('MANUAL_MULTI_REVIEW_INPUT_STALE');
   if(node.promptVersion!==u.promptVersion||node.name!==u.stepNameAtRead||await sha256(node.prompt,crypto)!==r.preparation.promptSha256)fail('MANUAL_MULTI_REVIEW_PROMPT_STALE');
  }
 }
 const reply=checked.replies.find(r=>r.id===q.replyId);if(!reply)fail('MANUAL_REPLY_MISSING');replyText(reply.content);
 // Current-use guard only: old archives remain viewable/exportable with their original bytes.
 assertManualReplyCorrelation(reply.content,checked.binding);
 if(isManualStepInput(checked.prepared)){
  // Only the immediate original is present. Do not infer or reconstruct absent ancestors.
  const upstreams=[MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA].includes(checked.prepared.schema)?checked.prepared.upstreams:[checked.prepared.upstream];
  for(const upstream of upstreams){const correlation=inspectManualReplyCorrelation(upstream.content,upstream.reference.preparation.integritySha256);if(!correlation.allowed)fail('MANUAL_REPLY_UPSTREAM_CORRELATION_'+correlation.state.toUpperCase())}
 }
 const reference={schema:'prism-manual-reply-reference/v1',kind:'manual-reply',authority:'none',verification:'unverified',platformVerified:false,researchAccepted:false,targetSource:source,origin:checked.origin,recordId:checked.id,reply:{id:reply.id,byteLength:bytes(reply.content),sha256:await sha256(reply.content,crypto),source:'user_pasted',verification:'unverified'},preparation:{integritySha256:checked.prepared.integritySha256,documentSha256:p.document.sha256,promptSha256:p.step.sha256,trace:t,originalIncluded:false}};
 const raw=JSON.stringify(reference,null,2);await readManualReplyReference(raw,crypto);
 return {kind:'manual-reply-link-proposal',reference,raw,defaultStatus:'ai_unverified',newClaimOnly:true,stored:false,authority:'none',warning:'仅待关联预览；答复为用户粘贴，来源未认证。引用仅含答复字节数、哈希与来源元数据，不含答复全文、论文正文或Prompt；原答复及准备包均未随附，重开不能独立重算其哈希。'};
}
