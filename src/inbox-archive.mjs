import {verifyReviewRecords} from './review-queue.mjs';
import {inboxString,inboxKeys,inboxHash,inboxDigest,validateInboxRecord} from './external-inbox.mjs';
// Immutable, local-only inbox archive slots. No workflow or Host controller access.
export async function inspectInboxArchive(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4000000)throw Error('ARCHIVE_TOO_LARGE');
 let data;try{data=JSON.parse(raw)}catch{throw Error('INVALID_ARCHIVE_JSON')}
 if(!inboxKeys(data,'schema,namespace,notice,records')||!['prism-external-inbox-export/v2','prism-review-queue-export/v1'].includes(data.schema)||!inboxString(data.namespace,300)||!inboxString(data.notice,1000)||!Array.isArray(data.records)||data.records.length>100)throw Error('INVALID_ARCHIVE');
 const review=data.schema==='prism-review-queue-export/v1';if(review)await verifyReviewRecords(data.records,data.namespace,crypto);
 const seen=new Set();
 for(const record of data.records){
  if(!review)validateInboxRecord(record);if(record.binding.namespace!==data.namespace)throw Error('ARCHIVE_NAMESPACE_MISMATCH');
  const {sha256,...payload}=record;
  if(await inboxDigest(JSON.stringify(payload),crypto)!==sha256)throw Error('INBOX_HASH_MISMATCH');
  if(seen.has(sha256))throw Error('ARCHIVE_DUPLICATE_RECORD');seen.add(sha256);
  for(const u of record.binding.upstream)for(const a of u.run?.artifacts||[])if(await inboxDigest(a.content,crypto)!==a.sha256)throw Error('INBOX_HASH_MISMATCH');
 }
 // Stable across formatting, notice changes, and record order; provenance remains part of every row hash.
 const fingerprint=await inboxDigest(JSON.stringify({...(review?{schema:data.schema}:{}),namespace:data.namespace,records:[...seen].sort()}),crypto);
 return {raw,data,fingerprint,byteSha256:await inboxDigest(raw,crypto),count:data.records.length};
}
export function createInboxArchiveManager({store,storage,crypto=globalThis.crypto,withLock}){
 const prefix=store.getStorageKey()+':inbox-archive-v1:',indexKey=prefix+'index',lockName=store.getStorageKey()+':external-inbox-write';
 function registry(){
  const raw=storage.getItem(indexKey);let list;try{list=raw===null?[]:JSON.parse(raw)}catch{throw Error('INVALID_ARCHIVE_INDEX')}
  if(!Array.isArray(list)||list.length>20)throw Error('INVALID_ARCHIVE_INDEX');const ids=new Set(),fps=new Set();
  for(const x of list){if(!inboxKeys(x,'id,namespace,fingerprint,byteSha256,count,createdAt')||typeof x.id!=='string'||!/^archive-[0-9a-f-]{36}$/.test(x.id)||!inboxString(x.namespace,300)||!inboxHash(x.fingerprint)||!inboxHash(x.byteSha256)||!Number.isInteger(x.count)||x.count<0||x.count>100||!inboxString(x.createdAt,40)||!Number.isFinite(Date.parse(x.createdAt))||ids.has(x.id)||fps.has(x.fingerprint))throw Error('INVALID_ARCHIVE_INDEX');ids.add(x.id);fps.add(x.fingerprint)}
  return {raw,list};
 }
 function guard(){store.assertCurrentStorage()}
 async function prepare(raw){guard();const r=await inspectInboxArchive(raw,crypto);guard();return r}
 async function restore(preview){
  if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  return withLock(lockName,async()=>{
   guard();const current=registry(),inboxRaw=storage.getItem(store.getStorageKey()+':external-inbox-v1');
   const parsed=await inspectInboxArchive(preview.raw,crypto);guard();
   if(parsed.byteSha256!==preview.byteSha256||parsed.fingerprint!==preview.fingerprint)throw Error('ARCHIVE_PREVIEW_CHANGED');
   if(storage.getItem(indexKey)!==current.raw||storage.getItem(store.getStorageKey()+':external-inbox-v1')!==inboxRaw)throw Error('INBOX_STORAGE_CONFLICT');
   if(current.list.some(x=>x.fingerprint===parsed.fingerprint))throw Error('ARCHIVE_ALREADY_RESTORED');if(current.list.length>=20)throw Error('ARCHIVE_LIMIT');
   const id='archive-'+crypto.randomUUID(),key=prefix+id;if(storage.getItem(key)!==null)throw Error('ARCHIVE_SLOT_EXISTS');
   const item={id,namespace:parsed.data.namespace,fingerprint:parsed.fingerprint,byteSha256:parsed.byteSha256,count:parsed.count,createdAt:new Date().toISOString()};
   // localStorage is not multi-key transactional. Never overwrite/clean up on partial failure.
   storage.setItem(key,parsed.raw);try{storage.setItem(indexKey,JSON.stringify([...current.list,item]))}catch{throw Error('ARCHIVE_INDEX_WRITE_FAILED_ORPHAN_PRESERVED')}
   return item;
  });
 }
 async function open(id){guard();const current=registry(),item=current.list.find(x=>x.id===id);if(!item)throw Error('ARCHIVE_NOT_FOUND');const key=prefix+id,raw=storage.getItem(key);const parsed=await inspectInboxArchive(raw,crypto);guard();if(storage.getItem(indexKey)!==current.raw||storage.getItem(key)!==raw)throw Error('INBOX_STORAGE_CONFLICT');if(parsed.byteSha256!==item.byteSha256||parsed.fingerprint!==item.fingerprint||parsed.data.namespace!==item.namespace||parsed.count!==item.count)throw Error('ARCHIVE_HASH_MISMATCH');return parsed}
 return {prepare,restore,open,list(){guard();return registry().list},canRestore:typeof withLock==='function'};
}
