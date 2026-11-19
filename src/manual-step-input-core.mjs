import {makeManualReviewSubject,makeManualMultiReviewSubject} from './manual-review-core.mjs';
import {createLocalPreparation} from './local-preparation-core.mjs';
import {prepareManualReplyReference} from './manual-reply-reference.mjs';
import {sha256,importWorkflow} from './custom-core.mjs';
import {MANUAL_STEP_INPUT_SCHEMA,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA,readManualStepInput} from './manual-step-input-format.mjs';
// No storage or execution. Caller must check live scope/source again before clipboard use.
export async function prepareManualStepInput(input,crypto=globalThis.crypto,reviewEvent=null){
 const q=JSON.parse(JSON.stringify(input));
 if(!q||Object.keys(q).sort().join(',')!=='context,paper,prompt,record,replyId,source,targetNodeId,workflowRaw')throw Error('STEP_INPUT_ARGUMENTS');
 const {context,source,paper,record}=q;
 if(!context||Object.keys(context).sort().join(',')!=='namespace,paperId,paperTitle,projectId'||!context.projectId||context.namespace!==source?.namespace||context.paperId!==source.paperId||context.paperTitle!==source.title||['namespace','projectId','paperId','paperTitle'].some(k=>record.origin?.[k]!==context[k]))throw Error('STEP_INPUT_SCOPE_MISMATCH');
 const {reference}=await prepareManualReplyReference({record,replyId:q.replyId,paper,source,workflowRaw:q.workflowRaw},crypto),trace=reference.preparation.trace;
 if(trace.stepOrigin!=='custom_graph')throw Error('STEP_INPUT_CUSTOM_GRAPH_REQUIRED');
 await importWorkflow(q.workflowRaw,crypto);const w=JSON.parse(q.workflowRaw).state,g=w.graphs.find(g=>g.version===w.currentVersion),node=g.nodes.find(n=>n.id===q.targetNodeId);
 if(!node||node.dependsOn.length!==1||node.dependsOn[0]!==trace.nodeId)throw Error('STEP_INPUT_SINGLE_DIRECT_DEPENDENCY_REQUIRED');
 const upstreamNode=g.nodes.find(n=>n.id===trace.nodeId);
 if(node.kind==='review'&&(node.reviewTarget!==trace.nodeId||upstreamNode?.kind!=='work'))throw Error('HUMAN_REVIEW_SINGLE_REVIEW_TARGET_REQUIRED');
 if(upstreamNode?.kind==='review'){
  const multi=record.prepared.schema===MANUAL_MULTI_STEP_INPUT_SCHEMA;
  if(node.kind!=='work'||(multi?!validMultiReviewInput(record.prepared,upstreamNode,g):upstreamNode.dependsOn.length!==1||upstreamNode.reviewTarget!==upstreamNode.dependsOn[0]||record.prepared.schema!=='prism-manual-step-input-v1'||record.prepared.upstream.reference.preparation.trace.nodeId!==upstreamNode.reviewTarget))throw Error('HUMAN_REVIEW_COMPOSED_REVIEW_INPUT_REQUIRED');
  if(record.replies.at(-1)?.id!==q.replyId)throw Error('HUMAN_REVIEW_LATEST_REPLY_REQUIRED');
  if(q.prompt!==node.prompt)throw Error('HUMAN_REVIEW_UNEDITED_TARGET_PROMPT_REQUIRED');
  const args={reference,reviewTargetId:upstreamNode.reviewTarget,target:node,targetPromptSha256:await sha256(node.prompt,crypto)};
  const subject=multi?makeManualMultiReviewSubject({...args,reviewInputs:record.prepared.upstreams.map(u=>u.reference)}):makeManualReviewSubject({...args,reviewInput:record.prepared.upstream.reference});
  if(reviewEvent?.decision!=='approved'||JSON.stringify(reviewEvent.subject)!==JSON.stringify(subject))throw Error('HUMAN_REVIEW_CURRENT_APPROVAL_REQUIRED');
 }
 // Approval is an external live sidecar. It never changes material bytes or binding.

 const base=await createLocalPreparation({filename:paper.document.filename,text:paper.document.text,prompt:q.prompt,stepName:node.name,trace:{documentOrigin:'workspace_copy',stepOrigin:'custom_graph',stepIndex:null,promptVersion:node.promptVersion,stepNameAtRead:node.name,promptEdited:q.prompt!==node.prompt,stepNameEdited:false,nodeId:node.id,graphVersion:g.version,graphSha256:g.sha256}},crypto);
 const payload={schema:MANUAL_STEP_INPUT_SCHEMA,purpose:'manual-step-handoff-only',authority:'none',executionAllowed:false,networkAllowed:false,base,source,origin:context,target:{nodeId:node.id,dependsOn:[...node.dependsOn],graphVersion:g.version,graphSha256:g.sha256},upstream:{reference,content:record.replies.find(r=>r.id===q.replyId).content}};
 const result={...payload,integritySha256:await sha256(JSON.stringify(payload),crypto)};return readManualStepInput(JSON.stringify(result),crypto);
}
function validMultiReviewInput(p,node,g){
 return node?.kind==='review'&&node.dependsOn.length>=2&&node.dependsOn.length<=8&&node.dependsOn.includes(node.reviewTarget)&&node.dependsOn.every(id=>g.nodes.find(n=>n.id===id)?.kind==='work')&&p?.schema===MANUAL_MULTI_STEP_INPUT_SCHEMA&&p.target.nodeId===node.id&&JSON.stringify(p.target.dependsOn)===JSON.stringify(node.dependsOn)&&p.upstreams.length===node.dependsOn.length&&p.upstreams.every((u,i)=>u.reference.preparation.trace.nodeId===node.dependsOn[i]);
}
// Multi-input is a new review-only operation. Existing single-input calls still emit v1 bytes.
export async function prepareManualMultiReviewInput(input,crypto=globalThis.crypto){
 if(!input||Object.keys(input).sort().join(',')!=='context,paper,prompt,selections,source,targetNodeId,workflowRaw'||!Array.isArray(input.selections)||input.selections.length<2||input.selections.length>8)throw Error('MULTI_STEP_INPUT_ARGUMENTS');
 const q=JSON.parse(JSON.stringify(input)),{context,source,paper}=q;
 if(!context||Object.keys(context).sort().join(',')!=='namespace,paperId,paperTitle,projectId'||!context.projectId||context.namespace!==source?.namespace||context.paperId!==source.paperId||context.paperTitle!==source.title)throw Error('STEP_INPUT_SCOPE_MISMATCH');
 await importWorkflow(q.workflowRaw,crypto);const w=JSON.parse(q.workflowRaw).state,g=w.graphs.find(g=>g.version===w.currentVersion),node=g.nodes.find(n=>n.id===q.targetNodeId);
 if(!node||node.kind!=='review'||node.dependsOn.length<2||node.dependsOn.length>8||!node.dependsOn.includes(node.reviewTarget)||!node.dependsOn.every(id=>g.nodes.find(n=>n.id===id)?.kind==='work')||q.selections.length!==node.dependsOn.length)throw Error('MULTI_REVIEW_ALL_DIRECT_WORK_REQUIRED');
 if(q.prompt!==node.prompt)throw Error('HUMAN_REVIEW_UNEDITED_TARGET_PROMPT_REQUIRED');
 const byNode=new Map(),recordIds=new Set();
 for(const selection of q.selections){
  if(!selection||Object.keys(selection).sort().join(',')!=='record,replyId')throw Error('MULTI_STEP_INPUT_SELECTION');
  const {record,replyId}=selection;
  if(['namespace','projectId','paperId','paperTitle'].some(k=>record?.origin?.[k]!==context[k]))throw Error('STEP_INPUT_SCOPE_MISMATCH');
  const {reference}=await prepareManualReplyReference({record,replyId,paper,source,workflowRaw:q.workflowRaw},crypto),trace=reference.preparation.trace,work=g.nodes.find(n=>n.id===trace.nodeId);
  if(trace.stepOrigin!=='custom_graph'||!node.dependsOn.includes(trace.nodeId)||work?.kind!=='work'||byNode.has(trace.nodeId)||recordIds.has(reference.recordId))throw Error('MULTI_REVIEW_DISTINCT_DIRECT_WORK_REQUIRED');
  // A work node with a direct review dependency cannot be represented by a standalone preparation.
  // No live ancestor approval is inferred here; the source's own copy gate checked that handoff.
  if(work.dependsOn.some(id=>g.nodes.find(n=>n.id===id)?.kind==='review')){
   const p=record.prepared,r=p?.upstream?.reference;
   if(work.dependsOn.length!==1||p?.schema!==MANUAL_STEP_INPUT_SCHEMA||p.target.nodeId!==work.id||JSON.stringify(p.target.dependsOn)!==JSON.stringify(work.dependsOn)||r?.preparation?.trace?.nodeId!==work.dependsOn[0])throw Error('HUMAN_REVIEW_USE_APPROVED_CHAIN_NOT_STANDALONE');
  }
  byNode.set(trace.nodeId,{reference,content:record.replies.find(r=>r.id===replyId).content});recordIds.add(reference.recordId);
 }
 if(byNode.size!==node.dependsOn.length)throw Error('MULTI_REVIEW_ALL_DIRECT_WORK_REQUIRED');
 const base=await createLocalPreparation({filename:paper.document.filename,text:paper.document.text,prompt:q.prompt,stepName:node.name,trace:{documentOrigin:'workspace_copy',stepOrigin:'custom_graph',stepIndex:null,promptVersion:node.promptVersion,stepNameAtRead:node.name,promptEdited:false,stepNameEdited:false,nodeId:node.id,graphVersion:g.version,graphSha256:g.sha256}},crypto);
 const payload={schema:MANUAL_MULTI_STEP_INPUT_SCHEMA,purpose:'manual-step-handoff-only',authority:'none',executionAllowed:false,networkAllowed:false,base,source,origin:context,target:{nodeId:node.id,dependsOn:[...node.dependsOn],graphVersion:g.version,graphSha256:g.sha256},upstreams:node.dependsOn.map(id=>byNode.get(id))};
 return readManualStepInput(JSON.stringify({...payload,integritySha256:await sha256(JSON.stringify(payload),crypto)}),crypto);
}

