import { searchCrossref } from './discovery.js';

const CANDIDATE='prism-discovery-candidate/v1';
const sid=/^[a-z][a-z0-9-]{0,39}$/;
const controls=/[\x00-\x1f\x7f-\x9f]/;
const fail=code=>Object.assign(new Error(code),{code});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const dataObject=v=>plain(v)&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const exact=(v,keys)=>dataObject(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const dataArray=v=>Array.isArray(v)&&Reflect.ownKeys(v).length===v.length+1&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/.test(k)&&Number(k)<v.length)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const loneSurrogate=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const str=(v,max,empty=true)=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())&&!controls.test(v)&&!loneSurrogate.test(v);
const clean=(v,max)=>typeof v==='string'&&!loneSurrogate.test(v)?v.slice(0,max*8).replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max).replace(/[\uD800-\uDBFF]$/u,''):'';
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
function doi(v){
 if(!str(v,1000,false))return null;let n=v.trim();
 try{if(/^https?:\/\//i.test(n)){const u=new URL(n);if(!['doi.org','dx.doi.org'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port)return null;n=u.pathname.slice(1)}else n=n.replace(/^doi:\s*/i,'');n=decodeURIComponent(n).toLowerCase()}catch{return null}
 return str(n,500,false)&&/^10\.\d{4,9}\/[^\s<>?#]+$/.test(n)?n:null;
}
function validLink(v){if(!exact(v,['url','type'])||!str(v.url,2000,false)||!str(v.type,60,false))return false;try{const u=new URL(v.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.href===v.url}catch{return false}}
function links(v){if(!dataArray(v))return [];const seen=new Set();return v.slice(0,30).flatMap(l=>{if(!dataObject(l)||typeof l.url!=='string'||l.url.length>2000)return [];try{const n={url:new URL(l.url).href,type:clean(l.type,60)||'unknown'};if(!validLink(n)||seen.has(n.url))return [];seen.add(n.url);return [n]}catch{return []}}).slice(0,10)}
const identity=(simulation,d,sourceId,recordId)=>`${simulation?'synthetic':'public'}:${d?`doi:${d}`:`record:${sourceId}:${recordId}`}`;

export function validateDiscoveryCandidate(c){
 if(!exact(c,['schema','id','identity','doi','title','authors','year','abstract','links','provenance','simulation','conflicts','possibleDuplicateIds']))return false;
 const local=c.schema==='prism-discovery-candidate/v2';
 if((c.schema!==CANDIDATE&&!local)||(local&&c.simulation!==false)||typeof c.id!=='string'||!/^candidate-[1-9]\d*$/.test(c.id)||typeof c.simulation!=='boolean'||!(c.doi===null||(doi(c.doi)===c.doi))||!str(c.title,500,false)||!(local?typeof c.abstract==='string'&&c.abstract.length<=12000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(c.abstract)&&!loneSurrogate.test(c.abstract):str(c.abstract,12000)))return false;
 if(!dataArray(c.authors)||c.authors.length>20||!c.authors.every(a=>str(a,300,false))||!(c.year===null||Number.isInteger(c.year)&&c.year>=1000&&c.year<=3000))return false;
 if(!dataArray(c.links)||c.links.length>10||!c.links.every(validLink)||new Set(c.links.map(l=>l.url)).size!==c.links.length)return false;
 if(!dataArray(c.provenance)||!c.provenance.length||c.provenance.length>10||!c.provenance.every(p=>exact(p,['sourceId','sourceLabel','mode','recordId','retrievedAt','query'])&&sid.test(p.sourceId)&&str(p.sourceId,40,false)&&str(p.sourceLabel,100,false)&&p.mode===(local?'local-file':c.simulation?'synthetic':'public-metadata')&&(local?['ris-file','bibtex-file'].includes(p.sourceId)&&/^sha256:[a-f0-9]{64}:[1-9]\d*$/.test(p.recordId):true)&&str(p.recordId,200,false)&&iso(p.retrievedAt)&&str(p.query,300,false)))return false;
 const p=c.provenance[0];if(c.identity!==(local?`local:${c.doi?`doi:${c.doi}`:`record:${p.sourceId}:${p.recordId}`}`:identity(c.simulation,c.doi,p.sourceId,p.recordId)))return false;
 if(!dataArray(c.conflicts)||!c.conflicts.every(f=>['title','authors','year','abstract','links'].includes(f))||new Set(c.conflicts).size!==c.conflicts.length)return false;
 return Array.isArray(c.possibleDuplicateIds)&&c.possibleDuplicateIds.length<=49&&new Set(c.possibleDuplicateIds).size===c.possibleDuplicateIds.length&&c.possibleDuplicateIds.every(id=>typeof id==='string'&&/^candidate-[1-9]\d*$/.test(id)&&id!==c.id);
}

export function normalizeDiscoveryItems(rawBatches,{query,createdAt}){
 if(!str(query,300,false)||!iso(createdAt)||!dataArray(rawBatches)||rawBatches.length>5)throw fail('INVALID_INPUT');
 const items=[],byIdentity=new Map();
 for(const batch of rawBatches){if(!exact(batch,['source','items']))throw fail('INVALID_RESPONSE');const {source,items:raw}=batch;if(!dataObject(source)||!str(source.id,40,false)||!sid.test(source.id)||!str(source.label,100,false)||!['synthetic','public-metadata'].includes(source.mode)||!dataArray(raw))throw fail('INVALID_RESPONSE');
 for(const r of raw.slice(0,10)){
  if(!dataObject(r)||!str(r.recordId,200,false))continue;
  const d=doi(r.doi),simulation=source.mode==='synthetic';
  const c={schema:CANDIDATE,id:`candidate-${items.length+1}`,identity:identity(simulation,d,source.id,r.recordId),doi:d,title:clean(r.title,500)||'Title unavailable',authors:dataArray(r.authors)?r.authors.slice(0,20).map(a=>clean(a,300)).filter(Boolean):[],year:Number.isInteger(r.year)&&r.year>=1000&&r.year<=3000?r.year:null,abstract:clean(r.abstract,12000),links:links(r.links),provenance:[{sourceId:source.id,sourceLabel:source.label,mode:source.mode,recordId:r.recordId,retrievedAt:createdAt,query}],simulation,conflicts:[],possibleDuplicateIds:[]};
  const old=byIdentity.get(c.identity);
  if(old){for(const field of ['title','authors','year','abstract','links'])if(JSON.stringify(old[field])!==JSON.stringify(c[field])&&!old.conflicts.includes(field))old.conflicts.push(field);if(old.provenance.length<10&&!old.provenance.some(p=>p.sourceId===source.id&&p.recordId===r.recordId))old.provenance.push(c.provenance[0]);}
  else{items.push(c);byIdentity.set(c.identity,c)}
 }
 }
 const key=c=>[c.simulation,clean(c.title,500).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''),c.year,clean(c.authors[0],300).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')].join('|');
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(key(items[i])===key(items[j])){items[i].possibleDuplicateIds.push(items[j].id);items[j].possibleDuplicateIds.push(items[i].id)}
 return freeze(items);
}

export function createDefaultDiscoverySources({crossrefSearch=searchCrossref}={}){
 const fixture=(id,title,year,recordId,doiValue)=>({recordId,doi:doiValue,title,authors:['Synthetic Example Author'],year,abstract:'Deterministic synthetic fixture. Not a research finding.',links:[]});
 return [
 {id:'crossref',label:'Crossref public metadata',mode:'public-metadata',network:true,status:'implemented',async search(query,{limit,signal}){const result=await crossrefSearch(query,{limit,signal});if(!Array.isArray(result?.items))throw fail('INVALID_RESPONSE');return result.items.map((r,i)=>({...r,recordId:r.doi||`crossref-${i+1}`}))}},
 {id:'synthetic-a',label:'Synthetic demonstration A (fixture only)',mode:'synthetic',network:false,status:'fixture-only',async search(query,{limit}){return [fixture('a','Synthetic reproducibility example',2024,'a-1','10.9999/synthetic-demo'),fixture('a','Synthetic record without DOI',2025,'a-2',null)].slice(0,limit)}},
 {id:'synthetic-b',label:'Synthetic demonstration B (fixture only)',mode:'synthetic',network:false,status:'fixture-only',async search(query,{limit}){return [fixture('b','Synthetic conflicting title',2023,'b-1','https://doi.org/10.9999/SYNTHETIC-DEMO'),fixture('b','Synthetic record without DOI',2025,'b-2',null)].slice(0,limit)}}
 ];
}

export function createDiscoverySearch({sources,crypto=globalThis.crypto,timeoutMs=10000}={}){
 if(!dataArray(sources)||!sources.length||sources.length>50||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw fail('INVALID_SOURCES');
 const registry=new Map();
 for(const s of sources){if(!dataObject(s)||!str(s.id,40,false)||!sid.test(s.id)||registry.has(s.id)||!str(s.label,100,false)||!['public-metadata','synthetic'].includes(s.mode)||typeof s.network!=='boolean'||!['implemented','fixture-only'].includes(s.status)||typeof s.search!=='function'||s.mode==='synthetic'&&(s.network||s.status!=='fixture-only')||s.mode==='public-metadata'&&(!s.network||s.status!=='implemented'))throw fail('INVALID_SOURCES');registry.set(s.id,{id:s.id,label:s.label,mode:s.mode,network:s.network,status:s.status,search:s.search})}
 let closed=false,busy=false,pending=0,current;
 const safeCodes=new Set(['ABORTED','TIMEOUT','NETWORK_ERROR','HTTP_ERROR','INVALID_RESPONSE','RESPONSE_TOO_LARGE','SEARCH_BUSY','RATE_LIMITED','CROSSREF_RATE_LIMITED','CLOCK_UNAVAILABLE']);
 return {
 listSources(){return freeze([...registry.values()].map(({search,...metadata})=>metadata))},
 close(){closed=true;current?.abort()},
 async search({query,sourceIds,limitPerSource=10,explicitNetwork=false}={}, {signal}={}){
  if(closed)throw fail('DISCOVERY_CLOSED');if(busy||pending)throw fail('SEARCH_BUSY');
  if(!str(query,300,false))throw fail('INVALID_QUERY');query=query.trim();
  if(!Array.isArray(sourceIds)||sourceIds.length<1||sourceIds.length>5||new Set(sourceIds).size!==sourceIds.length||!sourceIds.every(id=>registry.has(id)))throw fail('INVALID_SOURCES');
  if(!Number.isInteger(limitPerSource)||limitPerSource<1||limitPerSource>10)throw fail('INVALID_LIMIT');
  if(sourceIds.some(id=>registry.get(id).network)&&explicitNetwork!==true)throw fail('NETWORK_CONSENT_REQUIRED');
  if(signal?.aborted)throw fail('ABORTED');
  busy=true;current=new AbortController();const controller=current;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const createdAt=new Date().toISOString(),sourceStatuses=[],batches=[];let stopped=false;
  try{
   for(const id of sourceIds){const source=registry.get(id);let timer,onAbort,local;
    try{
     if(controller.signal.aborted)throw fail('ABORTED');if(stopped)throw fail('SEARCH_BUSY');
     local=new AbortController();const cancelled=new Promise((_,reject)=>{onAbort=()=>{local.abort();reject(fail('ABORTED'))};controller.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{stopped=true;local.abort();reject(fail('TIMEOUT'))},timeoutMs)});
     pending++;const actual=Promise.resolve().then(()=>{if(local.signal.aborted)throw fail('ABORTED');return source.search(query,{limit:limitPerSource,signal:local.signal})});actual.then(()=>pending--,()=>pending--);
     const raw=await Promise.race([actual,cancelled]);if(controller.signal.aborted||local.signal.aborted)throw fail('ABORTED');
     if(!dataArray(raw))throw fail('INVALID_RESPONSE');const normalized=normalizeDiscoveryItems([{source,items:raw.slice(0,limitPerSource)}],{query,createdAt});
     if(raw.length&&normalized.length===0)throw fail('INVALID_RESPONSE');
     batches.push({source,items:raw.slice(0,limitPerSource)});sourceStatuses.push({sourceId:id,label:source.label,mode:source.mode,status:'success',count:normalized.length,error:null});
    }catch(e){sourceStatuses.push({sourceId:id,label:source.label,mode:source.mode,status:'error',count:0,error:safeCodes.has(e?.code)?e.code:'SOURCE_ERROR'})}
    finally{clearTimeout(timer);if(onAbort)controller.signal.removeEventListener('abort',onAbort)}
   }
   if(controller.signal.aborted)throw fail('ABORTED');
   if(!batches.length)throw Object.assign(fail('DISCOVERY_ALL_SOURCES_FAILED'),{sourceStatuses:freeze(sourceStatuses)});
   return freeze({schema:'prism-discovery-results/v1',query,createdAt,sourceStatuses,items:normalizeDiscoveryItems(batches,{query,createdAt}),simulationOnly:batches.every(b=>b.source.mode==='synthetic'),fullTextRead:false,researchVerified:false,executionAllowed:false});
  }finally{signal?.removeEventListener('abort',abort);busy=false;current=null}
 }
 };
}

export function filterDiscoveryCandidates(items,filters={},papers=[]){
 if(!dataArray(items)||items.length>50||!items.every(validateDiscoveryCandidate)||!dataObject(filters)||!dataArray(papers))throw fail('INVALID_FILTERS');
 const {text='',yearFrom=null,yearTo=null,requireAbstract=false,sourceIds=[],hideKnown=false}=filters;
 const validYear=y=>y===null||Number.isInteger(y)&&y>=1000&&y<=3000;
 if(!str(text,300)||!validYear(yearFrom)||!validYear(yearTo)||yearFrom!==null&&yearTo!==null&&yearFrom>yearTo||typeof requireAbstract!=='boolean'||typeof hideKnown!=='boolean'||!dataArray(sourceIds)||sourceIds.length>5||!sourceIds.every(id=>str(id,40,false)&&sid.test(id))||new Set(sourceIds).size!==sourceIds.length)throw fail('INVALID_FILTERS');
 const words=String(text).toLowerCase().split(/\s+/).filter(Boolean),existingMatches=[];
 const known=new Set();
 for(const c of items){const paper=papers.find(p=>p?.metadata?.discovery?.identity===c.identity||(!c.simulation&&c.doi&&[p?.doi,p?.source,p?.metadata?.doi,p?.metadata?.crossref?.doi].some(d=>doi(d)===c.doi)&&p?.metadata?.discovery?.simulation!==true));if(paper){known.add(c.id);existingMatches.push({candidateId:c.id,paperId:paper.id})}}
 const filtered=items.filter(c=>words.every(w=>[c.title,...c.authors,c.abstract].join(' ').toLowerCase().includes(w))&&(yearFrom===null||c.year!==null&&c.year>=yearFrom)&&(yearTo===null||c.year!==null&&c.year<=yearTo)&&(!requireAbstract||!!c.abstract.trim())&&(!sourceIds.length||c.provenance.some(p=>sourceIds.includes(p.sourceId)))&&(!hideKnown||!known.has(c.id)));
 return {items:filtered,total:items.length,knownCount:known.size,existingMatches};
}
