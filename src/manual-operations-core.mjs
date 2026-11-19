import {readManualArchive} from './manual-archive-core.mjs';
import {createLocalPreparation} from './local-preparation-core.mjs';
import {manualPreparationBase,isManualStepInput,MANUAL_STEP_INPUT_SCHEMA,MANUAL_MULTI_STEP_INPUT_SCHEMA} from './manual-step-input-format.mjs';
import {manualReviewScope} from './manual-review-core.mjs';
import {sha256} from './custom-core.mjs';
// This projection is deliberately not an execution state or a text index.
const clone=x=>JSON.parse(JSON.stringify(x));
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=512;
export function manualOperationIdentity({namespace,projectId,paperId,recordId,binding}){return JSON.stringify([namespace,projectId,paperId,recordId,binding])}
export async function inspectManualOperationRecords(records,crypto=globalThis.crypto){
 if(!Array.isArray(records)||records.length>20)throw Error('OPERATIONS_RECORD_LIMIT');
 const results=[];
 for(const [index,input] of records.entries()){
  const origin=input?.origin,identity=origin&&['namespace','paperId'].every(k=>safeId(origin[k]))&&(origin.projectId===''||safeId(origin.projectId))&&safeId(input.id)?{namespace:origin.namespace,projectId:origin.projectId,paperId:origin.paperId,recordId:input.id,binding:typeof input.binding==='string'&&/^[a-f0-9]{64}$/.test(input.binding)?input.binding:null}:null;
  let record=null,replyHashes={};try{
   record=(await readManualArchive(JSON.stringify({schema:'prism-manual-research-records-v1',authority:'none',executionAllowed:false,records:[input]}),{crypto,prepare:createLocalPreparation})).records[0];
   for(const reply of record.replies)replyHashes[reply.id]={sha256:await sha256(reply.content,crypto),byteLength:new TextEncoder().encode(reply.content).length};
  }catch{record=null;replyHashes={}}
  results.push({index,identity,record,replyHashes,rawId:safeId(input?.id)?input.id:null});
 }
 return results;
}
export function createManualOperationsView({namespace,projectId,paperIds,papers,inspected,ledger,reviews,errors=[]}){
 if(!namespace||!projectId||!Array.isArray(paperIds))throw Error('OPERATIONS_PROJECT_REQUIRED');
 const memberIds=new Set(paperIds),paperById=new Map(papers.map(p=>[p.id,p])),rows=[],byKey=new Map(),idKeys=new Map(),pageIds=new Map();
 const inScope=x=>x&&x.namespace===namespace&&x.projectId===projectId&&memberIds.has(x.paperId);
 const register=x=>{const k=manualOperationIdentity(x);if(!idKeys.has(x.recordId))idKeys.set(x.recordId,new Set());idKeys.get(x.recordId).add(k)};
 for(const p of inspected){if(p.identity)register(p.identity);const id=p.rawId;if(id)pageIds.set(id,(pageIds.get(id)||0)+1)}
 const ledgerRows=(ledger?.records||[]).map(r=>({...r,namespace:ledger.namespace,recordId:r.id}));for(const r of ledgerRows)register(r);
 const events=reviews?.events||[],latest=new Map();for(const e of events){latest.set(manualReviewScope(e.subject),e.id);register({...e.subject,binding:e.subject.preparationSha256})}
 function make(identity,kind,index=''){
  const paper=paperById.get(identity.paperId),row={key:kind+':'+manualOperationIdentity(identity)+':'+index,...identity,paperTitle:paper?.title||'当前论文已不可用',canNavigate:!!paper,original:'missing',recordIndex:null,conflict:false,kind:'unknown',stepName:'',clipboard:null,ledgerClipboard:null,sending:null,replyCount:null,decisions:[],canLocate:false};rows.push(row);return row;
 }
 for(const p of inspected){if(!inScope(p.identity))continue;const row=make(p.identity,'page',p.index);row.recordIndex=p.index;row.original=p.record?'checked':'invalid';if(p.record){const b=manualPreparationBase(p.record.prepared);Object.assign(row,{kind:isManualStepInput(p.record.prepared)?'step_input':'initial',stepName:b.step.name,clipboard:p.record.clipboard,sending:p.record.sending,replyCount:p.record.replies.length})}const key=manualOperationIdentity(p.identity);if(!byKey.has(key))byKey.set(key,row)}
 for(const l of ledgerRows){if(!inScope(l))continue;const key=manualOperationIdentity(l);let row=byKey.get(key);if(!row||row.original==='invalid'){row=make({namespace,projectId,paperId:l.paperId,recordId:l.id,binding:l.binding},'metadata');byKey.set(key,row)}row.ledgerClipboard=l.clipboard;row.kind=l.kind}
 for(const e of events){const s=e.subject,identity={namespace:s.namespace,projectId:s.projectId,paperId:s.paperId,recordId:s.recordId,binding:s.preparationSha256};if(!inScope(identity))continue;const key=manualOperationIdentity(identity);let row=byKey.get(key);if(!row||row.original==='invalid'){row=make(identity,'review');byKey.set(key,row)}
  const p=row.recordIndex===null?null:inspected[row.recordIndex],record=p?.record,base=record?manualPreparationBase(record.prepared):null,hash=p?.replyHashes[s.replyId],input=record?.prepared?.upstream?.reference;
  const commonMatches=!!record&&record.prepared.integritySha256===s.preparationSha256&&hash?.sha256===s.replySha256&&hash.byteLength===s.replyByteLength&&record.prepared?.source?.snapshotSha256===s.sourceSnapshotSha256&&record.prepared?.source?.documentSha256===s.documentSha256&&record.prepared?.target?.nodeId===s.reviewNodeId&&base.step.sha256===s.promptSha256&&base.document.sha256===s.documentSha256&&base.trace?.nodeId===s.reviewNodeId&&base.trace?.graphVersion===s.graphVersion&&base.trace?.graphSha256===s.graphSha256&&base.trace?.promptVersion===s.promptVersion;
  // Each ordered input must match. An intact primary reference alone is never
  // evidence for a current choice concerning a different secondary input.
  const multi=s.schema==='prism-manual-review-subject-v2';
  const inputMatches=multi?record?.prepared?.schema===MANUAL_MULTI_STEP_INPUT_SCHEMA&&record.prepared.target.dependsOn.includes(s.reviewTargetId)&&Array.isArray(s.reviewInputs)&&s.reviewInputs.length===record.prepared.upstreams.length&&record.prepared.upstreams.every(({reference:r},i)=>{
   const values={nodeId:r.preparation.trace.nodeId,recordId:r.recordId,preparationSha256:r.preparation.integritySha256,promptVersion:r.preparation.trace.promptVersion,promptSha256:r.preparation.promptSha256,replyId:r.reply.id,replyByteLength:r.reply.byteLength,replySha256:r.reply.sha256};
   return Object.keys(values).every(k=>s.reviewInputs[i]?.[k]===values[k]);
  }):record?.prepared?.schema===MANUAL_STEP_INPUT_SCHEMA&&input?.preparation?.trace?.nodeId===s.reviewTargetId&&input?.recordId===s.reviewInputRecordId&&input?.reply?.id===s.reviewInputReplyId&&input?.reply?.sha256===s.reviewInputReplySha256&&input?.preparation?.integritySha256===s.reviewInputPreparationSha256;
  const originalMatches=commonMatches&&inputMatches;
  row.decisions.push({id:e.id,sequence:e.sequence,decision:e.decision,targetNodeId:s.targetNodeId,reviewNodeId:s.reviewNodeId,replyId:s.replyId,replySha256:s.replySha256,latest:latest.get(manualReviewScope(s))===e.id,originalMatches,check:'historical'});
 }
 for(const row of rows){row.conflict=(idKeys.get(row.recordId)?.size||0)>1||(pageIds.get(row.recordId)||0)>1;row.canLocate=row.original==='checked'&&!row.conflict&&row.canNavigate;if(row.conflict)for(const d of row.decisions)d.originalMatches=false;row.decisions.sort((a,b)=>b.sequence-a.sequence)}
 rows.sort((a,b)=>paperIds.indexOf(a.paperId)-paperIds.indexOf(b.paperId));
 return {namespace,projectId,rows,errors:clone(errors),paperCount:new Set(rows.map(r=>r.paperId)).size,unattributedCount:inspected.filter(r=>!r.identity).length,authority:'none',readOnly:true};
}
export function filterManualOperations(rows,{paperId='',status='all'}={}){
 const allowed=['all','originals','metadata','unknown','replies','review','attention','pending_review'];if(!allowed.includes(status)||typeof paperId!=='string')throw Error('OPERATIONS_FILTER');
 return rows.filter(r=>(!paperId||r.paperId===paperId)&&(status==='all'||status==='originals'&&r.original==='checked'||status==='metadata'&&r.original==='missing'||status==='unknown'&&([r.clipboard,r.ledgerClipboard].some(x=>x==='pending'||x==='unknown'))||status==='replies'&&r.replyCount>0||status==='review'&&r.decisions.length>0||status==='pending_review'&&r.targets?.some(t=>t.state==='needs_review')||status==='attention'&&(r.conflict||r.original==='invalid'||r.decisions.some(d=>d.latest&&d.decision==='approved'&&d.check!=='current'))));
}

