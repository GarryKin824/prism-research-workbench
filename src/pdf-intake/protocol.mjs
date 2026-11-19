import {LIMITS,LEGACY_PDF_TEXT,PAGE_IMAGE_LIMITS,pdfExcerptLocation,validPdfText,checkPdfTextIndex} from './policy.mjs';
export const SCHEMA='prism-pdf-intake/v1';
export const EXECUTOR='derived PDF.js classic Worker / opaque sandbox';
export const keys=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===k.split(',').sort().join('|');
export const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const ERRORS=['PDF_CANCELLED','PDF_TIMEOUT','PDF_SIZE_LIMIT','NOT_PDF','PDF_PAGE_LIMIT','PDF_PASSWORD_REQUIRED','PDF_NO_TEXT_NO_OCR','PDF_INVALID_TEXT','PDF_WORKER_FAILED','PDF_PARSE_REJECTED','INVALID_REQUEST','HASH_MISMATCH','OPAQUE_CRYPTO_UNAVAILABLE','PDF_SOURCE_MISMATCH','PDF_SOURCE_PAGE_MISSING','PDF_PAGE_RENDER_FAILED'];
export function validContext(x){return keys(x,'namespace,revision,selectedPaperId')&&typeof x.namespace==='string'&&x.namespace.length>0&&x.namespace.length<=200&&Number.isSafeInteger(x.revision)&&x.revision>=0&&(x.selectedPaperId===null||typeof x.selectedPaperId==='string'&&x.selectedPaperId.length>0&&x.selectedPaperId.length<=200)}
export function validInit(x){return keys(x,'schema,type,requestId,parentOrigin,deadline,sha256,byteLength,mimeType')&&x.schema===SCHEMA&&x.type==='INIT'&&typeof x.requestId==='string'&&/^[a-f0-9-]{36}$/.test(x.requestId)&&typeof x.parentOrigin==='string'&&x.parentOrigin.length<500&&Number.isSafeInteger(x.deadline)&&hash(x.sha256)&&Number.isInteger(x.byteLength)&&x.byteLength>0&&x.byteLength<=LIMITS.maxBytes&&x.mimeType==='application/pdf'}
export function validInspection(x){
 if(!hash(x?.pdfSha256)||!hash(x?.textSha256))return false;
 const version=x.version===undefined?'':x.version===2?',version':null;
 if(version===null)return false;
 const limits=version?LIMITS:LEGACY_PDF_TEXT;
 if(x.mapOnly===true)return keys(x,'pdfSha256,textSha256,mapOnly'+version);
 return keys(x,'pdfSha256,textSha256,start,end,page'+version)
  &&Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start>=0&&x.start<x.end&&x.end<=limits.maxChars
  &&(x.page===null||Number.isInteger(x.page)&&x.page>=1&&x.page<=limits.maxPages);
}
export function validParse(x,c){
 const inspect=x?.type==='INSPECT_PAGE';
 const fields='schema,type,requestId,sha256,byteLength,mimeType,bytes';
 return keys(x,inspect?fields+',inspection':fields)&&x.schema===SCHEMA&&(inspect||x.type==='PARSE')
  &&x.requestId===c.requestId&&x.sha256===c.sha256&&x.byteLength===c.byteLength&&x.mimeType===c.mimeType
  &&x.bytes instanceof ArrayBuffer&&x.bytes.byteLength===c.byteLength
  &&(!inspect||validInspection(x.inspection)&&x.inspection.pdfSha256===c.sha256);
}
export function validFinal(x,c,inspection=null){
 if(!keys(x,'schema,type,requestId,sha256,byteLength,code,result')||x.schema!==SCHEMA||x.type!=='FINAL'
    ||x.requestId!==c.requestId||x.sha256!==c.sha256||x.byteLength!==c.byteLength)return false;
 if(x.code!=='OK')return ERRORS.includes(x.code)&&x.result===null;
 const r=x.result,fields='text,pages,pagesRead,truncated,ocrPerformed,actualExecutor';
 const extra=inspection&&!inspection.mapOnly?',pageSpans,pageImage':',pageSpans';
 if(!keys(r,fields+extra)||!validPdfText(r.text)||r.text.length>LIMITS.maxChars
    ||!Number.isInteger(r.pages)||r.pages<1||r.pages>LIMITS.maxPages||!Number.isInteger(r.pagesRead)
    ||r.pagesRead<1||r.pagesRead>r.pages||typeof r.truncated!=='boolean'||r.ocrPerformed!==false||r.actualExecutor!==EXECUTOR)return false;
 try{
  if(!inspection||inspection.version===2)checkPdfTextIndex(r.text,{version:2,pages:r.pages,pagesRead:r.pagesRead,truncated:r.truncated,pageSpans:r.pageSpans});
  if(!inspection||inspection.mapOnly){pdfExcerptLocation(r,0,r.text.length);return true}
  const {pages}=pdfExcerptLocation(r,inspection.start,inspection.end),image=r.pageImage;
  return keys(image,'number,width,height,blob')&&pages.includes(image.number)&&image.number===(inspection.page??pages[0])
   &&Number.isInteger(image.width)&&image.width>=1&&image.width<=PAGE_IMAGE_LIMITS.width
   &&Number.isInteger(image.height)&&image.height>=1&&image.height<=PAGE_IMAGE_LIMITS.height
   &&image.blob instanceof Blob&&image.blob.type==='image/png'&&image.blob.size>0&&image.blob.size<=PAGE_IMAGE_LIMITS.bytes;
 }catch{return false}
}
export const digest=async(bytes,c=globalThis.crypto)=>Array.from(new Uint8Array(await c.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
