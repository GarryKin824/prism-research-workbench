import {captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import * as review from './terminal-review-core.mjs';
import {captureManualRecords} from './manual-review-controller.mjs';
import {prepareManualReplyReference} from './manual-reply-reference.mjs';
import {manualPreparationBase,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA} from './manual-step-input-format.mjs';
import {prepareManualStepInput,prepareManualMultiReviewInput,prepareManualMultiWorkInput,assertManualMultiWorkTarget} from './manual-step-input-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {sha256,importWorkflow} from './custom-core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)};
// A live resolver is authority-bearing, unlike a supplied/imported archive or validate callback.
// Keep all originals stable, not only projected IDs/hashes, through the last synchronous guard.
// Shares the handoff lock through decision commit and the entire clipboard attempt.
export function createTerminalReviewController({store,storage,crypto=globalThis.crypto,withLock,getRecords,getRecoveryFence}){
 const namespace=store.getStorageKey(),key=namespace+':terminal-review-decisions-v1',lockName=namespace+':manual-handoff-ledger-v1:copy',issued=new WeakMap();
 const sessionDecisions=new Map();
 let uncertain=false,observed=null,everPresent=false,busy=false,writeRecovery=null;
 function check(){if(uncertain)fail('HUMAN_REVIEW_UNKNOWN_RELOAD_REQUIRED');store.assertCurrentStorage();if(store.getStorageKey()!==namespace)fail('HUMAN_REVIEW_NAMESPACE_CHANGED')}
 function rawRead(){let raw;try{raw=storage.getItem(key)}catch{uncertain=true;fail('HUMAN_REVIEW_READ_UNKNOWN_NO_RETRY')}if(raw!==null)everPresent=true;else if(everPresent){uncertain=true;fail('HUMAN_REVIEW_ROLLBACK')}return raw}
 async function read(){check();const recovery=captureManualRecoveryFence(getRecoveryFence),raw=rawRead();let state;try{state=raw===null?review.emptyManualReviews(namespace):await review.loadManualReviews(raw,namespace,crypto)}catch(e){uncertain=true;throw e}check();recovery.stable();if(rawRead()!==raw)fail('HUMAN_REVIEW_HEAD_CHANGED');if(observed&&(state.events.length<observed.events.length||observed.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(state.events[i])))){uncertain=true;fail('HUMAN_REVIEW_ROLLBACK')}observed=clone(state);return {raw,state,recovery}}
 const headStable=head=>{check();head.recovery.stable();if(rawRead()!==head.raw)fail('HUMAN_REVIEW_PREVIEW_EXPIRED_HEAD_CHANGED')};
 async function inspect(){const {state}=await read();const heads=new Map();for(const e of state.events)heads.set(review.manualReviewScope(e.subject),e);return {key,schema:state.schema,canPersist:typeof withLock==='function',events:clone(state.events),latestIds:[...heads.values()].map(e=>e.id)}}
 function captureContext(context,isCurrent,recordSnapshot){
  check();const paper=clone(store.getSnapshot().papers.find(p=>p.id===context?.paperId)??null);if(!paper)fail('HUMAN_REVIEW_PAPER_MISSING');
  const paperRaw=JSON.stringify(paper),workflowKey=namespace+':custom-workflow-v1:'+paper.id,workflowRaw=storage.getItem(workflowKey),memberKey=namespace+':project-library-v1',projectKey=namespace+':project-planning-v1',memberRaw=storage.getItem(memberKey),projectRaw=storage.getItem(projectKey),records=recordSnapshot??captureManualRecords(getRecords),recovery=captureManualRecoveryFence(getRecoveryFence);
  const stable=()=>{check();records.stable();recovery.stable();if(isCurrent()!==true)fail('HUMAN_REVIEW_PREVIEW_EXPIRED');if(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id)??null)!==paperRaw||storage.getItem(workflowKey)!==workflowRaw||storage.getItem(memberKey)!==memberRaw||storage.getItem(projectKey)!==projectRaw)fail('HUMAN_REVIEW_SOURCE_CHANGED')};
  return {context,paper,paperRaw,workflowRaw,records,recovery,stable};
 }
 function captureInitial(input,isCurrent,recordSnapshot){
  const q=clone(input);check();if(!q||Object.keys(q).sort().join(',')!=='context,record,replyId'||q.context?.namespace!==namespace||!q.context.projectId)fail('HUMAN_REVIEW_INPUT');
  const captured=captureContext(q.context,isCurrent,recordSnapshot);
  if(!q.record?.replies?.length||q.record.replies.at(-1).id!==q.replyId)fail('HUMAN_REVIEW_LATEST_REPLY_REQUIRED');
  if(Object.keys(q.context).sort().join(',')!=='namespace,paperId,paperTitle,projectId'||Object.keys(q.context).some(k=>q.record.origin?.[k]!==q.context[k]))fail('HUMAN_REVIEW_CONTEXT');
  captured.records.exact(q.record,q.replyId,q.context);
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
  if(g.nodes.some(n=>n.dependsOn.includes(node.id)))fail('TERMINAL_REVIEW_HAS_DOWNSTREAM');
  if(node.dependsOn.length>1)await verifyMultiInput(p,node,captured,source);
  else {
   if(node.dependsOn.length!==1||node.reviewTarget!==node.dependsOn[0]||p?.schema!=='prism-manual-step-input-v1')fail('TERMINAL_REVIEW_INPUT_REQUIRED');
   const a=p.upstream.reference,original=captured.records.find(a.recordId,a.reply.id,captured.context);
   const expected=await prepareManualStepInput({context:captured.context,paper,source,workflowRaw,targetNodeId:node.id,prompt:node.prompt,record:original,replyId:a.reply.id},crypto);stable();
   if(JSON.stringify(expected)!==JSON.stringify(p))fail('TERMINAL_REVIEW_LIVE_INPUT_CHANGED');
  }
  const subject=review.makeSubject(reference);
  stable();membership.stable();return {subject,reference,record:q.record,target:node,recovery:captured.recovery,stable:()=>{stable();membership.stable()}};
 }
 function makePreview(head,event,display,stable){
  const proposed=review.appendManualReview(head.state,event),migration={key,namespace,required:head.state.schema!==proposed.schema,fromSchema:head.state.schema,toSchema:proposed.schema,previousRaw:head.state.schema!==proposed.schema?head.raw:null,previousEventCount:head.state.events.length};
  const preview={event,display,metadata:JSON.stringify(event,null,2),migration};issued.set(preview,{head,event,stable,display:JSON.stringify(preview),migrationRequired:migration.required});return preview;
 }
 async function prepare(input,{isCurrent=()=>true}={}){
  const q=clone(input);if(!q||Object.keys(q).sort().join(',')!=='context,decision,record,replyId'||!['approved','returned'].includes(q.decision))fail('HUMAN_REVIEW_DECISION');
  const inputRaw=JSON.stringify(input),current=()=>isCurrent()===true&&JSON.stringify(input)===inputRaw,{decision,...material}=q,initial=captureInitial(material,current),head=await read(),captured=await capture(initial);headStable(head);captured.stable();
  const event={id:crypto.randomUUID(),sequence:head.state.events.length+1,decision,subject:captured.subject};
  return makePreview(head,event,{record:captured.record,reference:captured.reference,targetName:captured.target.name},captured.stable);
 }
 async function prepareRevoke(eventId,{isCurrent=()=>true}={}){
  const head=await read(),old=head.state.events.find(e=>e.id===eventId);if(!old||old.decision!=='approved'||review.latestManualReview(head.state,old.subject)?.id!==old.id)fail('HUMAN_REVIEW_REVOKE_LATEST_APPROVAL_ONLY');
  const stable=()=>{check();if(isCurrent()!==true)fail('HUMAN_REVIEW_PREVIEW_EXPIRED')};stable();
  const event={id:crypto.randomUUID(),sequence:head.state.events.length+1,decision:'revoked',subject:clone(old.subject)};
  return makePreview(head,event,{record:null,reference:null,targetName:old.subject.nodeId},stable);
 }
 async function confirm(preview,{explicitConfirmation=false,migrationConfirmation=false,isCurrent=()=>true}={}){
  if(busy)fail('HUMAN_REVIEW_BUSY');const token=issued.get(preview);if(!token||explicitConfirmation!==true)fail('HUMAN_REVIEW_CONFIRM_REQUIRED');if(token.migrationRequired&&migrationConfirmation!==true)fail('HUMAN_REVIEW_MIGRATION_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_HUMAN_REVIEW');
  const stable=()=>{token.stable();headStable(token.head);if(issued.get(preview)!==token||isCurrent()!==true||JSON.stringify(preview)!==token.display)fail('HUMAN_REVIEW_PREVIEW_EXPIRED')};
  busy=true;try{return await withLock(lockName,async()=>{
   stable();const state=review.appendManualReview(token.head.state,token.event),raw=await review.exportManualReviews(state,crypto);stable();
   // Preserve the exact prior raw for recovery, but never retry, repair or roll back an uncertain write.
   writeRecovery={key,namespace,fromSchema:token.head.state.schema,toSchema:state.schema,previousRaw:token.head.raw,attemptedRaw:raw};issued.delete(preview);try{storage.setItem(key,raw)}catch{uncertain=true;fail('HUMAN_REVIEW_WRITE_UNKNOWN_NO_RETRY')}
   if(rawRead()!==raw){uncertain=true;fail('HUMAN_REVIEW_WRITE_UNKNOWN_NO_RETRY')}observed=clone(state);sessionDecisions.set(token.event.id,typeof getRecoveryFence==='function'?getRecoveryFence():null);writeRecovery=null;return clone(token.event);
  })}finally{busy=false}
 }
 // Read-only inspection for an operations view; does not mint a confirmation token or migrate bytes.
 async function inspectCurrent(input,{isCurrent=()=>true}={}){
  const inputRaw=JSON.stringify(input),current=()=>isCurrent()===true&&JSON.stringify(input)===inputRaw,initial=captureInitial(input,current),head=await read(),captured=await capture(initial);headStable(head);captured.stable();
  const event=review.latestManualReview(head.state,captured.subject);
  const recoveryRequired=!!event&&(!sessionDecisions.has(event.id)||sessionDecisions.get(event.id)!==(typeof getRecoveryFence==='function'?getRecoveryFence():null));
  return {subject:clone(captured.subject),event:event?clone(event):null,exact:!!event&&!recoveryRequired&&JSON.stringify(event.subject)===JSON.stringify(captured.subject),recoveryRequired,stable:()=>{captured.stable();headStable(head)}};
 }

 async function exportHistory(context){
  if(context?.namespace!==namespace||!context.projectId||!context.paperId)fail('TERMINAL_EXPORT_SCOPE');
  const rawContext=JSON.stringify(context),head=await read(),state={...head.state,events:head.state.events.filter(e=>e.subject.projectId===context.projectId&&e.subject.paperId===context.paperId).map((e,i)=>({...e,sequence:i+1}))};
  const raw=await review.exportManualReviews(state,crypto);headStable(head);if(JSON.stringify(context)!==rawContext)fail('TERMINAL_EXPORT_SCOPE_CHANGED');return raw;
 }
 return {key,lockName,inspect,inspectCurrent,exportHistory,prepare,prepareRevoke,confirm,recovery:()=>uncertain&&writeRecovery?clone(writeRecovery):null,cancel:p=>issued.delete(p)};
}