// Graph-first navigation metadata, never an execution/completion projection.
export function createManualChainBoard({paperId,graph,inspected,rows,paper,namespace,projectId,source}){
 const nodes=graph.nodes.map(node=>{
  const dependencies=node.dependsOn.map(id=>graph.nodes.find(n=>n.id===id));
  let task=null;
  if(node.kind==='work'&&!dependencies.length)task='preparation';
  else if(dependencies.length===1&&(node.kind==='work'||dependencies[0]?.kind==='work'&&node.reviewTarget===dependencies[0].id))task='single';
  else if(dependencies.length>=2&&dependencies.length<=8&&dependencies.every(n=>n?.kind==='work'))task=node.kind==='review'?'multireview':'multiwork';
  const records=[];
  for(const row of rows){
   if(row.paperId!==paperId||!row.canLocate||row.recordIndex===null)continue;
   const record=inspected[row.recordIndex]?.record,b=manualPreparationBase(record?.prepared),t=b?.trace;
   if(!record||!t||record.origin?.namespace!==namespace||record.origin?.projectId!==projectId||record.origin?.paperTitle!==paper.title||t.documentOrigin!=='workspace_copy'||t.stepOrigin!=='custom_graph'||t.nodeId!==node.id||t.graphVersion!==graph.version||t.graphSha256!==graph.sha256||t.promptEdited||t.stepNameEdited||t.promptVersion!==node.promptVersion||b.step.prompt!==node.prompt||b.step.name!==node.name||b.document.text!==paper.document?.text||b.document.sha256!==paper.document?.sha256||b.document.filename!==paper.document?.filename)continue;
   if(isManualStepInput(record.prepared)&&Object.keys(source).some(k=>record.prepared.source?.[k]!==source[k]))continue;
   records.push({key:row.key,recordId:row.recordId,binding:row.binding,replyCount:row.replyCount,targets:clone(row.targets||[]),canReview:node.kind==='review'&&isManualStepInput(record.prepared)&&record.replies.length>0});
  }
  return {id:node.id,name:node.name,kind:node.kind,dependsOn:[...node.dependsOn],successors:graph.nodes.filter(n=>n.dependsOn.includes(node.id)).map(n=>n.id),task,availableTasks:[...(task?[task]:[]),...(records.some(r=>r.canReview)?['humanreview']:[])],records};
 });
 return {paperId,graphVersion:graph.version,graphSha256:graph.sha256,nodes};
}
