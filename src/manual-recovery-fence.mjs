import {validateManualReviews,MANUAL_REVIEW_V2_SCHEMA,latestManualReview} from './manual-review-core.mjs';
// Runtime-only admission tokens. JSON objects, hashes and saved approval flags cannot mint one.
const manualRecoveryFenceTokens=new WeakMap();
const fail=code=>{throw Error(code)};
const identity=record=>JSON.stringify([record?.id,record?.binding]);
export function createManualRecoveryFence({namespace,reviewState,recoveredRecords,reservedBindings}){
 validateManualReviews(reviewState);
 if(reviewState.namespace!==namespace||!Array.isArray(recoveredRecords)||!Array.isArray(reservedBindings))fail('MANUAL_RECOVERY_FENCE_INPUT');
 const token=Object.freeze({kind:'manual-recovery-runtime-fence'}),prefix=reviewState.events.map(event=>JSON.stringify(event));
 const identities=new Set(recoveredRecords.map(identity));
 if(reservedBindings.some(binding=>typeof binding!=='string'||!/^[a-f0-9]{64}$/.test(binding)))fail('MANUAL_RECOVERY_FENCE_INPUT');
 manualRecoveryFenceTokens.set(token,{namespace,schema:reviewState.schema,prefix,observedPrefix:[...prefix],observedSchema:reviewState.schema,identities,bindings:new Set(reservedBindings)});
 return token;
}
export function captureManualRecoveryFence(getRecoveryFence){
 const read=()=>typeof getRecoveryFence==='function'?getRecoveryFence():null,token=read();
 if(token!==null&&token!==undefined&&!manualRecoveryFenceTokens.has(token))fail('MANUAL_RECOVERY_FENCE_INVALID');
 const entry=token?manualRecoveryFenceTokens.get(token):null;
 const stable=()=>{if(read()!==token)fail('MANUAL_RECOVERY_FENCE_CHANGED');return true};
 const assertHead=state=>{
  stable();if(!entry)return true;validateManualReviews(state);
  if(state.namespace!==entry.namespace||entry.observedSchema===MANUAL_REVIEW_V2_SCHEMA&&state.schema!==entry.observedSchema||state.events.length<entry.observedPrefix.length||entry.observedPrefix.some((event,index)=>JSON.stringify(state.events[index])!==event))fail('MANUAL_RECOVERY_REVIEW_PREFIX_CHANGED');
  // Share the observed append-only high-water mark across freshly created controllers.
  // The admission floor stays fixed: only this observed prefix grows.
  entry.observedPrefix=state.events.map(event=>JSON.stringify(event));entry.observedSchema=state.schema;
  return true;
 };
 const approvalCurrent=(record,event,state)=>{
  assertHead(state);if(!entry||!entry.identities.has(identity(record)))return true;
  return !!event&&event.decision==='approved'&&event.sequence>entry.prefix.length&&JSON.stringify(latestManualReview(state,event.subject))===JSON.stringify(event);
 };
 return {stable,assertHead,approvalCurrent,assertApproval(record,event,state){if(!approvalCurrent(record,event,state))fail('MANUAL_RECOVERY_FRESH_APPROVAL_REQUIRED');return true},assertBindingAvailable(binding){stable();if(entry?.bindings.has(binding))fail('MANUAL_RECOVERY_DUPLICATE_HISTORICAL_BINDING');return true}};
}
