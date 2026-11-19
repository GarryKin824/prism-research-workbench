/** Explicit public metadata search only. No automatic document, credential or email attachment; query text itself is transmitted verbatim after trimming. */
async function performCrossref(query,{fetch:fetcher=globalThis.fetch,signal,limit=5}={},gate) {
 const failure=code=>Object.assign(new Error(code),{code});
 if(typeof query!=='string'||!query.trim()||query.length>300||/[\x00-\x1f\x7f]/.test(query))throw failure('INVALID_QUERY');
 if(!Number.isInteger(limit)||limit<1||limit>10)throw failure('INVALID_LIMIT');
 if(typeof fetcher!=='function')throw failure('NETWORK_ERROR');
 query=query.trim();
 const controller=new AbortController();let timedOut=false,reader,fetchedResponse,bodyCancelled=false,rateLimitedError;
 const cancelResponseBody=()=>{if(!bodyCancelled&&fetchedResponse?.body?.cancel){bodyCancelled=true;try{gate.track(()=>fetchedResponse.body.cancel()).catch(()=>{})}catch{}}};
 const aborted=()=>controller.abort();
 if(signal?.aborted)throw failure('ABORTED');
 signal?.addEventListener('abort',aborted,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},8000);
 let rejectAbort;
 const abortPromise=new Promise((_,reject)=>{rejectAbort=()=>reject(failure(timedOut?'TIMEOUT':'ABORTED'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
 const maxBytes=1024*1024;
 function text(raw,max){
  if(typeof raw!=='string')return '';
  let s=raw.slice(0,Math.min(200000,max*8));
  s=s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ');
  s=s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,entity)=>{
   const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(entity[0]!=='#')return named[entity.toLowerCase()]||all;
   const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
   return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';
  });
  return s.replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
 }
 function doi(raw){if(typeof raw!=='string'||raw.length>500)return null;const s=raw.trim().toLowerCase();return /^10\.\d{4,9}\/[^\s<>?#]+$/.test(s)?s:null;}
 function link(raw){
  if(!raw||typeof raw.URL!=='string'||raw.URL.length>2000)return null;
  try{const url=new URL(raw.URL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return {url:url.href,type:text(raw['content-type'],60)||'unknown'};}catch{return null}
 }
 try{
  const url=new URL('https://api.crossref.org/works');url.searchParams.set('query',query);url.searchParams.set('rows',String(limit));url.searchParams.set('select','DOI,title,author,published,abstract,link');
  const response=await Promise.race([gate.track(()=>Promise.resolve(fetcher(url.href,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal})).then(response=>{fetchedResponse=response;if(controller.signal.aborted)cancelResponseBody();return response}),true),abortPromise]);
  if(controller.signal.aborted)throw failure(timedOut?'TIMEOUT':'ABORTED');
  if(response?.status===429){rateLimitedError=gate.rateError('CROSSREF_RATE_LIMITED');throw rateLimitedError;}
  if(!response||response.status!==200)throw failure('HTTP_ERROR');
  if(response.redirected)throw failure('INVALID_RESPONSE');
  if(response.url&&new URL(response.url).origin!=='https://api.crossref.org')throw failure('INVALID_RESPONSE');
  if(!response.headers?.get('content-type')?.toLowerCase().includes('application/json'))throw failure('INVALID_RESPONSE');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw failure(Number(length)>maxBytes?'RESPONSE_TOO_LARGE':'INVALID_RESPONSE');
  if(!response.body?.getReader)throw failure('INVALID_RESPONSE');
  reader=response.body.getReader();let bytes=0;const chunks=[];
  while(true){const part=await Promise.race([gate.track(()=>reader.read()),abortPromise]);if(part.done)break;if(!(part.value instanceof Uint8Array))throw failure('INVALID_RESPONSE');bytes+=part.value.byteLength;if(bytes>maxBytes)throw failure('RESPONSE_TOO_LARGE');chunks.push(part.value);}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}catch{throw failure('INVALID_RESPONSE')}
  if(body?.status!=='ok'||body['message-type']!=='work-list'||!Array.isArray(body.message?.items))throw failure('INVALID_RESPONSE');
  const items=[],seen=new Set(),retrievedAt=new Date().toISOString();
  for(const work of body.message.items.slice(0,10)){
   if(!work||typeof work!=='object')continue;const id=doi(work.DOI);if(!id||seen.has(id))continue;seen.add(id);
   const authors=Array.isArray(work.author)?work.author.slice(0,20).map(a=>a&&typeof a==='object'?text([a.given,a.family].filter(v=>typeof v==='string').join(' ')||a.name,300):'').filter(Boolean):[];
   const year=work.published?.['date-parts']?.[0]?.[0];
   const links=[],linkSeen=new Set();for(const raw of Array.isArray(work.link)?work.link.slice(0,30):[]){const l=link(raw);if(l&&!linkSeen.has(l.url)){linkSeen.add(l.url);links.push(l)}if(links.length===10)break;}
   items.push({doi:id,title:text(Array.isArray(work.title)?work.title[0]:'',500)||'标题未提供',authors,year:Number.isInteger(year)&&year>=1000&&year<=3000?year:null,abstract:text(work.abstract,12000),links,retrievedAt,query});
   if(items.length===limit)break;
  }
  if(controller.signal.aborted)throw failure(timedOut?'TIMEOUT':'ABORTED');
  return {query,provider:'Crossref',items,fullTextRead:false,dataAvailability:'unknown',codeAvailability:'unknown'};
 }catch(e){
  if(controller.signal.aborted)throw failure(timedOut?'TIMEOUT':'ABORTED');
  if(rateLimitedError&&e===rateLimitedError)throw rateLimitedError;
  if(['HTTP_ERROR','RESPONSE_TOO_LARGE','INVALID_RESPONSE'].includes(e?.code))throw failure(e.code);
  throw failure('NETWORK_ERROR');
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',aborted);controller.signal.removeEventListener('abort',rejectAbort);
  if(reader){try{gate.track(()=>reader.cancel()).catch(()=>{})}catch{}try{reader.releaseLock()}catch{}}else cancelResponseBody();
 }
}

/** Per-module gate only: no storage, cross-tab coordination, retry, or queued request. */
export function createCrossrefSearch({now=()=>globalThis.performance?.now?.()??Date.now(),wallNow=()=>Date.now()}={}) {
 let busy=false,nextAllowed=-Infinity;
 const error=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
 function clock(){const n=now();if(!Number.isFinite(n))throw error('CLOCK_UNAVAILABLE');return n}
 function rateError(code='RATE_LIMITED'){return error(code,{retryAfterMs:Math.max(0,Math.ceil(nextAllowed-clock()))})}
 function observeResponse(response){
  if(response?.status!==429)return;
  let value;try{value=response.headers?.get('retry-after')}catch{}
  let delay=60000;
  if(typeof value==='string'){
   const v=value.trim();
   if(/^\d+$/.test(v)){const n=Number(v)*1000;if(Number.isSafeInteger(n))delay=n;}
   else if(/^[A-Za-z]{3}, /.test(v)){const date=Date.parse(v),wall=wallNow();if(Number.isFinite(date)&&Number.isFinite(wall))delay=Math.max(0,date-wall);}
  }
  nextAllowed=Math.max(nextAllowed,clock()+delay);
 }
 return async function search(query,options={}){
  // Invalid input and already-aborted calls never acquire a network slot.
  if(typeof query!=='string'||!query.trim()||query.length>300||/[\x00-\x1f\x7f]/.test(query))throw error('INVALID_QUERY');
  const limit=options.limit??5;if(!Number.isInteger(limit)||limit<1||limit>10)throw error('INVALID_LIMIT');
  if(options.signal?.aborted)throw error('ABORTED');
  if(typeof(options.fetch??globalThis.fetch)!=='function')throw error('NETWORK_ERROR');
  if(busy)throw error('SEARCH_BUSY');
  const t=clock();if(t<nextAllowed)throw rateError();
  busy=true;nextAllowed=t+1000;
  let pending=0,finished=false;
  function release(){if(finished&&pending===0)busy=false}
  function track(fn,response=false){
   pending++;
   let raw;try{raw=Promise.resolve(fn())}catch(e){raw=Promise.reject(e)}
   const p=raw.then(v=>{if(response)observeResponse(v);return v});
   // Track real fetch/read/cancel settlement, not Promise.race cancellation.
   p.then(()=>{pending--;release()},()=>{pending--;release()});return p;
  }
  try{return await performCrossref(query,options,{track,rateError})}
  finally{finished=true;release()}
 };
}
export const searchCrossref=createCrossrefSearch();
