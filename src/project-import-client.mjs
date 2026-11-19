/** Disabled-by-default protocol foundation. No browser/HTTP adapter is supplied.
 * Injected ports and opaque identity objects are NOT authentication. Production use
 * requires a separately verified, revocable per-session transport; browserPeer is
 * not such a transport. This module never reads globals for enabling or identity.
 *
 * resolveTrustedTransport is read/called only by explicit setEnabled(true). It
 * must synchronously return {identity,signal,isCurrent,target,request}. Identity
 * is a stable opaque object, NOT evidence of authentication. signal is a stable
 * revocable AbortSignal; isCurrent() must remain true only for that exact session.
 * target is {namespace,targetLabel,expectedSeq,expectedSha256,targetEpoch}, a
 * trusted selected CAS descriptor, never learned or replaced from a reply.
 * request(envelope,{signal}) must bounded-read <=8 MiB UTF-8 response text and
 * return that text (not an already-parsed object). Caller integrates context and
 * source change notifications via invalidate() and/or prepareLocal's live guard.
 * Observed invalidation is permanent; unobserved external ABA is not detectable.
 *
 * prepareLocal works while disabled. A disabled preview can never be sent, even
 * after enabling: explicitly create a fresh preview. send and confirm each need
 * their own {explicit:true,previewSha256} approval and exact issued object. The
 * opaque response previewId only selects an already authorized server lease; it
 * cannot authenticate anyone. Dispatch uncertainty permanently closes this
 * controller to retries. Existing preview.raw remains available to its caller.
 * cancel/close only abort locally, not a promise of undo, remote deletion or no
 * write. Remote lease cleanup belongs to the trusted transport/server lifecycle.
 */
