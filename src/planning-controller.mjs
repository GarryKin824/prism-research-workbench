import * as planningCore from './planning-core.mjs';
import * as graphCore from './custom-core.mjs';
import * as libraryCore from './library-core.mjs';
import {assertScopeEditable} from './project-execution-owner.mjs';

export function createPlanningController({store,paperId,storage,crypto=globalThis.crypto,withLock}) {
 const clone=value=>value===null?null:JSON.parse(JSON.stringify(value));
 const ns=store.getStorageKey(),key=ns+':planning-drafts-v1',wk=ns+':custom-workflow-v1:'+paperId,qk=ns+':library-queue-v1';
 const ownerKey=ns+':project-execution-owner-v1',instancesKey=ns+':research-instances-v1',tokens=new WeakMap(),contexts=new WeakMap();
 let baseline=storage.getItem(key),state=null,generation=0,blocked=false,conflicted=false,recoveryData=null;
 const diagnostic=error=>String(error?.message??error??'UNKNOWN_ERROR').slice(0,500);
 const check=()=>{
  if(blocked)throw Error('PLANNING_WRITE_UNKNOWN_NO_RETRY');
  store.assertCurrentStorage();
  if(conflicted||store.getStorageKey()!==ns||storage.getItem(key)!==baseline){conflicted=true;throw Error('PLANNING_STORAGE_CONFLICT')}
 };
 function observedRecovery(raw,error) {
  if(error)return {observedRaw:null,observedRawStatus:'unreadable',readError:diagnostic(error)};
  if(raw===null)return {observedRaw:null,observedRawStatus:'absent',readError:null};
  const retained=typeof raw==='string'&&raw.length<=4000000&&new TextEncoder().encode(raw).length<=4000000;
  return {observedRaw:retained?raw:null,observedRawStatus:retained?'retained':typeof raw==='string'?'omitted-oversized':'omitted-type',observedRawLength:typeof raw==='string'?raw.length:null,readError:null};
 }
 function uncertain(attempt,{status='unknown',observed,readError=null,error}) {
  blocked=true;generation++;
  recoveryData={...attempt,status,blocked:true,currentStorageVerified:false,retryAllowed:false,...observedRecovery(observed,readError),error:diagnostic(error)};
  const code=status==='written-recheck-required'?'PLANNING_WRITTEN_RECHECK_REQUIRED':'PLANNING_WRITE_UNKNOWN_NO_RETRY';
  const result=Error(code+':'+diagnostic(error));result.code=code;return result;
 }
 async function initialize() {
  check();if(state)return snapshot();
  const head=baseline,epoch=generation,next=head===null?{namespace:ns,authority:'none',records:[]}:await planningCore.loadPlanning(head,ns,crypto);
  check();if(head!==baseline||epoch!==generation)throw Error('PLANNING_CONTEXT_CHANGED');
  state=next;return snapshot();
 }
 async function snapshot() {
  check();if(!state)throw Error('PLANNING_NOT_READY');
  const capturedBaseline=baseline,capturedGeneration=generation,records=clone(state.records.filter(r=>r.paperId===paperId));
  const paper=store.getSnapshot().papers.find(p=>p.id===paperId);if(!paper)throw Error('PAPER_MISSING');
  const paperRaw=JSON.stringify(paper),workflowRaw=storage.getItem(wk),queueRaw=storage.getItem(qk),ownerRaw=storage.getItem(ownerKey),instancesRaw=storage.getItem(instancesKey);
  if(!workflowRaw)throw Error('CREATE_WORKFLOW_FIRST');
  await graphCore.importWorkflow(workflowRaw,crypto);const workflow=JSON.parse(workflowRaw).state;
  if(workflow.source.namespace!==ns||workflow.source.paperId!==paperId||workflow.source.paperTitle!==paper.title||workflow.source.documentSha256!==(paper.document?.sha256??null))throw Error('PLANNING_SOURCE_CHANGED');
  let owned=false;if(queueRaw!==null){await libraryCore.importQueue(queueRaw,crypto);const v=libraryCore.queueView(JSON.parse(queueRaw).queue);owned=!!(v.active||v.pending)}
  const sourceStable=(expectedWorkflowRaw=workflowRaw)=>{
   store.assertCurrentStorage();
   if(store.getStorageKey()!==ns||JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paperId))!==paperRaw||storage.getItem(wk)!==expectedWorkflowRaw||storage.getItem(qk)!==queueRaw||storage.getItem(ownerKey)!==ownerRaw||storage.getItem(instancesKey)!==instancesRaw)throw Error('PLANNING_CONTEXT_CHANGED');
  };
  const stable=()=>{check();if(baseline!==capturedBaseline||generation!==capturedGeneration)throw Error('PLANNING_CONTEXT_CHANGED');sourceStable()};
  stable();const result={paper:JSON.parse(paperRaw),workflowRaw,workflow,owned,records,stable};
  contexts.set(result,{writtenStable(destination,raw){sourceStable(destination===wk?raw:workflowRaw);if(storage.getItem(key)!==(destination===key?raw:capturedBaseline))throw Error('PLANNING_STORAGE_CONFLICT')}});
  return result;
 }
 function selectedHistory(q,s) {
  const ids=q.historyIds??[];
  if(!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('INVALID_HISTORY_SELECTION');
  return ids.map(id=>{const r=s.records.find(r=>r.id===id);if(!r)throw Error('HISTORY_NOT_IN_CURRENT_PAPER');return planningCore.historyProjection(r)});
 }
 function issue(p,raw,s) {
  tokens.set(p,{display:JSON.stringify(p),raw,stable:s.stable,writtenStable:contexts.get(s).writtenStable,used:false,cancelled:false,source:{namespace:ns,paperId,paperTitle:s.paper.title,documentSha256:s.paper.document?.sha256??null,paperHash:p.record.paperHash}});
  return p;
 }
 async function prepare(input) {
  const q=clone(input),s=await snapshot();if(q.expectedWorkflowRaw!==s.workflowRaw)throw Error('PLANNING_EDITOR_DRIFT');
  const before=clone(state),r=await planningCore.planningRecord({...q,history:selectedHistory(q,s),paper:s.paper,workflowRaw:s.workflowRaw,previousSha256:before.records.at(-1)?.sha256??null},crypto);
  const next={...before,records:[...before.records,r]},raw=await planningCore.exportPlanning(next,crypto);s.stable();
  return issue({kind:'save-draft',record:r,diff:planningCore.planningDiff(r),sent:false,authority:'none'},raw,s);
 }
 async function prepareApply(id) {
  const s=await snapshot(),r=s.records.find(r=>r.id===id);
  if(s.owned||s.workflow.runs.some(r=>r.status==='running')||s.paper.steps.some(r=>r.status==='running'))throw Error('ACTIVE_TASK_LOCKED');
  if(!r?.proposalRaw||r.workflowRaw!==s.workflowRaw||r.paperHash!==await graphCore.sha256(JSON.stringify(s.paper),crypto))throw Error('PLANNING_DRAFT_STALE');
  await assertScopeEditable(storage,ns,crypto);s.stable();
  return issue({kind:'apply-graph',record:r,diff:planningCore.planningDiff(r),sent:false,authority:'none'},r.proposalRaw,s);
 }
 async function confirm(p,isCurrent=()=>true) {
  if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  return withLock(ns+':library-queue-write',()=>withLock(ns+':external-inbox-write',()=>withLock(ns+':planning-drafts-write',async()=>{
   check();const t=tokens.get(p);
   const current=()=>{const permitted=isCurrent();if(t?.cancelled||permitted!==true||JSON.stringify(p)!==t?.display)throw Error('PLANNING_OPERATION_EXPIRED')};
   const assertToken=()=>{if(!t||t.used||tokens.get(p)!==t||JSON.stringify(p)!==t.display)throw Error('PLANNING_PREVIEW_EXPIRED');current();t.stable()};
   assertToken();let next;if(p.kind==='save-draft')next=await planningCore.loadPlanning(t.raw,ns,crypto);else{await graphCore.importWorkflow(t.raw,crypto);await assertScopeEditable(storage,ns,crypto)}
   assertToken();const destination=p.kind==='save-draft'?key:wk;
   const attempt={scope:'memory-only',operation:p.kind,destination,source:clone(t.source),record:clone(p.record),priorRaw:storage.getItem(destination),intendedRaw:t.raw,verifiedPlanningRaw:baseline,verifiedState:clone(state)};
   // Final source/lifetime gate, followed by one write. No observer callback or
   // asynchronous work may run between this gate and consuming the capability.
   assertToken();t.used=true;
   let writeError=null,readError=null,observed;
   try{storage.setItem(destination,t.raw)}catch(e){writeError=e}
   try{observed=storage.getItem(destination)}catch(e){readError=e}
   // Seeing the prior bytes after an exception does not prove no intermediate
   // write happened. Never roll back, adopt competing bytes, or retry here.
   if(writeError||readError||observed!==t.raw)throw uncertain(attempt,{observed,readError,error:writeError||readError||Error('PLANNING_READBACK_MISMATCH')});
   try {
    current();t.writtenStable(destination,t.raw);
    // Advance only after normal write return and exact immediate readback.
    generation++;if(next){state=next;baseline=t.raw}
    const committedGeneration=generation,result=await snapshot();
    current();result.stable();t.writtenStable(destination,t.raw);
    if(generation!==committedGeneration)throw Error('PLANNING_CONTEXT_CHANGED');
    tokens.delete(p);return result;
   } catch(e) {
    let latest,latestError=null;try{latest=storage.getItem(destination)}catch(read){latestError=read}
    throw uncertain(attempt,{status:'written-recheck-required',observed:latest,readError:latestError,error:e});
   }
  })));
 }
 async function inspectCurrent() {
  // Inspection cannot clear the uncertainty latch or mint a new capability.
  const attempt=recoveryData;if(!attempt)throw Error('PLANNING_NO_RECOVERY');
  const source=clone(attempt.source),destination=attempt.destination;
  const currentSource=()=>{store.assertCurrentStorage();if(store.getStorageKey()!==ns)throw Error('PLANNING_STORAGE_CONFLICT')};
  try {
   currentSource();const raw=storage.getItem(destination),retained=observedRecovery(raw,null);
   if(!['retained','absent'].includes(retained.observedRawStatus))return {source,status:'uninspectable',...retained,blocked:true};
   let validated=null;if(raw!==null){if(destination===key)validated=await planningCore.loadPlanning(raw,ns,crypto);else{await graphCore.importWorkflow(raw,crypto);validated=JSON.parse(raw).state}}
   currentSource();if(storage.getItem(destination)!==raw)throw Error('PLANNING_INSPECTION_CHANGED');
   return {source,status:raw===attempt.intendedRaw?'attempt-observed':raw===attempt.priorRaw?'previous-observed':'other-observed',...retained,validated:clone(validated),blocked:true,currentStorageVerified:false};
  } catch(e) {return {source,status:'unreadable-or-invalid',error:diagnostic(e),blocked:true,currentStorageVerified:false}}
 }
 return {
  initialize,snapshot,prepare,prepareApply,confirm,inspectCurrent,
  recovery:()=>clone(recoveryData),
  cancel(preview){const t=tokens.get(preview);if(t)t.cancelled=true},
  invalidatePreviews(){generation++},
  async payload(input){const q=clone(input),s=await snapshot();if(q.expectedWorkflowRaw!==s.workflowRaw)throw Error('PLANNING_EDITOR_DRIFT：上下文已变化，请刷新后重试');const raw=await planningCore.planningPayload({...q,history:selectedHistory(q,s),paper:s.paper,workflowRaw:s.workflowRaw},crypto);s.stable();return raw},
  async exportJSON(){check();if(!state)throw Error('PLANNING_NOT_READY');const head=baseline,epoch=generation,raw=await planningCore.exportPlanning(state,crypto);check();if(head!==baseline||epoch!==generation)throw Error('PLANNING_CONTEXT_CHANGED');return raw}
 };
}
