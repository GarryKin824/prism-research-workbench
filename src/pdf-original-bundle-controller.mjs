import {PDF_ORIGINAL_BUNDLE_LIMITS,createPdfOriginalBundle,inspectPdfOriginalBundle,extractPdfOriginalBundle} from './pdf-original-bundle-core.mjs';
import {vaultArrayBufferLength} from './pdf-original-vault-core.mjs';

// Two independent read-only lanes. Construction, consent, and state observation
// never open storage or read a selected file. Raw bundle/PDF bytes remain private.
export function createPdfOriginalBundleController(options={}) {
 const result=(ok,code,extra={})=>Object.freeze({ok,code,...extra});
 const timeoutMs=Number.isInteger(options.timeoutMs)&&options.timeoutMs>0&&options.timeoutMs<=60000?options.timeoutMs:15000;
 let alive=true,captureEpoch=0,viewerEpoch=0,captureFlight=null,viewerFlight=null;
 let captureConsent=false,downloadConsent=false,readConsent=false,extractConsent=false;
 let captureData=null,viewerData=null,selectedId='',vault=null,vaultContext=null;
 const listeners=new Set();
 const emit=()=>{for(const listener of listeners)try{listener()}catch{}};
 const context=()=>{try{return options.getCaptureContext?.()||null}catch{return null}};
 const sameContext=source=>!!source&&context()===source;
 const crypto=()=>Object.hasOwn(options,'crypto')?options.crypto:globalThis.crypto;
 const bounded=(promise,code)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(Error(code),{code})),timeoutMs);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})});
 const codeOf=(error,fallback)=>typeof error?.code==='string'?error.code:fallback;
 const closeVault=()=>{try{vault?.close()}catch{}vault=null;vaultContext=null};
 function clearCapture(){captureEpoch++;captureData=null;downloadConsent=false;closeVault();emit()}
 function clearViewer(){viewerEpoch++;viewerData=null;selectedId='';extractConsent=false;emit()}
 function getState(){return Object.freeze({closed:!alive,captureConsent,downloadConsent,readConsent,extractConsent,captureBusy:!!captureFlight,viewerBusy:!!viewerFlight,captureSummary:captureData?.summary||null,captureByteLength:captureData?.byteLength||null,viewerSummary:viewerData?.summary||null,selectedFile:viewerData?.fileMeta||null,selectedId})}
 const captureCurrent=token=>alive&&captureConsent&&captureEpoch===token.epoch&&captureFlight===token&&sameContext(token.context);
 const viewerCurrent=token=>alive&&readConsent&&viewerEpoch===token.epoch&&viewerFlight===token;
 function beginCapture(kind){if(!alive)return result(false,'CLOSED');if(captureFlight)return result(false,'BUSY');if(!captureConsent)return result(false,'CONSENT_REQUIRED');const source=context();if(!source||typeof source.namespace!=='string')return result(false,'INVALID_NAMESPACE');const token={kind,context:source,epoch:++captureEpoch};captureFlight=token;emit();return token}
 function beginViewer(kind){if(!alive)return result(false,'CLOSED');if(viewerFlight)return result(false,'BUSY');if(!readConsent)return result(false,'CONSENT_REQUIRED');const token={kind,epoch:++viewerEpoch};viewerFlight=token;emit();return token}
 const finishCapture=token=>{if(captureFlight===token){captureFlight=null;emit()}};
 const finishViewer=token=>{if(viewerFlight===token){viewerFlight=null;emit()}};
 async function capture(){
  const token=beginCapture('capture');if('ok'in token)return token;
  captureData=null;downloadConsent=false;emit();const isCurrent=()=>captureCurrent(token);
  try{
   if(!isCurrent())return result(false,'CANCELLED');
   if(!vault||vaultContext!==token.context){closeVault();vault=options.createVault?.(token.context.namespace);vaultContext=token.context;}
   if(!vault||typeof vault.snapshotOriginals!=='function')return result(false,'UNSUPPORTED');
   if(!isCurrent())return result(false,'CANCELLED');
   const snapshot=await bounded(vault.snapshotOriginals({isCurrent}),'CAPTURE_TIMEOUT');if(!isCurrent())return result(false,'CANCELLED');
   if(!snapshot?.ok)return result(false,snapshot?.code||'READ_FAILED');
   if(snapshot.namespace!==token.context.namespace)return result(false,'SOURCE_CHANGED');
   const created=await bounded(createPdfOriginalBundle(snapshot,{crypto:crypto(),isCurrent}),'VERIFY_TIMEOUT');if(!isCurrent())return result(false,'CANCELLED');
   if(!created.ok)return created;
   captureData={text:created.text,summary:created.summary,byteLength:created.byteLength,context:token.context};emit();
   return result(true,'CAPTURED',{summary:created.summary,byteLength:created.byteLength});
  }catch(error){return result(false,isCurrent()?codeOf(error,'CAPTURE_FAILED'):'CANCELLED')}finally{finishCapture(token)}
 }
 async function downloadBundle(){
  if(!downloadConsent)return result(false,'CONFIRMATION_REQUIRED');
  const data=captureData;if(!data)return result(false,'NO_PREVIEW');
  if(!sameContext(data.context)){clearCapture();return result(false,'SOURCE_CHANGED')}
  const token=beginCapture('download');if('ok'in token)return token;
  downloadConsent=false;emit();const isCurrent=()=>captureCurrent(token)&&captureData===data;
  try{
   if(!isCurrent())return result(false,'CANCELLED');
   const blob=new Blob([data.text],{type:'application/json'});
   if(blob.size!==data.byteLength)return result(false,'VERIFY_FAILED');
   const name='PRISM-pdf-originals-'+data.summary.packetSha256+'.json';
   if(!isCurrent())return result(false,'CANCELLED');
   if(typeof options.requestDownload!=='function')return result(false,'DOWNLOAD_UNSUPPORTED');
   const requested=await bounded(options.requestDownload(blob,name,isCurrent),'DOWNLOAD_TIMEOUT');
   if(!isCurrent())return result(false,'CANCELLED');
   return requested===true?result(true,'DOWNLOAD_REQUESTED',{name}):result(false,'DOWNLOAD_FAILED');
  }catch(error){return result(false,isCurrent()?codeOf(error,'DOWNLOAD_FAILED'):'CANCELLED')}finally{finishCapture(token)}
 }
 function fileMeta(file){
  const name=file?.name,size=file?.size,type=file?.type,read=file?.arrayBuffer;
  if(Number.isSafeInteger(size)&&size>PDF_ORIGINAL_BUNDLE_LIMITS.maxPacketBytes)throw Object.assign(Error('PACKET_TOO_LARGE'),{code:'PACKET_TOO_LARGE'});
  if(typeof name!=='string'||!name.length||name.length>255||/[\u0000-\u001f\u007f-\u009f]/u.test(name)||!Number.isSafeInteger(size)||size<1||typeof type!=='string'||typeof read!=='function')throw Object.assign(Error('INVALID_FILE'),{code:'INVALID_FILE'});
  return {name,size,type,read};
 }
 const sameFile=(file,meta)=>{try{return file.name===meta.name&&file.size===meta.size&&file.type===meta.type&&file.arrayBuffer===meta.read}catch{return false}};
 async function inspectFile(file){
  const token=beginViewer('inspect');if('ok'in token)return token;
  viewerData=null;selectedId='';extractConsent=false;emit();const isCurrent=()=>viewerCurrent(token);
  try{
   const meta=fileMeta(file);if(!isCurrent())return result(false,'CANCELLED');
   const buffer=await bounded(Promise.resolve().then(()=>{if(!isCurrent())throw Object.assign(Error('CANCELLED'),{code:'CANCELLED'});return meta.read.call(file)}),'FILE_TIMEOUT');
   if(!isCurrent())return result(false,'CANCELLED');if(!sameFile(file,meta)||vaultArrayBufferLength(buffer)!==meta.size)return result(false,'INPUT_CHANGED');
   const inspected=await bounded(inspectPdfOriginalBundle(new Uint8Array(buffer).slice(),{crypto:crypto(),isCurrent}),'VERIFY_TIMEOUT');
   if(!isCurrent())return result(false,'CANCELLED');if(!sameFile(file,meta))return result(false,'INPUT_CHANGED');if(!inspected.ok)return inspected;
   const selected=Object.freeze({name:meta.name,size:meta.size});viewerData={inspection:inspected.inspection,summary:inspected.summary,fileMeta:selected};emit();
   return result(true,'INSPECTED',{summary:inspected.summary,selectedFile:selected});
  }catch(error){return result(false,isCurrent()?codeOf(error,'READ_FAILED'):'CANCELLED')}finally{finishViewer(token)}
 }
 async function extractSelected(){
  if(!extractConsent)return result(false,'CONFIRMATION_REQUIRED');const data=viewerData,id=selectedId;
  if(!data||!id)return result(false,'NO_SELECTION');const token=beginViewer('extract');if('ok'in token)return token;
  extractConsent=false;emit();const isCurrent=()=>viewerCurrent(token)&&viewerData===data&&selectedId===id;
  try{
   if(!isCurrent())return result(false,'CANCELLED');const extracted=await bounded(extractPdfOriginalBundle(data.inspection,id),'VERIFY_TIMEOUT');if(!isCurrent())return result(false,'CANCELLED');
   if(!extracted.ok)return extracted;
   const name='PRISM-original-'+id+'.pdf';if(typeof options.requestDownload!=='function')return result(false,'DOWNLOAD_UNSUPPORTED');
   if(!isCurrent())return result(false,'CANCELLED');const requested=await bounded(options.requestDownload(extracted.blob,name,isCurrent),'DOWNLOAD_TIMEOUT');
   if(!isCurrent())return result(false,'CANCELLED');return requested===true?result(true,'EXTRACTION_REQUESTED',{name,id}):result(false,'DOWNLOAD_FAILED');
  }catch(error){return result(false,isCurrent()?codeOf(error,'DOWNLOAD_FAILED'):'CANCELLED')}finally{finishViewer(token)}
 }
 return Object.freeze({getState,capture,downloadBundle,inspectFile,extractSelected,clearCapture,clearViewer,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  setCaptureConsent(value){captureConsent=alive&&value===true;clearCapture()},
  setDownloadConsent(value){captureEpoch++;downloadConsent=alive&&captureConsent&&!!captureData&&value===true;emit()},
  setReadConsent(value){readConsent=alive&&value===true;clearViewer()},
  selectOriginal(id){viewerEpoch++;extractConsent=false;selectedId=alive&&readConsent&&viewerData?.summary.files.some(file=>file.id===id)?id:'';emit()},
  setExtractConsent(value){viewerEpoch++;extractConsent=alive&&readConsent&&!!viewerData&&!!selectedId&&value===true;emit()},
  invalidateCapture(){captureConsent=false;clearCapture()},
  close(){if(!alive)return;alive=false;captureConsent=false;readConsent=false;clearCapture();clearViewer();listeners.clear()}
 });
}
