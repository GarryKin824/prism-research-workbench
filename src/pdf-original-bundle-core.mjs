import {PDF_ORIGINAL_VAULT_LIMITS,validVaultNamespace,validVaultName,validVaultHash,validVaultSize,assertPdfHeader,sha256VaultBytes,vaultArrayBufferLength,vaultUint8Array} from './pdf-original-vault-core.mjs';

// Independent byte collection, never an active project, restore, permission or authenticity token.
export const PDF_ORIGINAL_BUNDLE_FORMAT='prism-pdf-original-bundle';
export const PDF_ORIGINAL_BUNDLE_LIMITS=Object.freeze({...PDF_ORIGINAL_VAULT_LIMITS,maxTotalBytes:40*1024*1024,maxPacketBytes:56*1024*1024});
// An encoded bundle has its own memory budget, independent of the original vault.
const LIMITS=PDF_ORIGINAL_BUNDLE_LIMITS,inspections=new WeakMap(),encoder=new TextEncoder();
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Resolve Blob capabilities only for explicit creation/extraction. Incomplete
// browser/test environments must still load the surrounding workbench safely.
function blobCapabilities() {
 try {
  const BlobClass=globalThis.Blob,proto=BlobClass?.prototype;
  if(typeof BlobClass!=='function'||!proto)return null;
  const size=Object.getOwnPropertyDescriptor(proto,'size')?.get,type=Object.getOwnPropertyDescriptor(proto,'type')?.get,slice=proto.slice,read=proto.arrayBuffer;
  if([size,type,slice,read].some(value=>typeof value!=='function'))return null;
  return {BlobClass,size,type,slice,read};
 }catch{return null}
}
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const typedOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const typedBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const result=(ok,code,extra={})=>Object.freeze({ok,code,...extra});
const fail=code=>{const error=new Error(code);error.code=code;throw error};
const check=isCurrent=>{if(isCurrent){let current=false;try{current=isCurrent()===true}catch{}if(!current)fail('CANCELLED')}};
const caught=e=>result(false,typeof e?.code==='string'?e.code:'INVALID_PACKET');
const schema=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||!([Object.prototype,null].includes(Object.getPrototypeOf(value)))||Object.keys(value).sort().join('|')!==keys.slice().sort().join('|'))fail('INVALID_SCHEMA')};
const metadata=row=>Object.freeze({id:row.id,name:row.name,size:row.size,sha256:row.sha256});
// Preserve every name accepted by the vault. It is inert display metadata, never
// an output path; callers must use a digest-derived filename for extraction.
const validName=validVaultName;
function validateMeta(row) {
 if(!validVaultHash(row.id)||row.id!==row.sha256||!validName(row.name)||!validVaultSize(row.size))fail('INVALID_SCHEMA');
}
function payload(namespace,files,totalBytes) {return {format:PDF_ORIGINAL_BUNDLE_FORMAT,version:1,source:{namespace},files,totalBytes}}
function summary(value,packetSha256) {return Object.freeze({format:value.format,version:value.version,namespace:value.source.namespace,fileCount:value.files.length,totalBytes:value.totalBytes,packetSha256,files:Object.freeze(value.files.map(metadata))})}
async function hash(bytes,crypto,isCurrent) {check(isCurrent);const digest=await sha256VaultBytes(bytes,crypto);check(isCurrent);return digest}
function encodeBase64(bytes) {
 // Bounded chunks avoid argument-count and repeated-concatenation limits.
 const chunks=[];let chunk='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];chunk+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');if(chunk.length>=16384){chunks.push(chunk);chunk=''}}
 if(chunk)chunks.push(chunk);return chunks.join('');
}
function base64Value(code) {if(code>=65&&code<=90)return code-65;if(code>=97&&code<=122)return code-71;if(code>=48&&code<=57)return code+4;if(code===43)return 62;if(code===47)return 63;return -1}
function validateBase64(text,size) {
 if(typeof text!=='string'||text.length!==Math.ceil(size/3)*4)fail('INVALID_BASE64');
 const pad=(3-size%3)%3,end=text.length-pad;
 for(let i=0;i<end;i++)if(base64Value(text.charCodeAt(i))<0)fail('INVALID_BASE64');
 for(let i=end;i<text.length;i++)if(text[i]!=='=')fail('INVALID_BASE64');
 if(pad&&(base64Value(text.charCodeAt(end-1))&(pad===2?15:3))!==0)fail('INVALID_BASE64');
}
function decodeBase64(text,size) {
 const bytes=new Uint8Array(size);let offset=0;
 for(let i=0;i<text.length;i+=4){const a=base64Value(text.charCodeAt(i)),b=base64Value(text.charCodeAt(i+1)),c=base64Value(text.charCodeAt(i+2)),d=base64Value(text.charCodeAt(i+3));bytes[offset++]=(a<<2)|(b>>4);if(offset<size)bytes[offset++]=(b<<4)|(c>>2);if(offset<size)bytes[offset++]=(c<<6)|d;}
 return bytes;
}
function packetText(input) {
 if(typeof input==='string'){
  if(input.length>LIMITS.maxPacketBytes)fail('PACKET_TOO_LARGE');
  if(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(input))fail('INVALID_UTF8');
  // Count before encoding: a hostile multibyte string must not allocate a
  // 3x-over-limit temporary buffer merely to discover its UTF-8 length.
  let length=0;for(let i=0;i<input.length;i++){const code=input.charCodeAt(i);if(code<0x80)length++;else if(code<0x800)length+=2;else if(code>=0xd800&&code<=0xdbff){length+=4;i++}else length+=3;if(length>LIMITS.maxPacketBytes)fail('PACKET_TOO_LARGE')}return input;
 }
 let length,bytes;
 if(vaultUint8Array(input)){length=typedLength.call(input);if(length>LIMITS.maxPacketBytes)fail('PACKET_TOO_LARGE');bytes=new Uint8Array(new Uint8Array(typedBuffer.call(input),typedOffset.call(input),length))}
 else if((length=vaultArrayBufferLength(input))!==null){if(length>LIMITS.maxPacketBytes)fail('PACKET_TOO_LARGE');bytes=new Uint8Array(input).slice()}
 else fail('INVALID_PACKET');
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{fail('INVALID_UTF8')}
}
function parsePacket(text) {
 let value;try{value=JSON.parse(text)}catch{fail('INVALID_PACKET')}
 schema(value,['format','version','source','files','totalBytes','packageSha256']);schema(value.source,['namespace']);
 if(value.format!==PDF_ORIGINAL_BUNDLE_FORMAT||value.version!==1||!validVaultNamespace(value.source.namespace)||!validVaultHash(value.packageSha256))fail('INVALID_SCHEMA');
 if(!Array.isArray(value.files)||value.files.length<1||value.files.length>LIMITS.maxFiles)fail('LIMIT_EXCEEDED');
 if(!Number.isSafeInteger(value.totalBytes)||value.totalBytes<5||value.totalBytes>LIMITS.maxTotalBytes)fail('LIMIT_EXCEEDED');
 const ids=new Set();let total=0;
 for(const row of value.files){schema(row,['id','name','size','sha256','base64']);validateMeta(row);if(ids.has(row.id))fail('DUPLICATE_ID');ids.add(row.id);total+=row.size;if(total>LIMITS.maxTotalBytes)fail('LIMIT_EXCEEDED');validateBase64(row.base64,row.size)}
 if(total!==value.totalBytes)fail('VERIFY_FAILED');
 const normalized=payload(value.source.namespace,value.files.map(row=>({...metadata(row),base64:row.base64})),total);
 // One canonical UTF-8 serialization rejects duplicate JSON keys, extra spacing,
 // alternate escapes and key reorderings. This is a file protocol, not free-form JSON.
 if(text!==JSON.stringify({...normalized,packageSha256:value.packageSha256}))fail('NON_CANONICAL_PACKET');
 return {value:normalized,packageSha256:value.packageSha256};
}

