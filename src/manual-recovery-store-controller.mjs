import {createManualRecoverySnapshot,readManualRecoverySnapshot,assertManualRecoveryLocalSize} from './manual-recovery-snapshot-core.mjs';

// No constructor reads, autosave, automatic recovery, delete, clipboard or network.
// A failed write/readback remains latched across controllers in this loaded module.
// A browser restart cannot preserve an in-memory latch; it never auto-retries.
const manualRecoveryOutcomes=new WeakMap();
const clone=x=>JSON.parse(JSON.stringify(x)),fail=code=>{throw Error(code)};
export function createManualRecoveryStoreController({store,storage,crypto=globalThis.crypto,withLock,getRecords,getDrafts,getContext,isBusy=()=>false}){
 const namespace=store.getStorageKey(),key=namespace+':manual-original-session-v1',lockName=namespace+':manual-handoff-ledger-v1:copy',issued=new WeakMap(),inflight=new WeakMap();let operation=0,busy=false;
 let outcomes=manualRecoveryOutcomes.get(storage);if(!outcomes){outcomes=new Map();manualRecoveryOutcomes.set(storage,outcomes)}
 let outcome=outcomes.get(key);if(!outcome){outcome={uncertain:false,recovery:null,preservation:null};outcomes.set(key,outcome)}
 function check({write=false}={}){
  if(store.getStorageKey()!==namespace)fail('MANUAL_RECOVERY_NAMESPACE_CHANGED');
  if(write){if(outcome.uncertain)fail('MANUAL_RECOVERY_WRITE_UNKNOWN_NO_RETRY');store.assertCurrentStorage();if(isBusy()!==false)fail('MANUAL_RECOVERY_BUSY')}
 }
 function readRaw(){try{return storage.getItem(key)}catch{fail('MANUAL_RECOVERY_STORAGE_READ_FAILED')}}
 async function inspectRaw(raw){
  if(raw===null)return null;
  // Retain the exact explicitly read bytes even if size/schema/hash checking fails.
  // This is preservation, not a declaration that storage or the contents are valid.
  outcome.preservation={key,namespace,raw,verification:'unverified'};
  assertManualRecoveryLocalSize(raw);const snapshot=await readManualRecoverySnapshot(raw,{crypto,allowLegacy:false});
  if(snapshot.context.namespace!==namespace)fail('MANUAL_RECOVERY_NAMESPACE_CHANGED');return snapshot;
 }
 function capture(){
  check({write:true});
  const context=getContext(),records=getRecords(),drafts=getDrafts();
  const contextRaw=JSON.stringify(context),recordsRaw=JSON.stringify(records),draftsRaw=JSON.stringify(drafts);
  if(context?.namespace!==namespace)fail('MANUAL_RECOVERY_NAMESPACE_CHANGED');
  return {context:clone(context),records:clone(records),drafts:clone(drafts),stable(){check({write:true});if(JSON.stringify(getContext())!==contextRaw||JSON.stringify(getRecords())!==recordsRaw||JSON.stringify(getDrafts())!==draftsRaw)fail('MANUAL_RECOVERY_LIVE_CHANGED')}};
 }
 async function prepareSave({includeDrafts=false}={}, {isCurrent=()=>true}={}){
  if(busy)fail('MANUAL_RECOVERY_BUSY');const captured=capture(),generation=++operation,previousRaw=readRaw();
  const stable=()=>{captured.stable();if(generation!==operation||isCurrent()!==true)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED');if(readRaw()!==previousRaw)fail('MANUAL_RECOVERY_HEAD_CHANGED')};stable();
  // Existing bytes are never silently replaced, even if damaged or from another namespace.
  let previousSnapshot=null;
  if(previousRaw!==null){previousSnapshot=await inspectRaw(previousRaw);stable()}
  const snapshot=await createManualRecoverySnapshot({...captured,includeDrafts},crypto);stable();assertManualRecoveryLocalSize(snapshot.raw);
  const preview={kind:'save-manual-recovery-snapshot',key,namespace,snapshot,previousSnapshot,previousExists:previousRaw!==null,previousUtf8Bytes:previousRaw===null?0:new TextEncoder().encode(previousRaw).length};
  issued.set(preview,{previousRaw,attemptedRaw:snapshot.raw,snapshot:clone(snapshot),display:JSON.stringify(preview),stable});return preview;
 }
 async function confirmSave(preview,{explicitConfirmation=false,replaceConfirmation=false,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true)fail('MANUAL_RECOVERY_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_MANUAL_RECOVERY');if(busy)fail('MANUAL_RECOVERY_BUSY');
  const token=issued.get(preview);if(!token)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED');if(token.previousRaw!==null&&replaceConfirmation!==true)fail('MANUAL_RECOVERY_REPLACE_CONFIRM_REQUIRED');issued.delete(preview);inflight.set(preview,token);busy=true;
  const stable=()=>{token.stable();if(token.cancelled||isCurrent()!==true||JSON.stringify(preview)!==token.display)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED')};
  try{return await withLock(lockName,async()=>{
   stable();const checked=await readManualRecoverySnapshot(token.attemptedRaw,{crypto,allowLegacy:false});assertManualRecoveryLocalSize(token.attemptedRaw);stable();
   // After this boundary any failure is uncertain, never a retry or rollback.
   const recovery={key,namespace,previousRaw:token.previousRaw,attemptedRaw:token.attemptedRaw,observedRaw:null,observedReadSucceeded:false,outcome:'unknown'};
   try{storage.setItem(key,token.attemptedRaw)}catch{outcome.uncertain=true;outcome.recovery=recovery;try{recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true}catch{}fail('MANUAL_RECOVERY_WRITE_UNKNOWN_NO_RETRY')}
   try{recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true}catch{outcome.uncertain=true;outcome.recovery=recovery;fail('MANUAL_RECOVERY_READBACK_UNKNOWN_NO_RETRY')}
   if(recovery.observedRaw!==token.attemptedRaw){outcome.uncertain=true;outcome.recovery=recovery;fail('MANUAL_RECOVERY_READBACK_UNKNOWN_NO_RETRY')}
   return {committed:true,key,namespace,snapshot:checked};
  })}finally{busy=false;inflight.delete(preview)}
 }
 async function previewSaved({explicitReadConsent=false,isCurrent=()=>true}={}){
  if(explicitReadConsent!==true)fail('MANUAL_RECOVERY_READ_CONSENT_REQUIRED');check();const generation=++operation,raw=readRaw();
  const stable=()=>{check();if(generation!==operation||isCurrent()!==true)fail('MANUAL_RECOVERY_PREVIEW_EXPIRED');if(readRaw()!==raw)fail('MANUAL_RECOVERY_HEAD_CHANGED')};stable();
  if(raw===null)return null;const snapshot=await inspectRaw(raw);stable();return {...snapshot,storageKey:key,storageOutcome:outcome.uncertain?'unknown':'read-only'};
 }
 function cancel(preview){operation++;const token=issued.get(preview)||inflight.get(preview);if(token)token.cancelled=true;issued.delete(preview)}
 return {key,namespace,lockName,prepareSave,confirmSave,previewSaved,cancel,recovery:()=>outcome.recovery?{...outcome.recovery}:null,preservation:()=>outcome.preservation?{...outcome.preservation}:null};
}
