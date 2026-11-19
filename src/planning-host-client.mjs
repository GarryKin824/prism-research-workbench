/** Optional trusted-code bridge to an already established official ClientConnection.
 * Unbundled/default off. Does not establish or authenticate a connection. The caller MUST
 * abort signal on reset, reconnect, document replacement or disposal; no automatic event
 * wiring is claimed. Any in-flight abort/timeout closes this instance permanently. Closing
 * revokes local adoption only, not remote execution. Create a fresh instance explicitly.
 */
import {createPlanningSessionClient} from './planning-session-client.mjs';
export const PLANNING_HOST_CHANNEL = '/prism-planning-fixture';
export const PLANNING_HOST_ENDPOINT = 'exchange';
export const PLANNING_BOUNDED_HOST_CHANNEL = '/api';
export const PLANNING_BOUNDED_HOST_ENDPOINT = 'prism-planning-fixture/exchange';
// Private close propagation lets the Context wrapper release observers even when a
// best-effort cancellation RPC fails after its synchronous caller has returned.
const closeObservers=new WeakMap();
const fail = code => { throw Error(code); };
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x) && Reflect.ownKeys(x).length === keys.length && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(x,k) ?? {}, 'value'));
export function createPlanningHostClient(options = {}) {
  return createHostClient(options,PLANNING_HOST_CHANNEL,PLANNING_HOST_ENDPOINT);
}

/** Opt-in exact streaming /api route. Requires official bounded ingress AND trusted
 * Host registration; a document selector conveys no authorization. No fallback. */
