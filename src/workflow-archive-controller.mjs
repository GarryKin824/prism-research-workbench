import * as archiveCore from './workflow-archive-core.mjs';
// Immutable archive namespace is never loaded by an execution controller.
export function createWorkflowArchiveController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey(),prefix=namespace+':workflow-archive-v1:',issued=new WeakMap();
 const bytes=s=>new TextEncoder().encode(s).length;
 function guard(){store.assertCurrentStorage();if(store.getStorageKey()!==namespace)throw Error('ARCHIVE_PROFILE_CHANGED')}
 function scan(filter){guard();const rows=[];if(!Number.isSafeInteger(storage.length)||storage.length>10000)throw Error('ARCHIVE_STORAGE_SCAN_LIMIT');for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&filter(key)){const raw=storage.getItem(key);if(raw===null)throw Error('ARCHIVE_STORAGE_CHANGED');rows.push([key,raw])}}rows.sort((a,b)=>a[0].localeCompare(b[0]));return rows}
 function equalRows(a,b){return JSON.stringify(a)===JSON.stringify(b)}
 function saved(){const rows=scan(k=>k.startsWith(prefix));if(rows.length>20||rows.reduce((n,[,r])=>n+bytes(r),0)>32000000)throw Error('ARCHIVE_SLOT_LIMIT');for(const [key]of rows)if(!/^slot-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key.slice(prefix.length)))throw Error('ARCHIVE_INVALID_SLOT_KEY');return rows}
 function stable(rows){guard();if(!equalRows(rows,saved()))throw Error('ARCHIVE_STORAGE_CHANGED')}
 async function exportCurrent(){guard();const storeRaw=store.exportJSON(),filter=k=>k.startsWith(namespace+':custom-workflow-v1:')||k===namespace+':library-queue-v1',rows=scan(filter);for(const [key,value]of rows){if(key!==namespace+':library-queue-v1'){let data;try{data=JSON.parse(value)}catch{throw Error('ARCHIVE_INVALID_WORKFLOW_JSON')}if(data?.state?.source?.paperId!==key.slice((namespace+':custom-workflow-v1:').length))throw Error('ARCHIVE_WORKFLOW_KEY_MISMATCH')}}const raw=await archiveCore.createArchive({namespace,storeRaw,workflowRaws:rows.filter(([k])=>k!==namespace+':library-queue-v1').map(([,r])=>r),queueRaws:rows.filter(([k])=>k===namespace+':library-queue-v1').map(([,r])=>r)},crypto);guard();if(store.exportJSON()!==storeRaw||!equalRows(rows,scan(filter)))throw Error('ARCHIVE_SOURCE_CHANGED');return raw}
 async function prepare(raw){guard();const parsed=await archiveCore.inspectArchive(raw,crypto);guard();const preview={byteSha256:parsed.byteSha256,fingerprint:parsed.fingerprint,summary:parsed.summary};issued.set(preview,{raw,byteSha256:parsed.byteSha256,fingerprint:parsed.fingerprint,display:JSON.stringify(preview)});return preview}
 async function restore(preview,{explicitConfirmation=false,isCurrent=()=>true}={}){
  if(!explicitConfirmation)throw Error('ARCHIVE_CONFIRMATION_REQUIRED');
  if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  // A Host-view departure can leave the shared store alive. Its caller's
  // lifecycle must remain current until the first durable write, independently
  // of the store/profile checks. Do not reinterpret cancellation after commit.
  function current(){guard();if(typeof isCurrent!=='function'||isCurrent()!==true)throw Error('ARCHIVE_OPERATION_EXPIRED')}
  current();
  return withLock(namespace+':workflow-archive-write',async()=>{
   current();const token=issued.get(preview);
   if(!token||JSON.stringify(preview)!==token.display)throw Error('ARCHIVE_PREVIEW_NOT_ISSUED');
   const rows=saved(),parsed=await archiveCore.inspectArchive(token.raw,crypto);
   current();stable(rows);
   if(parsed.byteSha256!==token.byteSha256||parsed.fingerprint!==token.fingerprint)throw Error('ARCHIVE_PREVIEW_CHANGED');
   for(const [,raw]of rows){
    const existing=await archiveCore.inspectArchive(raw,crypto);current();stable(rows);
    if(existing.fingerprint===parsed.fingerprint)throw Error('ARCHIVE_ALREADY_RESTORED');
   }
   if(rows.length>=20||rows.reduce((n,[,r])=>n+bytes(r),0)+bytes(token.raw)>32000000)throw Error('ARCHIVE_SLOT_LIMIT');
   const id='slot-'+crypto.randomUUID(),key=prefix+id;stable(rows);
   if(storage.getItem(key)!==null)throw Error('ARCHIVE_SLOT_EXISTS');
   current();
   // One atomic localStorage setItem, no index or cleanup transaction.
   // Preserve readback and discoverable-slot handling after the write starts.
   storage.setItem(key,token.raw);issued.delete(preview);
   if(storage.getItem(key)!==token.raw)throw Error('ARCHIVE_WRITE_UNCERTAIN_CHECK_LIST');
   return {id,summary:parsed.summary};
  });
 }
 async function list(){const rows=saved(),out=[];for(const [key,raw]of rows){const p=await archiveCore.inspectArchive(raw,crypto);stable(rows);out.push({id:key.slice(prefix.length),summary:p.summary,byteSha256:p.byteSha256,fingerprint:p.fingerprint})}return out}
 async function open(id){const rows=saved(),row=rows.find(([key])=>key===prefix+id);if(!row)throw Error('ARCHIVE_SLOT_NOT_FOUND');const parsed=await archiveCore.inspectArchive(row[1],crypto);stable(rows);return {...parsed,raw:row[1]}}
 return {exportCurrent,prepare,restore,list,open,canRestore:typeof withLock==='function'};
}
