// Explicit manual persistence only. No reads at construction or authority recovery. Clear requires separate explicit confirmation.
const outcomes=new WeakMap();
const fail=c=>{throw Error(c)},clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function createInstanceDiscussionStorageController({storage,scope,validate,withLock}){
 const fields=['namespace','projectId','paperId','instanceId','nodeId'];
 if(!scope||Object.keys(scope).sort().join()!==fields.slice().sort().join()||fields.some(k=>typeof scope[k]!=='string'||!scope[k]||scope[k].length>200))fail('DISCUSSION_SCOPE_INVALID');
 const bound=clone(scope),scopeRaw=canonical(scope),namespace=bound.namespace,key=namespace+':instance-discussion-v1:'+JSON.stringify(fields.slice(1).map(k=>bound[k])),lockName=key+':write';
 if(typeof validate!=='function')fail('DISCUSSION_VALIDATOR_REQUIRED');
 let map=outcomes.get(storage);if(!map){map=new Map();outcomes.set(storage,map)}
 let outcome=map.get(key);if(!outcome){outcome={unknown:false,recovery:null,preservation:null};map.set(key,outcome)}
 let generation=0,busy=false;const issued=new WeakMap(),inflight=new WeakMap();
 const check=write=>{if(canonical(scope)!==scopeRaw)fail('DISCUSSION_SCOPE_CHANGED');if(write&&outcome.unknown)fail('DISCUSSION_WRITE_UNKNOWN_NO_RETRY')};
 const read=()=>{try{return storage.getItem(key)}catch{fail('DISCUSSION_STORAGE_READ_FAILED')}};
 async function inspect(raw){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>200*1024)fail('DISCUSSION_PACKAGE_TOO_LARGE');
  const packet=await validate(raw);
  if(!packet||canonical(packet.scope)!==scopeRaw)fail('DISCUSSION_SCOPE_MISMATCH');
  return packet;
 }
 async function prepareSave(raw,{isCurrent=()=>true,verifyCurrent}={}){
  if(typeof verifyCurrent!=='function')fail('DISCUSSION_TRUSTED_VERIFY_REQUIRED');
  if(busy)fail('DISCUSSION_BUSY');check(true);const g=++generation,previousRaw=read();
  const stable=()=>{check(true);if(verifyCurrent()===false)fail('DISCUSSION_BINDING_CHANGED');if(g!==generation||!isCurrent())fail('DISCUSSION_PREVIEW_EXPIRED');if(read()!==previousRaw)fail('DISCUSSION_HEAD_CHANGED')};stable();
  const packet=await inspect(raw);stable();let previous=null;
  if(previousRaw!==null){outcome.preservation={key,raw:previousRaw,verification:'unverified'};previous=await inspect(previousRaw);stable()}
  let merged=clone(packet);
  if(previous){const rounds=clone(previous.rounds),byId=new Map(rounds.map(r=>[r.id,r]));for(const r of packet.rounds){if(byId.has(r.id)){if(canonical(byId.get(r.id))!==canonical(r))fail('DISCUSSION_HISTORY_ID_CONFLICT')}else{rounds.push(clone(r));byId.set(r.id,r)}}merged.rounds=rounds}
  const newRaw=JSON.stringify(merged);await inspect(newRaw);stable();
  const preview={key,previousRaw,newRaw,previousExists:previousRaw!==null,previousRoundCount:previous?.rounds.length||0,roundCount:merged.rounds.length};
  issued.set(preview,{kind:'save',previousRaw,newRaw,display:JSON.stringify(preview),stable});return preview;
 }
 async function confirmSave(preview,{explicitConfirmation=false,replaceConfirmation=false,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true)fail('DISCUSSION_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('DISCUSSION_WEB_LOCKS_REQUIRED');if(busy)fail('DISCUSSION_BUSY');
  const t=issued.get(preview);if(!t||t.kind!=='save')fail('DISCUSSION_PREVIEW_EXPIRED');if(t.previousRaw!==null&&replaceConfirmation!==true)fail('DISCUSSION_REPLACE_CONFIRM_REQUIRED');
  issued.delete(preview);inflight.set(preview,t);busy=true;
  const stable=()=>{t.stable();if(t.cancelled||!isCurrent()||JSON.stringify(preview)!==t.display)fail('DISCUSSION_PREVIEW_EXPIRED')};
  try{return await withLock(lockName,async()=>{
   stable();await inspect(t.newRaw);stable();
   const recovery={key,previousRaw:t.previousRaw,attemptedRaw:t.newRaw,observedRaw:null,observedReadSucceeded:false,outcome:'unknown'};
   try{storage.setItem(key,t.newRaw);recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true;if(recovery.observedRaw!==t.newRaw)throw Error('readback')}
   catch{outcome.unknown=true;outcome.recovery=recovery;if(!recovery.observedReadSucceeded)try{recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true}catch{}fail('DISCUSSION_WRITE_UNKNOWN_NO_RETRY')}
   return {committed:true,raw:t.newRaw,key};
  })}finally{busy=false;inflight.delete(preview)}
 }
 async function prepareClear({explicitReadConsent=false,isCurrent=()=>true,verifyCurrent}={}){
  if(explicitReadConsent!==true)fail('DISCUSSION_READ_CONSENT_REQUIRED');
  if(typeof verifyCurrent!=='function')fail('DISCUSSION_TRUSTED_VERIFY_REQUIRED');
  if(busy)fail('DISCUSSION_BUSY');check(true);const g=++generation,previousRaw=read();
  const stable=()=>{check(true);if(verifyCurrent()===false)fail('DISCUSSION_BINDING_CHANGED');if(g!==generation||!isCurrent())fail('DISCUSSION_PREVIEW_EXPIRED');if(read()!==previousRaw)fail('DISCUSSION_HEAD_CHANGED')};stable();
  if(previousRaw===null)fail('DISCUSSION_NO_SAVED_COPY');
  outcome.preservation={key,raw:previousRaw,verification:'unverified'};let packet=null;try{packet=await inspect(previousRaw)}catch{}stable();
  const preview={kind:'clear-discussion-copy',key,scope:clone(bound),previousRaw,previousExists:true,roundCount:packet?.rounds.length??null,verification:packet?'schema-valid-unverified-history':'unverified-or-invalid',backupRaw:JSON.stringify({schema:'prism-discussion-local-copy-backup/v1',scope:bound,key,raw:previousRaw}),backupNotice:'Browser download is not verified backup. Confirm you separately saved these exact bytes or accept losing this local copy. In-memory discussion is not deleted.'};
  issued.set(preview,{kind:'clear',previousRaw,display:JSON.stringify(preview),stable});return preview;
 }
 async function confirmClear(preview,{explicitConfirmation=false,clearConfirmation=false,backupAcknowledgement=false,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true||clearConfirmation!==true||backupAcknowledgement!==true)fail('DISCUSSION_CLEAR_CONFIRM_REQUIRED');
  if(typeof withLock!=='function')fail('DISCUSSION_WEB_LOCKS_REQUIRED');if(busy)fail('DISCUSSION_BUSY');
  const t=issued.get(preview);if(!t||t.kind!=='clear')fail('DISCUSSION_PREVIEW_EXPIRED');
  issued.delete(preview);inflight.set(preview,t);busy=true;
  const stable=()=>{t.stable();if(t.cancelled||!isCurrent()||JSON.stringify(preview)!==t.display)fail('DISCUSSION_PREVIEW_EXPIRED')};
  try{return await withLock(lockName,async()=>{
   stable();
   const recovery={operation:'clear',key,previousRaw:t.previousRaw,attemptedRaw:null,observedRaw:null,observedReadSucceeded:false,outcome:'unknown'};
   try{storage.removeItem(key);recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true;if(recovery.observedRaw!==null)throw Error('readback')}
   catch{outcome.unknown=true;outcome.recovery=recovery;if(!recovery.observedReadSucceeded)try{recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true}catch{}fail('DISCUSSION_CLEAR_UNKNOWN_NO_RETRY')}
   return {cleared:true,key,scope:clone(bound),previousRaw:t.previousRaw};
  })}finally{busy=false;inflight.delete(preview)}
 }
 async function previewSaved({explicitReadConsent=false,isCurrent=()=>true}={}){
  if(explicitReadConsent!==true)fail('DISCUSSION_READ_CONSENT_REQUIRED');check(false);const g=++generation,raw=read();
  const stable=()=>{check(false);if(g!==generation||!isCurrent())fail('DISCUSSION_PREVIEW_EXPIRED');if(read()!==raw)fail('DISCUSSION_HEAD_CHANGED')};stable();if(raw===null)return null;
  outcome.preservation={key,raw,verification:'unverified'};await inspect(raw);stable();return {raw,key,outcome:outcome.unknown?'unknown':'read-only'};
 }
 function cancel(preview){generation++;if(preview){const t=issued.get(preview)||inflight.get(preview);if(t)t.cancelled=true;issued.delete(preview)}}
 return {key,namespace,lockName,prepareSave,confirmSave,prepareClear,confirmClear,previewSaved,cancel,recovery:()=>outcome.recovery?clone(outcome.recovery):null,preservation:()=>outcome.preservation?clone(outcome.preservation):null};
}
