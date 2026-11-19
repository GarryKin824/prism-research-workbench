import * as platformCore from './platform-plan-core.mjs';
import * as graphCore from './custom-core.mjs';

export function createPlatformPlanController({store,storage,crypto=globalThis.crypto,withLock}) {
 const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
 const fail = code => { throw Error(code); };
 const namespace=store.getStorageKey(),key=namespace+':platform-plan-v1',issued=new WeakMap(),listeners=new Set();
 let baseline=storage.getItem(key),state=null,ready=false,busy=false,uncertainty=null,outcome=null,recovery=null,consentGeneration=0;
 // This latch and outcome are process-local. v1 does not durably record a failed
 // write attempt. localStorage plus an advisory lock is not compare-and-swap.
 const getOutcome=()=>clone(outcome);
 const diagnostic=value=>{const text=typeof value==='string'?value:String(value??'UNKNOWN_ERROR');return {text:text.slice(0,500),truncated:text.length>500}};
 function observedRecovery(value,readError) {
  if(readError)return {observedRaw:null,observedRawStatus:'unreadable',observedRawType:null,observedRawLength:null,observedRawByteLength:null};
  if(value===null)return {observedRaw:null,observedRawStatus:'absent',observedRawType:'null',observedRawLength:0,observedRawByteLength:0};
  if(typeof value!=='string')return {observedRaw:null,observedRawStatus:'omitted-type',observedRawType:typeof value,observedRawLength:null,observedRawByteLength:null};
  // Do not allocate an arbitrarily large encoding merely to measure bad storage.
  const byteLength=value.length<=4000000?new TextEncoder().encode(value).length:null;
  const retained=byteLength!==null&&byteLength<=4000000;
  return {observedRaw:retained?value:null,observedRawStatus:retained?'retained':'omitted-oversized',observedRawType:'string',observedRawLength:value.length,observedRawByteLength:byteLength};
 }
 function report(change) {
  if(Object.hasOwn(change,'detail')){const d=diagnostic(change.detail);change={...change,detail:change.detail===null?null:d.text,detailTruncated:d.truncated}}
  if(Object.hasOwn(change,'code')){const d=diagnostic(change.code);change={...change,code:change.code===null?null:d.text,codeTruncated:d.truncated}}
  outcome={...outcome,...change};
  if(recovery?.operationId===outcome.id)recovery.outcome=getOutcome();
  for(const listener of listeners)try{listener(getOutcome())}catch{}
 }
 function check() {
  store.assertCurrentStorage();
  if(store.getStorageKey()!==namespace)fail('PLATFORM_PLAN_NAMESPACE_CHANGED');
  if(storage.getItem(key)!==baseline)fail('PLATFORM_PLAN_STORAGE_CONFLICT');
  if(uncertainty)fail('PLATFORM_PLAN_WRITE_UNKNOWN_NO_RETRY');
 }
 function requireReady(){if(!ready)fail('PLATFORM_PLAN_NOT_READY')}
 function current(isCurrent,token) {
  if(token?.cancelled||isCurrent()!==true)fail('PLATFORM_PLAN_CONTEXT_RETIRED');
 }
 async function exclusive(work) {
  if(busy)fail('PLATFORM_PLAN_BUSY');
  busy=true;try{return await work()}finally{busy=false}
 }
 async function initialize() {
  return exclusive(async()=>{
   check();if(ready)return clone(state);
   const next=baseline===null?await platformCore.createPlatformPlan({namespace},crypto):await platformCore.loadPlatformPlan(baseline,{namespace},crypto);
   check();state=next;ready=true;return clone(state);
  });
 }
 async function captureSnapshot() {
  check();requireReady();
  const capturedState=state,papersRaw=JSON.stringify(store.getSnapshot().papers),papers=JSON.parse(papersRaw),sources=[],workflows=[],issues=[],rows=[];
  // Capture all source bytes before the first digest yields.
  for(const p of papers) {const wk=namespace+':custom-workflow-v1:'+p.id;rows.push([wk,storage.getItem(wk)])}
  for(let i=0;i<papers.length;i++) {
   const p=papers[i],raw=rows[i][1];
   sources.push({namespace,paperId:p.id,title:p.title,documentSha256:p.document?.sha256??null,snapshotSha256:await graphCore.sha256(JSON.stringify(p),crypto)});
   if(raw!==null)try {
    await graphCore.importWorkflow(raw,crypto);const w=JSON.parse(raw).state;
    if(w.source?.namespace!==namespace||w.source?.paperId!==p.id)fail('WORKFLOW_IDENTITY_MISMATCH');
    workflows.push(w);
   } catch(e) {issues.push({paperId:p.id,error:e.message})}
  }
  function stable(){check();if(JSON.stringify(store.getSnapshot().papers)!==papersRaw||rows.some(([k,r])=>storage.getItem(k)!==r))fail('PLATFORM_PLAN_SOURCE_CHANGED')}
  stable();
  return {state:clone(capturedState),sources,workflows,issues,view:platformCore.planView(capturedState,{sources,workflows}),outcome:getOutcome(),stable};
 }
 const snapshot=()=>exclusive(captureSnapshot);
 function target(s,paperId,expectedSource,expectedGraphSha256) {
  const source=s.sources.find(x=>x.paperId===paperId),workflow=s.workflows.find(w=>w.source.paperId===paperId),graph=workflow?.graphs.find(g=>g.version===workflow.currentVersion);
  if(!source||!workflow)fail('PLATFORM_PLAN_SOURCE_UNAVAILABLE');
  if(JSON.stringify(source)!==JSON.stringify(expectedSource)||graph?.sha256!==expectedGraphSha256)fail('PLATFORM_PLAN_EDIT_SOURCE_CHANGED');
  return {source,workflow};
 }
 async function prepare(input,{isCurrent=()=>true}={}) {
  const {paperId,kind,assignments,planId,reviewVerdict='pass',maxTransitions=20,confirmNodeIds=[],expectedSource,expectedGraphSha256}=clone(input);
  return exclusive(async()=>{
   current(isCurrent);const s=await captureSnapshot(),t=target(s,paperId,expectedSource,expectedGraphSha256);let preview;
   if(kind==='plan')preview=await platformCore.preparePlan(state,{...t,assignments},crypto);
   else if(kind==='simulation')preview=await platformCore.prepareSimulation(state,{...t,planId,reviewVerdict,maxTransitions,confirmNodeIds},crypto);
   else fail('PLATFORM_PLAN_ACTION_REFUSED');
   s.stable();current(isCurrent);
   issued.set(preview,{kind,paperId,expectedSource,expectedGraphSha256,serialized:JSON.stringify(preview),used:false,cancelled:false,generation:consentGeneration});
   return preview;
  });
 }
 function beginOutcome({kind,paperId,paperTitle,sessionId=null,planId=null,planVersion=null,graphSha256=null,sourceSnapshotSha256=null,stage}) {
  report({id:crypto.randomUUID(),kind,paperId,paperTitle,sessionId,planId,planVersion,graphSha256,sourceSnapshotSha256,stage,status:'working',writeAttempted:false,intentCommitted:false,blocked:false,code:null,detail:null,reconciliation:null});
 }
 function outcomeError(code,cause) {
  const detail=diagnostic(cause?.message),error=new Error(code+(cause?.message?': '+detail.text+(detail.truncated?' [diagnostic truncated]':''):''),cause?{cause}:undefined);
  error.code=code;error.outcome=getOutcome();return error;
 }
 async function save(next,stable,stage) {
  report({stage});
  const raw=await platformCore.exportPlatformPlan(next,crypto);
  // Nothing asynchronous may run between this final gate and the sole write.
  stable();
  const previous=baseline;
  // Do not notify subscribers here: a callback must not invalidate the final
  // selection/source gate before setItem. The outcome is readable synchronously.
  outcome={...outcome,stage,writeAttempted:true};
  let writeError=null,readError=null,observed;
  try{storage.setItem(key,raw)}catch(e){writeError=e}
  try{observed=storage.getItem(key)}catch(e){readError=e}
  if(writeError||readError||observed!==raw) {
   uncertainty={raw,previous};consentGeneration++;
   recovery={operationId:outcome.id,scope:'memory-only',currentStorageVerified:false,verifiedState:clone(state),verifiedStateProvenance:previous===null?'initialized-empty-not-persisted':'last-verified-storage',verifiedRaw:previous,attemptedRaw:raw,...observedRecovery(observed,readError),readbackAvailable:!readError,readError:readError?diagnostic(readError.message).text:null,readErrorTruncated:readError?diagnostic(readError.message).truncated:false};
   const cause=writeError||readError||Error('PLATFORM_PLAN_READBACK_MISMATCH');
   report({status:'unknown',blocked:true,code:'PLATFORM_PLAN_WRITE_UNKNOWN_NO_RETRY',detail:cause.message,reconciliation:readError?'unreadable':observed===raw?'attempt-observed':observed===previous?'previous-observed':'other-observed'});
   throw outcomeError('PLATFORM_PLAN_WRITE_UNKNOWN_NO_RETRY',cause);
  }
  // Advance only after normal return AND exact immediate readback. This is a
  // bounded observation, not a guarantee against subsequent cross-tab writes.
  baseline=raw;state=next;
  if(stage==='begin')report({intentCommitted:true});
  return clone(state);
 }
 function failed(error) {
  if(outcome.status!=='unknown')report({status:outcome.intentCommitted?'interrupted':'not-written',code:error.code||error.message,detail:error.message,blocked:false});
  // Discard the core's in-memory execution capability. A persisted begin must
  // now be shown as unknown and may only be explicitly abandoned, never resumed.
  if(outcome.intentCommitted)state=clone(state);
  error.outcome=getOutcome();throw error;
 }
 async function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true}={}) {
  if(explicitConfirmation!==true)fail('PLATFORM_PLAN_CONFIRMATION_REQUIRED');
  if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED');
  return exclusive(async()=>{
   const token=issued.get(preview);
   if(!token||token.used||token.cancelled||token.generation!==consentGeneration||JSON.stringify(preview)!==token.serialized)fail('PLATFORM_PLAN_PREVIEW_NOT_ISSUED');
   check();requireReady();
   // Consume consent once, including pre-write failures. A deliberate new
   // preview is required; callers cannot automatically replay this operation.
   token.used=true;
   beginOutcome({kind:token.kind,paperId:token.paperId,paperTitle:token.expectedSource?.title,sessionId:preview.data.sessionId??null,planId:preview.data.planId,planVersion:preview.data.version??null,graphSha256:token.expectedGraphSha256,sourceSnapshotSha256:token.expectedSource?.snapshotSha256??null,stage:token.kind==='plan'?'plan':'begin'});
   try{return await withLock(namespace+':platform-plan-write',async()=>{
    current(isCurrent,token);const s=await captureSnapshot(),t=target(s,token.paperId,token.expectedSource,token.expectedGraphSha256);
    const stable=()=>{s.stable();current(isCurrent,token)};
    if(token.kind==='plan') {
     const next=await platformCore.confirmPlan(state,preview,t,crypto);await save(next,stable,'plan');
    } else {
     const begun=await platformCore.beginSimulation(state,preview,t,crypto);await save(begun,stable,'begin');
     // A navigation/source change after this commit retires execution, not the
     // committed intent. Do not start or persist another stage on stale consent.
     stable();
     const finished=await platformCore.finishSimulation(state,{sessionId:preview.data.sessionId,...t},crypto);
     await save(finished,stable,'finish');
    }
    report({status:'saved',blocked:false,code:null,detail:null});return clone(state);
   })}catch(error){return failed(error)}
  });
 }
 async function abandon({sessionId,reason,explicitConfirmation=false,isCurrent=()=>true}) {
  if(explicitConfirmation!==true)fail('PLATFORM_PLAN_CONFIRMATION_REQUIRED');
  if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED');
  return exclusive(async()=>{
   check();requireReady();
   const view=platformCore.planView(state),session=view.sessions.find(s=>s.sessionId===sessionId),plan=view.plans.find(p=>p.planId===session?.planId);
   beginOutcome({kind:'abandon',paperId:session?.begin.source.paperId??null,paperTitle:session?.begin.source.title??null,sessionId,planId:session?.planId??null,planVersion:plan?.version??null,graphSha256:plan?.graph.sha256??null,sourceSnapshotSha256:session?.begin.source.snapshotSha256??null,stage:'abandon'});
   try{return await withLock(namespace+':platform-plan-write',async()=>{
    const stable=()=>{check();current(isCurrent)};stable();
    const next=await platformCore.abandonSimulation(state,{sessionId,reason},crypto);
    await save(next,stable,'abandon');report({status:'saved',blocked:false,code:null,detail:null});return clone(state);
   })}catch(error){return failed(error)}
  });
 }
 async function reconcile() {
  return exclusive(async()=>{
   requireReady();store.assertCurrentStorage();
   if(store.getStorageKey()!==namespace)fail('PLATFORM_PLAN_NAMESPACE_CHANGED');
   if(!uncertainty)return captureSnapshot();
   const attempt=uncertainty;let raw,next;
   try{raw=storage.getItem(key)}catch(e){report({reconciliation:'unreadable',detail:e.message});throw outcomeError('PLATFORM_PLAN_RECONCILE_UNREADABLE',e)}
   try{next=raw===null?null:await platformCore.loadPlatformPlan(raw,{namespace},crypto)}catch(e){report({reconciliation:'invalid',detail:e.message});throw outcomeError('PLATFORM_PLAN_RECONCILE_INVALID',e)}
   store.assertCurrentStorage();
   let after;try{after=storage.getItem(key)}catch(e){report({reconciliation:'unreadable',detail:e.message});throw outcomeError('PLATFORM_PLAN_RECONCILE_UNREADABLE',e)}
   if(after!==raw){report({reconciliation:'changed'});throw outcomeError('PLATFORM_PLAN_RECONCILE_CHANGED')}
   const reconciliation=raw===attempt.raw?'attempt-observed':raw===attempt.previous?'previous-observed':'other-observed';
   if(reconciliation==='other-observed') {
    report({reconciliation,blocked:true});
    // Inspection only: do not adopt a competing/altered history or write over it.
    return {state:clone(next),sources:[],workflows:[],issues:[],view:next?platformCore.planView(next):null,outcome:getOutcome(),observedOnly:true};
   }
   // Loading removes transient simulation tokens. An observed begin remains
   // unknown. Seeing previous bytes does NOT prove an earlier commit never ran.
   baseline=raw;if(next!==null)state=next;else state=clone(state);uncertainty=null;
   report({reconciliation,blocked:false});
   return captureSnapshot();
  });
 }
 return {
  initialize,snapshot,prepare,confirm,abandon,reconcile,getOutcome,
  // Recovery material is not exportJSON and makes no current-storage claim.
  inspectRecovery(){return clone(recovery)},
  cancel(preview){const token=issued.get(preview);if(token)token.cancelled=true},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  async exportJSON(){return exclusive(async()=>{check();requireReady();const raw=await platformCore.exportPlatformPlan(state,crypto);check();return raw})}
 };
}