export function createPlanningBoundedHostClient(options = {}) {
  return createHostClient(options,PLANNING_BOUNDED_HOST_CHANNEL,PLANNING_BOUNDED_HOST_ENDPOINT);
}
function createHostClient(options,channel,endpoint) {
  // Intentionally do not read connection, crypto, signal or document selectors when off.
  if (options.enabled !== true) return Object.freeze({client:null,close(){},getSnapshot:()=>Object.freeze({enabled:false,state:'disabled',fixtureOnly:true,realModelConnected:false})});
  let session, closed=false, rpc, call, adapter;
  const {documentId,signal,isCurrent=()=>true,timeoutMs=5000}=options;
  try {
    if(typeof documentId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(documentId) || !signal || typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function' || typeof signal.removeEventListener!=='function' || typeof isCurrent!=='function') fail();
    rpc=options.connection.rpc;call=rpc.call.bind(rpc);
  } catch {fail('HOST_CONFIGURATION_INVALID');}
  function close() {if(closed)return;closed=true;signal.removeEventListener('abort',close);session?.close();const observe=closeObservers.get(adapter);closeObservers.delete(adapter);observe?.();}
  function current() {
    try {if(closed || signal.aborted || isCurrent()!==true || closed || signal.aborted) fail();}
    catch {close();fail('HOST_CONTEXT_EXPIRED');}
  }
  const exchange=async(raw,{signal:requestSignal})=>{
    current();if(requestSignal.aborted){close();fail('HOST_CONTEXT_EXPIRED');}
    requestSignal.addEventListener('abort',close,{once:true});
    try {
      const result=await call(channel,endpoint,JSON.stringify({documentId,raw}),requestSignal);
      current();if(requestSignal.aborted)fail();
      if(!exact(result,['ok','value']) || result.ok!==true || typeof result.value!=='string') fail();
      return result.value;
    } catch {close();fail('HOST_OUTCOME_UNKNOWN');}
    finally {requestSignal.removeEventListener('abort',close);}
  };
  try {session=createPlanningSessionClient({exchange,crypto:options.crypto??globalThis.crypto,timeoutMs});}
  catch {fail('HOST_CONFIGURATION_INVALID');}
  signal.addEventListener('abort',close,{once:true});if(signal.aborted)close();
  const check = fn => () => {current();return fn()===true;};
  const client=Object.freeze({
    prepare(input,assertStable=()=>{}) {return session.prepare(input,()=>{current();assertStable();current();});},
    confirm(preview,approval,isStillCurrent=()=>true) {return session.confirm(preview,approval,check(isStillCurrent));},
    consumeResult(result,isStillCurrent=()=>true) {return session.consumeResult(result,check(isStillCurrent));},
    cancel(token) {session.cancel(token);},close
  });
  adapter=Object.freeze({client,close,getSnapshot:()=>Object.freeze({enabled:!closed,state:closed?'closed':'ready',fixtureOnly:true,realModelConnected:false})});
  return adapter;
}

/** Observe an already established official Cordis connection generation. This never
 * starts a connection or resumes after replacement. Caller signal still owns document
 * lifetime. Generation identity plus monotone id are captured, not Host facts. */
export function createPlanningHostContextClient(ctx, options = {}) {
  return createHostContextClient(ctx,options,createPlanningHostClient);
}

/** Same generation/reset/disposal ownership, only the bounded exact route. */
export function createPlanningBoundedHostContextClient(ctx, options = {}) {
  return createHostContextClient(ctx,options,createPlanningBoundedHostClient);
}
function createHostContextClient(ctx,options,createClient) {
  if(options.enabled!==true)return createClient();
  let inner,closed=false;const cleanup=[],lifetime=new AbortController();
  function close() {
    if(closed)return;closed=true;lifetime.abort();inner?.close();
    for(const dispose of cleanup.splice(0).reverse())try{Promise.resolve(dispose()).catch(()=>{});}catch{}
  }
  function retain(dispose) {
    if(typeof dispose!=='function')throw Error();
    if(closed){try{Promise.resolve(dispose()).catch(()=>{});}catch{}}else cleanup.push(dispose);
  }
  try {
    const callerSignal=options.signal;
    if(!callerSignal || typeof callerSignal.aborted!=='boolean' || typeof callerSignal.addEventListener!=='function' || typeof callerSignal.removeEventListener!=='function')throw Error();
    const connection=ctx.connection,generation=connection.generation,initial=generation.getSnapshot(),id=initial?.id;
    if(!initial || !Number.isSafeInteger(id) || id<1)throw Error();
    const suppliedCurrent=options.isCurrent??(()=>true);
    if(typeof suppliedCurrent!=='function')throw Error();
    const sameGeneration=()=>ctx.connection===connection && connection.generation===generation && generation.getSnapshot()===initial && initial.id===id;
    const observe=()=>{try{if(!sameGeneration())close();}catch{close();}};
    // Install first, then recheck: callbacks during installation cannot reopen us.
    retain(generation.subscribe(observe));observe();
    retain(ctx.on('connection/reset',close));observe();
    retain(ctx.effect(()=>close));observe();
    callerSignal.addEventListener('abort',close,{once:true});
    retain(()=>callerSignal.removeEventListener('abort',close));
    if(callerSignal.aborted)close();
    inner=createClient({...options,connection,signal:lifetime.signal,isCurrent:()=>{
      observe();return !closed && suppliedCurrent()===true;
    }});
    closeObservers.set(inner,close);
    if(closed || inner.getSnapshot().state==='closed'){closeObservers.delete(inner);close();inner.close();}
  } catch {close();fail('HOST_CONTEXT_CONFIGURATION_INVALID');}
  const reconcile=()=>{if(inner.getSnapshot().state==='closed')close();};
  const client=Object.freeze({
    async prepare(...args){try{return await inner.client.prepare(...args);}finally{reconcile();}},
    async confirm(...args){try{return await inner.client.confirm(...args);}finally{reconcile();}},
    consumeResult(...args){try{return inner.client.consumeResult(...args);}finally{reconcile();}},
    cancel(...args){try{return inner.client.cancel(...args);}finally{reconcile();}},close
  });
  return Object.freeze({client,close,getSnapshot(){reconcile();return inner.getSnapshot();}});
}
