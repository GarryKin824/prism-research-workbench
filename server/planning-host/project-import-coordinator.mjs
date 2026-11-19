/** Optional trusted Host operator seam, NOT a browser upload endpoint or authentication.
 * Existing full archives only, initial seed or ordered append-only extension. No merge,
 * namespace rewrite, auto-admission, model call, rollback, retry or ownership claim.
 */
import {webcrypto} from 'node:crypto';
import {inspectProjectTransfer} from '../../src/project-transfer-core.mjs';
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const fail=code=>{throw Error(code);};
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function createPlanningHostProjectImportCoordinator(options={}){
 if(options.enabled!==true)return Object.freeze({prepare:async()=>fail('HOST_PROJECT_IMPORT_DISABLED'),confirm:async()=>fail('HOST_PROJECT_IMPORT_DISABLED'),cancel(){},close(){},inspect:()=>Object.freeze({state:'disabled',enabled:false})});
 const {source,namespace,targetLabel,crypto=webcrypto,maxPreviews=32}=options;
 if(!source||!['getSnapshot','subscribe','inspect','replace'].every(k=>typeof source[k]==='function')||typeof namespace!=='string'||!namespace.trim()||namespace.length>300||typeof targetLabel!=='string'||!targetLabel.trim()||targetLabel.length>500||!Number.isSafeInteger(maxPreviews)||maxPreviews<1||maxPreviews>64||typeof crypto?.subtle?.digest!=='function')fail('HOST_PROJECT_IMPORT_CONFIGURATION_INVALID');
 const tokens=new WeakMap(),entries=new Set();let closed=false,uncertain=false,active=null,epoch=0,attempts=0,unsubscribe;
 // This seam is coupled to DomainProjectSource's exact successful protocol:
 // synchronous attempt invalidation, then one post-durability invalidation.
 // An extra notification or epoch is not proof of our ownership and fails closed.
 const retire=(sourceEvent=false)=>{
  epoch++;
  if(sourceEvent&&active){
   const e=active,n=++e.notifications;
   try{
    const s=source.inspect(),first=n===1;
    if(n>2||s.epoch!==e.target.status.epoch+n||s.enabled!==true||!['ready','absent'].includes(s.state)||s.pending!==(first?0:1)||s.seq!==(first?e.target.status.seq:e.target.status.seq+1)||s.rawSha256!==(first?e.target.status.rawSha256:e.incomingSha256))throw Error();
   }catch{e.cancelled=true;}
  }
  for(const e of entries)if(e!==active){e.cancelled=true;if(!e.preparing)entries.delete(e);}
 };
 try{unsubscribe=source.subscribe(()=>retire(true));if(typeof unsubscribe!=='function')throw Error();}catch{fail('HOST_PROJECT_IMPORT_CONFIGURATION_INVALID');}
 function available(){if(closed||uncertain)fail('HOST_PROJECT_IMPORT_UNAVAILABLE');}
 function target(){
  available();const status=source.inspect();
  if(status?.enabled!==true||!['ready','absent'].includes(status.state)||status.pending!==0||!Number.isSafeInteger(status.epoch)||status.epoch<0||!Number.isSafeInteger(status.seq)||status.seq<0)fail('HOST_PROJECT_IMPORT_TARGET_UNAVAILABLE');
  if(status.state==='absent'){if(status.seq!==0||status.rawSha256!==null)fail('HOST_PROJECT_IMPORT_TARGET_INVALID');return {status,snapshot:null};}
  if(status.seq<1||!hash(status.rawSha256))fail('HOST_PROJECT_IMPORT_TARGET_INVALID');
  const snapshot=source.getSnapshot();if(!exact(snapshot,['epoch','raw'])||!Object.isFrozen(snapshot)||snapshot.epoch!==status.epoch||typeof snapshot.raw!=='string')fail('HOST_PROJECT_IMPORT_TARGET_INVALID');
  return {status,snapshot};
 }
 function current(e,check=()=>true,writing=false){
  available();if(e.cancelled||typeof check!=='function'||check()!==true)fail('HOST_PROJECT_IMPORT_EXPIRED');
  if(!writing){if(e.epoch!==epoch)fail('HOST_PROJECT_IMPORT_EXPIRED');const now=target();if(now.snapshot!==e.target.snapshot||now.status.seq!==e.target.status.seq||now.status.rawSha256!==e.target.status.rawSha256||now.status.epoch!==e.target.status.epoch)fail('HOST_PROJECT_IMPORT_TARGET_CHANGED');}
  available();if(e.cancelled||check()!==true)fail('HOST_PROJECT_IMPORT_EXPIRED');
 }
 const digest=async raw=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');
 async function prepare(raw){
  available();if(active)fail('HOST_PROJECT_IMPORT_ACTIVE');if(entries.size>=4)fail('HOST_PROJECT_IMPORT_PREVIEW_CAPACITY');if(attempts>=maxPreviews)fail('HOST_PROJECT_IMPORT_PREVIEW_LIMIT');attempts++;
  const e={epoch,target:target(),cancelled:false,used:false,preparing:true};entries.add(e);
  try{
   const incoming=await inspectProjectTransfer(raw,{expectedNamespace:namespace,crypto});current(e);
   const previous=e.target.snapshot?await inspectProjectTransfer(e.target.snapshot.raw,{expectedNamespace:namespace,crypto}):null;current(e);
   if(previous&&previous.rawSha256!==e.target.status.rawSha256)fail('HOST_PROJECT_IMPORT_TARGET_INVALID');
   const old=previous?.state.projects??[],next=incoming.state.projects;
   if(next.length<old.length)fail('HOST_PROJECT_IMPORT_HISTORY_REMOVAL');
   for(let i=0;i<old.length;i++){
    if(next[i]?.id!==old[i].id||next[i].revisions.length<old[i].revisions.length)fail('HOST_PROJECT_IMPORT_HISTORY_REMOVAL');
    for(let j=0;j<old[i].revisions.length;j++)if(JSON.stringify(next[i].revisions[j])!==JSON.stringify(old[i].revisions[j]))fail('HOST_PROJECT_IMPORT_HISTORY_REWRITE');
   }
   const mapping=incoming.projects.map((p,i)=>({projectId:p.projectId,targetProjectId:p.projectId,preservedRevisions:old[i]?.revisions.length??0,addedRevisions:p.revisionCount-(old[i]?.revisions.length??0),newProject:i>=old.length}));
   const fields={kind:'host-project-import-preview',targetLabel,namespace,mode:previous?'append-only':'initial-seed',raw:incoming.raw,rawSha256:incoming.rawSha256,bytes:incoming.bytes,archiveSha256:incoming.archiveSha256,expectedSeq:e.target.status.seq,expectedSha256:e.target.status.rawSha256,targetEpoch:e.target.status.epoch,projects:incoming.projects,mapping,preservedProjects:old.length,newProjects:next.length-old.length,preservedRevisions:previous?.revisionCount??0,addedRevisions:incoming.revisionCount-(previous?.revisionCount??0),authority:'none',registered:false,sent:false};
   const previewSha256=await digest(JSON.stringify(fields));current(e);const preview=freeze({...fields,previewSha256});e.preparing=false;tokens.set(preview,e);return preview;
  }catch(error){e.cancelled=true;entries.delete(e);throw error;}
 }
 async function confirm(preview,approval={},isCurrent=()=>true){
  const e=tokens.get(preview);if(!e||e.used||e.cancelled||approval?.explicit!==true||approval.previewSha256!==preview.previewSha256)fail('HOST_PROJECT_IMPORT_CONFIRMATION_REQUIRED');
  available();if(active)fail('HOST_PROJECT_IMPORT_ACTIVE');current(e,isCurrent);e.used=true;e.notifications=0;e.incomingSha256=preview.rawSha256;active=e;
  try{
   // Only the two exact DomainProjectSource notifications are tolerated for
   // this write. Concurrent rejected attempts also revoke its outcome adoption.
   const result=await source.replace(preview.raw,{expectedSeq:preview.expectedSeq,expectedSha256:preview.expectedSha256,isCurrent:()=>{current(e,isCurrent,true);return true;}});
   current(e,isCurrent,true);if(e.notifications!==2)fail('HOST_PROJECT_IMPORT_SOURCE_PROTOCOL_INVALID');
   if(!exact(result,['seq','rawSha256','epoch'])||result.seq!==preview.expectedSeq+1||result.rawSha256!==preview.rawSha256||!Number.isSafeInteger(result.epoch)||result.epoch!==preview.targetEpoch+2)fail('HOST_PROJECT_IMPORT_RESULT_INVALID');
   const now=target();if(now.status.seq!==result.seq||now.status.rawSha256!==result.rawSha256||now.status.epoch!==result.epoch||now.snapshot?.raw!==preview.raw)fail('HOST_PROJECT_IMPORT_RESULT_INVALID');
   current(e,isCurrent,true);const final=target();if(final.snapshot!==now.snapshot||final.status.seq!==now.status.seq||final.status.epoch!==now.status.epoch||final.status.rawSha256!==now.status.rawSha256)fail('HOST_PROJECT_IMPORT_RESULT_INVALID');
   return freeze({kind:'host-project-import-result',saved:true,namespace,targetLabel,seq:result.seq,rawSha256:result.rawSha256,epoch:result.epoch,registered:false,modelInvoked:false,authority:'none'});
  }catch{uncertain=true;retire();fail('HOST_PROJECT_IMPORT_OUTCOME_UNKNOWN_MAY_BE_SAVED');}
  finally{active=null;e.cancelled=true;entries.delete(e);}
 }
 function cancel(token){const e=tokens.get(token);if(!e)return;e.cancelled=true;entries.delete(e);}
 function close(){if(closed)return;closed=true;for(const e of entries)e.cancelled=true;entries.clear();try{unsubscribe?.();}finally{unsubscribe=undefined;}}
 return Object.freeze({prepare,confirm,cancel,close,inspect:()=>Object.freeze({enabled:true,state:closed?'closed':uncertain?'unknown-may-be-saved':active?'writing':'ready',attempts,activePreviews:entries.size,pendingPrepares:[...entries].filter(e=>e.preparing).length,authority:'none'})});
}