export async function createPdfOriginalBundle(snapshot,{crypto=globalThis.crypto,isCurrent}={}) {
 try{
  check(isCurrent);const capabilities=blobCapabilities();if(!capabilities)fail('UNSUPPORTED');
  // Capture and validate all metadata and native immutable Blob slices before any
  // await. Later mutations of caller-owned arrays/records cannot change the packet.
  if(!snapshot||typeof snapshot!=='object')fail('INVALID_SNAPSHOT');
  const namespace=snapshot.namespace,rows=snapshot.records,expectedTotal=snapshot.totalBytes;
  if(!validVaultNamespace(namespace)||!Array.isArray(rows))fail('INVALID_SNAPSHOT');
  if(rows.length===0)fail('EMPTY_BUNDLE');if(rows.length>LIMITS.maxFiles)fail('LIMIT_EXCEEDED');
  const captures=[],ids=new Set();let total=0;
  for(const source of rows){schema(source,['id','name','size','sha256','blob']);const row={id:source.id,name:source.name,size:source.size,sha256:source.sha256},blob=source.blob;validateMeta(row);if(ids.has(row.id))fail('DUPLICATE_ID');ids.add(row.id);total+=row.size;if(total>LIMITS.maxTotalBytes)fail('LIMIT_EXCEEDED');
   let owned;try{if(capabilities.size.call(blob)!==row.size||capabilities.type.call(blob)!=='application/pdf')fail('INVALID_SNAPSHOT');owned=capabilities.slice.call(blob,0,row.size,'application/pdf')}catch{fail('INVALID_SNAPSHOT')}
   captures.push({...row,blob:owned});
  }
  if(expectedTotal!==total)fail('INVALID_SNAPSHOT');
  const files=[];
  for(const row of captures){check(isCurrent);const buffer=await capabilities.read.call(row.blob);check(isCurrent);if(vaultArrayBufferLength(buffer)!==row.size)fail('VERIFY_FAILED');const bytes=new Uint8Array(buffer);assertPdfHeader(bytes);if(await hash(bytes,crypto,isCurrent)!==row.sha256)fail('VERIFY_FAILED');files.push({...metadata(row),base64:encodeBase64(bytes)})}
  const value=payload(namespace,files,total),packageSha256=await hash(encoder.encode(JSON.stringify(value)),crypto,isCurrent),text=JSON.stringify({...value,packageSha256}),byteLength=encoder.encode(text).byteLength;
  if(byteLength>LIMITS.maxPacketBytes)fail('PACKET_TOO_LARGE');check(isCurrent);
  return result(true,'CREATED',{text,byteLength,summary:summary(value,packageSha256)});
 }catch(e){return caught(e)}
}

