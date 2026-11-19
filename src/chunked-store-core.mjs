// Bounded exact-text container. This codec never parses, installs, or activates a store.
// Callers serialize a validated store compactly before encoding it. Hashes are integrity, not identity.
export const CHUNKED_STORE_SCHEMA='prism-chunked-store/v1';
export const STORE_NATIVE_UNITS=4000000;
export const STORE_NATIVE_BYTES=12000000;
export const STORE_CHUNK_BYTES=1000000;
export const STORE_MAX_CHUNKS=16;
const fail=code=>{throw Object.assign(Error(code),{code})};
const exact=(v,names)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const positive=n=>Number.isSafeInteger(n)&&n>0;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
// Scan before TextEncoder allocation, and reject lone surrogates so distinct inputs cannot
// silently hash as the same replacement character. Splitting always respects code points.
function measured(raw,limit){
 if(typeof raw!=='string'||raw.length>limit)fail('STORE_CHUNK_SIZE_LIMIT');
 let byteLength=0;
 for(let i=0;i<raw.length;i++){
  const code=raw.charCodeAt(i);
  if(code>=0xd800&&code<=0xdbff){const next=raw.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('STORE_CHUNK_INVALID_UNICODE');byteLength+=4}
  else if(code>=0xdc00&&code<=0xdfff)fail('STORE_CHUNK_INVALID_UNICODE');
  else byteLength+=code<128?1:code<2048?2:3;
  if(byteLength>limit)fail('STORE_CHUNK_SIZE_LIMIT');
 }
 return byteLength;
}
async function digest(raw,c){
 if(!c?.subtle?.digest)fail('CRYPTO_UNAVAILABLE');
 const result=new Uint8Array(await c.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 if(result.length!==32)fail('INVALID_DIGEST');
 return Array.from(result,n=>n.toString(16).padStart(2,'0')).join('');
}
function preflight(packet){
 if(!exact(packet,'schema,encoding,codeUnits,byteLength,sha256,chunks')||packet.schema!==CHUNKED_STORE_SCHEMA||packet.encoding!=='utf-8'||!hash(packet.sha256))fail('STORE_CHUNK_INVALID_ENVELOPE');
 if(!positive(packet.codeUnits)||packet.codeUnits>STORE_NATIVE_UNITS||!positive(packet.byteLength)||packet.byteLength>STORE_NATIVE_BYTES||!Array.isArray(packet.chunks)||packet.chunks.length<1||packet.chunks.length>STORE_MAX_CHUNKS)fail('STORE_CHUNK_SIZE_LIMIT');
 let units=0,total=0;
 for(const [index,chunk]of packet.chunks.entries()){
  if(!exact(chunk,'index,codeUnits,byteLength,sha256,text')||chunk.index!==index||!hash(chunk.sha256))fail('STORE_CHUNK_INVALID_SEQUENCE');
  if(!positive(chunk.codeUnits)||chunk.codeUnits>STORE_CHUNK_BYTES||!positive(chunk.byteLength)||chunk.byteLength>STORE_CHUNK_BYTES||typeof chunk.text!=='string'||chunk.text.length!==chunk.codeUnits)fail('STORE_CHUNK_SIZE_LIMIT');
  if(measured(chunk.text,STORE_CHUNK_BYTES)!==chunk.byteLength)fail('STORE_CHUNK_LENGTH_MISMATCH');
  units+=chunk.codeUnits;total+=chunk.byteLength;
  if(units>STORE_NATIVE_UNITS||total>STORE_NATIVE_BYTES)fail('STORE_CHUNK_SIZE_LIMIT');
 }
 if(units!==packet.codeUnits||total!==packet.byteLength)fail('STORE_CHUNK_LENGTH_MISMATCH');
}
// Envelope readers use this before hashing their outer wrapper as well.
export function validateChunkedStoreLayout(packet){preflight(packet);return true}
export async function encodeChunkedStore(raw,c=globalThis.crypto){
 if(typeof raw!=='string'||raw.length<1||raw.length>STORE_NATIVE_UNITS)fail('STORE_CHUNK_SIZE_LIMIT');
 const byteLength=measured(raw,STORE_NATIVE_BYTES),chunks=[];
 let start=0,chunkBytes=0;
 for(let i=0;i<raw.length;i++){
  const code=raw.charCodeAt(i),width=code>=0xd800&&code<=0xdbff?2:1,n=width===2?4:code<128?1:code<2048?2:3;
  if(chunkBytes+n>STORE_CHUNK_BYTES){const text=raw.slice(start,i);chunks.push({index:chunks.length,codeUnits:text.length,byteLength:chunkBytes,sha256:null,text});start=i;chunkBytes=0}
  chunkBytes+=n;i+=width-1;
 }
 const text=raw.slice(start);chunks.push({index:chunks.length,codeUnits:text.length,byteLength:chunkBytes,sha256:null,text});
 if(chunks.length>STORE_MAX_CHUNKS)fail('STORE_CHUNK_SIZE_LIMIT');
 for(const chunk of chunks)chunk.sha256=await digest(chunk.text,c);
 return {schema:CHUNKED_STORE_SCHEMA,encoding:'utf-8',codeUnits:raw.length,byteLength,sha256:await digest(raw,c),chunks};
}
export async function decodeChunkedStore(packet,c=globalThis.crypto){
 preflight(packet);
 // Snapshot at most 16 bounded string references before awaiting caller-supplied crypto.
 const chunks=packet.chunks.map(chunk=>({...chunk})),expected=packet.sha256;
 for(const chunk of chunks)if(await digest(chunk.text,c)!==chunk.sha256)fail('STORE_CHUNK_HASH_MISMATCH');
 const raw=chunks.map(chunk=>chunk.text).join('');
 if(await digest(raw,c)!==expected)fail('STORE_CHUNK_WHOLE_HASH_MISMATCH');
 return raw;
}
