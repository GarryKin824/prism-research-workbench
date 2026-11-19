import {readManualArchive} from './manual-archive-core.mjs';
import {createLocalPreparation} from './local-preparation-core.mjs';
import {manualPreparationBase,MANUAL_STEP_INPUT_SCHEMA,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA} from './manual-step-input-format.mjs';
import {prepareManualReplyReference} from './manual-reply-reference.mjs';
import {prepareManualStepInput,prepareManualMultiReviewInput,prepareManualMultiWorkInput,assertManualMultiWorkTarget} from './manual-step-input-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {emptyManualReviews,loadManualReviews} from './manual-review-core.mjs';
import {loadManualHandoffLedger} from './manual-handoff-ledger-core.mjs';
import {createManualRecoveryFence,captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import {importWorkflow,sha256} from './custom-core.mjs';
const clone=value=>JSON.parse(JSON.stringify(value)),fail=code=>{throw Error(code)};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
// This controller admits bounded originals into memory only. It never writes a sidecar or clipboard.
export function createManualRecoveryAdmissionController({store,storage,crypto=globalThis.crypto,withLock,getRecords,getRecoveryFence}){
 const namespace=store.getStorageKey(),reviewKey=namespace+':manual-review-decisions-v1',handoffKey=namespace+':manual-handoff-ledger-v1',lockName=handoffKey+':copy',issued=new WeakMap();
 let busy=false;
 const check=()=>{store.assertCurrentStorage();if(store.getStorageKey()!==namespace)fail('MANUAL_RECOVERY_NAMESPACE_CHANGED')};
 function capture(input,isCurrent){
  if(!exact(input,'archiveRaw,context')||typeof input.archiveRaw!=='string'||!exact(input.context,'namespace,projectId,paperId,paperTitle')||input.context.namespace!==namespace||!input.context.projectId)fail('MANUAL_RECOVERY_INPUT');
  check();if(typeof getRecords!=='function')fail('MANUAL_RECOVERY_LIVE_RESOLVER_REQUIRED');
  const records=getRecords();if(!Array.isArray(records)||records.length)fail('MANUAL_RECOVERY_EMPTY_SESSION_REQUIRED');
  const inputRaw=JSON.stringify(input),q=clone(input),paper=clone(store.getSnapshot().papers.find(p=>p.id===q.context.paperId)??null);
  if(!paper||paper.title!==q.context.paperTitle)fail('MANUAL_RECOVERY_PAPER_MISMATCH');
  const paperRaw=JSON.stringify(paper),workflowKey=namespace+':custom-workflow-v1:'+paper.id,workflowRaw=storage.getItem(workflowKey),keys=[workflowKey,namespace+':project-library-v1',namespace+':project-planning-v1'],raws=keys.map(key=>storage.getItem(key)),fence=captureManualRecoveryFence(getRecoveryFence);
  const stable=()=>{check();fence.stable();if(isCurrent()!==true||JSON.stringify(input)!==inputRaw)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED');const live=getRecords();if(!Array.isArray(live)||live.length)fail('MANUAL_RECOVERY_EMPTY_SESSION_REQUIRED');if(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id)??null)!==paperRaw||keys.some((key,i)=>storage.getItem(key)!==raws[i]))fail('MANUAL_RECOVERY_SOURCE_CHANGED')};
  return {q,paper,paperRaw,workflowRaw,stable,fence};
 }
 async function evaluate(captured){
  const {q,paper,paperRaw,workflowRaw,stable}=captured,archive=await readManualArchive(q.archiveRaw,{crypto,prepare:createLocalPreparation});stable();
  await importWorkflow(workflowRaw,crypto);stable();const workflow=JSON.parse(workflowRaw).state,graph=workflow.graphs.find(g=>g.version===workflow.currentVersion);
  const members=createProjectLibraryController({store,storage,crypto});await members.initialize();stable();const membership=await members.snapshot(q.context.projectId);stable();
  if(!membership.paperIds.includes(paper.id))fail('MANUAL_RECOVERY_PROJECT_MEMBERSHIP');
  const fullStable=()=>{stable();membership.stable()},source={namespace,paperId:paper.id,title:paper.title,documentSha256:paper.document?.sha256??null,snapshotSha256:await sha256(paperRaw,crypto)};fullStable();
  if(!paper.document||workflow.source?.namespace!==namespace||workflow.source?.paperId!==paper.id||workflow.source?.paperTitle!==paper.title||workflow.source?.documentSha256!==paper.document.sha256)fail('MANUAL_RECOVERY_GRAPH_SOURCE_MISMATCH');
  const byId=new Map(archive.records.map(record=>[record.id,record])),rows=new Map(),visiting=new Set(),dependencies=new Map();
  async function currentBase(record){
   if(['namespace','projectId','paperId','paperTitle'].some(key=>record.origin?.[key]!==q.context[key]))fail('MANUAL_RECOVERY_FOREIGN_SCOPE');
   const base=manualPreparationBase(record.prepared),trace=base.trace,node=graph.nodes.find(n=>n.id===trace?.nodeId);
   if(!node||trace.documentOrigin!=='workspace_copy'||trace.stepOrigin!=='custom_graph'||trace.graphVersion!==graph.version||trace.graphSha256!==graph.sha256||trace.promptEdited||trace.stepNameEdited)fail('MANUAL_RECOVERY_STALE_TRACE');
   const expected=await createLocalPreparation({filename:paper.document.filename,text:paper.document.text,prompt:node.prompt,stepName:node.name,trace:{documentOrigin:'workspace_copy',stepOrigin:'custom_graph',stepIndex:null,promptVersion:node.promptVersion,stepNameAtRead:node.name,promptEdited:false,stepNameEdited:false,nodeId:node.id,graphVersion:graph.version,graphSha256:graph.sha256}},crypto);fullStable();
   if(JSON.stringify(base)!==JSON.stringify(expected))fail('MANUAL_RECOVERY_CURRENT_PREPARATION_MISMATCH');
   for(const reply of record.replies){await prepareManualReplyReference({record,replyId:reply.id,paper,source,workflowRaw},crypto);fullStable()}
   return node;
  }
  // Memoized DFS is bounded by the archive reader's 20-record limit, not archive order.
  // Every composed edge resolves an actual original and is regenerated from current source.
  // Hash-valid embedded references alone never establish a recoverable relationship.
  for(const record of archive.records)rows.set(record.id,{recordId:record.id,eligible:false,reason:null,nodeId:manualPreparationBase(record.prepared).trace?.nodeId??null,kind:'historical'});
  async function visit(record){
   const row=rows.get(record.id);if(row.eligible||row.reason)return row;
   if(visiting.has(record.id))fail('MANUAL_RECOVERY_ORIGINAL_CLOSURE_CYCLE');
   visiting.add(record.id);
   try{
    const node=await currentBase(record),p=record.prepared;row.kind=node.kind;
    if(node.kind==='work'&&node.dependsOn.length===0){
     if(p.schema!=='prism-local-preparation-v1')fail('MANUAL_RECOVERY_INPUT_RELATIONSHIP_MISMATCH');
     dependencies.set(record.id,[]);row.eligible=true;return row;
    }
    const direct=node.dependsOn.map(id=>graph.nodes.find(n=>n.id===id));
    if(node.kind==='work'){
     if(p.schema===MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA)assertManualMultiWorkTarget(graph,node.id);
     else if(direct.some(n=>n?.kind==='review'))fail('MANUAL_RECOVERY_POST_REVIEW_WORK_READ_ONLY');
     else if(direct.length!==1||direct[0]?.kind!=='work'||p.schema!==MANUAL_STEP_INPUT_SCHEMA)fail('MANUAL_RECOVERY_NONROOT_WORK_READ_ONLY');
    }else if(node.kind!=='review'||direct.length<1||direct.length>8||direct.some(n=>n?.kind!=='work')||!node.dependsOn.includes(node.reviewTarget)||p.schema!==(direct.length===1?MANUAL_STEP_INPUT_SCHEMA:MANUAL_MULTI_STEP_INPUT_SCHEMA))fail('MANUAL_RECOVERY_UNSUPPORTED_REVIEW_READ_ONLY');
    const upstreams=[MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA].includes(p.schema)?p.upstreams:[p.upstream],selections=[];
    if(upstreams.length!==direct.length)fail('MANUAL_RECOVERY_INPUT_RELATIONSHIP_MISMATCH');
    for(const [index,upstream] of upstreams.entries()){
     const reference=upstream.reference,original=byId.get(reference.recordId);
     if(!original)fail('MANUAL_RECOVERY_ORIGINAL_CLOSURE_MISSING');
     if(reference.preparation.trace.nodeId!==node.dependsOn[index]||manualPreparationBase(original.prepared).trace?.nodeId!==node.dependsOn[index])fail('MANUAL_RECOVERY_INPUT_RELATIONSHIP_MISMATCH');
     const parent=await visit(original);fullStable();
     if(!parent.eligible||parent.kind!=='work')fail('MANUAL_RECOVERY_ORIGINAL_CLOSURE_MISSING');
     selections.push({record:original,replyId:reference.reply.id});
    }
    const common={context:q.context,paper,source,workflowRaw,targetNodeId:node.id,prompt:node.prompt};
    const expected=p.schema===MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA?await prepareManualMultiWorkInput({...common,selections},crypto):p.schema===MANUAL_MULTI_STEP_INPUT_SCHEMA?await prepareManualMultiReviewInput({...common,selections},crypto):await prepareManualStepInput({...common,...selections[0]},crypto);fullStable();
    if(JSON.stringify(expected)!==JSON.stringify(p))fail('MANUAL_RECOVERY_INPUT_RELATIONSHIP_MISMATCH');
    dependencies.set(record.id,selections.map(selection=>selection.record.id));row.eligible=true;
   }catch(error){fullStable();row.reason=error.message}finally{visiting.delete(record.id)}
   return row;
  }
  for(const record of archive.records)await visit(record);
  function closure(id,seen=new Set()){
   for(const parentId of dependencies.get(id)||[])if(!seen.has(parentId)){closure(parentId,seen);seen.add(parentId)}
   return [...seen];
  }
  for(const row of rows.values())row.requiredRecordIds=row.eligible?closure(row.recordId):[];
  fullStable();const candidates=[...rows.values()],reservedBindings=[...new Set(archive.records.filter(record=>record.origin?.namespace===namespace).map(record=>record.binding))];
  return {archive,candidates,reservedBindings,dependencies,stable:fullStable,source,graph};
 }
 async function inspect(input,{isCurrent=()=>true}={}){const result=await evaluate(capture(input,isCurrent));result.stable();return {candidates:clone(result.candidates),summary:{recordCount:result.archive.records.length,eligibleCount:result.candidates.filter(row=>row.eligible).length}}}
 async function prepare(input,{isCurrent=()=>true}={}){
  if(!exact(input,'archiveRaw,context,recordIds')||!Array.isArray(input.recordIds)||!input.recordIds.length||input.recordIds.length>20||input.recordIds.some(id=>typeof id!=='string')||new Set(input.recordIds).size!==input.recordIds.length)fail('MANUAL_RECOVERY_SELECTION_REQUIRED');
  const originalRaw=JSON.stringify(input),{recordIds,...material}=input,current=()=>isCurrent()===true&&JSON.stringify(input)===originalRaw,captured=capture(material,current),result=await evaluate(captured),selected=new Set(recordIds);
  for(const id of selected){const row=result.candidates.find(row=>row.recordId===id);if(!row?.eligible)fail('MANUAL_RECOVERY_SELECTED_RECORD_UNAVAILABLE')}
  const chosen=result.archive.records.filter(record=>selected.has(record.id));
  // Requiring every selected node's direct originals also requires the full transitive closure.
  for(const record of chosen)if(result.dependencies.get(record.id)?.some(id=>!selected.has(id)))fail('MANUAL_RECOVERY_SELECTED_CLOSURE_MISSING');
  const drafts=Object.create(null),records=chosen.map(record=>{const {replyDraft,...original}=record;if(replyDraft)drafts[record.id]=replyDraft.content;return original});
  const excluded=result.candidates.filter(row=>!selected.has(row.recordId)).map(row=>({recordId:row.recordId,reason:row.reason||'MANUAL_RECOVERY_NOT_SELECTED'}));
  const preview={records,drafts,reservedBindings:result.reservedBindings,excluded,candidates:result.candidates,summary:{recordCount:records.length,replyCount:records.reduce((n,r)=>n+r.replies.length,0),draftCount:Object.keys(drafts).length,excludedRecordCount:excluded.length,requiresFreshReview:true}};
  result.stable();issued.set(preview,{captured,result,raw:JSON.stringify(preview)});return preview;
 }
 async function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true,onCommit}={}){
  if(busy)fail('MANUAL_RECOVERY_BUSY');const token=issued.get(preview);
  if(!token||explicitConfirmation!==true||typeof onCommit!=='function')fail('MANUAL_RECOVERY_CONFIRM_REQUIRED');if(onCommit.constructor?.name==='AsyncFunction')fail('MANUAL_RECOVERY_SYNCHRONOUS_COMMIT_REQUIRED');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_MANUAL_RECOVERY');
  const stable=()=>{token.result.stable();if(issued.get(preview)!==token||isCurrent()!==true||JSON.stringify(preview)!==token.raw)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED')};
  busy=true;try{return await withLock(lockName,async()=>{
   stable();const reviewRaw=storage.getItem(reviewKey),handoffRaw=storage.getItem(handoffKey),reviews=reviewRaw===null?emptyManualReviews(namespace):await loadManualReviews(reviewRaw,namespace,crypto);stable();
   const handoffs=handoffRaw===null?null:await loadManualHandoffLedger(handoffRaw,namespace,crypto);stable();
   // An identifier cannot silently change its original binding or ownership at admission.
   for(const record of preview.records){
    const existing=handoffs?.records.find(row=>row.id===record.id);
    if(existing&&(existing.binding!==record.binding||existing.paperId!==record.origin.paperId||existing.projectId!==record.origin.projectId||existing.kind!==(record.prepared.schema==='prism-local-preparation-v1'?'initial':'step_input')))fail('MANUAL_RECOVERY_AUDIT_ID_CONFLICT');
    for(const event of reviews.events)if(event.subject.recordId===record.id&&(event.subject.preparationSha256!==record.binding||event.subject.projectId!==record.origin.projectId||event.subject.paperId!==record.origin.paperId))fail('MANUAL_RECOVERY_AUDIT_ID_CONFLICT');
   }
   if(storage.getItem(reviewKey)!==reviewRaw||storage.getItem(handoffKey)!==handoffRaw)fail('MANUAL_RECOVERY_AUDIT_HEAD_CHANGED');
   token.captured.fence.assertHead(reviews);
   const records=clone(preview.records),drafts=clone(preview.drafts),reservedBindings=[...preview.reservedBindings],fence=createManualRecoveryFence({namespace,reviewState:reviews,recoveredRecords:records.filter(record=>token.result.candidates.find(row=>row.recordId===record.id)?.kind==='review'),reservedBindings});
   stable();if(storage.getItem(reviewKey)!==reviewRaw||storage.getItem(handoffKey)!==handoffRaw)fail('MANUAL_RECOVERY_AUDIT_HEAD_CHANGED');
   // Consume before admission. The UI must commit this complete payload synchronously, once.
   issued.delete(preview);const payload={records,drafts,reservedBindings,fence,archiveRecords:clone(token.result.archive.records)};const result=onCommit(payload);
   if(result&&typeof result.then==='function')fail('MANUAL_RECOVERY_SYNCHRONOUS_COMMIT_REQUIRED');
   return {recovered:true,recordCount:records.length,excludedRecordCount:preview.excluded.length,authority:'none',requiresFreshReview:true};
  })}finally{busy=false}
 }
 return {namespace,lockName,inspect,prepare,confirm,cancel:preview=>issued.delete(preview)};
}
