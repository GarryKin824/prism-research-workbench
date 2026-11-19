/** Default-off owner-wide exact Fetch carrier. Authentication is owned by the
 * official Connection registry, not this in-process handler. No Peer is invented.
 */
export const PLANNING_BOUNDED_HOST_CHANNEL='/api';
export const PLANNING_BOUNDED_HOST_ENDPOINT='prism-planning-fixture/exchange';
export const PLANNING_BOUNDED_HOST_PATH=`${PLANNING_BOUNDED_HOST_CHANNEL}/${PLANNING_BOUNDED_HOST_ENDPOINT}`;
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const refused=()=>({ok:false,error:{code:'PLANNING_HOST_REFUSED',message:'Planning fixture request refused',details:{}}});
const reject=status=>new Response('Planning fixture request refused',{status,headers:{'cache-control':'no-store'}});
const invalid=()=>{throw Error('PLANNING_BOUNDED_HOST_CONFIGURATION_INVALID');};
const validate=raw=>{if(raw===undefined)return {enabled:false};if(!exact(raw,['enabled'])||typeof raw.enabled!=='boolean')invalid();return raw;};

/** Protocol parsers must be the public official clientRequestSchema and
 * serverResponseSchema supplied by trusted composition, never user configuration.
 * Limits may only be reduced from the fixed production maxima.
 */
export function createPlanningBoundedHostPlugin(catalog,{clientRequestSchema,serverResponseSchema,maxBodyBytes=2097152,maxActiveReaders=8,readTimeoutMs=10000,maxReadChunks=8192}={}){
 let activated=false;
 return {name:'prism-planning-bounded-fixture-carrier',inject:['connection'],
  Config:{'~standard':{version:1,vendor:'prism',validate(raw){try{return {value:validate(raw)};}catch{return {issues:[{message:'PLANNING_BOUNDED_HOST_CONFIGURATION_INVALID'}]};}}}},
  apply(ctx,raw){
   if(!validate(raw).enabled)return;
   if(activated)throw Error('PLANNING_BOUNDED_HOST_ALREADY_ACTIVATED');
   if(!catalog||typeof catalog.dispatchAdmittedOwnerRequest!=='function'||typeof catalog.close!=='function'||typeof clientRequestSchema?.safeParse!=='function'||typeof serverResponseSchema?.safeParse!=='function'||!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>2097152||!Number.isSafeInteger(maxActiveReaders)||maxActiveReaders<1||maxActiveReaders>8||!Number.isSafeInteger(maxReadChunks)||maxReadChunks<1||maxReadChunks>8192||!Number.isSafeInteger(readTimeoutMs)||readTimeoutMs<1||readTimeoutMs>10000)invalid();
   activated=true;
   let active=0,disposed=false,dispose,cleanupPromise;
   const lifetime=new AbortController();
   const cleanup=()=>{
    if(cleanupPromise)return cleanupPromise;
    disposed=true;lifetime.abort();
    cleanupPromise=(async()=>{let failed=false;try{catalog.close();}catch{failed=true;}try{if(dispose)await dispose();}catch{failed=true;}if(failed)throw Error('PLANNING_BOUNDED_HOST_DISPOSE_FAILED');})();
    return cleanupPromise;
   };
   async function fetch(request){
    if(disposed)return reject(503);
    if(request.method!=='POST'||new URL(request.url).pathname!==PLANNING_BOUNDED_HOST_PATH)return reject(404);
    if(request.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')return reject(415);
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return reject(400);
    if(length!==null&&Number(length)>maxBodyBytes)return reject(413);
    if(active>=maxActiveReaders)return reject(503);
    active++;
    let reader,timer,onAbort,signal,readingStopped=false;
    try{
     signal=AbortSignal.any([request.signal,lifetime.signal]);
     if(signal.aborted)return reject(408);
     if(!request.body)return reject(400);
     reader=request.body.getReader();
     // A single fixed accumulator avoids retaining an unbounded number of tiny
     // chunks. A transport-provided chunk may itself exceed the cap; never copy it.
     const bytes=new Uint8Array(maxBodyBytes);let size=0,chunks=0;
     const stopped=new Promise((_,rejectRead)=>{
      onAbort=()=>rejectRead(408);
      signal.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(()=>rejectRead(408),readTimeoutMs);
      if(signal.aborted)onAbort();
     });
     const deadline=performance.now()+readTimeoutMs;
     const reading=(async()=>{
      while(true){
       if(readingStopped||signal.aborted||performance.now()>=deadline)throw 408;
       const part=await reader.read();
       if(readingStopped||signal.aborted||performance.now()>=deadline)throw 408;
       if(part.done)return;
       if(++chunks>maxReadChunks)throw 413;
       if(!(part.value instanceof Uint8Array))throw 400;
       if(part.value.byteLength>maxBodyBytes-size)throw 413;
       bytes.set(part.value,size);size+=part.value.byteLength;
      }
     })();
     // Only one stop reaction for the whole read, not one retained reaction per
     // chunk. Monotonic checks also enforce deadlines if timers are starved.
     await Promise.race([reading,stopped]);
     clearTimeout(timer);signal.removeEventListener('abort',onAbort);
     reader.releaseLock();reader=undefined;
     const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size));
     const input=JSON.parse(text);
     // Official clients serialize this exact envelope. Requiring canonical JSON
     // also rejects duplicate fields (including escaped duplicate field names).
     if(!exact(input,['type','rpcId','method','payload'])||JSON.stringify(input)!==text||typeof input.rpcId!=='string'||input.rpcId.length<1||input.rpcId.length>128||input.method!==PLANNING_BOUNDED_HOST_ENDPOINT)return reject(400);
     const parsed=clientRequestSchema.safeParse(input);
     if(!parsed.success)return reject(400);
     if(signal.aborted||disposed)return reject(408);
     let result;
     try{result=await catalog.dispatchAdmittedOwnerRequest(parsed.data.payload,signal);}catch{result=refused();}
     if(signal.aborted||disposed)return reject(408);
     let envelope={type:'server-response',rpcId:input.rpcId,result};
     if(!serverResponseSchema.safeParse(envelope).success)envelope={...envelope,result:refused()};
     return Response.json(envelope,{headers:{'cache-control':'no-store'}});
    }catch(error){return reject(error===408?408:error===413?413:400);}
    finally{
     readingStopped=true;
     clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort);
     // Do NOT cancel a Node-backed stream here: cancellation can destroy the
     // socket before the error response. Releasing a pending read rejects that
     // read; official bridge closes/destroys unread ingress after responding.
     try{reader?.releaseLock();}catch{}
     active--;
    }
   }
   try{
    dispose=ctx.connection.fetch.register({path:PLANNING_BOUNDED_HOST_PATH,methods:['POST'],requestBody:'streaming',fetch});
    if(typeof dispose!=='function')throw Error();
    ctx.effect(()=>cleanup);
   }catch{return cleanup().catch(()=>{}).then(()=>{throw Error('PLANNING_BOUNDED_HOST_INSTALL_FAILED');});}
  }
 };
}
