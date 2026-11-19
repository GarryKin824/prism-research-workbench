// No network. Storage slots are logical separation, not an account security boundary.
import {encodeChunkedStore,decodeChunkedStore,validateChunkedStoreLayout} from './chunked-store-core.mjs';
export const LARGE_RESEARCH_BACKUP_LIMIT=16000000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>{throw Object.assign(Error(code),{code})};
const bytes=raw=>new TextEncoder().encode(raw).length;
function checkCurrent(isCurrent){if(isCurrent===undefined)return;let current=false;try{current=typeof isCurrent==='function'&&isCurrent()===true}catch{}if(!current)fail('RESTORE_CONTEXT_CHANGED');}
const fields={root:'schema revision papers',paper:'id title source steps runs events accepted document metadata documentAttachment',step:'name prompt promptVersion status currentRunId history',history:'version prompt time',run:'id stepIndex prompt promptVersion status started ended upstream upstreamBindings artifacts reviewedRun reviewedHash verdict errorCode',binding:'id promptVersion prompt sha256',artifact:'name content sha256',event:'kind text time',accepted:'run review sha256 time scope',document:'text filename mime byteLength sha256 pdfText',metadata:'doi title authors year abstract links retrievedAt query sourceURL dataAvailability codeAvailability fullTextRead provider'};
function keys(x,kind){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!fields[kind].split(' ').includes(k)))fail('INVALID_FIELDS');}
function safeStructure(x){let count=0;function visit(v,d){if(++count>150000||d>20)fail('STRUCTURE_LIMIT');if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))fail('UNSAFE_KEY');visit(v[k],d+1)}}}visit(x,0);return x;}
function parseBounded(raw,limit){if(typeof raw!=='string'||raw.length>limit||bytes(raw)>limit)fail('BACKUP_TOO_LARGE');let x;try{x=JSON.parse(raw)}catch{fail('INVALID_JSON')}return safeStructure(x);}
function bounded(raw){return parseBounded(raw,4000000)}
function nativeCapacity(raw){if(typeof raw!=='string'||raw.length>4000000||bytes(raw)>12000000)fail('STORE_NATIVE_CAPACITY_EXCEEDED');}
async function hashText(text,crypto){if(!crypto?.subtle?.digest)fail('CRYPTO_UNAVAILABLE');const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));if(b.length!==32)fail('INVALID_DIGEST');return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
export async function validateStoreSnapshot(data,{createStore,crypto=globalThis.crypto,normalize=false,checkNativeCapacity=true}={}){
  if(typeof createStore!=='function')fail('INVALID_CONFIGURATION');
  safeStructure(data);
  // Snapshot before any digest await; callers cannot change a validated component in flight.
  const inputRaw=JSON.stringify(data);if(checkNativeCapacity)nativeCapacity(inputRaw);data=JSON.parse(inputRaw);
  keys(data,'root');if(!Array.isArray(data.papers))fail('INVALID_STORE');
  for(const p of data.papers){keys(p,'paper');for(const s of p.steps??[]){keys(s,'step');for(const h of s.history??[])keys(h,'history')}for(const r of p.runs??[]){keys(r,'run');for(const b of r.upstreamBindings??[])keys(b,'binding');for(const a of r.artifacts??[])keys(a,'artifact')}for(const e of p.events??[])keys(e,'event');if(p.accepted)keys(p.accepted,'accepted');if(p.document)keys(p.document,'document');/* metadata validated by existing strict store */}
  const raw=JSON.stringify(data);const temp=createStore({storage:{getItem:()=>raw,setItem:()=>fail('VALIDATION_WRITE_FORBIDDEN')},key:'validation',crypto,schedule:()=>fail('VALIDATION_EXECUTION_FORBIDDEN')});
  try{const ready=await temp.ready;if(!ready.ready||temp.getSnapshot().persistence.error==='INVALID_OR_UNAVAILABLE_STORAGE')fail('INVALID_STORE');temp.exportJSON();}finally{temp.destroy()}
  // The store validator checked the receipt and full old workflow. Validate the old
  // paper's exact restore fields and artifact ancestry as a bounded nonrecursive snapshot.
  for(const p of data.papers)if(p.documentAttachment)await validateStoreSnapshot({schema:1,revision:0,papers:[JSON.parse(p.documentAttachment.oldPaperRaw)]},{createStore,crypto,normalize:false,checkNativeCapacity:false});
  for(const p of data.papers){const byId=new Map(p.runs.map(r=>[r.id,r]));for(const r of p.runs){if(r.promptVersion<1)fail('RUN_VERSION_INVALID');
   if(r.status==='completed'){if(r.artifacts.length!==1)fail('COMPLETED_EVIDENCE_REQUIRED');if(r.stepIndex===2&&!['passed','needs_revision'].includes(r.verdict))fail('REVIEW_VERDICT_REQUIRED');if(r.stepIndex!==2&&r.verdict!==undefined&&r.verdict!==null)fail('UNEXPECTED_VERDICT');}
   else if(r.artifacts.length!==0||r.verdict!==undefined&&r.verdict!==null)fail('UNFINISHED_EVIDENCE');for(const a of r.artifacts)if(await hashText(a.content,crypto)!==a.sha256)fail('ARTIFACT_HASH_MISMATCH');for(let i=0;i<r.stepIndex;i++){const a=byId.get(r.upstream[i]),b=r.upstreamBindings[i];if(!a||a.stepIndex!==i||a.stepIndex>=r.stepIndex||a.id!==b.id||a.prompt!==b.prompt||a.promptVersion!==b.promptVersion||a.artifacts[0]?.sha256!==b.sha256)fail('ANCESTRY_MISMATCH')}if(r.stepIndex===2&&(r.reviewedRun!==r.upstream[1]||r.reviewedHash!==r.upstreamBindings[1].sha256))fail('REVIEW_BINDING_MISMATCH')}
   for(let i=0;i<3;i++){const s=p.steps[i];if(s.currentRunId!==null){const r=byId.get(s.currentRunId);if(!r||r.stepIndex!==i||r.prompt!==s.prompt||r.promptVersion!==s.promptVersion||r.upstream.some((id,j)=>p.steps[j].currentRunId!==id))fail('CURRENT_VERSION_MISMATCH')}}
   if(p.runs.filter(r=>r.status==='running').length>1)fail('MULTIPLE_RUNNING');
   for(let i=0;i<3;i++){
    const step=p.steps[i],r=byId.get(step.currentRunId);
    if(step.currentRunId===null){if(!['ready','blocked'].includes(step.status))fail('STEP_STATE_MISMATCH');continue;}
    if(r.status==='running'&&step.status!=='running'||['cancelled','interrupted'].includes(r.status)&&step.status!=='interrupted')fail('STEP_STATE_MISMATCH');
    if(r.status==='completed'){
     if(i===2&&step.status!==r.verdict)fail('STEP_STATE_MISMATCH');
     if(i===0&&step.status!=='completed')fail('STEP_STATE_MISMATCH');
     if(i===1&&step.status!=='completed'){
      if(step.status!=='needs_revision'||!p.runs.some(v=>v.stepIndex===2&&v.status==='completed'&&v.verdict==='needs_revision'&&v.reviewedRun===r.id&&v.reviewedHash===r.artifacts[0].sha256))fail('STEP_STATE_MISMATCH');
     }
    }
   }
   if(p.accepted){const a=p.accepted,r=byId.get(a.run),review=byId.get(a.review);if(!r||!review||p.steps[1].currentRunId!==r.id||p.steps[2].currentRunId!==review.id||review.verdict!=='passed'||review.reviewedRun!==r.id||review.reviewedHash!==a.sha256||r.artifacts[0]?.sha256!==a.sha256)fail('ACCEPTANCE_MISMATCH');}
  }
  if(!normalize)return {data,raw};
  // Historical acceptance is evidence only. Never silently reinstate scientific acceptance.
  const clean=JSON.parse(raw);for(const p of clean.papers){p.accepted=null;for(const r of p.runs)if(r.status==='running')r.status='interrupted';for(const s of p.steps)if(s.status==='running')s.status='interrupted';}
  const cleanRaw=JSON.stringify(clean);
  // Normalization can grow running states into interrupted states. The exact
  // bytes written must satisfy the same bound as a future load/slot switch.
  // Refuse before issuing a preview; never truncate history or raise the cap.
  if(checkNativeCapacity)nativeCapacity(cleanRaw);safeStructure(clean);return {data:clean,raw:cleanRaw};
 }
