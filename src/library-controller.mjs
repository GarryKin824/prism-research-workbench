import {assertOwner} from './project-execution-owner.mjs';
import * as graphCore from './custom-core.mjs';
import * as libraryCore from './library-core.mjs';
import {createCustomWorkflowManager} from './custom-workflow-manager.mjs';
export function createLibraryController({store,storage,crypto=globalThis.crypto,withLock,ownerToken=null}){
 const ns=store.getStorageKey(),key=ns+':library-queue-v1',managers=new Map();let baseline=storage.getItem(key),queue=null,ready=false;
 // Page/foreground cancellation is not a queue failure or an authorization grant.
 // Keep a private sentinel so an unrelated error with the same text is not swallowed.
 const stopped=Error('USER_STOPPED'),assertCurrent=isCurrent=>{if(isCurrent!==undefined&&isCurrent()!==true)throw stopped};
 const check=()=>{store.assertCurrentStorage();if(storage.getItem(key)!==baseline)throw Error('LIBRARY_STORAGE_CONFLICT');if(!ready)throw Error('LIBRARY_NOT_READY')};
 const workflowKey=id=>ns+':custom-workflow-v1:'+id;
 async function readWorkflow(paperId){store.assertCurrentStorage();const raw=storage.getItem(workflowKey(paperId));if(raw===null)throw Error('WORKFLOW_MISSING');await graphCore.importWorkflow(raw,crypto);store.assertCurrentStorage();if(storage.getItem(workflowKey(paperId))!==raw)throw Error('WORKFLOW_READ_CONFLICT');const state=JSON.parse(raw).state;if(state.source?.namespace!==ns||state.source?.paperId!==paperId)throw Error('WORKFLOW_IDENTITY_MISMATCH');const paper=store.getSnapshot().papers.find(p=>p.id===paperId);if(!paper||paper.title!==state.source.paperTitle||(paper.document?.sha256||null)!==state.source.documentSha256)throw Error('WORKFLOW_SOURCE_CHANGED');return {raw,state}}
 async function save(next,isCurrent){check();assertCurrent(isCurrent);const raw=await libraryCore.exportQueue(next,crypto);await assertOwner(storage,ns,ownerToken,crypto);check();assertCurrent(isCurrent);storage.setItem(key,raw);baseline=raw;queue=next;return queue}
 async function exclusive(fn,isCurrent){if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');assertCurrent(isCurrent);return withLock(ns+':library-queue-write',async()=>{check();assertCurrent(isCurrent);await assertOwner(storage,ns,ownerToken,crypto);check();assertCurrent(isCurrent);return fn()})}
 async function initialize(){store.assertCurrentStorage();if(baseline!==null){queue=await libraryCore.importQueue(baseline,crypto);store.assertCurrentStorage();if(storage.getItem(key)!==baseline)throw Error('LIBRARY_STORAGE_CONFLICT')}ready=true;return queue}
 async function candidates(){check();const result=[],issues=[];for(const p of store.getSnapshot().papers){if(storage.getItem(workflowKey(p.id))===null)continue;try{const {state}=await readWorkflow(p.id),g=state.graphs.find(g=>g.version===state.currentVersion);const previous=queue?.configs.flatMap(x=>x.entries).find(e=>e.workflowId===state.id&&e.graphSha256===g.sha256);result.push({id:previous?.id||('entry-'+crypto.randomUUID()),workflowId:state.id,namespace:ns,paperId:p.id,label:p.title,graphSha256:g.sha256})}catch(e){issues.push({paperId:p.id,label:p.title,error:e.message})}}check();return {result,issues}}
 async function guardedConfigure(draft,isCurrent){if(ownerToken)throw Error('PROJECT_CONFIG_IMMUTABLE');return exclusive(async()=>save(queue?await libraryCore.editQueue(queue,draft,crypto):await libraryCore.createQueue(draft,crypto),isCurrent),isCurrent)}
 async function configure(draft){return guardedConfigure(draft)}
 async function guardedChange(action,args=[],isCurrent){return exclusive(async()=>{if(!queue)throw Error('QUEUE_MISSING');if(!['authorizeQueue','pauseQueue','resumeQueue','skipEntry','abandonActiveEntry'].includes(action))throw Error('LIBRARY_ACTION_REFUSED');return save(await libraryCore[action](queue,...args,crypto),isCurrent)},isCurrent)}
 async function change(action,...args){return guardedChange(action,args)}
 async function managerFor(paperId){if(!managers.has(paperId)){const manager=createCustomWorkflowManager({store,paperId,storage,crypto,withLock,ownerToken});const state=await manager.initialize();managers.set(paperId,{manager,state})}return managers.get(paperId)}
 async function step(action,args=[],isCurrent){assertCurrent(isCurrent);const view=libraryCore.queueView(queue);if(!view.active||view.pending)throw Error('QUEUE_NOT_READY');const id=view.active.entry.paperId,{state:actual}=await readWorkflow(id);assertCurrent(isCurrent);await save(await libraryCore.beginAction(queue,{workflow:actual,action},crypto),isCurrent);const intent=libraryCore.queueView(queue).pending;if(!intent)return queue;if(intent.kind!=='action'||intent.action!==action)throw Error('ACTION_INTENT_MISMATCH');
 // Only the first intent write is guarded. Once durable, settle this exact action even
 // if the page/foreground operation stops. Any failure leaves it unresolved; never replay.
 const owner=await managerFor(id);owner.state=await owner.manager.apply(action,...args);const {state:after}=await readWorkflow(id);await save(await libraryCore.ackAction(queue,intent.token,{workflow:after},crypto));return queue}
 async function tick({confirmNext=false,confirmNode=false,resumePaper=false,verdict='pass',isCurrent}={}){return exclusive(async()=>{
  if(!queue)throw Error('QUEUE_MISSING');let view=libraryCore.queueView(queue);if(view.pending)throw Error('PENDING_INTENT_REQUIRES_RECONCILIATION');if(!queue.allowed||(queue.pause&&!(queue.pause.code==='QUEUE_MANUAL_CONFIRMATION'&&confirmNext)))return queue;
  if(!view.active){if(!view.nextEntry){return save(await libraryCore.grantNext(queue,{confirmManual:confirmNext},crypto),isCurrent)}const {raw,state}=await readWorkflow(view.nextEntry.paperId);assertCurrent(isCurrent);await save(await libraryCore.grantNext(queue,{workflow:state,confirmManual:confirmNext},crypto),isCurrent);view=libraryCore.queueView(queue);if(!view.pending)return queue;const markerKey=key+':assignment:'+view.pending.token;if(storage.getItem(markerKey)!==null)throw Error('ASSIGNMENT_MARKER_EXISTS');const marker={token:view.pending.token,workflowDigest:view.pending.workflowDigest};storage.setItem(markerKey,JSON.stringify(marker));const latest=await readWorkflow(view.pending.entry.paperId);if(latest.raw!==raw||storage.getItem(markerKey)!==JSON.stringify(marker))throw Error('ASSIGNMENT_READBACK_CONFLICT');return save(await libraryCore.ackNext(queue,view.pending.token,{workflow:latest.state,proof:{token:marker.token,workflowDigest:marker.workflowDigest}},crypto))}
  const id=view.active.entry.paperId,{state:actual}=await readWorkflow(id);assertCurrent(isCurrent);try{await libraryCore.completionEvidence(actual,crypto);assertCurrent(isCurrent);return save(await libraryCore.completeActive(queue,{workflow:actual},crypto),isCurrent)}catch(e){if(!['PAPER_NOT_COMPLETE','PAPER_BUSY','PAPER_PAUSED'].includes(e.message))throw e}
  const owner=await managerFor(id);assertCurrent(isCurrent);const w=owner.state,g=w.graphs.find(g=>g.version===w.currentVersion);if(!g.policy.allowSynthetic)throw Error('PAPER_PERMISSION_REQUIRED');
  if(!w.syntheticAuthorized)return step('authorizeSynthetic',[true],isCurrent);
  if(w.pause){if(w.pause.code==='HUMAN_CONFIRMATION_REQUIRED'){if(confirmNode)return step('approveNode',[w.pause.nodeId],isCurrent);return queue}if(w.pause.code==='RESTORED_REQUIRES_CONFIRMATION'||resumePaper)return step('resumeWorkflow',[],isCurrent);return queue}
  const running=w.runs.find(r=>r.status==='running');return running?step('finishSynthetic',[running.id,{reviewVerdict:verdict,failWith:null}],isCurrent):step('startNext',[],isCurrent);
 },isCurrent).catch(async error=>{if(error!==stopped&&queue)try{const guard=libraryCore.queueView(queue).pending?undefined:isCurrent;await exclusive(async()=>save(await libraryCore.pauseQueue(queue,crypto),guard),guard)}catch{}throw error})}
 // Explicit foreground batch only: never grants human gates, resumes pauses, or retries an unknown action.
 let advancing=false;
 async function advance({maxActions=50,verdict='pass',isCurrent=()=>true,onProgress=()=>{}}={}){
  if(advancing)throw Error('ADVANCE_ALREADY_RUNNING');
  if(!Number.isSafeInteger(maxActions)||maxActions<1||maxActions>200)throw Error('INVALID_ADVANCE_LIMIT');
  advancing=true;let actions=0;
  try{for(;actions<maxActions;){
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   const before=await status();
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   if(before.view?.pending)throw Error('PENDING_INTENT_REQUIRES_RECONCILIATION');
   if(!before.queue?.allowed)return {actions,reason:'QUEUE_PERMISSION_REQUIRED'};
   if(before.queue.pause)return {actions,reason:before.queue.pause.code==='WORKFLOW_EXCEPTION'?(before.workflow?.pause?.code??before.queue.pause.code):before.queue.pause.code};
   if(before.workflow?.pause&&!['WORKFLOW_COMPLETE','RESTORED_REQUIRES_CONFIRMATION'].includes(before.workflow.pause.code))return {actions,reason:before.workflow.pause.code};
   const raw=JSON.stringify(before.queue);
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   await tick({verdict,isCurrent});actions++;
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   const after=await status();
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   await onProgress(after);
   if(isCurrent()!==true)return {actions,reason:'USER_STOPPED'};
   if(JSON.stringify(after.queue)===raw)return {actions,reason:after.workflow?.pause?.code??'NO_PROGRESS'};
   await new Promise(resolve=>setTimeout(resolve,0));
  }return {actions,reason:'ACTION_LIMIT'};}catch(error){if(error===stopped)return {actions,reason:'USER_STOPPED'};throw error}finally{advancing=false}
 }
 async function reconcile(isCurrent){return exclusive(async()=>{const pending=libraryCore.queueView(queue).pending;if(!pending)throw Error('NO_PENDING_INTENT');const {state}=await readWorkflow(pending.entry.paperId);assertCurrent(isCurrent);const next=await libraryCore.reconcilePending(queue,pending.token,{workflow:state},crypto);await save(next,isCurrent);managers.delete(pending.entry.paperId);return queue},isCurrent)}
 async function cancel(reason,isCurrent){return exclusive(async()=>{const v=libraryCore.queueView(queue);if(!v.active||v.pending)throw Error('QUEUE_NOT_READY');let actual=(await readWorkflow(v.active.entry.paperId)).state,terminationStarted=false;assertCurrent(isCurrent);if(actual.runs.some(r=>r.status==='running')){await step('pauseWorkflow',[],isCurrent);terminationStarted=true;actual=(await readWorkflow(v.active.entry.paperId)).state}const next=await libraryCore.cancelActiveEntry(queue,{workflow:actual,reason},crypto);await save(next,terminationStarted?undefined:isCurrent);managers.delete(v.active.entry.paperId);return queue},isCurrent)}
 async function status(){check();const view=queue?libraryCore.queueView(queue):null;let workflow=null,error=null;if(view?.active)try{workflow=(await readWorkflow(view.active.entry.paperId)).state}catch(e){error=e.message}check();return {queue,view,workflow,error}}
 return {initialize,candidates,configure,guardedConfigure,change,guardedChange,tick,advance,reconcile,cancel,status,async exportJSON(){check();if(!queue)throw Error('QUEUE_MISSING');const raw=await libraryCore.exportQueue(queue,crypto);check();return raw}};
}