export async function inspectPdfOriginalBundle(input,{crypto=globalThis.crypto,isCurrent}={}) {
 try{
  check(isCurrent);const text=packetText(input),{value,packageSha256}=parsePacket(text);check(isCurrent);
  if(await hash(encoder.encode(JSON.stringify(value)),crypto,isCurrent)!==packageSha256)fail('VERIFY_FAILED');
  const rows=[];
  for(const row of value.files){check(isCurrent);const bytes=decodeBase64(row.base64,row.size);assertPdfHeader(bytes);if(await hash(bytes,crypto,isCurrent)!==row.sha256)fail('VERIFY_FAILED');rows.push({metadata:metadata(row),bytes})}
  check(isCurrent);const inspection=Object.freeze({}),info=summary(value,packageSha256);inspections.set(inspection,rows);
  return result(true,'INSPECTED',{summary:info,inspection});
 }catch(e){return caught(e)}
}

export function extractPdfOriginalBundle(inspection,id) {
 try{
  const rows=inspection&&typeof inspection==='object'?inspections.get(inspection):null;if(!rows)fail('INVALID_INSPECTION');
  if(!validVaultHash(id))fail('INVALID_ID');const row=rows.find(row=>row.metadata.id===id);if(!row)fail('NOT_FOUND');
  const capabilities=blobCapabilities();if(!capabilities)fail('UNSUPPORTED');
  // Each caller owns its byte copy; mutating it cannot change the issued Blob or
  // any subsequent extraction. No export API accepts caller-created inspection data.
  const bytes=row.bytes.slice(),blob=new capabilities.BlobClass([bytes],{type:'application/pdf'});
  return result(true,'EXTRACTED',{...row.metadata,bytes,blob});
 }catch(e){return caught(e)}
}
