/** Unmounted trusted-code endpoint foundation. NEVER registers a route. Shared
 * browserPeer is unconditionally refused: this is not browser-session authority.
 * The caller owns the ready operator and official Connection admission service.
 */
import {webcrypto} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {inspectProjectTransfer} from '../../src/project-transfer-core.mjs';
import {PROJECT_IMPORT_PROTOCOL,PROJECT_IMPORT_PATH,PROJECT_IMPORT_MAX_BYTES,parseProjectImportRequest,validateProjectImportPreview,validateProjectImportResponse} from '../../src/project-import-protocol.mjs';
const UNKNOWN='HOST_PROJECT_IMPORT_OUTCOME_UNKNOWN_MAY_BE_SAVED';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
class Refused extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const reject=(code,status)=>{throw new Refused(code,status);};
const response=(body,status=200)=>{const raw=JSON.stringify(body);if(raw.length>PROJECT_IMPORT_MAX_BYTES||Buffer.byteLength(raw)>PROJECT_IMPORT_MAX_BYTES)reject('IMPORT_TOO_LARGE',413);return new Response(raw,{status,headers:{'content-type':'application/json','cache-control':'no-store'}});};
const failure=(error,q)=>response({...q?{protocol:PROJECT_IMPORT_PROTOCOL,requestId:q.requestId}:{},ok:false,error:{code:error instanceof Refused?error.code:'IMPORT_REFUSED'}},error instanceof Refused?error.status:400);
export function createPlanningHostProjectImportEndpoint(options={}){
 if(options.enabled!==true)return Object.freeze({handle:async()=>failure(new Refused('IMPORT_DISABLED',503)),close:async()=>{},inspect:()=>Object.freeze({enabled:false,state:'disabled',routeRegistered:false})});
 const {connection,operator,crypto=webcrypto,maxBodyBytes=PROJECT_IMPORT_MAX_BYTES,maxActiveRequests=4,maxPreviews=4,maxRequests=64,requestTimeoutMs=10000,maxReadChunks=8192,previewTtlMs=60000}=options;
 const limits=[[maxBodyBytes,PROJECT_IMPORT_MAX_BYTES],[maxActiveRequests,4],[maxPreviews,4],[maxRequests,64],[requestTimeoutMs,10000],[maxReadChunks,8192],[previewTtlMs,60000]];
 if(!connection||typeof connection.admit!=='function'||!connection.browserPeer||!operator||!['prepareImport','confirmImport','cancelImport','inspect'].every(k=>typeof operator[k]==='function')||operator.inspect()?.state!=='ready'||typeof crypto?.randomUUID!=='function'||typeof crypto?.subtle?.digest!=='function'||limits.some(([v,max])=>!Number.isSafeInteger(v)||v<1||v>max))throw Error('IMPORT_ENDPOINT_CONFIGURATION_INVALID');
 const admit=connection.admit.bind(connection),initialBrowserPeer=connection.browserPeer,jobs=new Set(),entries=new Set(),previews=new Map(),requestIds=new Set(),previewIds=new Set();
 let closed=false,uncertain=false,closing,totalRequests=0,confirming=null;
 function admitOwner(request,expected){
  if(closed||uncertain)reject('IMPORT_UNAVAILABLE',503);
  let admitted;try{admitted=admit(request);}catch{reject('IMPORT_IDENTITY_REQUIRED',403);}
  if(!admitted?.peer)reject('IMPORT_IDENTITY_REQUIRED',admitted?.rejection===401?401:403);
  const peer=admitted.peer;
  if(peer===initialBrowserPeer||peer===connection.browserPeer)reject('IMPORT_SHARED_BROWSER_REFUSED',403);
  if(peer.principal?.kind!=='owner'||!peer.signal||peer.signal.aborted||typeof peer.signal.addEventListener!=='function'||typeof peer.signal.removeEventListener!=='function')reject('IMPORT_IDENTITY_REQUIRED',403);
  if(expected&&(peer!==expected.peer||peer.signal!==expected.peerSignal))reject('IMPORT_PEER_MISMATCH',403);return peer;
 }
 function cancelEntry(e){
  e.cancelled=true;clearTimeout(e.timer);e.peerSignal.removeEventListener('abort',e.onAbort);if(e.id)previews.delete(e.id);
  try{if(e.preview)operator.cancelImport(e.preview);}catch{}
  // Async prepare/confirm work still owns its slot until its promise settles.
  if(e.phase==='ready')entries.delete(e);
 }
 function revokeAll(){for(const e of [...entries])cancelEntry(e);}
 function check(job,e){
  if(job.stopped)throw job.error;if(performance.now()>=job.deadline){job.stop(new Refused('IMPORT_TIMEOUT',408));throw job.error;}
  if(job.request.signal.aborted||job.peerSignal.aborted){job.stop(new Refused('IMPORT_ABORTED',408));throw job.error;}
  admitOwner(job.request,job);
  if(e&&(e.cancelled||performance.now()>=e.deadline||e.peerSignal.aborted)){cancelEntry(e);reject('IMPORT_PREVIEW_EXPIRED',410);}
  if(e&&(e.peer!==job.peer||e.peerSignal!==job.peerSignal))reject('IMPORT_PEER_MISMATCH',403);
 }
 async function read(job){
  const request=job.request;if(!request.body)reject('IMPORT_REQUEST_INVALID',400);
  const reader=request.body.getReader(),buffer=new Uint8Array(maxBodyBytes);let size=0,chunks=0,readingStopped=false;
  const reading=(async()=>{while(true){
   if(readingStopped)throw job.error??new Refused('IMPORT_ABORTED',408);check(job);
   const part=await reader.read();
   if(readingStopped)throw job.error??new Refused('IMPORT_ABORTED',408);check(job);
   if(part.done)return;if(++chunks>maxReadChunks)reject('IMPORT_TOO_LARGE',413);if(!(part.value instanceof Uint8Array)||part.value.byteLength>maxBodyBytes-size)reject('IMPORT_TOO_LARGE',413);buffer.set(part.value,size);size+=part.value.byteLength;
  }})();
  try{
   // One stop reaction for the entire stream, not one retained per chunk.
   await Promise.race([reading,job.stoppedPromise]);check(job);
   return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,size));
  }finally{readingStopped=true;try{reader.releaseLock();}catch{}}
 }
 function reserve(job){
  if(entries.size>=maxPreviews)reject('IMPORT_BUSY',503);
  const e={peer:job.peer,peerSignal:job.peerSignal,phase:'preparing',cancelled:false,deadline:performance.now()+previewTtlMs};
  e.onAbort=()=>cancelEntry(e);entries.add(e);e.peerSignal.addEventListener('abort',e.onAbort,{once:true});e.timer=setTimeout(e.onAbort,previewTtlMs);e.timer.unref?.();job.entry=e;return e;
 }
 async function execute(job){
  const q=parseProjectImportRequest(await read(job));job.q=q;check(job);
  if(requestIds.has(q.requestId))reject('IMPORT_REQUEST_REPLAY',409);requestIds.add(q.requestId);
  let value;
  if(q.operation==='prepare'){
   const e=reserve(job);
   try{
    const inspection=await inspectProjectTransfer(q.raw,{crypto});check(job,e);
    e.preview=await operator.prepareImport(q.raw);check(job,e);validateProjectImportPreview(e.preview);
    if(e.preview.raw!==q.raw||e.preview.rawSha256!==inspection.rawSha256||e.preview.namespace!==inspection.namespace||e.preview.archiveSha256!==inspection.archiveSha256)reject('IMPORT_REFUSED',400);
    const id=crypto.randomUUID();if(!uuid(id)||previewIds.has(id))reject('IMPORT_REFUSED',400);previewIds.add(id);e.id=id;e.phase='ready';previews.set(id,e);value={previewId:id,preview:e.preview};
   }catch(error){cancelEntry(e);entries.delete(e);throw error;}
  }else{
   const e=previews.get(q.previewId);if(!e)reject('IMPORT_PREVIEW_EXPIRED',410);
   // A foreign owner/shared-browser request never consumes or cancels the lease.
   if(e.peer!==job.peer||e.peerSignal!==job.peerSignal)reject('IMPORT_PEER_MISMATCH',403);check(job,e);job.entry=e;
   if(q.operation==='cancel'){cancelEntry(e);value={cancelled:true};}
   else{
    if(e.phase!=='ready'||confirming)reject('IMPORT_BUSY',409);
    if(q.previewSha256!==e.preview.previewSha256)reject('IMPORT_REQUEST_INVALID',400);
    e.phase='confirming';confirming=e;job.writeStarted=true;
    try{
     value=await operator.confirmImport(e.preview,{explicit:true,previewSha256:q.previewSha256},()=>{check(job,e);return true;});check(job,e);
     if(value?.namespace!==e.preview.namespace||value?.targetLabel!==e.preview.targetLabel||value?.rawSha256!==e.preview.rawSha256||value?.seq!==e.preview.expectedSeq+1||value?.epoch<=e.preview.targetEpoch)throw Error('receipt mismatch');
     validateProjectImportResponse({protocol:PROJECT_IMPORT_PROTOCOL,requestId:q.requestId,ok:true,value},'confirm',q.requestId);
    }catch{uncertain=true;revokeAll();reject(UNKNOWN,409);}
    finally{confirming=null;cancelEntry(e);entries.delete(e);}
   }
  }
  check(job,q.operation==='prepare'?job.entry:null);
  const result={protocol:PROJECT_IMPORT_PROTOCOL,requestId:q.requestId,ok:true,value};validateProjectImportResponse(result,q.operation,q.requestId);return response(result);
 }
 async function handle(request){
  if(closed||uncertain)return failure(new Refused('IMPORT_UNAVAILABLE',503));
  let peer;
  try{
   const url=new URL(request.url);if(request.method!=='POST'||url.pathname!==PROJECT_IMPORT_PATH||url.search||url.hash)reject('IMPORT_ROUTE_REFUSED',404);
   peer=admitOwner(request);
   if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')reject('IMPORT_MEDIA_TYPE',415);
   const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))reject('IMPORT_REQUEST_INVALID',400);if(length!==null&&Number(length)>maxBodyBytes)reject('IMPORT_TOO_LARGE',413);
   if(jobs.size>=maxActiveRequests)reject('IMPORT_BUSY',503);if(totalRequests>=maxRequests)reject('IMPORT_LIMIT',429);totalRequests++;
  }catch(error){return failure(error);}
  const job={request,peer,peerSignal:peer.signal,deadline:performance.now()+requestTimeoutMs,stopped:false,writeStarted:false};
  let rejectStop;job.stoppedPromise=new Promise((_,reject)=>rejectStop=reject);
  job.stop=error=>{if(job.stopped)return;job.stopped=true;job.error=job.writeStarted?new Refused(UNKNOWN,409):error;if(job.writeStarted){uncertain=true;revokeAll();}else if(job.entry)cancelEntry(job.entry);rejectStop(job.error);};
  job.onAbort=()=>job.stop(new Refused('IMPORT_ABORTED',408));job.timer=setTimeout(()=>job.stop(new Refused('IMPORT_TIMEOUT',408)),requestTimeoutMs);
  request.signal.addEventListener('abort',job.onAbort,{once:true});job.peerSignal.addEventListener('abort',job.onAbort,{once:true});jobs.add(job);
  job.task=Promise.resolve().then(()=>execute(job)).catch(error=>{if(job.writeStarted){uncertain=true;revokeAll();}else if(job.q?.operation==='prepare'&&job.entry)cancelEntry(job.entry);return failure(job.writeStarted?new Refused(UNKNOWN,409):error,job.q);}).finally(()=>{clearTimeout(job.timer);request.signal.removeEventListener('abort',job.onAbort);job.peerSignal.removeEventListener('abort',job.onAbort);jobs.delete(job);});
  return Promise.race([job.task,job.stoppedPromise]).catch(error=>failure(error,job.q));
 }
 function close(){if(closing)return closing;closed=true;for(const job of jobs)job.stop(new Refused('IMPORT_UNAVAILABLE',503));revokeAll();closing=Promise.allSettled([...jobs].map(job=>job.task)).then(()=>{});return closing;}
 return Object.freeze({handle,close,inspect:()=>Object.freeze({enabled:true,state:closed?'closed':uncertain?'unknown-may-be-saved':'ready',activeRequests:jobs.size,activePreviews:entries.size,totalRequests,routeRegistered:false,sharedBrowserSupported:false,realModelConnected:false})});
}
