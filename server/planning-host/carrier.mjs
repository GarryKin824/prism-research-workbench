/** Opt-in official Host RPC carrier. Host owner-wide, NOT per-tab authorization.
 * No transport/model/authentication creation. Documents are admitted only by trusted
 * in-process composition. Request IDs and document IDs are selectors, not authority.
 */
import {randomUUID} from 'node:crypto';
import {createPlanningSessionBroker} from '../planning-http/session-broker.mjs';
export const PLANNING_HOST_CHANNEL='/prism-planning-fixture';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const failure=()=>({ok:false,error:{code:'PLANNING_HOST_REFUSED',message:'Planning fixture request refused',details:{}}});
const invalid=()=>{throw Error('PLANNING_HOST_CONFIGURATION_INVALID');};
export function createPlanningHostCatalog({maxDocuments=16,maxActiveDispatches=8,lifetimeMs=300000,leaseMs=60000,requestTimeoutMs=10000}={}){
 if(!Number.isSafeInteger(maxActiveDispatches)||maxActiveDispatches<1||maxActiveDispatches>16||!Number.isSafeInteger(maxDocuments)||maxDocuments<1||maxDocuments>64||![lifetimeMs,leaseMs,requestTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)||lifetimeMs>300000||leaseMs>60000||requestTimeoutMs>60000)invalid();
 const entries=new Map(),bindings=new Set();let closed=false,registered=0,activeDispatches=0;
 function retire(id){const e=entries.get(id);if(!e)return;entries.delete(id);bindings.delete(e.key);clearTimeout(e.timer);e.abort.abort();e.broker.close();}
 function registerDocument({document,bridge,assertCurrent=()=>true}={}){
  if(closed||registered>=maxDocuments||typeof assertCurrent!=='function')invalid();
  // Validate through the existing broker before admitting or consuming capacity.
  let snapshot;try{snapshot=freeze(JSON.parse(JSON.stringify(document)));}catch{invalid();}
  const key=JSON.stringify([snapshot?.namespace,snapshot?.projectId]);
  if(bindings.has(key))invalid();
  const documentId=randomUUID(),abort=new AbortController();let e;
  const scope=Object.freeze({document:snapshot,signal:abort.signal,assertCurrent:()=>{try{return !closed&&!abort.signal.aborted&&entries.get(documentId)===e&&assertCurrent()===true&&!closed&&!abort.signal.aborted&&entries.get(documentId)===e;}catch{return false;}}});
  // Broker construction checks currentness immediately; publish provisionally, roll back on failure.
  e={key,abort,broker:null,timer:null};entries.set(documentId,e);
  try{e.broker=createPlanningSessionBroker({bridge,scope,lifetimeMs,leaseMs,requestTimeoutMs});}catch{entries.delete(documentId);abort.abort();invalid();}
  e.scope=scope;e.timer=setTimeout(()=>retire(documentId),lifetimeMs);e.timer.unref?.();bindings.add(key);registered++;
  return Object.freeze({documentId,retire:()=>retire(documentId),signal:abort.signal});
 }
 async function dispatch(endpoint,payload,signal,peer){
  if(endpoint!=='exchange'||peer?.principal?.kind!=='owner'||!peer.signal||peer.signal.aborted||typeof peer.signal.addEventListener!=='function')return failure();
  return dispatchOwner(payload,signal,peer.signal);
 }
 // Trusted in-process seam ONLY: the official exact Fetch registry admits owners.
 // It does not supply a Peer, so this entry point makes no per-Peer lifetime claim.
 async function dispatchAdmittedOwnerRequest(payload,signal){return dispatchOwner(payload,signal);}
 async function dispatchOwner(payload,signal,peerSignal){
  if(activeDispatches>=maxActiveDispatches)return failure();
  activeDispatches++;
  try{
   if(closed||peerSignal?.aborted||!signal||signal.aborted||typeof signal.addEventListener!=='function')return failure();
   if(typeof payload!=='string'||Buffer.byteLength(payload)>2097152)return failure();
   const input=JSON.parse(payload);
   if(!exact(input,['documentId','raw'])||JSON.stringify(input)!==payload||!UUID.test(input.documentId)||typeof input.raw!=='string'||Buffer.byteLength(input.raw)>1048576)return failure();
   const e=entries.get(input.documentId);if(!e||!e.scope.assertCurrent())return failure();
   const abort=new AbortController(),stop=()=>abort.abort();
   signal.addEventListener('abort',stop,{once:true});peerSignal?.addEventListener('abort',stop,{once:true});
   try{
    if(signal.aborted||peerSignal?.aborted)abort.abort();
    const value=await e.broker.dispatch(input.raw,{scope:e.scope,signal:abort.signal});
    if(closed||abort.signal.aborted||entries.get(input.documentId)!==e||!e.scope.assertCurrent()||abort.signal.aborted)return failure();
    return {ok:true,value};
   }finally{signal.removeEventListener('abort',stop);peerSignal?.removeEventListener('abort',stop);}
  }catch{return failure();}finally{activeDispatches--;}
 }
 function close(){if(closed)return;closed=true;for(const id of entries.keys())retire(id);}
 return Object.freeze({registerDocument,retire,dispatch,dispatchAdmittedOwnerRequest,close,inspect:()=>Object.freeze({closed,registered,activeDispatches,activeDocuments:entries.size,authorization:'host-owner-wide',fixtureOnly:true,realModelConnected:false})});
}
/** Factory captures trusted catalog; no catalog, bridge or scope can come from config.
 * The plugin owns catalog lifetime. Create a new catalog after plugin disposal.
 * Underlying bridges remain caller-owned and must be closed by their creator.
 */
export function createPlanningHostPlugin(catalog){
 if(!catalog||!['dispatch','close','registerDocument'].every(k=>typeof catalog[k]==='function'))invalid();
 const validate=raw=>{if(raw===undefined)return {enabled:false};if(!exact(raw,['enabled'])||typeof raw.enabled!=='boolean')invalid();return raw;};
 let activated=false;
 return {name:'prism-planning-fixture-carrier',inject:['connection'],Config:{'~standard':{version:1,vendor:'prism',validate(raw){try{return {value:validate(raw)}}catch{return {issues:[{message:'PLANNING_HOST_CONFIGURATION_INVALID'}]}}}}},
  apply(ctx,raw){const config=validate(raw);if(!config.enabled)return;
   if(activated)throw Error('PLANNING_HOST_ALREADY_ACTIVATED');
   activated=true;
   let dispose,disposed=false;
   const cleanup=async()=>{if(disposed)return;disposed=true;catalog.close();if(dispose)await dispose();};
   try{dispose=ctx.connection.rpc.handle(PLANNING_HOST_CHANNEL,(...args)=>catalog.dispatch(...args));ctx.effect(()=>cleanup);}
   catch{catalog.close();if(dispose)return cleanup().catch(()=>{}).then(()=>{throw Error('PLANNING_HOST_INSTALL_FAILED');});throw Error('PLANNING_HOST_INSTALL_FAILED');}
  }};
}
