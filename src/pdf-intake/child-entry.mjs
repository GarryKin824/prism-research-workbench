import {SCHEMA,EXECUTOR,ERRORS,keys,validInit,validParse,digest} from './protocol.mjs';
import {checkBytes,LIMITS} from './policy.mjs';import {parseBytes} from './parser.mjs';
const deny=()=>{throw Error('NETWORK_DISABLED')};for(const k of ['fetch','XMLHttpRequest','WebSocket','EventSource','SharedWorker','open'])Object.defineProperty(globalThis,k,{value:deny,writable:false,configurable:false});for(const k of ['localStorage','sessionStorage','indexedDB'])Object.defineProperty(globalThis,k,{get:deny,configurable:false});if(navigator.sendBeacon)Object.defineProperty(navigator,'sendBeacon',{value:deny,writable:false,configurable:false});
let connected=false;const abort=new AbortController();addEventListener('pagehide',()=>abort.abort());
addEventListener('message',e=>{
 if(connected||e.source!==parent||!validInit(e.data)||e.origin!==e.data.parentOrigin||e.ports.length!==1)return;
 connected=true;
 const c=e.data,p=e.ports[0];
 let used=false;
 const check=()=>{
  if(abort.signal.aborted)throw Error('PDF_CANCELLED');
  if(Date.now()>=c.deadline||c.deadline-Date.now()>LIMITS.timeoutMs)throw Error('PDF_TIMEOUT');
 };
 p.onmessage=async event=>{
  const x=event.data;
  if(keys(x,'schema,type,requestId')&&x.schema===SCHEMA&&x.type==='CANCEL'&&x.requestId===c.requestId){abort.abort();return}
  if(used)return;
  used=true;
  let code='OK',result=null;
  try{
   check();
   if(!validParse(x,c))throw Error('INVALID_REQUEST');
   const bytes=new Uint8Array(x.bytes);
   checkBytes(bytes);
   if(!crypto?.subtle)throw Error('OPAQUE_CRYPTO_UNAVAILABLE');
   if(await digest(bytes)!==c.sha256)throw Error('HASH_MISMATCH');
   check();
   const inspection=x.type==='INSPECT_PAGE'?x.inspection:null;
   result={...await parseBytes(bytes,{deadline:c.deadline,signal:abort.signal,inspection,onProgress:({page,pages})=>{if(page===1||page%5===0||page===pages)p.postMessage({type:"PROGRESS",requestId:c.requestId,page,pages})}}),ocrPerformed:false,actualExecutor:EXECUTOR};
   check();
  }catch(error){
   code=ERRORS.includes(error.message)?error.message:'PDF_PARSE_REJECTED';
   result=null;
  }finally{
   p.postMessage({schema:SCHEMA,type:'FINAL',requestId:c.requestId,sha256:c.sha256,byteLength:c.byteLength,code,result});
   p.close();
  }
 };
 p.start();
});
