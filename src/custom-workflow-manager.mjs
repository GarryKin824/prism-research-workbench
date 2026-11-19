import {assertWorkflowOwner} from './project-execution-owner.mjs';
import * as graphCore from './custom-core.mjs';
// Separate new-schema store; no writes to old research/history or Host state.
export function createCustomWorkflowManager({store,paperId,storage,crypto=globalThis.crypto,withLock,ownerToken=null}){
 const namespace=store.getStorageKey(),key=namespace+':custom-workflow-v1:'+paperId,previews=new WeakMap();
 let baseline=storage.getItem(key),state=null,ready=false,unknown=null;
 const ownerKeys=['research-instances-v1','project-execution-owner-v1','project-queues-v1','project-library-v1','project-planning-v1','library-queue-v1'].map(suffix=>namespace+':'+suffix);
 const usable=()=>{if(unknown)throw unknown};
 const sourcePaper=()=>{const p=store.getSnapshot().papers.find(p=>p.id===paperId);if(!p)throw Error('PAPER_NOT_FOUND');return p};
 const checkStorage=()=>{usable();store.assertCurrentStorage();if(store.getStorageKey()!==namespace)throw Error('CUSTOM_WORKFLOW_CONTEXT_CHANGED');if(storage.getItem(key)!==baseline)throw Error('CUSTOM_WORKFLOW_STORAGE_CONFLICT')};
 const check=()=>{checkStorage();if(!ready)throw Error('CUSTOM_WORKFLOW_NOT_READY')};
 function checkSource(s){const p=sourcePaper();if(!s.source||s.source.namespace!==namespace||s.source.paperId!==paperId||s.source.paperTitle!==p.title||s.source.documentSha256!==(p.document?.sha256||null))throw Error('CUSTOM_SOURCE_CHANGED')}
 function assertCurrent(isCurrent){if(isCurrent!==undefined){let current=false;try{current=typeof isCurrent==='function'&&isCurrent()===true}catch{}if(!current)throw Error('CUSTOM_WORKFLOW_STALE_OPERATION')}}
 // Capture plain data synchronously, before lock acquisition or the first digest.
 // Unlike JSON round-tripping, this preserves undefined and invalid numeric values
 // for the core's own validation instead of silently changing the requested action.
 function capture(value,seen=new Set(),depth=0){
  if(value===null||['undefined','string','boolean','number'].includes(typeof value))return value;
  if(typeof value!=='object'||seen.has(value)||depth>40)throw Error('CUSTOM_WORKFLOW_ARGUMENTS_INVALID');
  seen.add(value);const copy=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value)){const property=Object.getOwnPropertyDescriptor(value,key);if(!property||!Object.hasOwn(property,'value'))throw Error('CUSTOM_WORKFLOW_ARGUMENTS_INVALID');Object.defineProperty(copy,key,{value:capture(property.value,seen,depth+1),enumerable:true,writable:true,configurable:true})}
  seen.delete(value);return Object.freeze(copy);
 }
 function operation(isCurrent){
  usable();assertCurrent(isCurrent);check();const sourceRaw=JSON.stringify(sourcePaper()),ownerRaws=ownerKeys.map(k=>storage.getItem(k));
  const stable=()=>{check();assertCurrent(isCurrent);if(JSON.stringify(sourcePaper())!==sourceRaw)throw Error('CUSTOM_SOURCE_CHANGED');if(ownerKeys.some((k,i)=>storage.getItem(k)!==ownerRaws[i]))throw Error('CUSTOM_WORKFLOW_OWNER_CHANGED')};
  // Core and owner validation each contain multiple awaits. Do not let a stale
  // callback resume another hash, and check again after their outer await too.
  const guardedCrypto={randomUUID:()=>{stable();return crypto.randomUUID()},subtle:{digest:async(...args)=>{stable();try{return await crypto.subtle.digest(...args)}finally{stable()}}}};
  stable();return {stable,crypto:guardedCrypto,sourceRaw,isCurrent};
 }
 async function initialize(){
  checkStorage();const expected=baseline,sourceRaw=JSON.stringify(sourcePaper());let restored=null;
  if(expected!==null){if(new TextEncoder().encode(expected).length>4000000)throw Error('CUSTOM_WORKFLOW_TOO_LARGE');restored=await graphCore.importWorkflow(expected,crypto)}
  checkStorage();if(baseline!==expected)throw Error('CUSTOM_WORKFLOW_STORAGE_CONFLICT');if(JSON.stringify(sourcePaper())!==sourceRaw)throw Error('CUSTOM_SOURCE_CHANGED');if(restored)checkSource(restored);
  state=restored;ready=true;return state;
 }
 async function preview(){
  check();if(state)throw Error('CUSTOM_WORKFLOW_EXISTS');const snapshot=JSON.stringify(sourcePaper());
  const {workflow}=await graphCore.previewLegacyMigration({namespace,paper:JSON.parse(snapshot)},crypto);
  check();if(state)throw Error('CUSTOM_WORKFLOW_EXISTS');if(JSON.stringify(sourcePaper())!==snapshot)throw Error('CUSTOM_SOURCE_CHANGED');previews.set(workflow,JSON.stringify(workflow));return workflow;
 }
 async function save(next,op,ownerAction=null){
  op.stable();checkSource(next);const raw=await graphCore.exportWorkflow(next,op.crypto);op.stable();
  await assertWorkflowOwner(storage,namespace,ownerToken,paperId,ownerAction,op.crypto);op.stable();checkSource(next);
  if(new TextEncoder().encode(raw).length>4000000)throw Error('CUSTOM_WORKFLOW_TOO_LARGE');
  // This is the last guard before the first write. Once attempted, only exact
  // readback can establish success. Never retry, roll back, or salvage a throw.
  op.stable();assertCurrent(op.isCurrent);
  try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('CUSTOM_WORKFLOW_READBACK_MISMATCH')}
  catch(cause){unknown=Error('CUSTOM_WORKFLOW_SAVE_UNKNOWN_RELOAD_REQUIRED',{cause});throw unknown}
  baseline=raw;state=next;return state;
 }
 async function guardedCreate(previewState,isCurrent){
  usable();assertCurrent(isCurrent);if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  const fixed=previews.get(previewState);
  if(!fixed||JSON.stringify(previewState)!==fixed||previewState.syntheticAuthorized||previewState.runs.length||Object.keys(previewState.currentRuns).length)throw Error('CUSTOM_PREVIEW_REQUIRED');
  const next=capture(JSON.parse(fixed)),op=operation(isCurrent);
  return withLock(namespace+':external-inbox-write',async()=>{
   op.stable();if(state||baseline!==null)throw Error('CUSTOM_WORKFLOW_EXISTS');if(previews.get(previewState)!==fixed)throw Error('CUSTOM_PREVIEW_REQUIRED');
   checkSource(next);await assertWorkflowOwner(storage,namespace,ownerToken,paperId,null,op.crypto);op.stable();checkSource(next);
   if(await graphCore.sha256(op.sourceRaw,op.crypto)!==next.source.sourceArchiveSha256)throw Error('CUSTOM_SOURCE_CHANGED');op.stable();
   const saved=await save(next,op);previews.delete(previewState);return saved;
  });
 }
 async function create(previewState){return guardedCreate(previewState)}
 async function guardedApply(action,args=[],isCurrent){
  usable();assertCurrent(isCurrent);if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  const allowed=['editGraph','approveNode','startNext','finishSynthetic','cancelActive','resumeWorkflow','authorizeSynthetic','pauseWorkflow'];
  if(!allowed.includes(action))throw Error('CUSTOM_ACTION_REFUSED');if(!Array.isArray(args))throw Error('CUSTOM_WORKFLOW_ARGUMENTS_INVALID');
  const capturedArgs=capture(args),op=operation(isCurrent);
  return withLock(namespace+':external-inbox-write',async()=>{
   op.stable();if(!state)throw Error('CUSTOM_WORKFLOW_MISSING');checkSource(state);
   await assertWorkflowOwner(storage,namespace,ownerToken,paperId,action,op.crypto);op.stable();checkSource(state);
   const next=await graphCore[action](state,...capturedArgs,op.crypto);op.stable();return save(next,op,action);
  });
 }
 // Queue callers intentionally settle an already-durable intent without a page
 // guard. The standalone editor uses the guarded methods above instead.
 async function apply(action,...args){return guardedApply(action,args)}
 return {initialize,preview,create,guardedCreate,apply,guardedApply,async exportJSON(){check();if(!state)throw Error('CUSTOM_WORKFLOW_MISSING');checkSource(state);const expected=state,sourceRaw=JSON.stringify(sourcePaper()),raw=await graphCore.exportWorkflow(expected,crypto);check();checkSource(expected);if(state!==expected)throw Error('CUSTOM_WORKFLOW_STORAGE_CONFLICT');if(JSON.stringify(sourcePaper())!==sourceRaw)throw Error('CUSTOM_SOURCE_CHANGED');return raw}};
}
