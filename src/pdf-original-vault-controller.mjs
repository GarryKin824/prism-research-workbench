import {PDF_ORIGINAL_VAULT_LIMITS as LIMITS,PDF_ORIGINAL_VAULT_DB_PREFIX,PDF_ORIGINAL_VAULT_STORE as STORE,vaultError,validVaultNamespace,validVaultName,validVaultHash,validVaultSize,assertPdfHeader,vaultMetadata,validateVaultRecord,sha256VaultBytes,vaultArrayBufferLength} from './pdf-original-vault-core.mjs';

// No storage operations at construction. Every open follows an explicit method call.
// Namespace isolation is organizational, not protection from other same-origin code.
export function createPdfOriginalVaultController(options={}) {
 const namespace=options.namespace,issued=new WeakMap();
 let indexedDB,crypto,BlobClass,setupCode=null;
 try { indexedDB=Object.hasOwn(options,'indexedDB')?options.indexedDB:globalThis.indexedDB;crypto=Object.hasOwn(options,'crypto')?options.crypto:globalThis.crypto;BlobClass=Object.hasOwn(options,'Blob')?options.Blob:globalThis.Blob;
  if(!indexedDB||typeof indexedDB.open!=='function'||typeof crypto?.subtle?.digest!=='function'||typeof BlobClass!=='function')setupCode='UNSUPPORTED';
 } catch {setupCode='UNSUPPORTED';}
 if(!validVaultNamespace(namespace))setupCode='INVALID_NAMESPACE';
 const timeoutMs=Number.isInteger(options.timeoutMs)&&options.timeoutMs>=1&&options.timeoutMs<=30000?options.timeoutMs:5000;
 let db=null,closed=false,busy=false,uncertain=null,generation=0;
 const result=(ok,code,extra={})=>Object.freeze({ok,code,...extra});
 const current=guard=>{try{return !closed&&(!guard||guard()===true)}catch{return false}};
 const check=guard=>{if(closed)throw vaultError('CLOSED');if(setupCode)throw vaultError(setupCode);if(!current(guard))throw vaultError('CANCELLED')};
 const errorCode=(e,fallback)=>typeof e?.code==='string'?e.code:fallback;
 const bounded=(promise,code)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(vaultError(code)),timeoutMs);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},e=>{clearTimeout(timer);reject(e)})});
 function forget(connection) { try{connection?.close()}catch{}if(db===connection)db=null; }
 function open(guard,{allowCreate=true}={}) {
  check(guard);if(db)return Promise.resolve(db);
  return new Promise((resolve,reject)=>{
   let request,settled=false,upgrade=null;
   const finish=(error,connection)=>{if(settled){if(connection)forget(connection);return}settled=true;clearTimeout(timer);if(error){if(upgrade)try{upgrade.abort()}catch{}reject(error)}else resolve(connection)};
   const timer=setTimeout(()=>finish(vaultError('OPEN_TIMEOUT')),timeoutMs);
   try {request=indexedDB.open(PDF_ORIGINAL_VAULT_DB_PREFIX+namespace,1)}catch {finish(vaultError('OPEN_FAILED'));return;}
   request.onblocked=()=>finish(vaultError('OPEN_BLOCKED'));
   request.onerror=()=>finish(vaultError('OPEN_FAILED'));
   request.onupgradeneeded=event=>{
    upgrade=request.transaction;
    // Bundle snapshots may observe an existing vault, but never create or migrate one.
    if(!allowCreate){try{upgrade.abort()}catch{}if(!settled)finish(vaultError(event.oldVersion===0?'VAULT_ABSENT':'INCOMPATIBLE_SCHEMA'));return}
    if(settled||!current(guard)||event.oldVersion!==0){try{upgrade.abort()}catch{}if(!settled)finish(vaultError(event.oldVersion!==0?'INCOMPATIBLE_SCHEMA':closed?'CLOSED':'CANCELLED'));return;}
    try{request.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:false})}catch{finish(vaultError('INCOMPATIBLE_SCHEMA'))}
   };
   request.onsuccess=()=>{
    const connection=request.result;
    if(settled){forget(connection);return}
    if(!current(guard)){forget(connection);finish(vaultError(closed?'CLOSED':'CANCELLED'));return}
    try{if(connection.version!==1||connection.objectStoreNames.length!==1||!connection.objectStoreNames.contains(STORE))throw vaultError('INCOMPATIBLE_SCHEMA');}
    catch{forget(connection);finish(vaultError('INCOMPATIBLE_SCHEMA'));return;}
    connection.onversionchange=()=>forget(connection);
    connection.onclose=()=>{if(db===connection)db=null};
    db=connection;finish(null,connection);
   };
  });
 }
 function schemaStore(tx) { const store=tx.objectStore(STORE);if(store.keyPath!=='id'||store.autoIncrement!==false||store.indexNames.length!==0)throw vaultError('INCOMPATIBLE_SCHEMA');return store; }
 // Only synchronous IndexedDB work in transaction callbacks. No crypto awaits here.
 function scan(connection,{writeRecord=null,guard,onAdmit=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
   let tx,settled=false,admitted=false,failed=null,duplicate=null,totalBytes=0;const records=[];
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value)};
   const failure=(code,outcome)=>{const e=vaultError(code);e.outcome=outcome;e.admitted=admitted;return e};
   const timer=setTimeout(()=>{try{tx?.abort()}catch{}finish(failure(admitted?'WRITE_UNCERTAIN':writeRecord?'WRITE_ABORTED':'READ_TIMEOUT',admitted?'unknown':'not_written'))},timeoutMs);
   const abort=code=>{failed=code;try{tx.abort()}catch{finish(failure(admitted?'WRITE_UNCERTAIN':code,admitted?'unknown':'not_written'))}};
   try {
    check(guard);tx=connection.transaction(STORE,writeRecord?'readwrite':'readonly');
    tx.onabort=()=>finish(failure(admitted?'WRITE_ABORTED':failed||(writeRecord?'WRITE_ABORTED':'READ_FAILED'),admitted?'aborted':'not_written'));
    tx.onerror=()=>{}; // Abort/complete, not a request's success/error, determines settlement.
    tx.oncomplete=()=>{if(failed){finish(failure(admitted?'WRITE_UNCERTAIN':failed,admitted?'committed_unverified':'not_written'));return}finish(null,{records,totalBytes,duplicate,admitted})};
    const store=schemaStore(tx),request=store.openCursor();
    request.onerror=()=>abort(writeRecord?'WRITE_ABORTED':'READ_FAILED');
    request.onsuccess=()=>{
     try {
      if(!current(guard)&&!admitted){abort(closed?'CLOSED':'CANCELLED');return}
      const cursor=request.result;
      if(cursor){
       if(records.length>=LIMITS.maxFiles){abort('CORRUPT_RECORD');return}
       const record=validateVaultRecord(cursor.value,namespace,BlobClass);
       if(cursor.primaryKey!==record.id){abort('CORRUPT_RECORD');return}
       totalBytes+=record.size;if(totalBytes>LIMITS.maxTotalBytes){abort('CORRUPT_RECORD');return}
       records.push(record);if(writeRecord&&record.id===writeRecord.id)duplicate=record;
       cursor.continue();return;
      }
      if(writeRecord&&!duplicate){
       if(records.length>=LIMITS.maxFiles||totalBytes+writeRecord.size>LIMITS.maxTotalBytes){abort('FULL');return}
       check(guard);const addRequest=store.add(writeRecord);admitted=true;onAdmit();
       addRequest.onerror=()=>{failed='WRITE_ABORTED'};
      }
     }catch(e){abort(errorCode(e,'READ_FAILED'))}
    };
   }catch(e){if(tx)abort(errorCode(e,writeRecord?'WRITE_ABORTED':'READ_FAILED'));else finish(failure(errorCode(e,writeRecord?'WRITE_ABORTED':'READ_FAILED'),'not_written'))}
  });
 }
 function readOne(connection,id,guard) {
  return new Promise((resolve,reject)=>{
   let tx,settled=false,record;
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(record)};
   const timer=setTimeout(()=>{try{tx?.abort()}catch{}finish(vaultError('READ_TIMEOUT'))},timeoutMs);
   try{
    check(guard);tx=connection.transaction(STORE,'readonly');
    tx.onabort=()=>finish(vaultError('READ_FAILED'));tx.onerror=()=>{};
    tx.oncomplete=()=>finish();
    const request=schemaStore(tx).get(id);
    request.onerror=()=>{try{tx.abort()}catch{}finish(vaultError('READ_FAILED'))};
    request.onsuccess=()=>{record=request.result};
   }catch(e){try{tx?.abort()}catch{}finish(vaultError(errorCode(e,'READ_FAILED')))}
  });
 }
 async function verify(record,expected=null) {
  validateVaultRecord(record,namespace,BlobClass);
  const buffer=await bounded(record.blob.arrayBuffer(),'READ_TIMEOUT');
  if(vaultArrayBufferLength(buffer)!==record.size)throw vaultError('VERIFY_FAILED');
  const bytes=new Uint8Array(buffer);assertPdfHeader(bytes);
  const hash=await bounded(sha256VaultBytes(bytes,crypto),'HASH_TIMEOUT');
  if(hash!==record.sha256||expected&&(record.id!==expected.id||record.name!==expected.name||record.size!==expected.size||record.sha256!==expected.sha256))throw vaultError('VERIFY_FAILED');
  return vaultMetadata(record);
 }
 async function run(guard,work,{allowUncertain=false}={}) {
  if(busy)return result(false,'BUSY');
  try{check(guard);if(uncertain&&!allowUncertain)return result(false,'REFRESH_REQUIRED',{outcome:uncertain.outcome});}catch(e){return result(false,errorCode(e,'UNSUPPORTED'))}
  busy=true;
  try{return await work()}catch(e){return result(false,errorCode(e,'READ_FAILED'),{stale:!current(guard)})}finally{busy=false}
 }
 function prepare(file,{isCurrent:callerGuard}={}) {if(busy)return Promise.resolve(result(false,'BUSY'));const mine=++generation;const isCurrent=()=>mine===generation&&(!callerGuard||callerGuard()===true);return run(isCurrent,async()=>{
  let name,size,type,read;
  try{name=file.name;size=file.size;type=file.type;read=file.arrayBuffer;if(!validVaultName(name)||typeof read!=='function'||(type!==''&&type!=='application/pdf'))throw vaultError('INVALID_FILE');if(Number.isSafeInteger(size)&&size>LIMITS.maxFileBytes)throw vaultError('TOO_LARGE');if(!validVaultSize(size))throw vaultError('INVALID_FILE')}catch(e){throw vaultError(errorCode(e,'INVALID_FILE'))}
  const buffer=await bounded(Promise.resolve().then(()=>{check(isCurrent);return read.call(file)}),'FILE_TIMEOUT');check(isCurrent);
  if(file.name!==name||file.size!==size||file.type!==type||vaultArrayBufferLength(buffer)!==size)throw vaultError('INPUT_CHANGED');
  const bytes=new Uint8Array(buffer).slice();assertPdfHeader(bytes);
  const sha256=await bounded(sha256VaultBytes(bytes,crypto),'HASH_TIMEOUT');check(isCurrent);
  if(file.name!==name||file.size!==size||file.type!==type)throw vaultError('INPUT_CHANGED');
  const preview=Object.freeze({id:sha256,name,size,sha256});
  const blob=new BlobClass([bytes],{type:'application/pdf'});if(blob.size!==size)throw vaultError('INVALID_FILE');
  issued.set(preview,{blob,used:false,generation:mine});return result(true,'PREPARED',{preview});
 });}
 function commit(preview,{explicitConfirmation=false,isCurrent:callerGuard}={}) {const mine=generation;const isCurrent=()=>mine===generation&&(!callerGuard||callerGuard()===true);return run(isCurrent,async()=>{
  if(explicitConfirmation!==true)return result(false,'CONFIRMATION_REQUIRED');
  const token=preview&&typeof preview==='object'?issued.get(preview):null;
  if(!token||token.used||token.generation!==mine)return result(false,'INVALID_PREVIEW');
  const record={version:1,namespace,...preview,blob:token.blob};
  let admitted=false,committed=false;
  try{
   const connection=await open(isCurrent);check(isCurrent);
   const scanResult=await scan(connection,{writeRecord:record,guard:isCurrent,onAdmit(){admitted=true;token.used=true}});
   if(scanResult.duplicate){
    const metadata=await verify(scanResult.duplicate);check(isCurrent);token.used=true;
    return result(false,'DUPLICATE',{record:metadata,selectedName:preview.name,outcome:'already_present_verified',stale:false});
   }
   committed=true;
   // A closed/stale UI must not silently become a saved success. No replay after admission.
   if(!current(isCurrent))throw vaultError('CANCELLED');
   const persisted=await readOne(connection,preview.id,isCurrent);
   if(!persisted)throw vaultError('VERIFY_FAILED');
   const metadata=await verify(persisted,record);
   if(!current(isCurrent))throw vaultError('CANCELLED');
   return result(true,'STORED',{record:metadata,outcome:'committed_verified',stale:false});
  }catch(e){
   if(committed||admitted&&e.outcome!=='aborted'){
    const outcome=committed||e.outcome==='committed_unverified'?'committed_unverified':'unknown';
    uncertain={id:preview.id,expected:vaultMetadata(record),outcome};
    return result(false,'WRITE_UNCERTAIN',{outcome,cause:errorCode(e,'READ_FAILED'),stale:!current(isCurrent)});
   }
   return result(false,errorCode(e,admitted?'WRITE_ABORTED':'OPEN_FAILED'),{outcome:admitted?'aborted':'not_written',stale:!current(isCurrent)});
  }
 });}
 function readList(isRefresh,{isCurrent}={}) {return run(isCurrent,async()=>{
  const connection=await open(isCurrent);check(isCurrent);const snapshot=await scan(connection,{guard:isCurrent});
  const records=[];for(const record of snapshot.records){check(isCurrent);records.push(await verify(record));}
  check(isCurrent);let reconciliation;
  if(isRefresh&&uncertain){
   const found=records.find(record=>record.id===uncertain.id);
   if(found&&(found.name!==uncertain.expected.name||found.size!==uncertain.expected.size||found.sha256!==uncertain.expected.sha256))throw vaultError('VERIFY_FAILED');
   reconciliation=Object.freeze({id:uncertain.id,state:found?'present_verified':'not_present',previousOutcome:uncertain.outcome});uncertain=null;
  }
  return result(true,isRefresh?'REFRESHED':'LISTED',{records:Object.freeze(records),totalBytes:snapshot.totalBytes,...(reconciliation?{reconciliation}:{})});
 },{allowUncertain:isRefresh});}
 // Capture one readonly transaction, then verify its immutable Blob values outside it.
 // Unlike refresh, this does not reconcile or clear a previous uncertain write.
 function snapshotOriginals({isCurrent,metadataOnly=false}={}) {return run(isCurrent,async()=>{
  const connection=await open(isCurrent,{allowCreate:false});check(isCurrent);
  const snapshot=await scan(connection,{guard:isCurrent});const records=[];
  for(const record of snapshot.records){check(isCurrent);const metadata=metadataOnly?vaultMetadata(record):await verify(record);check(isCurrent);
   records.push(metadataOnly?metadata:Object.freeze({...metadata,blob:record.blob}));
  }
  check(isCurrent);
  return result(true,'SNAPSHOT',{namespace,records:Object.freeze(records),totalBytes:snapshot.totalBytes});
 },{allowUncertain:true});}
 function exportOriginal(id,{isCurrent,allowCreate=true}={}) {return run(isCurrent,async()=>{
  if(!validVaultHash(id))return result(false,'INVALID_ID');
  const connection=await open(isCurrent,{allowCreate});check(isCurrent);const record=await readOne(connection,id,isCurrent);
  check(isCurrent);if(!record)return result(false,'NOT_FOUND');
  const metadata=await verify(record);check(isCurrent);
  // Blob is immutable; the exact persisted bytes just rehashed are returned, never a parser result.
  return result(true,'EXPORTED',{...metadata,blob:record.blob});
 },{allowUncertain:true});}
 async function restoreOriginals(originals,{rollback=false,guard=()=>{}}={}) {
  if(!originals.length)return;
  const rows=originals.map(({id,name,size,sha256,blob})=>({id,name,size,sha256,blob,version:1,namespace}));
  if(!rollback){for(const row of rows)await verify(row);}
  const connection=await open(undefined);
  return new Promise((resolve,reject)=>{
   const tx=connection.transaction(STORE,'readwrite',{durability:'strict'}),store=schemaStore(tx);
   let failure;
   const abort=error=>{failure=error;tx.abort()};
   const timer=setTimeout(()=>abort(vaultError('RESTORE_TIMEOUT')),timeoutMs);
   tx.onabort=()=>{clearTimeout(timer);reject(failure??tx.error??vaultError('RESTORE_ABORTED'))};
   tx.oncomplete=()=>{clearTimeout(timer);resolve()};
   if(rollback){
    for(const row of rows){
     const request=store.get(row.id);
     request.onsuccess=()=>{const value=request.result;if(value&&value.sha256===row.sha256&&value.size===row.size&&value.name===row.name)store.delete(row.id)};
    }
    return;
   }
   const count=store.count();
   count.onsuccess=()=>{
    try{
     guard();
     if(count.result)throw Error('RECOVERY_DESTINATION_OCCUPIED');
     for(const row of rows)store.add(row);
    }catch(error){abort(error)}
   };
  });
 }
 return Object.freeze({prepare,commit,list:options=>readList(false,options),refresh:options=>readList(true,options),exportOriginal,snapshotOriginals,restoreOriginals,close(){closed=true;forget(db)},getStatus(){return Object.freeze({namespace,closed,busy,uncertain:!!uncertain,available:!setupCode})}});
}
