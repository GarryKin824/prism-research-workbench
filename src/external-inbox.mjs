// Local-only external result intake. Never changes workflow status or dispatches.
export async function inboxDigest(text,crypto=globalThis.crypto){
 if(!crypto?.subtle)throw Error('CRYPTO_UNAVAILABLE');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 if(bytes.length!==32)throw Error('INVALID_DIGEST');
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export const inboxString=(v,max,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export const inboxHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const inboxKeys=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join('|')===keys.split(',').sort().join('|');
export function validateInboxRecord(r){
 const bad=()=>{throw Error('INVALID_INBOX')};
 if(!inboxKeys(r,'schema,status,platform,source,text,binding,createdAt,sha256')||r.schema!=='prism-external-result/v2'||r.status!=='unverified'||!inboxString(r.platform,80)||!inboxString(r.source,1000,true)||!inboxString(r.text,100000)||!inboxHash(r.sha256)||!inboxString(r.createdAt,40)||!Number.isFinite(Date.parse(r.createdAt)))bad();
 const b=r.binding;
 if(!inboxKeys(b,'namespace,paperId,paperTitle,paperSource,documentSha256,stepIndex,promptVersion,prompt,upstream')||!inboxString(b.namespace,300)||!inboxString(b.paperId,100)||!inboxString(b.paperTitle,500)||!inboxString(b.paperSource,1000,true)||!(b.documentSha256===null||inboxHash(b.documentSha256))||!Number.isInteger(b.stepIndex)||b.stepIndex<0||b.stepIndex>2||!Number.isSafeInteger(b.promptVersion)||b.promptVersion<1||!inboxString(b.prompt,16000)||!Array.isArray(b.upstream)||b.upstream.length!==b.stepIndex)bad();
 for(const [i,u] of b.upstream.entries()){
  if(!inboxKeys(u,'stepIndex,promptVersion,prompt,status,run')||u.stepIndex!==i||!Number.isSafeInteger(u.promptVersion)||u.promptVersion<1||!inboxString(u.prompt,16000)||!['ready','blocked','running','completed','needs_revision','passed','cancelled','interrupted'].includes(u.status))bad();
  if(u.run!==null){const x=u.run;if(!inboxKeys(x,'id,status,promptVersion,prompt,artifacts')||!inboxString(x.id,100)||!inboxString(x.status,30)||!Number.isSafeInteger(x.promptVersion)||x.promptVersion<1||!inboxString(x.prompt,16000)||!Array.isArray(x.artifacts)||x.artifacts.length>1)bad();for(const a of x.artifacts)if(!inboxKeys(a,'name,content,sha256')||!inboxString(a.name,100)||!inboxString(a.content,100000,true)||!inboxHash(a.sha256))bad();}
 }
 return true;
}
export function inboxBinding(store,paperId,stepIndex){
 const p=store.getSnapshot().papers.find(p=>p.id===paperId),s=p?.steps[stepIndex];if(!s||!Number.isInteger(stepIndex)||stepIndex<0||stepIndex>2)throw Error('HANDOFF_NODE_MISSING');
 const upstream=p.steps.slice(0,stepIndex).map((u,i)=>{const r=(p.runs||[]).find(x=>x.id===u.currentRunId);return {stepIndex:i,promptVersion:u.promptVersion,prompt:u.prompt,status:u.status,run:r?{id:r.id,status:r.status,promptVersion:r.promptVersion,prompt:r.prompt,artifacts:(r.artifacts||[]).map(a=>({name:a.name,content:a.content,sha256:a.sha256}))}:null}});
 return {namespace:store.getStorageKey(),paperId,paperTitle:p.title,paperSource:p.source||'',documentSha256:p.document?.sha256||null,stepIndex,promptVersion:s.promptVersion,prompt:s.prompt,upstream};
}
export function serializeInboxExport(namespace,records){return JSON.stringify({schema:'prism-external-inbox-export/v2',namespace,notice:'用户人工提供的外部结果；来源未认证，结论未审核；不包含研究档案备份。',records},null,2)}
export function assertInboxExportBudget(namespace,records){if(new TextEncoder().encode(serializeInboxExport(namespace,records)).length>4000000)throw Error('INBOX_EXPORT_BUDGET_EXCEEDED')}
export function createExternalInbox({store,storage,crypto=globalThis.crypto,withLock}){
 const key=store.getStorageKey()+':external-inbox-v1';let baseline=null,records=[],ready=false,openingError=null;
 try{baseline=storage.getItem(key)}catch(cause){openingError=cause instanceof Error?cause:Error('INBOX_STORAGE_UNAVAILABLE',{cause})}
 const check=()=>{if(openingError)throw openingError;store.assertCurrentStorage();if(storage.getItem(key)!==baseline)throw Error('INBOX_STORAGE_CONFLICT');if(!ready)throw Error('INBOX_NOT_VERIFIED')};
 async function initialize(){
  if(openingError)throw openingError;
  if(baseline!==null&&new TextEncoder().encode(baseline).length>4000000)throw Error('INBOX_FULL');
  const parsed=baseline===null?[]:JSON.parse(baseline);
  if(!Array.isArray(parsed)||parsed.length>100)throw Error('INVALID_INBOX');
  for(const r of parsed){
   validateInboxRecord(r);if(r.binding.namespace!==store.getStorageKey())throw Error('INBOX_NAMESPACE_MISMATCH');
   for(const u of r.binding.upstream)for(const a of u.run?.artifacts||[])if(await inboxDigest(a.content,crypto)!==a.sha256)throw Error('INBOX_HASH_MISMATCH');
   const {sha256,...payload}=r;if(await inboxDigest(JSON.stringify(payload),crypto)!==sha256)throw Error('INBOX_HASH_MISMATCH');
  }
  if(storage.getItem(key)!==baseline)throw Error('INBOX_STORAGE_CONFLICT');records=parsed;ready=true;return JSON.parse(JSON.stringify(records));
 }
 async function prepare({paperId,stepIndex,platform,source='',text}){
  check();if(typeof text!=='string'||!text.trim()||text.length>100000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('INVALID_RESULT_TEXT');
  if(typeof platform!=='string'||!platform.trim()||platform.length>80||typeof source!=='string'||source.length>1000)throw Error('INVALID_RESULT_SOURCE');
  const paper=store.getSnapshot().papers.find(p=>p.id===paperId),step=paper?.steps[stepIndex];if(!step||!Number.isInteger(stepIndex))throw Error('HANDOFF_NODE_MISSING');
  const binding=inboxBinding(store,paperId,stepIndex);
  const payload={schema:'prism-external-result/v2',status:'unverified',platform:platform.trim(),source,text,binding,createdAt:new Date().toISOString()};
  const result={...payload,sha256:await inboxDigest(JSON.stringify(payload),crypto)};assertCurrent(result);return result;
 }
 function assertCurrent(r){check();validateInboxRecord(r);if(JSON.stringify(inboxBinding(store,r.binding.paperId,r.binding.stepIndex))!==JSON.stringify(r.binding))throw Error('HANDOFF_STALE')}
 async function commitUnlocked(r){
  assertCurrent(r);const {sha256,...payload}=r;if(await inboxDigest(JSON.stringify(payload),crypto)!==sha256)throw Error('INBOX_HASH_MISMATCH');assertCurrent(r);
  if(records.length>=100)throw Error('INBOX_FULL');if(records.some(x=>x.sha256===sha256))throw Error('INBOX_DUPLICATE');
  const next=[...records,JSON.parse(JSON.stringify(r))],raw=JSON.stringify(next);if(new TextEncoder().encode(raw).length>4000000)throw Error('INBOX_FULL');
  assertInboxExportBudget(store.getStorageKey(),next);
  storage.setItem(key,raw);baseline=raw;records=next;return JSON.parse(JSON.stringify(records));
 }
 async function commit(r){if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');return withLock(store.getStorageKey()+':external-inbox-write',()=>commitUnlocked(r))}
 return {initialize,prepare,commit,assertCurrent,exportJSON(){check();assertInboxExportBudget(store.getStorageKey(),records);return serializeInboxExport(store.getStorageKey(),records)}};
}