// Eligibility is deliberately separate from archive format validation. All ancestors
// must remain pre-review; graph import is the caller's responsibility.
export function assertManualMultiWorkTarget(graph,nodeId){
 const nodes=graph?.nodes;
 if(!Array.isArray(nodes)||nodes.length>256)throw Error('MULTI_WORK_GRAPH_REQUIRED');
 const byId=new Map(nodes.map(n=>[n.id,n])),target=byId.get(nodeId);
 if(byId.size!==nodes.length||!target||target.kind!=='work'||!Array.isArray(target.dependsOn)||target.dependsOn.length<2||target.dependsOn.length>8||new Set(target.dependsOn).size!==target.dependsOn.length)throw Error('MULTI_WORK_ALL_DIRECT_WORK_REQUIRED');
 const seen=new Set(),visiting=new Set();
 function visit(id){
  if(visiting.has(id))throw Error('MULTI_WORK_GRAPH_CYCLE');
  if(seen.has(id))return;
  const node=byId.get(id);
  if(!node||node.kind!=='work'||!Array.isArray(node.dependsOn))throw Error('MULTI_WORK_PRE_REVIEW_ANCESTRY_REQUIRED');
  visiting.add(id);for(const parent of node.dependsOn)visit(parent);visiting.delete(id);seen.add(id);
 }
 visit(nodeId);return target;
}
export async function prepareManualMultiWorkInput(input,crypto=globalThis.crypto){
 if(!input||Object.keys(input).sort().join(',')!=='context,paper,prompt,selections,source,targetNodeId,workflowRaw'||!Array.isArray(input.selections)||input.selections.length<2||input.selections.length>8)throw Error('MULTI_STEP_INPUT_ARGUMENTS');
 const q=JSON.parse(JSON.stringify(input)),{context,source,paper}=q;
 if(!context||Object.keys(context).sort().join(',')!=='namespace,paperId,paperTitle,projectId'||!context.projectId||context.namespace!==source?.namespace||context.paperId!==source.paperId||context.paperTitle!==source.title)throw Error('STEP_INPUT_SCOPE_MISMATCH');
 await importWorkflow(q.workflowRaw,crypto);const w=JSON.parse(q.workflowRaw).state,g=w.graphs.find(g=>g.version===w.currentVersion),node=assertManualMultiWorkTarget(g,q.targetNodeId);
 if(q.selections.length!==node.dependsOn.length)throw Error('MULTI_WORK_ALL_DIRECT_WORK_REQUIRED');
 if(q.prompt!==node.prompt)throw Error('MULTI_WORK_UNEDITED_TARGET_PROMPT_REQUIRED');
 const byNode=new Map(),recordIds=new Set();
 for(const selection of q.selections){
  if(!selection||Object.keys(selection).sort().join(',')!=='record,replyId')throw Error('MULTI_STEP_INPUT_SELECTION');
  const {record,replyId}=selection;
  if(['namespace','projectId','paperId','paperTitle'].some(k=>record?.origin?.[k]!==context[k]))throw Error('STEP_INPUT_SCOPE_MISMATCH');
  const {reference}=await prepareManualReplyReference({record,replyId,paper,source,workflowRaw:q.workflowRaw},crypto),trace=reference.preparation.trace;
  if(trace.stepOrigin!=='custom_graph'||!node.dependsOn.includes(trace.nodeId)||byNode.has(trace.nodeId)||recordIds.has(reference.recordId))throw Error('MULTI_WORK_DISTINCT_DIRECT_WORK_REQUIRED');
  byNode.set(trace.nodeId,{reference,content:record.replies.find(r=>r.id===replyId).content});recordIds.add(reference.recordId);
 }
 if(byNode.size!==node.dependsOn.length)throw Error('MULTI_WORK_ALL_DIRECT_WORK_REQUIRED');
 const base=await createLocalPreparation({filename:paper.document.filename,text:paper.document.text,prompt:q.prompt,stepName:node.name,trace:{documentOrigin:'workspace_copy',stepOrigin:'custom_graph',stepIndex:null,promptVersion:node.promptVersion,stepNameAtRead:node.name,promptEdited:false,stepNameEdited:false,nodeId:node.id,graphVersion:g.version,graphSha256:g.sha256}},crypto);
 const payload={schema:MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA,purpose:'manual-step-handoff-only',authority:'none',executionAllowed:false,networkAllowed:false,base,source,origin:context,target:{nodeId:node.id,kind:'work',inputMode:'all-direct-work-pre-review',dependsOn:[...node.dependsOn],graphVersion:g.version,graphSha256:g.sha256},upstreams:node.dependsOn.map(id=>byNode.get(id))};
 return readManualStepInput(JSON.stringify({...payload,integritySha256:await sha256(JSON.stringify(payload),crypto)}),crypto);
}
