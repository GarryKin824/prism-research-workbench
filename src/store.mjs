/** Local simulation only. No network, execution bridge, filesystem or global fetch changes. */
import {assertDocumentAttachmentShape,validateDocumentAttachment,normalizePaperDocument} from './document-attachment-core.mjs';
import {assertScopeEditable} from './project-execution-owner.mjs';
import {importQueue,queueView} from './library-core.mjs';
import {normalizeDoi,validateZoteroMetadata,zoteroDuplicate,zoteroSourceLabel} from './zotero-import-core.mjs';
export function createStore(options={}) {
 let storage;try{storage=Object.hasOwn(options,'storage')?options.storage:globalThis.localStorage}catch{}
 const crypto=Object.hasOwn(options,'crypto')?options.crypto:globalThis.crypto;
 const schedule=options.schedule??((fn)=>setTimeout(fn,250)), key=options.key??'prism-native-v01';
 const clone=x=>JSON.parse(JSON.stringify(x)), now=()=>new Date().toISOString();
 const error=code=>{throw Object.assign(new Error(code),{code})};
 const listeners=new Set();let serial=0, snapshot, mem, persistedRevision=null, persistedRaw=null, destroyed=false, writeOutcomeUnknown=false;
 const uid=()=>`${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2,10)}`;
 const defaults=['提取论文研究问题、数据来源与复现限制。','使用合成示例演示，记录观察到的变化。','审核指定结果的分母记录，说明尚未核验真实数据。'];
 const validText=(s,n)=>typeof s==='string'&&s.length<=n;
 const statuses=new Set(['ready','blocked','running','completed','passed','needs_revision','interrupted']);
 const runStates=new Set(['running','completed','cancelled','interrupted']);
 const uint=n=>Number.isSafeInteger(n)&&n>=0;
 const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v)}return x};
 const fresh=()=>({schema:1,revision:0,papers:[]});
 function documentData(d,loaded=false){return normalizePaperDocument(d,{loaded})}
 // Match the discovery preview's legacy DOI paths without relaxing load validation.
 const paperHasDoi=(p,doi)=>[p.doi,p.source,p.metadata?.doi,p.metadata?.crossref?.doi].some(value=>normalizeDoi(value)===doi);
 function metadataData(c,loaded=false){
  if(!c||typeof c!=='object'||Array.isArray(c))error('INVALID_CANDIDATE');
  if(!loaded&&Object.keys(c).some(k=>!['doi','title','authors','year','abstract','links','retrievedAt','query'].includes(k)))error('INVALID_CANDIDATE');
  const doi=normalizeDoi(c.doi);if(!doi)error('INVALID_DOI');
  const authors=c.authors??[],year=c.year??null,abstract=c.abstract??'',links=c.links??[],query=c.query??'';
  if(!Array.isArray(authors)||authors.length>20||authors.some(a=>!validText(a,300)||!a.trim())||year!==null&&(!Number.isInteger(year)||year<1000||year>9999)||!validText(abstract,12000)||!validText(query,600)||!Array.isArray(links)||links.length>10)error('INVALID_CANDIDATE_METADATA');
  const safeLinks=links.map(link=>{
   if(!link||typeof link!=='object'||Array.isArray(link)||Object.keys(link).some(k=>!['url','type'].includes(k))||!validText(link.url,2000)||!validText(link.type,60)||/[\x00-\x20\x7f]/.test(link.url))error('INVALID_CANDIDATE_LINK');
   let url;try{url=new URL(link.url)}catch{error('INVALID_CANDIDATE_LINK')}
   if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)error('INVALID_CANDIDATE_LINK');
   return {url:link.url,type:link.type};
  });
  const retrievedAt=c.retrievedAt??now();
  if(!validText(retrievedAt,40)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(retrievedAt)||!Number.isFinite(Date.parse(retrievedAt))||new Date(retrievedAt).toISOString().slice(0,19)!==retrievedAt.slice(0,19))error('INVALID_CANDIDATE_METADATA');
  if(c.provider!==undefined&&c.provider!=='Crossref'||c.fullTextRead!==undefined&&c.fullTextRead!==false||c.fulltextVerified!==undefined&&c.fulltextVerified!==false||c.dataAvailability!==undefined&&c.dataAvailability!=='unknown'||c.codeAvailability!==undefined&&c.codeAvailability!=='unknown')error('INVALID_CANDIDATE_METADATA');
  if(c.sourceURL!==undefined&&normalizeDoi(c.sourceURL)!==doi)error('INVALID_CANDIDATE_METADATA');
  const metadata={provider:'Crossref',doi,authors:authors.map(a=>a.trim()),year,abstract,links:safeLinks,retrievedAt,query,sourceURL:'https://doi.org/'+doi,scope:'bibliographic-metadata-only',fulltextVerified:false,fullTextRead:false,dataAvailability:'unknown',codeAvailability:'unknown'};
  if(loaded){
   if(Object.keys(c).some(k=>!Object.hasOwn(metadata,k))||Object.keys(metadata).some(k=>!Object.hasOwn(c,k))||c.doi!==doi||c.provider!=='Crossref'||c.scope!==metadata.scope||c.sourceURL!==metadata.sourceURL)error('INVALID_CANDIDATE_METADATA');
  }
  return metadata;
 }
 // Search intake has a separate exact schema. Keep legacy Crossref metadata untouched.
 function exactFields(x,fields){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==fields.length||fields.some(k=>!Object.hasOwn(x,k)))error('INVALID_SEARCH_CANDIDATE');}
 function searchText(s,n,lines=false){
  if(!validText(s,n)||(lines?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/:/[\x00-\x1f\x7f-\x9f]/).test(s))return false;
  for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=s.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
 }
 function searchMetadata(c,local=false){
  if(local&&c.simulation!==false)error('INVALID_SEARCH_CANDIDATE');
  if(typeof c.simulation!=='boolean'||!(c.doi===null||searchText(c.doi,500)&&normalizeDoi(c.doi)===c.doi))error('INVALID_SEARCH_CANDIDATE');
  if(!Array.isArray(c.authors)||c.authors.length>20||c.authors.some(a=>!searchText(a,300)||!a.trim())||c.year!==null&&(!Number.isInteger(c.year)||c.year<1000||c.year>3000)||!searchText(c.abstract,12000,true)||!Array.isArray(c.links)||c.links.length>10)error('INVALID_SEARCH_CANDIDATE');
  for(const link of c.links){exactFields(link,['url','type']);if(!searchText(link.url,2000)||!searchText(link.type,60)||/\s/.test(link.url))error('INVALID_SEARCH_CANDIDATE');let u;try{u=new URL(link.url)}catch{error('INVALID_SEARCH_CANDIDATE')}if(!['https:','http:'].includes(u.protocol)||!u.hostname||u.username||u.password)error('INVALID_SEARCH_CANDIDATE');}
  if(!Array.isArray(c.provenance)||c.provenance.length<1||c.provenance.length>10)error('INVALID_SEARCH_PROVENANCE');
  for(const v of c.provenance){
   exactFields(v,['sourceId','sourceLabel','mode','recordId','retrievedAt','query']);
   if(!searchText(v.sourceId,40)||!(/^[a-z][a-z0-9-]{0,39}$/).test(v.sourceId)||!searchText(v.sourceLabel,100)||!v.sourceLabel.trim()||v.mode!==(local?'local-file':c.simulation?'synthetic':'public-metadata')||local&&(!['ris-file','bibtex-file'].includes(v.sourceId)||!/^sha256:[a-f0-9]{64}:[1-9]\d*$/.test(v.recordId))||!searchText(v.recordId,200)||!v.recordId.trim()||!searchText(v.query,300)||!searchText(v.retrievedAt,40)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.retrievedAt)||!Number.isFinite(Date.parse(v.retrievedAt))||new Date(v.retrievedAt).toISOString().slice(0,19)!==v.retrievedAt.slice(0,19))error('INVALID_SEARCH_PROVENANCE');
  }
  const first=c.provenance[0],partition=local?'local':c.simulation?'synthetic':'public',identity=c.doi===null?`${partition}:record:${first.sourceId}:${first.recordId}`:`${partition}:doi:${c.doi}`;
  if(c.identity!==identity||!Array.isArray(c.conflicts)||c.conflicts.length>5||new Set(c.conflicts).size!==c.conflicts.length||c.conflicts.some(f=>!['title','authors','year','abstract','links'].includes(f)))error('INVALID_SEARCH_PROVENANCE');
  return clone({provider:local?'PRISM Imported References':'PRISM Search',doi:c.doi,authors:c.authors,year:c.year,abstract:c.abstract,links:c.links,retrievedAt:first.retrievedAt,query:first.query,sourceURL:c.doi?'https://doi.org/'+c.doi:c.links.find(link=>link.url.length<=1000)?.url??'',scope:'bibliographic-metadata-only',fulltextVerified:false,fullTextRead:false,dataAvailability:'unknown',codeAvailability:'unknown',discovery:{schema:local?'prism-search-provenance/v2':'prism-search-provenance/v1',identity,simulation:c.simulation,provenance:c.provenance,conflicts:c.conflicts}});
 }
 function searchCandidate(c){
  exactFields(c,['schema','id','identity','doi','title','authors','year','abstract','links','provenance','simulation','conflicts','possibleDuplicateIds']);
  if(!['prism-discovery-candidate/v1','prism-discovery-candidate/v2'].includes(c.schema)||!/^candidate-[1-9][0-9]*$/.test(c.id)||!searchText(c.id,100)||!searchText(c.title,500)||!c.title.trim()||!Array.isArray(c.possibleDuplicateIds)||c.possibleDuplicateIds.length>50||c.possibleDuplicateIds.some(id=>!searchText(id,100)||!/^candidate-[1-9][0-9]*$/.test(id)))error('INVALID_SEARCH_CANDIDATE');
  return {title:c.title,metadata:searchMetadata(c,c.schema==='prism-discovery-candidate/v2')};
 }
 function loadedSearchMetadata(c){
  exactFields(c,['provider','doi','authors','year','abstract','links','retrievedAt','query','sourceURL','scope','fulltextVerified','fullTextRead','dataAvailability','codeAvailability','discovery']);
  exactFields(c.discovery,['schema','identity','simulation','provenance','conflicts']);
  if(!['prism-search-provenance/v1','prism-search-provenance/v2'].includes(c.discovery.schema))error('INVALID_SEARCH_PROVENANCE');
  const expected=searchMetadata({...c,...c.discovery},c.discovery.schema==='prism-search-provenance/v2');
  for(const k of ['provider','retrievedAt','query','sourceURL','scope','fulltextVerified','fullTextRead','dataAvailability','codeAvailability'])if(c[k]!==expected[k])error('INVALID_SEARCH_PROVENANCE');
  return expected;
 }
 function validate(x){
  if(!x||x.schema!==1||!uint(x.revision)||!Array.isArray(x.papers)||x.papers.length>100)error('INVALID_STORE');
  const ids=new Set();
  for(const p of x.papers){
   if(!validText(p.id,100)||!p.id||ids.has(p.id)||!validText(p.title,500)||!p.title.trim()||!validText(p.source,1000)||!Array.isArray(p.steps)||p.steps.length!==3||!Array.isArray(p.runs)||p.runs.length>100||!Array.isArray(p.events)||p.events.length>200)error('INVALID_STORE');ids.add(p.id);
   if(p.document!==undefined)documentData(p.document,true);
   if(p.documentAttachment!==undefined){const {oldPaper}=assertDocumentAttachmentShape(p);validate({schema:1,revision:0,papers:[oldPaper]});}
   if(p.metadata?.provider==='Zotero'){
    validateZoteroMetadata(p.metadata,p.document);
    if(p.source!==zoteroSourceLabel(p.metadata))error('INVALID_STORE');
   }else if(p.metadata!==undefined){const metadata=['PRISM Search','PRISM Imported References'].includes(p.metadata.provider)?loadedSearchMetadata(p.metadata):metadataData(p.metadata,true);if(['PRISM Search','PRISM Imported References'].includes(p.metadata.provider)&&!searchText(p.title,500))error('INVALID_STORE');if(p.source!==metadata.sourceURL)error('INVALID_STORE');}
   for(const s of p.steps){if(!validText(s.name,100)||!validText(s.prompt,16000)||!s.prompt.trim()||!uint(s.promptVersion)||s.promptVersion<1||!statuses.has(s.status)||!Array.isArray(s.history)||s.history.length>30||!(s.currentRunId===null||validText(s.currentRunId,100)))error('INVALID_STORE');for(const h of s.history)if(!uint(h.version)||!validText(h.prompt,16000)||!validText(h.time,40))error('INVALID_STORE');}
   const rids=new Set();for(const r of p.runs){if(!validText(r.id,100)||rids.has(r.id)||!uint(r.stepIndex)||r.stepIndex>2||!runStates.has(r.status)||!validText(r.prompt,16000)||!uint(r.promptVersion)||!Array.isArray(r.upstream)||r.upstream.length!==r.stepIndex||!Array.isArray(r.upstreamBindings)||r.upstreamBindings.length!==r.stepIndex||!Array.isArray(r.artifacts)||r.artifacts.length>1||!validText(r.started,40))error('INVALID_STORE');if(r.ended!==undefined&&!validText(r.ended,40)||r.errorCode!==undefined&&!validText(r.errorCode,100)||r.verdict!==undefined&&r.verdict!==null&&!['passed','needs_revision'].includes(r.verdict))error('INVALID_STORE');rids.add(r.id);for(const a of r.artifacts)if(!validText(a.content,100000)||!validText(a.name,100)||!/^([a-f0-9]{64})$/.test(a.sha256))error('INVALID_STORE');for(const u of r.upstream)if(!validText(u,100))error('INVALID_STORE');for(const b of r.upstreamBindings)if(!validText(b.id,100)||!uint(b.promptVersion)||!validText(b.prompt,16000)||!(/^[a-f0-9]{64}$/).test(b.sha256))error('INVALID_STORE');if(r.stepIndex===2&&(!validText(r.reviewedRun,100)||!(/^[a-f0-9]{64}$/).test(r.reviewedHash)))error('INVALID_STORE');}
   const byId=new Map(p.runs.map(r=>[r.id,r]));
   for(let i=0;i<p.steps.length;i++){const id=p.steps[i].currentRunId;if(id!==null&&byId.get(id)?.stepIndex!==i)error('INVALID_STORE');}
   for(const r of p.runs)for(let i=0;i<r.stepIndex;i++){
    const ancestor=byId.get(r.upstream[i]);
    if(!ancestor||ancestor.id===r.id||ancestor.stepIndex!==i||ancestor.stepIndex>=r.stepIndex||ancestor.status!=='completed'||r.upstreamBindings[i].id!==ancestor.id)error('INVALID_STORE');
   }
   for(const e of p.events)if(!validText(e.kind,60)||!validText(e.text,1000)||!validText(e.time,40))error('INVALID_STORE');
  }
 }
 let loadError=null;
 try{const raw=storage?.getItem(key);if(raw){if(raw.length>4000000)error('STORE_TOO_LARGE');mem=JSON.parse(raw);validate(mem);persistedRevision=mem.revision;persistedRaw=raw;}else mem=fresh();}catch{mem=fresh();loadError='INVALID_OR_UNAVAILABLE_STORAGE';}
 let restored=false,requiresReaccept=false;
 for(const p of mem.papers){if(p.accepted)requiresReaccept=true;p.accepted=null;for(const r of p.runs)if(r.status==='running'){r.status='interrupted';restored=true;}for(let i=0;i<3;i++)if(p.steps[i].status==='running'){p.steps[i].status='interrupted';p.steps.slice(i+1).forEach(s=>{s.status='blocked';s.currentRunId=null});restored=true;}}
 let verificationPending=false,verificationFailure=null;
 let persistence={saved:!!persistedRaw&&!loadError&&!restored&&!requiresReaccept,error:loadError||(restored||requiresReaccept?'RESTORED_STATE_NOT_SAVED':persistedRaw?null:'NOT_SAVED'),restoredInterrupted:restored,restoredRequiresReaccept:requiresReaccept};
 function publish(){snapshot=freeze({...clone(mem),persistence:{...persistence}});for(const fn of listeners){try{fn()}catch{}}}
 function persist(){
  // A successful setItem call alone is not a durability acknowledgement. Keep
  // the validated memory copy exportable even when the storage outcome is unknown.
  try{
   if(writeOutcomeUnknown)error('STORAGE_OUTCOME_UNKNOWN');
   if(!storage)error('STORAGE_UNAVAILABLE');
   const previous=storage.getItem(key);if(previous!==persistedRaw)error('STORAGE_CONFLICT');
   const data=JSON.stringify(mem);if(data.length>4000000)error('STORE_TOO_LARGE');checkInstanceOwner();
   let writeError=null;try{storage.setItem(key,data)}catch(e){writeError=e}
   let actual;try{actual=storage.getItem(key)}catch{writeOutcomeUnknown=true;error('STORAGE_OUTCOME_UNKNOWN')}
   if(actual===data){persistedRevision=mem.revision;persistedRaw=data;persistence={...persistence,saved:true,error:null};return}
   if(actual!==previous){writeOutcomeUnknown=true;error('STORAGE_OUTCOME_UNKNOWN')}
   error(writeError?'STORAGE_WRITE_FAILED':'STORAGE_WRITE_NOT_SAVED');
  }catch(e){persistence={...persistence,saved:false,error:e.code||'STORAGE_WRITE_FAILED'};}
 }
 function commit(next){checkInstanceOwner();next.revision=mem.revision+1;mem=next;persist();publish();}
 function commitAttachment(next){
  checkInstanceOwner();checkExternal();if(!storage)error('STORAGE_UNAVAILABLE');
  next.revision=mem.revision+1;const raw=JSON.stringify(next),before=persistedRaw;
  if(raw.length>4000000)error('STORE_TOO_LARGE');
  // One base-key write contains both the first document and complete old checkpoint.
  // Do not publish a known failed write as an attached paper. Never retry an unknown write.
  try{storage.setItem(key,raw)}catch{}
  let actual,readFailed=false;try{actual=storage.getItem(key)}catch{readFailed=true}
  if(!readFailed&&actual===raw){mem=next;persistedRaw=raw;persistedRevision=next.revision;persistence={...persistence,saved:true,error:null};publish();return snapshot}
  if(!readFailed&&actual===before)error('ATTACHMENT_NOT_SAVED_RELOAD_REQUIRED');
  mem=next;writeOutcomeUnknown=true;persistence={...persistence,saved:false,error:'ATTACHMENT_WRITE_UNKNOWN_RELOAD_REQUIRED'};publish();error('ATTACHMENT_WRITE_UNKNOWN_RELOAD_REQUIRED');
 }
 function event(p,kind,text){p.events.push({kind,text,time:now()});p.events=p.events.slice(-200)}
 function paper(x,id){const p=x.papers.find(p=>p.id===id);if(!p)error('PAPER_NOT_FOUND');return p}
 function invalidate(p,index){p.accepted=null;for(let i=index;i<3;i++){p.steps[i].currentRunId=null;p.steps[i].status=i===0?'ready':'blocked';}}
 async function sha(text){if(!crypto?.subtle?.digest)error('CRYPTO_UNAVAILABLE');const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const hash=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');if(!/^[a-f0-9]{64}$/.test(hash))error('INVALID_DIGEST');return hash;}
 function active(p){return p.runs.some(r=>r.status==='running')}
 function current(p,i){const s=p.steps[i];return p.runs.find(r=>r.id===s.currentRunId&&r.stepIndex===i&&r.status==='completed'&&r.promptVersion===s.promptVersion&&r.prompt===s.prompt)}
 function lineage(p,r){return r.upstream.length===r.stepIndex&&r.upstream.every((id,i)=>current(p,i)?.id===id)}
 function binding(r){if(!r?.artifacts?.[0])error('UPSTREAM_REQUIRED');return {id:r.id,promptVersion:r.promptVersion,prompt:r.prompt,sha256:r.artifacts[0].sha256}}
 async function verifyAncestry(p,r,visited=new Set(),depth=0){
  if(!r||depth>2||visited.has(r.id)||!uint(r.stepIndex)||r.stepIndex>2)error('STALE_LINEAGE');
  const path=new Set(visited);path.add(r.id);
  if(!lineage(p,r)||p.steps[r.stepIndex].prompt!==r.prompt||p.steps[r.stepIndex].promptVersion!==r.promptVersion||r.upstreamBindings.length!==r.stepIndex)error('STALE_LINEAGE');
  for(let i=0;i<r.stepIndex;i++){
   const ancestor=current(p,i),b=r.upstreamBindings[i];
   if(!ancestor||ancestor.stepIndex!==i||ancestor.stepIndex>=r.stepIndex||path.has(ancestor.id)||JSON.stringify(binding(ancestor))!==JSON.stringify(b))error('STALE_LINEAGE');
   if(await sha(ancestor.artifacts[0].content)!==b.sha256)error('HASH_MISMATCH');
   // Each prior run must also agree with its own immutable ancestor bindings.
   await verifyAncestry(p,ancestor,path,depth+1);
  }
 }

 async function writeExclusive(fn){const lock=options.withLock??(typeof globalThis.window!=='undefined'&&typeof globalThis.navigator?.locks?.request==='function'?((name,work)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},work)):null);if(lock)return lock(key+':library-queue-write',fn);if(storage?.getItem(key+':research-instances-v1')!==null&&storage?.getItem(key+':research-instances-v1')!==undefined)error('WEB_LOCKS_REQUIRED_FOR_INSTANCES');return fn()}
 async function finish(pid,rid){return writeExclusive(()=>finishUnlocked(pid,rid))}
 async function finishUnlocked(pid,rid){
  let p=mem.papers.find(p=>p.id===pid),r=p?.runs.find(r=>r.id===rid);
  if(destroyed||!r||r.status!=='running'||p.steps[r.stepIndex].currentRunId!==rid)return;
  try{
   const paperFingerprint=JSON.stringify(p);await verifyAncestry(p,r);
   let text,verdict;
   if(r.stepIndex===0)text='本地模拟资料检查：未读取真实论文。请人工核对数据来源、样本与许可。';
   else if(r.stepIndex===1)text='本地模拟结果：10个合成对象中2个状态改变。'+(r.prompt.includes('分母')?'分母：10个合成对象；不代表真实论文发现。':'缺口：未记录分母和统计口径。');
   else {const target=current(p,1);if(!target||target.id!==r.reviewedRun||!lineage(p,target))error('STALE_REVIEW');if(await sha(target.artifacts[0].content)!==r.reviewedHash)error('HASH_MISMATCH');verdict=target.prompt.includes('分母')?'passed':'needs_revision';text='本地模拟审核：'+verdict+'。只检查演示规则，不核验真实论文、统计推断或数据许可。';}
   const hash=await sha(text);
   p=mem.papers.find(p=>p.id===pid);r=p?.runs.find(r=>r.id===rid);
   if(destroyed||!r||r.status!=='running'||p.steps[r.stepIndex].currentRunId!==rid)return;
   if(!lineage(p,r)||JSON.stringify(p)!==paperFingerprint)error('STALE_LINEAGE');checkExternal();
   const next=clone(mem),q=paper(next,pid),run=q.runs.find(r=>r.id===rid),i=run.stepIndex;
   Object.assign(run,{status:'completed',ended:now(),artifacts:[{name:i===2?'review.md':'report.md',content:text,sha256:hash}],verdict:verdict??null});q.steps[i].status=verdict||'completed';
   if(i<2)q.steps[i+1].status='ready';else if(verdict==='needs_revision')q.steps[1].status='needs_revision';
   event(q,'result','仅模拟产物已生成；不是研究完成');commit(next);
  }catch(e){const next=clone(mem),q=next.papers.find(p=>p.id===pid),run=q?.runs.find(r=>r.id===rid);if(destroyed||!run||run.status!=='running')return;run.status='interrupted';run.errorCode=['CRYPTO_UNAVAILABLE','INVALID_DIGEST','STALE_REVIEW','HASH_MISMATCH','STALE_LINEAGE'].includes(e.code)?e.code:'SIMULATION_FAILED';q.steps[run.stepIndex].status='interrupted';event(q,'error',run.errorCode);commit(next);}
 }
 function checkExternal(){if(writeOutcomeUnknown)error('STORAGE_OUTCOME_UNKNOWN');if(storage&&storage.getItem(key)!==persistedRaw)error('STORAGE_CONFLICT')}
 function checkInstanceOwner(){if(!storage)return;const raw=storage.getItem(key+':research-instances-v1');if(raw===null)return;try{const x=JSON.parse(raw);if(x.state.activeId!==null||x.state.queueState?.activeQueueId)error('RESEARCH_INSTANCE_OWNS_RUNNER')}catch(e){error('RESEARCH_INSTANCE_OWNS_RUNNER')}}
 async function dispatch(a){checkInstanceOwner();if(a?.type==='attachDocument'){
  // Capture data before waiting for either lock; callbacks are only currentness guards.
  const fixed={...a,document:clone(a.document),attachment:clone(a.attachment)};
  const lock=options.withLock??(typeof globalThis.window!=='undefined'&&typeof globalThis.navigator?.locks?.request==='function'?((name,work)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},work)):null);
  if(typeof lock!=='function')error('WEB_LOCKS_REQUIRED_FOR_DOCUMENT_ATTACHMENT');
  return lock(key+':library-queue-write',()=>lock(key+':external-inbox-write',()=>dispatchUnlocked(fixed)));
 }return writeExclusive(()=>dispatchUnlocked(a))}
 async function dispatchUnlocked(a){
  checkInstanceOwner();
  ensureVerified();
  if(destroyed)error('STORE_DESTROYED');
  if(loadError)error('STORAGE_RECOVERY_REQUIRED');
  checkExternal();
  if(!a||a.revision!==mem.revision)error('REVISION_CONFLICT');
  const originalRevision=mem.revision;
  const checkImportGuard=()=>{if(!['importPaper','importSearchCandidates','importZoteroItem','attachDocument'].includes(a.type))return;if(a.signal?.aborted)error('IMPORT_CANCELLED');if(a.isCurrent!==undefined){let okay=false;try{okay=typeof a.isCurrent==='function'&&a.isCurrent()===true}catch{}if(!okay)error('IMPORT_CONTEXT_CHANGED')}};checkImportGuard();
  if(a.type==='run'||a.type==='accept'){await sha('capability-check');checkInstanceOwner();if(destroyed)error('STORE_DESTROYED');if(mem.revision!==originalRevision)error('REVISION_CONFLICT');checkExternal();}
  const next=clone(mem);
  if(a.type==='attachDocument'){
   const p=paper(next,a.paperId);if(Object.hasOwn(p,'document')||Object.hasOwn(p,'documentAttachment'))error('DOCUMENT_ALREADY_ATTACHED');if(active(p))error('ATTACHMENT_PAPER_ACTIVE');
   const oldPaperRaw=JSON.stringify(p),workflowKey=key+':custom-workflow-v1:'+p.id,oldWorkflowRaw=storage?.getItem(workflowKey)??null;
   const contextKeys=['project-execution-owner-v1','research-instances-v1','library-queue-v1','project-library-v1','project-planning-v1','project-queues-v1'].map(suffix=>key+':'+suffix),contextRaws=contextKeys.map(k=>storage?.getItem(k)??null);
   const stable=()=>{if(destroyed)error('STORE_DESTROYED');checkImportGuard();checkInstanceOwner();checkExternal();if(mem.revision!==originalRevision)error('REVISION_CONFLICT');if(JSON.stringify(mem.papers.find(q=>q.id===p.id))!==oldPaperRaw||storage?.getItem(workflowKey)!==oldWorkflowRaw||contextKeys.some((k,i)=>(storage?.getItem(k)??null)!==contextRaws[i]))error('ATTACHMENT_CONTEXT_CHANGED')};
   const document=documentData(a.document);document.sha256=await sha(document.text);stable();
   const attachment=clone(a.attachment);if(attachment?.namespace!==key||attachment?.oldPaperRaw!==oldPaperRaw||attachment?.oldWorkflowRaw!==oldWorkflowRaw||attachment?.documentSha256!==document.sha256)error('ATTACHMENT_PREVIEW_MISMATCH');
   p.document=document;p.documentAttachment=attachment;invalidate(p,0);
   const validated=await validateDocumentAttachment(p,{namespace:key,crypto});stable();
   if(validated.oldWorkflow&&(validated.oldWorkflow.syntheticAuthorized||validated.oldWorkflow.runs.some(r=>r.status==='running')))error('ATTACHMENT_WORKFLOW_ACTIVE');
   await assertScopeEditable(storage,key,crypto);stable();
   const queueRaw=contextRaws[2];if(queueRaw!==null){await importQueue(queueRaw,crypto);stable();const queue=JSON.parse(queueRaw).queue,view=queueView(queue);if(queue.allowed||view.active||view.pending)error('ATTACHMENT_QUEUE_ACTIVE');}
   validate(next);if(JSON.stringify({...next,revision:mem.revision+1}).length>4000000)error('STORE_TOO_LARGE');
   stable();return commitAttachment(next);
  }else if(a.type==='importSearchCandidates'){
   if(!Array.isArray(a.candidates)||a.candidates.length<1||a.candidates.length>50)error('INVALID_SEARCH_CANDIDATES');
   // Validate every input before deduplication: an invalid duplicate is still invalid.
   const candidates=a.candidates.map(searchCandidate);
   for(const {title,metadata} of candidates){
    const {identity,simulation}=metadata.discovery;
    if(next.papers.some(p=>(p.metadata?.discovery?.simulation===true)===simulation&&(p.metadata?.discovery?.identity===identity||metadata.doi!==null&&paperHasDoi(p,metadata.doi))))continue;
    if(next.papers.length>=100)error('PAPER_LIMIT');
    next.papers.push({id:uid(),title,source:metadata.sourceURL,metadata,steps:defaults.map((prompt,i)=>({name:['资料检查','模拟复现','模拟审核'][i],prompt,promptVersion:1,status:i===0?'ready':'blocked',currentRunId:null,history:[]})),runs:[],events:[],accepted:null});
   }
   checkImportGuard();
   if(next.papers.length===mem.papers.length)return snapshot;
   if(JSON.stringify({...next,revision:mem.revision+1}).length>4000000)error('STORE_TOO_LARGE');
  }else if(['addPaper','importPaper','importCandidate','importZoteroItem'].includes(a.type)){
   let metadata;
   if(a.type==='importCandidate'){
    if(!validText(a.candidate?.title,500)||!a.candidate.title.trim())error('INVALID_PAPER');metadata=metadataData(a.candidate);
    const existing=next.papers.find(p=>p.metadata?.discovery?.simulation!==true&&paperHasDoi(p,metadata.doi));
    if(existing)throw Object.assign(new Error('DUPLICATE_DOI'),{code:'DUPLICATE_DOI',existingPaperId:existing.id});
    a={...a,title:a.candidate.title.trim(),source:metadata.sourceURL};
   }
   if(a.type==='importZoteroItem'){
    metadata=clone(a.metadata);
    if(metadata.provider!=='Zotero')error('INVALID_ZOTERO_SOURCE');
    a={...a,source:zoteroSourceLabel(metadata)};
   }
   if(!validText(a.title,500)||!a.title.trim()||!validText(a.source??'',1000))error('INVALID_PAPER');if(next.papers.length>=100)error('PAPER_LIMIT');
   const title=a.title.trim(),source=a.source??'';
   let document;
   if(a.type==='importPaper'||a.type==='importZoteroItem'&&a.document){
    document=documentData(a.document);document.sha256=await sha(document.text);checkImportGuard();
    if(destroyed)error('STORE_DESTROYED');if(mem.revision!==originalRevision)error('REVISION_CONFLICT');checkExternal();
    if(next.papers.some(p=>p.document?.sha256===document.sha256)){
     if(a.type==='importPaper')error('DUPLICATE_DOCUMENT');
     validateZoteroMetadata(metadata,document);
     metadata.zotero.extraction=null;
     document=undefined;
    }
   }
   if(a.type==='importZoteroItem'){
    validateZoteroMetadata(metadata,document);
    if(document&&!metadata.zotero.extraction)error('INVALID_ZOTERO_SOURCE');
    const duplicate=zoteroDuplicate(next.papers,metadata);
    if(duplicate)error(duplicate.kind==='item'?'DUPLICATE_ZOTERO_ITEM':'DUPLICATE_DOI');
    checkImportGuard();
   }
   next.papers.push({...(metadata?{metadata}:{}),...(document?{document}:{}),id:uid(),title,source,steps:defaults.map((prompt,i)=>({name:['资料检查','模拟复现','模拟审核'][i],prompt,promptVersion:1,status:i===0?'ready':'blocked',currentRunId:null,history:[]})),runs:[],events:[],accepted:null});
   if(['importPaper','importCandidate','importZoteroItem'].includes(a.type)&&JSON.stringify({...next,revision:mem.revision+1}).length>4000000)error('STORE_TOO_LARGE');
  }else{
   const p=paper(next,a.paperId),i=a.stepIndex??0;if(!uint(i)||i>2)error('INVALID_STEP');const s=p.steps[i];
   if(a.type==='editPrompt'){
    if(active(p))error('RUNNING');if(!validText(a.prompt,16000)||!a.prompt.trim())error('INVALID_PROMPT');if(a.prompt===s.prompt)return snapshot;if(s.history.length>=30)error('PROMPT_HISTORY_LIMIT');s.history.push({version:s.promptVersion,prompt:s.prompt,time:now()});s.prompt=a.prompt;s.promptVersion++;invalidate(p,i);if(i>0&&current(p,i-1))s.status='ready';event(p,'prompt','Prompt已更新，下游版本失效');
   }else if(a.type==='run'){
    if(active(p))error('RUNNING');if(p.runs.length>=100)error('RUN_LIMIT');if(i>0&&(!current(p,i-1)||!lineage(p,current(p,i-1))))error('UPSTREAM_REQUIRED');
    invalidate(p,i);const rid=uid(),r={id:rid,stepIndex:i,prompt:s.prompt,promptVersion:s.promptVersion,status:'running',started:now(),upstream:p.steps.slice(0,i).map(s=>s.currentRunId),upstreamBindings:p.steps.slice(0,i).map((s,j)=>binding(current(p,j))),artifacts:[]};
    if(i===2){const target=current(p,1);if(!target?.artifacts[0])error('UPSTREAM_REQUIRED');r.reviewedRun=target.id;r.reviewedHash=target.artifacts[0].sha256;}
    await verifyAncestry(p,r);if(destroyed)error('STORE_DESTROYED');if(mem.revision!==originalRevision)error('REVISION_CONFLICT');checkExternal();
    p.runs.push(r);s.currentRunId=rid;s.status='running';event(p,'run','开始本地模拟；不发送至模型');commit(next);schedule(()=>finish(p.id,rid));return snapshot;
   }else if(a.type==='cancel'){
    for(const r of p.runs)if(r.status==='running'){r.status='cancelled';r.ended=now();p.steps[r.stepIndex].status='interrupted';}p.accepted=null;event(p,'cancel','本地模拟已取消');
   }else if(a.type==='accept'){
    if(active(p))error('RUNNING');const review=current(p,2),target=current(p,1);
    if(!review||review.verdict!=='passed'||!target||!lineage(p,review)||!lineage(p,target)||review.reviewedRun!==target.id||review.reviewedHash!==target.artifacts[0]?.sha256)error('REVIEW_REQUIRED');
    await verifyAncestry(p,review);await verifyAncestry(p,target);
    if(await sha(target.artifacts[0].content)!==review.reviewedHash||await sha(review.artifacts[0].content)!==review.artifacts[0].sha256)error('HASH_MISMATCH');if(destroyed)error('STORE_DESTROYED');if(mem.revision!==originalRevision)error('REVISION_CONFLICT');checkExternal();
    p.accepted={run:target.id,review:review.id,sha256:review.reviewedHash,time:now(),scope:'仅人工接收本地模拟版本，非科学验证'};event(p,'accept','人工接收模拟成果');
   }else error('UNKNOWN_ACTION');
  }
  checkImportGuard();commit(next);return snapshot;
 }
 function ensureVerified(){if(destroyed)error('STORE_DESTROYED');if(verificationPending)error('DOCUMENT_VERIFICATION_PENDING');if(verificationFailure)error(verificationFailure);if(loadError)error('STORAGE_RECOVERY_REQUIRED');}
 const loadedDocuments=!loadError?mem.papers.filter(p=>p.document).map(p=>p.document):[];
 const loadedAttachments=!loadError?mem.papers.filter(p=>p.documentAttachment):[];
 const afterVerification={...persistence};
 if(loadedDocuments.length||loadedAttachments.length){verificationPending=true;persistence={...persistence,saved:false,error:'DOCUMENT_VERIFICATION_PENDING'};}
 publish();
 const ready=loadedDocuments.length||loadedAttachments.length?Promise.resolve().then(async()=>{
  try{
   for(const d of loadedDocuments){const actual=await sha(d.text);if(destroyed)return {ready:false,error:'STORE_DESTROYED'};checkExternal();if(actual!==d.sha256)error('DOCUMENT_HASH_MISMATCH');}
   for(const p of loadedAttachments){await validateDocumentAttachment(p,{crypto});if(destroyed)return {ready:false,error:'STORE_DESTROYED'};checkExternal();}
   if(destroyed)return {ready:false,error:'STORE_DESTROYED'};checkExternal();verificationPending=false;persistence=afterVerification;publish();return {ready:true};
  }catch(e){
   if(destroyed)return {ready:false,error:'STORE_DESTROYED'};
   verificationPending=false;verificationFailure=['DOCUMENT_HASH_MISMATCH','CRYPTO_UNAVAILABLE','INVALID_DIGEST','STORAGE_CONFLICT'].includes(e.code)?e.code:'DOCUMENT_VERIFICATION_FAILED';persistence={...persistence,saved:false,error:verificationFailure};publish();return {ready:false,error:verificationFailure};
  }
 }):Promise.resolve({ready:!loadError,error:loadError});
 return {getStorageKey:()=>key,assertCurrentStorage(){if(destroyed)error('STORE_DESTROYED');ensureVerified();if(!storage)error('STORAGE_UNAVAILABLE');checkExternal();return true},ready,getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},dispatch,destroy(){destroyed=true;listeners.clear()},exportJSON:()=>{ensureVerified();return JSON.stringify(mem,null,2)}};
}