import {inspectProjectTransfer} from './project-transfer-core.mjs';
import {PROJECT_IMPORT_PROTOCOL as PROTOCOL,parseProjectImportResponse} from './project-import-protocol.mjs';
const fail=c=>{throw Error(c)},hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),integer=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const targetKeys=['namespace','targetLabel','expectedSeq','expectedSha256','targetEpoch'];
function targetCopy(t){if(!exact(t,targetKeys)||typeof t.namespace!=='string'||!t.namespace.trim()||t.namespace.length>300||typeof t.targetLabel!=='string'||!t.targetLabel.trim()||t.targetLabel.length>500||!integer(t.expectedSeq)||!integer(t.targetEpoch)||(t.expectedSeq===0?t.expectedSha256!==null:!hash(t.expectedSha256)))fail('PROJECT_IMPORT_TARGET_INVALID');return Object.fromEntries(targetKeys.map(k=>[k,t[k]]))}
const sameTarget=(a,b)=>targetKeys.every(k=>a[k]===b[k]);
export function createProjectImportClient(options={}){
 const crypto=options.crypto??globalThis.crypto,requestTimeoutMs=options.requestTimeoutMs??15000;
 if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>30000)fail('PROJECT_IMPORT_TIMEOUT_CONFIGURATION');
 const now=globalThis.performance?.now?.bind(globalThis.performance);if(!now)fail('PROJECT_IMPORT_MONOTONIC_CLOCK_REQUIRED');
 let activeLocal=0,activeRequests=0,activeOperations=0,attempts=0;
 let enabled=false,closed=false,uncertain=false,generation=0,port=null,contract=null,unsubscribe=null;const handles=new WeakMap(),entries=new Set();
 const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
 function retire(){generation++;for(const e of entries){e.cancelled=true;e.abort.abort()}entries.clear()}
 function detach(){try{unsubscribe?.()}finally{unsubscribe=null;port=null;contract=null}}
 function expire(){retire();enabled=false;detach()}
 function guard(e,extra=()=>true){let ok=false;try{ok=!closed&&!uncertain&&!e.cancelled&&e.generation===generation&&e.current()===true&&extra()===true}catch{}if(!ok){retire();fail('PROJECT_IMPORT_EXPIRED')}if(e.port){let identityOK=false;try{identityOK=port===e.port&&port.identity===e.identity&&port.signal===e.signal&&port.request===e.request&&port.isCurrent===e.portCurrent&&enabled&&!e.signal.aborted&&e.portCurrent.call(port)===true&&sameTarget(targetCopy(port.target),e.target)}catch{}if(!identityOK){expire();fail('PROJECT_IMPORT_IDENTITY_OR_TARGET_EXPIRED')}}}
 function setEnabled(value){if(typeof value!=='boolean')fail('PROJECT_IMPORT_ENABLE_EXPLICIT');if(closed||uncertain)fail('PROJECT_IMPORT_UNAVAILABLE');expire();if(!value)return;const resolveTrustedTransport=options.resolveTrustedTransport;if(typeof resolveTrustedTransport!=='function')fail('PROJECT_IMPORT_NO_PRODUCTION_ADAPTER');const p=resolveTrustedTransport();if(!p||!p.identity||typeof p.identity!=='object'||typeof p.request!=='function'||typeof p.isCurrent!=='function'||!p.signal||typeof p.signal.addEventListener!=='function'||typeof p.signal.removeEventListener!=='function'||p.signal.aborted||p.isCurrent()!==true)fail('PROJECT_IMPORT_TRUSTED_PORT_REQUIRED');targetCopy(p.target);port=p;contract={identity:p.identity,signal:p.signal,request:p.request,isCurrent:p.isCurrent};enabled=true;const stop=()=>expire(),signal=contract.signal;signal.addEventListener('abort',stop,{once:true});unsubscribe=()=>signal.removeEventListener('abort',stop);}
 async function prepareLocal(raw,{target,isCurrent=()=>true}={}){if(closed||uncertain)fail('PROJECT_IMPORT_UNAVAILABLE');if(activeLocal>=4||activeOperations)fail('PROJECT_IMPORT_ACTIVE_LIMIT');if(attempts>=64)fail('PROJECT_IMPORT_ATTEMPT_LIMIT');attempts++;const t=targetCopy(target);if(typeof isCurrent!=='function')fail('PROJECT_IMPORT_CONTEXT_REQUIRED');retire();activeLocal++;const e={generation,port:enabled?port:null,identity:enabled?contract.identity:null,signal:enabled?contract.signal:null,request:enabled?contract.request:null,portCurrent:enabled?contract.isCurrent:null,target:t,current:isCurrent,cancelled:false,used:false,abort:new AbortController()};if(typeof isCurrent!=='function')fail('PROJECT_IMPORT_CONTEXT_REQUIRED');entries.add(e);try{guard(e);const inspection=await inspectProjectTransfer(raw,{expectedNamespace:t.namespace,crypto});guard(e);const fields={kind:'project-import-local-preview',raw:inspection.raw,rawSha256:inspection.rawSha256,bytes:inspection.bytes,archiveSha256:inspection.archiveSha256,namespace:inspection.namespace,projects:inspection.projects,target:t,scope:'Saved project planning only; application snapshots may include historical outputs/reviews; not a complete paper/PDF/findings backup. No execution permissions.',enabled:!!e.port,authority:'none',sent:false};const preview=freeze({...fields,previewSha256:await digest(JSON.stringify(fields))});guard(e);e.inspection=inspection;handles.set(preview,e);return preview}catch(error){e.cancelled=true;entries.delete(e);throw error}finally{activeLocal--}}
 function take(preview,approval,extra){const e=handles.get(preview);if(!e||e.used||e.cancelled||approval?.explicit!==true||approval.previewSha256!==preview.previewSha256)fail('PROJECT_IMPORT_CONFIRMATION_REQUIRED');guard(e,extra);if(!e.port)fail('PROJECT_IMPORT_DISABLED_PREVIEW');e.used=true;return e}
 function response(raw,operation,requestId){const r=parseProjectImportResponse(raw,operation,requestId);if(r.ok!==true)fail(r.error.code);return r.value}
 async function validatePreview(p,e){
 const keys=['kind','targetLabel','namespace','mode','raw','rawSha256','bytes','archiveSha256','expectedSeq','expectedSha256','targetEpoch','projects','mapping','preservedProjects','newProjects','preservedRevisions','addedRevisions','authority','registered','sent','previewSha256'];
 if(!exact(p,keys)||p.kind!=='host-project-import-preview'||!sameTarget(p,e.target)||p.raw!==e.inspection.raw||p.rawSha256!==e.inspection.rawSha256||p.bytes!==e.inspection.bytes||p.archiveSha256!==e.inspection.archiveSha256||p.authority!=='none'||p.registered!==false||p.sent!==false||!hash(p.previewSha256)||!Array.isArray(p.projects)||p.projects.length!==e.inspection.projects.length||!Array.isArray(p.mapping)||p.mapping.length!==p.projects.length)fail('PROJECT_IMPORT_PREVIEW_INVALID');
 // Bound and validate before hashing/copying any transport-provided arrays.
 for(let i=0;i<p.projects.length;i++){const a=p.projects[i],b=e.inspection.projects[i];if(!exact(a,['projectId','title','revisionCount','headRevisionSha256','templateVersion','revisions'])||a.projectId!==b.projectId||a.title!==b.title||a.revisionCount!==b.revisionCount||a.headRevisionSha256!==b.headRevisionSha256||a.templateVersion!==b.templateVersion||!Array.isArray(a.revisions)||a.revisions.length!==b.revisions.length)fail('PROJECT_IMPORT_PROJECTS_INVALID');for(let j=0;j<a.revisions.length;j++){const r=a.revisions[j],s=b.revisions[j];if(!exact(r,['id','seq','kind','sha256'])||Object.keys(s).some(k=>r[k]!==s[k]))fail('PROJECT_IMPORT_PROJECTS_INVALID')}}
 if(!integer(p.preservedProjects)||p.preservedProjects>p.projects.length||p.newProjects!==p.projects.length-p.preservedProjects||!integer(p.preservedRevisions)||!integer(p.addedRevisions)||p.preservedRevisions+p.addedRevisions!==e.inspection.revisionCount||p.mode!==(e.target.expectedSeq===0?'initial-seed':'append-only')||(p.mode==='initial-seed'&&(p.preservedProjects!==0||p.preservedRevisions!==0)))fail('PROJECT_IMPORT_MAPPING_INVALID');let preserved=0,added=0;
 for(let i=0;i<p.mapping.length;i++){const m=p.mapping[i];if(!exact(m,['projectId','targetProjectId','preservedRevisions','addedRevisions','newProject'])||m.projectId!==p.projects[i].projectId||m.targetProjectId!==m.projectId||!integer(m.preservedRevisions)||!integer(m.addedRevisions)||m.preservedRevisions+m.addedRevisions!==p.projects[i].revisionCount||m.newProject!==(i>=p.preservedProjects)||(m.newProject?m.preservedRevisions!==0:m.preservedRevisions<1))fail('PROJECT_IMPORT_MAPPING_INVALID');preserved+=m.preservedRevisions;added+=m.addedRevisions}if(preserved!==p.preservedRevisions||added!==p.addedRevisions)fail('PROJECT_IMPORT_MAPPING_INVALID');
 const {previewSha256,...fields}=p;if(await digest(JSON.stringify(fields))!==previewSha256)fail('PROJECT_IMPORT_PREVIEW_HASH');return freeze(JSON.parse(JSON.stringify(p)));
 }
 // A future trusted port MUST bound streaming reads to 8 MiB before returning
 // raw UTF-8 JSON text. This controller also parses with the shared byte/token/
 // depth bounds. No fetch implementation, browserPeer adapter, or auth is here.
 async function request(e,q,isCurrent,checkpoint){
  checkpoint();if(activeRequests>=1)fail('PROJECT_IMPORT_ACTIVE_LIMIT');activeRequests++;
  try{guard(e,isCurrent);checkpoint();const raw=await e.request.call(e.port,q,{signal:e.abort.signal});checkpoint();return raw}finally{activeRequests--}
 }
 function unknown(write){uncertain=true;expire();fail(write?'PROJECT_IMPORT_WRITE_OUTCOME_UNKNOWN_MAY_BE_SAVED':'PROJECT_IMPORT_SEND_OUTCOME_UNKNOWN_NO_RETRY')}
 async function operation(e,write,work){
  activeOperations++;const deadline=now()+requestTimeoutMs;let timer;
  const checkpoint=()=>{if(now()>=deadline){e.abort.abort();fail('PROJECT_IMPORT_TIMEOUT')}guard(e)};
  // The slot belongs to the whole underlying pipeline, not the race winner.
  // A timed-out, uncancellable digest/request holds it until actual settlement.
  const underlying=Promise.resolve().then(async()=>{checkpoint();const result=await work(checkpoint);checkpoint();return result});
  underlying.then(()=>{activeOperations--},()=>{activeOperations--});
  try{return await Promise.race([underlying,new Promise((_,reject)=>{timer=setTimeout(()=>{e.abort.abort();reject(Error('PROJECT_IMPORT_TIMEOUT'))},requestTimeoutMs)})])}catch{unknown(write)}finally{clearTimeout(timer)}
 }
 async function send(preview,approval,isCurrent=()=>true){
  if(preview?.kind!=='project-import-local-preview')fail('PROJECT_IMPORT_LOCAL_REQUIRED');if(activeOperations)fail('PROJECT_IMPORT_ACTIVE_LIMIT');const e=take(preview,approval,isCurrent);
  return operation(e,false,async checkpoint=>{const requestId=crypto.randomUUID(),raw=await request(e,{protocol:PROTOCOL,requestId,operation:'prepare',raw:e.inspection.raw},isCurrent,checkpoint);checkpoint();const value=response(raw,'prepare',requestId);checkpoint();guard(e,isCurrent);
   if(!exact(value,['previewId','preview'])||typeof value.previewId!=='string'||!value.previewId||value.previewId.length>200)fail('PROJECT_IMPORT_RESPONSE_INVALID');const p=await validatePreview(value.preview,e);checkpoint();guard(e,isCurrent);const next={...e,used:false,previewId:value.previewId};entries.delete(e);entries.add(next);handles.set(p,next);return p});
 }
 async function confirm(preview,approval,isCurrent=()=>true){
  if(preview?.kind!=='host-project-import-preview')fail('PROJECT_IMPORT_HOST_PREVIEW_REQUIRED');if(activeOperations)fail('PROJECT_IMPORT_ACTIVE_LIMIT');const e=take(preview,approval,isCurrent);
  return operation(e,true,async checkpoint=>{const requestId=crypto.randomUUID(),raw=await request(e,{protocol:PROTOCOL,requestId,operation:'confirm',previewId:e.previewId,previewSha256:preview.previewSha256,explicit:true},isCurrent,checkpoint);checkpoint();const value=response(raw,'confirm',requestId);checkpoint();guard(e,isCurrent);
   if(!exact(value,['kind','saved','namespace','targetLabel','seq','rawSha256','epoch','registered','modelInvoked','authority'])||value.kind!=='host-project-import-result'||value.saved!==true||value.namespace!==preview.namespace||value.targetLabel!==preview.targetLabel||value.seq!==preview.expectedSeq+1||value.rawSha256!==preview.rawSha256||value.epoch!==preview.targetEpoch+2||value.registered!==false||value.modelInvoked!==false||value.authority!=='none')fail('PROJECT_IMPORT_RESULT_INVALID');const result=freeze({...value});checkpoint();entries.delete(e);return result});
 }
 // Local cancellation does not withdraw already transmitted bytes or guarantee
 // an in-flight write was prevented. No automatic cancel RPC/retry is attempted.
 function cancel(){retire()}
 function close(){if(closed)return;closed=true;expire()}
 return Object.freeze({prepareLocal,send,confirm,cancel,invalidate:cancel,setEnabled,close,boundary:()=>Object.freeze({enabled,state:closed?'closed':uncertain?'uncertain':enabled?'ready':'disabled',productionAdapterAvailable:false,activeLocal,activeRequests,activeOperations,attempts,authority:'none'})});
}
