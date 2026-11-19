import bundle,{scriptHash} from './child-source.mjs';
import {makeSrcdoc} from './srcdoc.mjs';
import {SCHEMA,validContext,validFinal,validInspection,digest} from './protocol.mjs';
import {LIMITS,checkBytes,pdfExcerptLocation} from './policy.mjs';
export {scriptHash,LIMITS};
export {checkPdfTextIndex} from './policy.mjs';
export function createPdfIntake({mount,getContext,crypto=globalThis.crypto,clock=()=>Date.now(),document=globalThis.document,MessageChannel=globalThis.MessageChannel,File=globalThis.File,origin=globalThis.location?.origin}){
 if(!mount||typeof getContext!=='function'||!crypto?.subtle)throw Error('INVALID_SETUP');
 let epoch=0,active=null,destroyed=false;const issued=new WeakMap();
 const snapshot=x=>{if(!validContext(x))throw Error('INVALID_CONTEXT');return Object.freeze({...x})};
 const equal=(a,b)=>validContext(b)&&a.namespace===b.namespace&&a.revision===b.revision&&a.selectedPaperId===b.selectedPaperId;
 function cleanup(r){clearTimeout(r.timer);clearTimeout(r.cleanupTimer);r.port?.close();r.port2?.close();r.frame?.remove();if(active===r)active=null}
 function cancel(){epoch++;if(active){const r=active;active=null;clearTimeout(r.timer);r.reject(Error('PDF_CANCELLED'));if(r.config&&r.port){r.port.onmessage=e=>{if(validFinal(e.data,r.config)&&e.data.code==='PDF_CANCELLED'&&e.data.result===null)cleanup(r)};r.cleanupTimer=setTimeout(()=>cleanup(r),400);try{r.port.postMessage({schema:SCHEMA,type:'CANCEL',requestId:r.config.requestId})}catch{cleanup(r)}}else cleanup(r)}}
 function assertCurrent(p){const t=issued.get(p);if(!t||t.used||destroyed||t.epoch!==epoch||!equal(p.context,getContext()))throw Error('STALE_PREVIEW');return p}
 function consume(p){assertCurrent(p);issued.get(p).used=true;return p}
 function run(input,{confirmed=false,context,inspection=null,onProgress}={}){
 cancel();if(destroyed)return Promise.reject(Error('DESTROYED'));if(confirmed!==true)return Promise.reject(Error('EXPLICIT_CONFIRMATION_REQUIRED'));
 if(inspection!==null&&!validInspection(inspection))return Promise.reject(Error('PDF_SOURCE_MISMATCH'));
 const review=inspection===null?null:Object.freeze({...inspection});
 const mine=epoch,start=clock(),deadline=start+LIMITS.timeoutMs;
 return new Promise((resolve,reject)=>{const r={reject,timer:null,frame:null,port:null};active=r;const check=()=>{if(active!==r||mine!==epoch||destroyed)throw Error('PDF_CANCELLED');if(clock()>=deadline||clock()<start)throw Error('PDF_TIMEOUT');if(!equal(bound,getContext()))throw Error('SOURCE_CHANGED')};let bound;
 const fail=e=>{if(active!==r)return;cleanup(r);reject(e)};
 r.timer=setTimeout(()=>fail(Error('PDF_TIMEOUT')),LIMITS.timeoutMs);
 (async()=>{bound=snapshot(context);check();const isFile=typeof File==='function'&&input instanceof File;
 if(!isFile&&(!input||Object.keys(input).sort().join('|')!=='bytes|mimeType|name'||!(input.bytes instanceof Uint8Array)))throw Error('INVALID_INPUT');
 const name=input.name,mimeType=isFile?input.type:input.mimeType,size=isFile?input.size:input.bytes.byteLength;
 if(typeof name!=='string'||!name.length||name.length>255||/[\x00-\x1f\x7f/\\]/.test(name))throw Error('INVALID_FILENAME');
 if(mimeType!=='application/pdf')throw Error('PDF_MIME_REQUIRED');
 if(!Number.isInteger(size)||size<1||size>LIMITS.maxBytes)throw Error('PDF_SIZE_LIMIT');
 const bytes=isFile?new Uint8Array(await input.arrayBuffer()):input.bytes.slice();check();if(bytes.length!==size)throw Error('INPUT_CHANGED');checkBytes(bytes);
 const sha256=await digest(bytes,crypto);check();
 if(review&&sha256!==review.pdfSha256)throw Error('PDF_SOURCE_MISMATCH');
 const config={schema:SCHEMA,type:'INIT',requestId:crypto.randomUUID(),parentOrigin:origin,deadline,sha256,byteLength:size,mimeType};
 r.config=config;const channel=new MessageChannel(),frame=document.createElement('iframe');r.port=channel.port1;r.port2=channel.port2;r.frame=frame;frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.hidden=true;frame.title=review?.mapOnly?'受限 PDF 页区间核对':review?'受限 PDF 原页核对':'受限 PDF 文本提取';
 let finalReceived=false;
 channel.port1.onmessage=async e=>{
  if(active!==r||mine!==epoch||finalReceived)return;
  if(e.data?.type==="PROGRESS"&&e.data.requestId===config.requestId){
   const {page,pages}=e.data;
   if(Number.isInteger(page)&&Number.isInteger(pages)&&page>=1&&page<=pages&&pages<=LIMITS.maxPages)onProgress?.({page,pages});
   return;
  }
  finalReceived=true;

  try{
   check();
   if(!validFinal(e.data,config,review))throw Error('INVALID_RESPONSE');
   if(e.data.code!=='OK')throw Error(e.data.code);
   const parsed=e.data.result;
   const textSha256=await digest(new TextEncoder().encode(parsed.text),crypto);
   check();
   if(review){
    if(textSha256!==review.textSha256)throw Error('PDF_SOURCE_MISMATCH');
    const evidence=review.mapOnly?{pageSpans:parsed.pageSpans}
     :{pageImage:parsed.pageImage,...pdfExcerptLocation(parsed,review.start,review.end)};
    cleanup(r);
    resolve({text:parsed.text,pdfSha256:sha256,textSha256,byteLength:size,documentPages:parsed.pages,
     pagesRead:parsed.pagesRead,truncated:parsed.truncated,...evidence});
    return;
   }
   const preview=Object.freeze({status:'prepared',text:parsed.text,pageSpans:Object.freeze(parsed.pageSpans.map(Object.freeze)),context:bound,metadata:Object.freeze({name,mimeType,byteLength:size,pdfSha256:sha256,textSha256,pages:parsed.pages,pagesRead:parsed.pagesRead,truncated:parsed.truncated,ocrPerformed:false,actualExecutor:parsed.actualExecutor,limits:LIMITS,authority:'unreviewed-local-extraction',binaryRetained:false})});
   issued.set(preview,{epoch:mine,used:false});
   cleanup(r);resolve(preview);
  }catch(error){fail(error)}
 };
 channel.port1.start();
 frame.onload=()=>{
  if(active!==r||mine!==epoch)return;
  frame.onload=null;
  try{
   check();
   frame.contentWindow.postMessage(config,'*',[channel.port2]);
   channel.port1.postMessage({
    schema:SCHEMA,type:review?'INSPECT_PAGE':'PARSE',requestId:config.requestId,sha256,byteLength:size,mimeType,bytes:bytes.buffer,
    ...(review?{inspection:review}:{}),
   },[bytes.buffer]);
  }catch(error){fail(error)}
 };
 frame.srcdoc=makeSrcdoc({bundle,scriptHash});check();mount.append(frame);
 })().catch(fail);
 });
 }
 return Object.freeze({run,cancel,destroy(){cancel();destroyed=true},assertCurrent,consume});
}
