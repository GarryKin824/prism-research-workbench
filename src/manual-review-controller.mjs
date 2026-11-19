import {captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import * as review from './manual-review-core.mjs';
import {prepareManualReplyReference} from './manual-reply-reference.mjs';
import {manualPreparationBase,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA} from './manual-step-input-format.mjs';
import {prepareManualMultiReviewInput,prepareManualMultiWorkInput,assertManualMultiWorkTarget} from './manual-step-input-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {sha256,importWorkflow} from './custom-core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)};
// A live resolver is authority-bearing, unlike a supplied/imported archive or validate callback.
// Keep all originals stable, not only projected IDs/hashes, through the last synchronous guard.
export function captureManualRecords(getRecords,{required=false}={}){
 if(typeof getRecords!=='function'){
  if(required)fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED');
  return {available:false,stable:()=>true,exact:()=>fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED'),find:()=>fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED')};
 }
 const readRaw=()=>{
  const original=getRecords();if(!Array.isArray(original))fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED');
  if(original.length>20)fail('HUMAN_REVIEW_LIVE_RECORDS_LIMIT');
  const ids=new Set();for(const record of original){if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.id!=='string'||!record.id||record.id.length>128||ids.has(record.id))fail('HUMAN_REVIEW_LIVE_RECORDS_DUPLICATE');ids.add(record.id)}
  return JSON.stringify(original);
 };
 const raw=readRaw(),records=JSON.parse(raw);
 const stable=()=>{if(readRaw()!==raw)fail('HUMAN_REVIEW_LIVE_RECORDS_CHANGED');return true};
 const find=(id,replyId,context)=>{
  const record=records.find(r=>r.id===id);if(!record)fail('HUMAN_REVIEW_LIVE_RECORD_MISSING');
  if(!context||['namespace','projectId','paperId','paperTitle'].some(k=>record.origin?.[k]!==context[k]))fail('HUMAN_REVIEW_CONTEXT');
  if(!Array.isArray(record.replies)||record.replies.filter(r=>r.id===replyId).length!==1)fail('HUMAN_REVIEW_LIVE_REPLY_MISSING');
  return record;
 };
 const exact=(record,replyId,context)=>{const current=find(record?.id,replyId,context);if(JSON.stringify(record)!==JSON.stringify(current))fail('HUMAN_REVIEW_LIVE_RECORD_CHANGED');return current};
 return {available:true,stable,find,exact};
}
// Shares the handoff lock through decision commit and the entire clipboard attempt.
export function createManualReviewController({store,storage,crypto=globalThis.crypto,withLock,getRecords,getRecoveryFence}){
 const namespace=store.getStorageKey(),key=namespace+':manual-review-decisions-v1',lockName=namespace+':manual-handoff-ledger-v1:copy',issued=new WeakMap();
 let uncertain=false,observed=null,everPresent=false,busy=false,writeRecovery=null;
 function check(){if(uncertain)fail('HUMAN_REVIEW_UNKNOWN_RELOAD_REQUIRED');store.assertCurrentStorage();if(store.getStorageKey()!==namespace)fail('HUMAN_REVIEW_NAMESPACE_CHANGED')}
 function rawRead(){let raw;try{raw=storage.getItem(key)}catch{uncertain=true;fail('HUMAN_REVIEW_READ_UNKNOWN_NO_RETRY')}if(raw!==null)everPresent=true;else if(everPresent){uncertain=true;fail('HUMAN_REVIEW_ROLLBACK')}return raw}
 async function read(){check();const recovery=captureManualRecoveryFence(getRecoveryFence),raw=rawRead();let state;try{state=raw===null?review.emptyManualReviews(namespace):await review.loadManualReviews(raw,namespace,crypto)}catch(e){uncertain=true;throw e}check();recovery.stable();recovery.assertHead(state);if(rawRead()!==raw)fail('HUMAN_REVIEW_HEAD_CHANGED');if(observed&&((observed.schema===review.MANUAL_REVIEW_V2_SCHEMA&&state.schema!==observed.schema)||state.events.length<observed.events.length||observed.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(state.events[i])))){uncertain=true;fail('HUMAN_REVIEW_ROLLBACK')}observed=clone(state);return {raw,state,recovery}}
 const headStable=head=>{check();head.recovery.stable();head.recovery.assertHead(head.state);if(rawRead()!==head.raw)fail('HUMAN_REVIEW_PREVIEW_EXPIRED_HEAD_CHANGED')};
 async function inspect(){const {state}=await read();const heads=new Map();for(const e of state.events)heads.set(review.manualReviewScope(e.subject),e);return {key,schema:state.schema,canPersist:typeof withLock==='function',events:clone(state.events),latestIds:[...heads.values()].map(e=>e.id)}}
 function captureContext(context,isCurrent,recordSnapshot){
  check();const paper=clone(store.getSnapshot().papers.find(p=>p.id===context?.paperId)??null);if(!paper)fail('HUMAN_REVIEW_PAPER_MISSING');
  const paperRaw=JSON.stringify(paper),workflowKey=namespace+':custom-workflow-v1:'+paper.id,workflowRaw=storage.getItem(workflowKey),memberKey=namespace+':project-library-v1',projectKey=namespace+':project-planning-v1',memberRaw=storage.getItem(memberKey),projectRaw=storage.getItem(projectKey),records=recordSnapshot??captureManualRecords(getRecords),recovery=captureManualRecoveryFence(getRecoveryFence);
  const stable=()=>{check();records.stable();recovery.stable();if(isCurrent()!==true)fail('HUMAN_REVIEW_PREVIEW_EXPIRED');if(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id)??null)!==paperRaw||storage.getItem(workflowKey)!==workflowRaw||storage.getItem(memberKey)!==memberRaw||storage.getItem(projectKey)!==projectRaw)fail('HUMAN_REVIEW_SOURCE_CHANGED')};
  return {context,paper,paperRaw,workflowRaw,records,recovery,stable};
 }
 function captureInitial(input,isCurrent,recordSnapshot){
  const q=clone(input);check();if(!q||Object.keys(q).sort().join(',')!=='context,record,replyId,targetNodeId'||q.context?.namespace!==namespace||!q.context.projectId)fail('HUMAN_REVIEW_INPUT');
  const captured=captureContext(q.context,isCurrent,recordSnapshot);
  if(!q.record?.replies?.length||q.record.replies.at(-1).id!==q.replyId)fail('HUMAN_REVIEW_LATEST_REPLY_REQUIRED');
  if(Object.keys(q.context).sort().join(',')!=='namespace,paperId,paperTitle,projectId'||Object.keys(q.context).some(k=>q.record.origin?.[k]!==q.context[k]))fail('HUMAN_REVIEW_CONTEXT');
  if(q.record.prepared?.schema===MANUAL_MULTI_STEP_INPUT_SCHEMA)captured.records.exact(q.record,q.replyId,q.context);
  return {...captured,q};
 }
 async function membershipFor(captured){
  const {context,paper,stable}=captured,members=createProjectLibraryController({store,storage,crypto});await members.initialize();stable();const membership=await members.snapshot(context.projectId);stable();if(!membership.paperIds.includes(paper.id))fail('HUMAN_REVIEW_PROJECT_MEMBERSHIP');return membership;
 }
 async function sourceFor(captured){const {paper,paperRaw,stable}=captured;const source={namespace,paperId:paper.id,title:paper.title,documentSha256:paper.document?.sha256??null,snapshotSha256:await sha256(paperRaw,crypto)};stable();return source}
 async function verifyMultiInput(p,node,captured,source){
  if(p?.schema!==MANUAL_MULTI_STEP_INPUT_SCHEMA||!Array.isArray(p.upstreams)||p.target?.nodeId!==node.id||JSON.stringify(p.target.dependsOn)!==JSON.stringify(node.dependsOn))fail('HUMAN_REVIEW_COMPOSED_MULTI_REVIEW_INPUT_REQUIRED');
  if(!captured.records.available)fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED');
  const selections=p.upstreams.map(u=>({record:captured.records.find(u.reference.recordId,u.reference.reply.id,captured.context),replyId:u.reference.reply.id}));
  const expected=await prepareManualMultiReviewInput({context:captured.context,paper:captured.paper,source,workflowRaw:captured.workflowRaw,targetNodeId:node.id,prompt:node.prompt,selections},crypto);captured.stable();
  if(JSON.stringify(expected)!==JSON.stringify(p))fail('HUMAN_REVIEW_LIVE_MULTI_INPUT_CHANGED');
  return p.upstreams.map(u=>u.reference);
 }
 async function capture(captured){
  const {q,paper,workflowRaw,stable}=captured,membership=await membershipFor(captured),source=await sourceFor(captured);
  const {reference}=await prepareManualReplyReference({record:q.record,replyId:q.replyId,paper,source,workflowRaw},crypto);stable();
  await importWorkflow(workflowRaw,crypto);stable();const w=JSON.parse(workflowRaw).state,g=w.graphs.find(g=>g.version===w.currentVersion),t=reference.preparation.trace,node=g.nodes.find(n=>n.id===t.nodeId),target=g.nodes.find(n=>n.id===q.targetNodeId),p=q.record.prepared;
  if(node?.kind!=='review')fail('HUMAN_REVIEW_SINGLE_REVIEW_TARGET_REQUIRED');
  if(!target||target.kind!=='work'||target.dependsOn.length!==1||target.dependsOn[0]!==node.id)fail('HUMAN_REVIEW_SINGLE_DIRECT_WORK_REQUIRED');
  let subject;
  if(node.dependsOn.length>1){
   if(p?.schema!==MANUAL_MULTI_STEP_INPUT_SCHEMA)fail('HUMAN_REVIEW_SINGLE_REVIEW_TARGET_REQUIRED');
   captured.records.exact(q.record,q.replyId,q.context);
   const reviewInputs=await verifyMultiInput(p,node,captured,source);
   subject=review.makeManualMultiReviewSubject({reference,reviewInputs,reviewTargetId:node.reviewTarget,target,targetPromptSha256:await sha256(target.prompt,crypto)});
  }else{
   if(node.dependsOn.length!==1||node.reviewTarget!==node.dependsOn[0])fail('HUMAN_REVIEW_SINGLE_REVIEW_TARGET_REQUIRED');
   if(p?.schema!=='prism-manual-step-input-v1'||p.upstream.reference.preparation.trace.nodeId!==node.reviewTarget||p.target.nodeId!==node.id||p.target.dependsOn.length!==1||p.target.dependsOn[0]!==node.reviewTarget)fail('HUMAN_REVIEW_COMPOSED_REVIEW_INPUT_REQUIRED');
   subject=review.makeManualReviewSubject({reference,reviewInput:p.upstream.reference,reviewTargetId:node.reviewTarget,target,targetPromptSha256:await sha256(target.prompt,crypto)});
  }
  stable();membership.stable();return {subject,reference,record:q.record,target,recovery:captured.recovery,stable:()=>{stable();membership.stable()}};
 }
 function makePreview(head,event,display,stable){
  const proposed=review.appendManualReview(head.state,event),migration={key,namespace,required:head.state.schema!==proposed.schema,fromSchema:head.state.schema,toSchema:proposed.schema,previousRaw:head.state.schema!==proposed.schema?head.raw:null,previousEventCount:head.state.events.length};
  const preview={event,display,metadata:JSON.stringify(event,null,2),migration};issued.set(preview,{head,event,stable,display:JSON.stringify(preview),migrationRequired:migration.required});return preview;
 }
 async function prepare(input,{isCurrent=()=>true}={}){
  const q=clone(input);if(!q||Object.keys(q).sort().join(',')!=='context,decision,record,replyId,targetNodeId'||!['approved','returned'].includes(q.decision))fail('HUMAN_REVIEW_DECISION');
  const inputRaw=JSON.stringify(input),current=()=>isCurrent()===true&&JSON.stringify(input)===inputRaw,{decision,...material}=q,initial=captureInitial(material,current),head=await read(),captured=await capture(initial);headStable(head);captured.stable();
  const event={id:crypto.randomUUID(),sequence:head.state.events.length+1,decision,subject:captured.subject};
  return makePreview(head,event,{record:captured.record,reference:captured.reference,targetName:captured.target.name},captured.stable);
 }
 async function prepareRevoke(eventId,{isCurrent=()=>true}={}){
  const head=await read(),old=head.state.events.find(e=>e.id===eventId);if(!old||old.decision!=='approved'||review.latestManualReview(head.state,old.subject)?.id!==old.id)fail('HUMAN_REVIEW_REVOKE_LATEST_APPROVAL_ONLY');
  const stable=()=>{check();if(isCurrent()!==true)fail('HUMAN_REVIEW_PREVIEW_EXPIRED')};stable();
  const event={id:crypto.randomUUID(),sequence:head.state.events.length+1,decision:'revoked',subject:clone(old.subject)};
  return makePreview(head,event,{record:null,reference:null,targetName:old.subject.targetNodeId},stable);
 }
 async function confirm(preview,{explicitConfirmation=false,migrationConfirmation=false,isCurrent=()=>true}={}){
  if(busy)fail('HUMAN_REVIEW_BUSY');const token=issued.get(preview);if(!token||explicitConfirmation!==true)fail('HUMAN_REVIEW_CONFIRM_REQUIRED');if(token.migrationRequired&&migrationConfirmation!==true)fail('HUMAN_REVIEW_MIGRATION_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_HUMAN_REVIEW');
  const stable=()=>{token.stable();headStable(token.head);if(issued.get(preview)!==token||isCurrent()!==true||JSON.stringify(preview)!==token.display)fail('HUMAN_REVIEW_PREVIEW_EXPIRED')};
  busy=true;try{return await withLock(lockName,async()=>{
   stable();const state=review.appendManualReview(token.head.state,token.event),raw=await review.exportManualReviews(state,crypto);stable();
   // Preserve the exact prior raw for recovery, but never retry, repair or roll back an uncertain write.
   writeRecovery={key,namespace,fromSchema:token.head.state.schema,toSchema:state.schema,previousRaw:token.head.raw,attemptedRaw:raw};issued.delete(preview);try{storage.setItem(key,raw)}catch{uncertain=true;fail('HUMAN_REVIEW_WRITE_UNKNOWN_NO_RETRY')}
   if(rawRead()!==raw){uncertain=true;fail('HUMAN_REVIEW_WRITE_UNKNOWN_NO_RETRY')}observed=clone(state);token.head.recovery.assertHead(state);writeRecovery=null;return clone(token.event);
  })}finally{busy=false}
 }
 // Read-only inspection for an operations view; does not mint a confirmation token or migrate bytes.
 async function inspectCurrent(input,{isCurrent=()=>true}={}){
  const inputRaw=JSON.stringify(input),current=()=>isCurrent()===true&&JSON.stringify(input)===inputRaw,initial=captureInitial(input,current),head=await read(),captured=await capture(initial);headStable(head);captured.stable();
  const event=review.latestManualReview(head.state,captured.subject);
  const recoveryRequired=event?.decision==='approved'&&!captured.recovery.approvalCurrent(captured.record,event,head.state);
  return {subject:clone(captured.subject),event:event?clone(event):null,exact:!!event&&!recoveryRequired&&JSON.stringify(event.subject)===JSON.stringify(captured.subject),recoveryRequired,stable:()=>{captured.stable();headStable(head)}};
 }
 async function approval(input,{isCurrent=()=>true}={}){
  const inputRaw=JSON.stringify(input),current=()=>isCurrent()===true&&JSON.stringify(input)===inputRaw,initial=captureInitial(input,current),head=await read(),captured=await capture(initial);headStable(head);captured.stable();const event=review.requireManualReviewApproval(head.state,captured.subject);captured.recovery.assertApproval(captured.record,event,head.state);
  return {event:clone(event),stable:()=>{captured.stable();headStable(head)}};
 }
 // Called INSIDE the shared lock by handoff.copy. No granting authority from archive text.
 async function guardHandoff({prepared:p,context},{isCurrent=()=>true,recordSnapshot}={}){
  check();const t=manualPreparationBase(p)?.trace;if(t?.stepOrigin!=='custom_graph')return ()=>{check();if(!isCurrent())fail('HUMAN_REVIEW_PREVIEW_EXPIRED');return true};
  const initial=captureContext(context,isCurrent,recordSnapshot),{workflowRaw,stable:graphStable}=initial;
  if(!workflowRaw)fail('HUMAN_REVIEW_CURRENT_GRAPH_REQUIRED');await importWorkflow(workflowRaw,crypto);graphStable();
  const w=JSON.parse(workflowRaw).state,g=w.graphs.find(g=>g.version===w.currentVersion),node=g.nodes.find(n=>n.id===t.nodeId);
  if(!node||t.graphVersion!==g.version||t.graphSha256!==g.sha256||w.source?.namespace!==namespace||w.source?.paperId!==context?.paperId)fail('HUMAN_REVIEW_GRAPH_STALE');
  // Route v3 by its declared format as well as the current node: a rehashed
  // archive cannot masquerade as a root, single work or single review target.
  if(p.schema===MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA)assertManualMultiWorkTarget(g,node.id);
  // A multi-review cannot be copied as a standalone preparation or single-input shortcut.
  if(node.kind==='review'&&node.dependsOn.length>1){
   if(p.schema!==MANUAL_MULTI_STEP_INPUT_SCHEMA)fail('HUMAN_REVIEW_USE_EXACT_MULTI_REVIEW_INPUT');
   if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_MULTI_REVIEW');
   const source=await sourceFor(initial),membership=await membershipFor(initial);await verifyMultiInput(p,node,initial,source);graphStable();membership.stable();
   return ()=>{graphStable();membership.stable();return true};
  }
  // Work fan-in is a complete explicit material selection, never a standalone shortcut.
  // Rebuild from live originals inside the copy lock, then retain synchronous drift guards.
  if(node.kind==='work'&&node.dependsOn.length>1){
   if(p.schema!==MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA)fail('MANUAL_WORK_USE_EXACT_MULTI_INPUT');
   if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_MULTI_WORK');
   if(!initial.records.available)fail('HUMAN_REVIEW_LIVE_RECORDS_REQUIRED');
   const source=await sourceFor(initial),membership=await membershipFor(initial);
   const selections=p.upstreams.map(u=>({record:initial.records.find(u.reference.recordId,u.reference.reply.id,context),replyId:u.reference.reply.id}));
   const expected=await prepareManualMultiWorkInput({context:initial.context,paper:initial.paper,source,workflowRaw:initial.workflowRaw,targetNodeId:node.id,prompt:node.prompt,selections},crypto);graphStable();membership.stable();
   if(JSON.stringify(expected)!==JSON.stringify(p))fail('MANUAL_WORK_LIVE_MULTI_INPUT_CHANGED');
   return ()=>{graphStable();membership.stable();return true};
  }
  const requiresReview=node.kind==='work'&&node.dependsOn.some(id=>g.nodes.find(n=>n.id===id)?.kind==='review');
  if(!requiresReview)return ()=>{graphStable();return true};
  if(p.schema!=='prism-manual-step-input-v1')fail('HUMAN_REVIEW_USE_APPROVED_CHAIN_NOT_STANDALONE');
  if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_HUMAN_REVIEW');
  const reviewNode=g.nodes.find(n=>n.id===p.upstream.reference.preparation.trace.nodeId);
  if(node.dependsOn.length!==1||node.dependsOn[0]!==reviewNode?.id||reviewNode.kind!=='review'||t.promptEdited||t.stepNameEdited||p.base.step.prompt!==node.prompt)fail('HUMAN_REVIEW_SINGLE_DIRECT_WORK_REQUIRED');
  // Recovered single-review material also needs a live original and a fresh
  // decision beyond the admission fence. Preserve resolver-optional legacy
  // behavior only when no runtime recovery fence is present.
  const recoveryFenced=typeof getRecoveryFence==='function'&&getRecoveryFence()!=null;
  initial.recovery.stable();
  if(reviewNode.dependsOn.length>1||recoveryFenced){
   // Resolve current R (and all A originals for multi-review). A flat B packet
   // cannot bypass recovery admission by carrying an old matching approval.
   const record=initial.records.find(p.upstream.reference.recordId,p.upstream.reference.reply.id,context),material=captureInitial({context,record,replyId:p.upstream.reference.reply.id,targetNodeId:node.id},isCurrent,initial.records),head=await read(),captured=await capture(material);graphStable();captured.stable();headStable(head);
   if(JSON.stringify(captured.reference)!==JSON.stringify(p.upstream.reference))fail('HUMAN_REVIEW_LIVE_RECORD_CHANGED');
   const event=review.requireManualReviewApproval(head.state,captured.subject);captured.recovery.assertApproval(captured.record,event,head.state);if(!review.manualReviewMatchesHandoff(event,p))fail('HUMAN_REVIEW_CURRENT_APPROVAL_REQUIRED');
   return ()=>{graphStable();captured.stable();headStable(head);return true};
  }
  // Legacy single-input path is deliberately resolver-optional and byte-compatible.
  if(reviewNode.dependsOn.length!==1||reviewNode.reviewTarget!==reviewNode.dependsOn[0])fail('HUMAN_REVIEW_SINGLE_DIRECT_WORK_REQUIRED');
  const head=await read();graphStable();
  const event=head.state.events.findLast(e=>e.subject.projectId===context?.projectId&&e.subject.paperId===context?.paperId&&e.subject.graphVersion===g.version&&e.subject.graphSha256===g.sha256&&e.subject.reviewNodeId===reviewNode.id&&e.subject.targetNodeId===node.id);
  if(!review.manualReviewMatchesHandoff(event,p)||event.subject.reviewTargetId!==reviewNode.reviewTarget)fail('HUMAN_REVIEW_CURRENT_APPROVAL_REQUIRED');
  const source=await sourceFor(initial);if(source.snapshotSha256!==p.source.snapshotSha256)fail('HUMAN_REVIEW_SOURCE_CHANGED');
  const membership=await membershipFor(initial);graphStable();headStable(head);
  return ()=>{graphStable();headStable(head);membership.stable();return true};
 }
 return {key,lockName,inspect,inspectCurrent,prepare,prepareRevoke,confirm,approval,guardHandoff,recovery:()=>uncertain&&writeRecovery?clone(writeRecovery):null,cancel:p=>issued.delete(p)};
}