export function createRestoreManager({storage,profileId,createStore,crypto=globalThis.crypto,withLock}={}){
 if(!uuid.test(profileId)||!storage||typeof createStore!=='function')fail('INVALID_CONFIGURATION');
 const originalKey='prism-native-profile-v1:'+profileId,prefix=originalKey+':restore:';let generation=0,closed=false,pending;
 const validKey=k=>k===originalKey||typeof k==='string'&&k.startsWith(prefix)&&uuid.test(k.slice(prefix.length));
 const hash=text=>hashText(text,crypto);
 async function validate(data,native=false){const result=await validateStoreSnapshot(data,{createStore,crypto,normalize:true,checkNativeCapacity:native});if(!native)bounded(result.raw);return result.raw;}

 return {
 validateSlotKey:validKey,
 listSlots(){const slots=[];if(!Number.isSafeInteger(storage.length)||storage.length>10000)fail('STORAGE_ENUMERATION_UNAVAILABLE');for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key!==originalKey&&validKey(key))slots.push({slotKey:key,metadataKey:key+':metadata'});}return slots;},
 async validateStoredSlot(slotKey,{isCurrent}={}){
  checkCurrent(isCurrent);if(closed||!validKey(slotKey))fail('INVALID_SOURCE');
  const raw=storage.getItem(slotKey);if(typeof raw!=='string')fail('TARGET_SLOT_MISSING');nativeCapacity(raw);
  const data=parseBounded(raw,12000000);await validateStoreSnapshot(data,{createStore,crypto,normalize:true});
  checkCurrent(isCurrent);if(closed)fail('RESTORE_CONTEXT_CHANGED');if(storage.getItem(slotKey)!==raw)fail('TARGET_SLOT_CHANGED');
  return {slotKey,raw,readOnly:true};
 },
 async exportCurrent(store,{sourceKey=originalKey,isCurrent}={}){
  checkCurrent(isCurrent);if(closed||!validKey(sourceKey))fail('INVALID_SOURCE');if(typeof store?.getStorageKey!=='function'||store.getStorageKey()!==sourceKey)fail('STORE_SOURCE_MISMATCH');
  store.assertCurrentStorage();const before=storage.getItem(sourceKey),memoryRaw=store.exportJSON(),data=parseBounded(memoryRaw,LARGE_RESEARCH_BACKUP_LIMIT);
  const checked=await validateStoreSnapshot(data,{createStore,crypto,normalize:true}),raw=JSON.stringify(data);
  function unchanged(){checkCurrent(isCurrent);if(closed)fail('RESTORE_CONTEXT_CHANGED');store.assertCurrentStorage();if(before!==storage.getItem(sourceKey)||memoryRaw!==store.exportJSON())fail('SOURCE_CHANGED')}
  unchanged();const provenance={format:'prism-research-backup',version:1,profileId,sourceKey,exportedAt:new Date().toISOString()};
  let output=JSON.stringify({...provenance,data});
  if(bytes(output)>4000000||bytes(checked.raw)>4000000){
   const storeChunks=await encodeChunkedStore(raw,crypto);unchanged();const body={...provenance,version:2,storeChunks};output=JSON.stringify({...body,sha256:await hash(JSON.stringify(body))});parseBounded(output,LARGE_RESEARCH_BACKUP_LIMIT);
  }else bounded(output);
  unchanged();return output;
 },
 async prepare(raw,{sourceKey=originalKey,isCurrent}={}){
  checkCurrent(isCurrent);const g=++generation;pending=null;if(closed||!validKey(sourceKey))fail('INVALID_SOURCE');
  const sourceRaw=storage.getItem(sourceKey),parsed=parseBounded(raw,LARGE_RESEARCH_BACKUP_LIMIT),native=parsed?.format==='prism-research-backup'&&parsed?.version===2;
  if(!native)bounded(raw);
  let data=parsed,provenance={format:'legacy-store',version:1};
  if(parsed?.format!==undefined){
   const allowed=native?['format','version','profileId','sourceKey','exportedAt','storeChunks','sha256']:['format','version','profileId','sourceKey','exportedAt','data'];
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).some(k=>!allowed.includes(k))||parsed.format!=='prism-research-backup'||parsed.version!==(native?2:1)||!uuid.test(parsed.profileId)||typeof parsed.sourceKey!=='string'||parsed.sourceKey.length>300||typeof parsed.exportedAt!=='string'||!Number.isFinite(Date.parse(parsed.exportedAt)))fail('INVALID_BACKUP');
   if(native&&Object.keys(parsed).length!==allowed.length)fail('INVALID_BACKUP');
   if(native){validateChunkedStoreLayout(parsed.storeChunks);const {sha256:expected,...body}=parsed;if(typeof expected!=='string'||!(/^[a-f0-9]{64}$/).test(expected)||expected!==await hash(JSON.stringify(body)))fail('BACKUP_HASH_MISMATCH');const decodedRaw=await decodeChunkedStore(parsed.storeChunks,crypto);data=parseBounded(decodedRaw,12000000);if(JSON.stringify(data)!==decodedRaw)fail('STORE_CHUNK_NOT_COMPACT')}else data=parsed.data;
   provenance={format:parsed.format,version:parsed.version,profileId:parsed.profileId,sourceKey:parsed.sourceKey,exportedAt:parsed.exportedAt};
  }
  const clean=await validate(data,native),sha256=await hash(raw);if(closed||g!==generation)fail('STALE_PREVIEW');if(sourceRaw!==storage.getItem(sourceKey))fail('SOURCE_CHANGED');
  const previewId=crypto.randomUUID(),summary={papers:data.papers.length,runs:data.papers.reduce((n,p)=>n+p.runs.length,0),documents:data.papers.filter(p=>p.document).length,acceptancesCleared:data.papers.filter(p=>p.accepted).length,sha256,provenance,
   ...(native?{formatVersion:2,storeUtf16Units:clean.length,storeUtf8Bytes:bytes(clean),scope:'base-store-only-not-full-project',originalPdfFilesIncluded:false}: {})};
  checkCurrent(isCurrent);pending={previewId,sourceKey,sourceRaw,clean,summary};return {previewId,summary:JSON.parse(JSON.stringify(summary)),canConfirm:typeof withLock==='function'};
 },
 async confirm(previewId,{explicitConfirmation=false,isCurrent}={}){checkCurrent(isCurrent);if(!explicitConfirmation||!pending||pending.previewId!==previewId||closed)fail('CONFIRMATION_REQUIRED');if(typeof withLock!=='function')fail('EXCLUSIVE_LOCK_REQUIRED');const captured=pending,g=generation;return withLock('prism-restore:'+profileId,async()=>{checkCurrent(isCurrent);if(closed||generation!==g||pending!==captured)fail('STALE_PREVIEW');if(storage.getItem(captured.sourceKey)!==captured.sourceRaw)fail('SOURCE_CHANGED');const slotId=crypto.randomUUID(),slotKey=prefix+slotId,metadataKey=slotKey+':metadata';if(storage.getItem(slotKey)!==null||storage.getItem(metadataKey)!==null)fail('SLOT_EXISTS');const metadata=JSON.stringify({version:1,profileId,slotId,sourceKey:captured.sourceKey,restoredAt:new Date().toISOString(),...captured.summary});checkCurrent(isCurrent);try{storage.setItem(metadataKey,metadata);storage.setItem(slotKey,captured.clean);if(storage.getItem(slotKey)!==captured.clean||storage.getItem(metadataKey)!==metadata)fail('WRITE_CONFLICT')}catch{pending=null;fail('RESTORE_WRITE_FAILED_OR_ORPHANED')}pending=null;generation++;return {slotKey,metadataKey,originalKey,sourceKey:captured.sourceKey,saved:true,activeChanged:false};});},
 destroy(){closed=true;generation++;pending=null;}
 };
}
