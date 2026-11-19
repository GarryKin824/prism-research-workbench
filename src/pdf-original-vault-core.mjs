import {LIMITS as PDF_LIMITS} from "./pdf-intake/policy.mjs";

// Independent original-byte vault. A PDF header/hash is not validation or malware scanning.
export const PDF_ORIGINAL_VAULT_LIMITS = Object.freeze({maxFileBytes:PDF_LIMITS.maxBytes,maxFiles:32,maxTotalBytes:256*1024*1024,maxNameLength:255,maxNamespaceLength:1024});
export const PDF_ORIGINAL_VAULT_DB_PREFIX = 'prism:pdf-original-vault:v1:';
export const PDF_ORIGINAL_VAULT_STORE = 'originals';
export function vaultError(code) { const error=new Error(code);error.code=code;return error; }
export function validVaultNamespace(value) { return typeof value==='string'&&value.length>0&&value.length<=PDF_ORIGINAL_VAULT_LIMITS.maxNamespaceLength&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value); }
export function validVaultName(value) { return typeof value==='string'&&value.trim().length>0&&value.length<=PDF_ORIGINAL_VAULT_LIMITS.maxNameLength&&!/[\u0000-\u001f\u007f-\u009f/\\]/u.test(value)&&/\.pdf$/iu.test(value)&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value); }
export function validVaultHash(value) { return typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value); }
export function validVaultSize(value) { return Number.isSafeInteger(value)&&value>=5&&value<=PDF_ORIGINAL_VAULT_LIMITS.maxFileBytes; }
const arrayBufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const typedArrayTag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag).get;
export function vaultArrayBufferLength(value) { try{return arrayBufferLength.call(value)}catch{return null} }
export function vaultUint8Array(value) { try{return typedArrayTag.call(value)==='Uint8Array'}catch{return false} }
export function assertPdfHeader(bytes) { if(!vaultUint8Array(bytes)||bytes.length<5||bytes[0]!==37||bytes[1]!==80||bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)throw vaultError('NOT_PDF_HEADER'); }
export function vaultMetadata(record) { return Object.freeze({id:record.id,name:record.name,size:record.size,sha256:record.sha256}); }
export function validateVaultRecord(record,namespace,BlobClass) {
 if(!record||typeof record!=='object'||Object.keys(record).sort().join('|')!=='blob|id|name|namespace|sha256|size|version'||record.version!==1||record.namespace!==namespace||!validVaultHash(record.id)||record.id!==record.sha256||!validVaultName(record.name)||!validVaultSize(record.size)||!(record.blob instanceof BlobClass)||record.blob.size!==record.size||record.blob.type!=='application/pdf')throw vaultError('CORRUPT_RECORD');
 return record;
}
export async function sha256VaultBytes(bytes,crypto) {
 if(!crypto?.subtle||typeof crypto.subtle.digest!=='function')throw vaultError('UNSUPPORTED');
 // Copy before invoking injected/native crypto; callers never own this hash input.
 const digest=await crypto.subtle.digest('SHA-256',bytes.slice());
 if(vaultArrayBufferLength(digest)!==32)throw vaultError('HASH_FAILED');
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
