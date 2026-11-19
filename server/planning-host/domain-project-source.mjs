/** Optional trusted Host composition. Owns a dedicated official DomainFacility handle.
 * No browser import, authentication, backend choice, physical readback or migration.
 * Durability/atomicity are contracts of the official selected backend, not this adapter.
 * Domain get() is an authoritative MEMORY read, and is checked on every admission.
 */
import {webcrypto} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadProjects} from '../../src/project-planning-core.mjs';
const SCHEMA='prism-host-project-source/v1';
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const fail=code=>{throw Error(code);};
const keys=['schema','namespace','seq','raw','rawSha256'];
const hashPattern=/^[a-f0-9]{64}$/;
export function createPlanningHostDomainProjectSource(options={}){
 // No ctx, facility, schema, namespace or crypto getters are consulted when off.
 if(options.enabled!==true)return Object.freeze({initialize:async()=>Object.freeze({state:'disabled'}),getSnapshot(){fail('HOST_SOURCE_DISABLED');},subscribe:()=>()=>{},replace:async()=>fail('HOST_SOURCE_DISABLED'),inspect:()=>Object.freeze({state:'disabled',enabled:false}),close:async()=>{}});
 const {ctx,facility,defineDomain,z,namespace,domainName='prism_host_projects',crypto=webcrypto,maxOperations=100,maxPending=4,lifetimeMs=300000}=options;
 if(!ctx||typeof ctx.on!=='function'||typeof ctx.effect!=='function'||!facility||typeof facility.open!=='function'||typeof defineDomain!=='function'||!z||typeof z.object!=='function'||typeof namespace!=='string'||!namespace.trim()||namespace.length>300||!/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(domainName)||!crypto?.subtle||typeof crypto.subtle.digest!=='function'||!Number.isSafeInteger(maxOperations)||maxOperations<1||maxOperations>1000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>8||!Number.isSafeInteger(lifetimeMs)||lifetimeMs<1||lifetimeMs>300000)fail('HOST_SOURCE_CONFIGURATION_INVALID');
 let state='new',domain,initializing,closing,chain=Promise.resolve(),epoch=0,snapshot,record,recordRaw,expectedWrite,operations=0,pending=0,timer,reason=null,writeOutcomeUncertain=false,deadline=Infinity;
 const listeners=new Set(),cleanup=[];
 const notify=()=>{for(const fn of [...listeners])try{fn();}catch{}};
 function invalidate(){snapshot=undefined;if(epoch===Number.MAX_SAFE_INTEGER){state='quarantined';reason='epoch-exhausted';}else epoch++;notify();}
 function detach(){clearTimeout(timer);for(const dispose of cleanup.splice(0).reverse())try{Promise.resolve(dispose()).catch(()=>{});}catch{}}
 function quarantine(code){if(state==='closed'||state==='quarantined')return;state='quarantined';reason=code;invalidate();detach();listeners.clear();}
 function active(){if(state!=='closed'&&state!=='quarantined'&&performance.now()>=deadline)quarantine('lifetime-expired');if(state==='closed'||state==='quarantined')fail('HOST_SOURCE_UNAVAILABLE');}
 function validRecord(r){
  if(!exact(r,keys)||r.schema!==SCHEMA||r.namespace!==namespace||!Number.isSafeInteger(r.seq)||r.seq<0||typeof r.raw!=='string'||Buffer.byteLength(r.raw)>4000000)fail('HOST_SOURCE_RECORD_INVALID');
  if(r.seq===0?(r.raw!==''||r.rawSha256!==null):(!hashPattern.test(r.rawSha256)||typeof r.rawSha256!=='string'))fail('HOST_SOURCE_RECORD_INVALID');
  return r;
 }
 const digest=async raw=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');
 async function validateRaw(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>4000000)fail('HOST_SOURCE_RAW_INVALID');await loadProjects(raw,namespace,crypto);return digest(raw);}
 function read(){
  active();if(!domain||!record)fail('HOST_SOURCE_NOT_INITIALIZED');
  try{const now=validRecord(domain.global.get());if(now!==record||JSON.stringify(now)!==recordRaw)throw Error();active();return now;}
  catch{quarantine('memory-unreadable-or-drift');fail('HOST_SOURCE_UNAVAILABLE');}
 }
 function publish(){active();read();if(pending!==0)return;if(record.seq===0){state='absent';snapshot=undefined;}else{state='ready';snapshot=Object.freeze({epoch,raw:record.raw});}}
 function retain(dispose){if(typeof dispose!=='function')fail('HOST_SOURCE_OBSERVER_INVALID');if(state==='closed'||state==='quarantined'){try{Promise.resolve(dispose()).catch(()=>{});}catch{}}else cleanup.push(dispose);}
 function changed(change){
  if(change?.domain!==domainName||state==='closed'||state==='quarantined')return;
  if(!expectedWrite||change.table!==''||change.key!==''||change.operation!=='put'||change.value!==expectedWrite.value||expectedWrite.seen){quarantine('unexpected-domain-change');return;}
  try{if(domain.global.get()!==expectedWrite.value)throw Error();record=validRecord(expectedWrite.value);recordRaw=JSON.stringify(record);expectedWrite.seen=true;invalidate();}catch{quarantine('post-durability-event-drift');}
 }
 function initialize(){
  try{active();if(state==='opening')return initializing;if(state!=='new'){if(pending)fail('HOST_SOURCE_NOT_READY');read();return Promise.resolve(inspect());}}catch(error){return Promise.reject(error);}
  state='opening';deadline=performance.now()+lifetimeMs;
  initializing=(async()=>{
   try{
    const schema=z.object({schema:z.literal(SCHEMA),namespace:z.literal(namespace),seq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),raw:z.string().max(4000000),rawSha256:z.string().regex(hashPattern).nullable()}).strict().refine(r=>Buffer.byteLength(r.raw)<=4000000&&(r.seq===0?r.raw===''&&r.rawSha256===null:r.rawSha256!==null));
    const initial=Object.freeze({schema:SCHEMA,namespace,seq:0,raw:'',rawSha256:null});
    const spec=defineDomain({name:domainName,version:1,layout:'single',tables:{},global:{schema,initial}});
    retain(ctx.on('domain/changed',changed));retain(ctx.effect(()=>close));active();
    timer=setTimeout(()=>quarantine('lifetime-expired'),lifetimeMs);timer.unref?.();
    const opened=await facility.open(spec);domain=opened;active();
    const value=validRecord(domain.global.get()),captured=JSON.stringify(value);
    if(value.seq!==0&&await validateRaw(value.raw)!==value.rawSha256)fail('HOST_SOURCE_RECORD_DIGEST_INVALID');
    active();if(domain.global.get()!==value||JSON.stringify(value)!==captured)fail('HOST_SOURCE_INITIAL_DRIFT');
    record=value;recordRaw=captured;publish();return inspect();
   }catch(error){quarantine('initialization-failed');throw Error('HOST_SOURCE_INITIALIZATION_FAILED',{cause:error});}
  })();return initializing;
 }
 function getSnapshot(){active();if(pending)fail('HOST_SOURCE_NOT_READY');const r=read();if(state!=='ready'||!snapshot||r.seq===0)fail('HOST_SOURCE_NOT_READY');return snapshot;}
 function replace(raw,approval={}){
  // Even rejected/identical replacement attempts revoke existing admissions NOW.
  try{active();}catch(error){return Promise.reject(error);}
  invalidate();
  if(!domain||!record||!['ready','absent'].includes(state)&&pending===0)return Promise.reject(Error('HOST_SOURCE_NOT_INITIALIZED'));
  if(operations>=maxOperations){quarantine('operation-limit');return Promise.reject(Error('HOST_SOURCE_OPERATION_LIMIT'));}
  operations++;
  const rejectBeforeQueue=code=>{if(pending===0)try{publish();}catch{quarantine('pre-operation-drift');}return Promise.reject(Error(code));};
  if(typeof raw!=='string'||Buffer.byteLength(raw)>4000000)return rejectBeforeQueue('HOST_SOURCE_RAW_INVALID');
  if(pending>=maxPending)return rejectBeforeQueue('HOST_SOURCE_QUEUE_FULL');
  pending++;
  // Capture caller-owned values before entering the asynchronous queue.
  let expectedSeq,expectedSha256,isCurrent,configurationError;
  try{if(!exact(approval,['expectedSeq','expectedSha256','isCurrent'])&&!exact(approval,['expectedSeq','expectedSha256']))throw Error();({expectedSeq,expectedSha256,isCurrent=()=>true}=approval);if(!Number.isSafeInteger(expectedSeq)||expectedSeq<0||(expectedSeq===0?expectedSha256!==null:typeof expectedSha256!=='string'||!hashPattern.test(expectedSha256))||typeof isCurrent!=='function'||typeof raw!=='string')throw Error();}catch{configurationError=true;}
  const run=async()=>{
   let writeStarted=false;
   try{
    active();if(configurationError)fail('HOST_SOURCE_REPLACE_INVALID');
    const check=()=>{active();if(isCurrent()!==true)fail('HOST_SOURCE_CONTEXT_EXPIRED');active();return read();};
    check();const rawSha256=await validateRaw(raw);const prior=check();
    if(prior.seq!==expectedSeq||prior.rawSha256!==expectedSha256)fail('HOST_SOURCE_CAS_CONFLICT');
    if(prior.seq===Number.MAX_SAFE_INTEGER)fail('HOST_SOURCE_SEQUENCE_EXHAUSTED');
    const next=Object.freeze({schema:SCHEMA,namespace,seq:prior.seq+1,raw,rawSha256});
    check();active();expectedWrite={value:next,seen:false};writeStarted=true;
    // Sole mutation. The privately owned global has no external writer contract.
    await domain.global.set(next);
    active();if(isCurrent()!==true)fail('HOST_SOURCE_CONTEXT_EXPIRED');active();
    // MEMORY consistency only; official backend resolution supplies durability.
    if(domain.global.get()!==next||JSON.stringify(domain.global.get())!==JSON.stringify(next)||!expectedWrite.seen)fail('HOST_SOURCE_MEMORY_READBACK_DRIFT');
    record=next;recordRaw=JSON.stringify(next);expectedWrite=undefined;
    return Object.freeze({seq:next.seq,rawSha256:next.rawSha256,epoch});
   }catch(error){if(writeStarted){writeOutcomeUncertain=true;quarantine('write-outcome-uncertain');}throw error;}
   finally{expectedWrite=undefined;pending--;if(state!=='closed'&&state!=='quarantined'){try{publish();}catch{quarantine('post-operation-drift');}}}
  };
  const result=chain.then(run);chain=result.catch(()=>{});return result;
 }
 function inspect(){try{active();}catch{}return Object.freeze({enabled:true,state,epoch,seq:record?.seq??null,rawSha256:record?.rawSha256??null,operations,pending,uncertain:writeOutcomeUncertain,writeOutcomeUncertain,trustUnavailable:state==='quarantined'||state==='closed',reason,physicalReadback:false});}
 function close(){
  if(closing)return closing;
  closing=Promise.resolve().then(async()=>{try{await initializing;}catch{}await chain;await domain?.close();});
  state='closed';invalidate();detach();listeners.clear();return closing;
 }
 return Object.freeze({initialize,getSnapshot,replace,inspect,close,subscribe(fn){active();if(typeof fn!=='function'||listeners.size>=64)fail('HOST_SOURCE_LISTENER_INVALID');listeners.add(fn);return()=>listeners.delete(fn);}});
}
