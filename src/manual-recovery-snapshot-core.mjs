import {readManualArchive,serializeManualArchive} from './manual-archive-core.mjs';
import {createLocalPreparation} from './local-preparation-core.mjs';
import {sha256} from './custom-core.mjs';

// Full, plaintext originals. This format confers no workflow or sending authority.
export const MANUAL_RECOVERY_SNAPSHOT_SCHEMA='prism-manual-recovery-snapshot-v1';
export const MANUAL_RECOVERY_FILE_MAX_BYTES=8388608;
export const MANUAL_RECOVERY_LOCAL_MAX_BYTES=2097152;
const fail=code=>{throw Error(code)},clone=x=>JSON.parse(JSON.stringify(x));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
const byteLength=value=>new TextEncoder().encode(value).length;
function checkContext(context){
 if(!exact(context,'namespace,projectId,paperId,paperTitle'))fail('MANUAL_RECOVERY_CONTEXT');
 for(const key of ['namespace','projectId','paperId','paperTitle'])if(typeof context[key]!=='string'||context[key].length>512)fail('MANUAL_RECOVERY_CONTEXT');
 if(!context.namespace||!context.paperId)fail('MANUAL_RECOVERY_CONTEXT');
}
function sameScope(record,context){return ['namespace','projectId','paperId'].every(key=>record?.origin?.[key]===context[key])}
function checkRaw(raw){if(typeof raw!=='string'||!raw.length||raw.length>MANUAL_RECOVERY_FILE_MAX_BYTES||byteLength(raw)>MANUAL_RECOVERY_FILE_MAX_BYTES)fail('MANUAL_RECOVERY_FILE_SIZE')}
export function assertManualRecoveryLocalSize(raw){
 checkRaw(raw);
 if(byteLength(raw)>MANUAL_RECOVERY_LOCAL_MAX_BYTES||raw.length*2>MANUAL_RECOVERY_LOCAL_MAX_BYTES)fail('MANUAL_RECOVERY_LOCAL_TOO_LARGE_USE_FILE');
 return true;
}
function payloadFor(context,archive){
 // Do not recursively sort nested material. Existing preparation digests bind
 // JSON field order as well as content; retain those exact nested objects.
 return {schema:MANUAL_RECOVERY_SNAPSHOT_SCHEMA,context,authority:'none',executionAllowed:false,networkAllowed:false,archive};
}
async function descriptor(raw,{kind,context,archive,integritySha256,excludedRecordCount=0},crypto){
 const archiveRaw=kind==='legacy-archive'?raw:JSON.stringify(archive),checked=await readManualArchive(archiveRaw,{crypto,prepare:createLocalPreparation});
 if(context&&!checked.records.every(record=>sameScope(record,context)))fail('MANUAL_RECOVERY_SCOPE_MISMATCH');
 return {kind,raw,archiveRaw,records:checked.records,context:context?clone(context):null,integritySha256,rawSha256:await sha256(raw,crypto),summary:{recordCount:checked.records.length,replyCount:checked.records.reduce((n,r)=>n+r.replies.length,0),draftCount:checked.records.filter(r=>r.replyDraft).length,excludedRecordCount,utf8Bytes:byteLength(raw),utf16Bytes:raw.length*2},readOnly:true,authority:'none',executionAllowed:false};
}
export async function createManualRecoverySnapshot({context,records,drafts={},includeDrafts=false},crypto=globalThis.crypto){
 // Freeze all caller values before the first hashing yield.
 checkContext(context);
 if(!Array.isArray(records)||records.length>20||!drafts||typeof drafts!=='object'||Array.isArray(drafts)||typeof includeDrafts!=='boolean')fail('MANUAL_RECOVERY_INPUT');
 const draftKeys=Object.keys(drafts);
 if(draftKeys.length>20||draftKeys.some(key=>!key.length||key.length>128||typeof drafts[key]!=='string'||drafts[key].length>64000))fail('MANUAL_RECOVERY_DRAFT');
 for(const record of records){
  if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.id!=='string'||!record.id.length||record.id.length>128||!Array.isArray(record.replies)||record.replies.length>20)fail('MANUAL_RECOVERY_INPUT');
  for(const reply of record.replies)if(!reply||typeof reply!=='object'||Array.isArray(reply)||typeof reply.id!=='string'||!reply.id.length||reply.id.length>128||typeof reply.content!=='string'||reply.content.length>64000)fail('MANUAL_RECOVERY_INPUT');
 }
 const capturedContext=clone(context),selected=records.filter(record=>sameScope(record,capturedContext)).map(record=>({...record}));
 if(!selected.length)fail('MANUAL_RECOVERY_SCOPE_EMPTY');
 const excludedRecordCount=records.length-selected.length;
 for(const record of selected){
  delete record.replyDraft;
  if(includeDrafts&&Object.hasOwn(drafts,record.id)){
   const content=drafts[record.id];
   if(content.length)record.replyDraft={content,status:'unsubmitted',verification:'unverified'};
  }
 }
 // Serialize and enforce the archive cap before allocating the deep parsed copy.
 // These bounded serialized formats are not a guarantee about peak browser heap.
 const archive=JSON.parse(serializeManualArchive(selected)),payload=payloadFor(capturedContext,archive);
 // Validate originals before issuing an exportable snapshot.
 await readManualArchive(JSON.stringify(archive),{crypto,prepare:createLocalPreparation});
 const integritySha256=await sha256(JSON.stringify(payload),crypto),raw=JSON.stringify({...payload,integritySha256});checkRaw(raw);
 return descriptor(raw,{kind:'snapshot',context:capturedContext,archive,integritySha256,excludedRecordCount},crypto);
}
export async function readManualRecoverySnapshot(raw,{crypto=globalThis.crypto,allowLegacy=true}={}){
 checkRaw(raw);let input;try{input=JSON.parse(raw)}catch{fail('MANUAL_RECOVERY_JSON')}
 if(allowLegacy&&input?.schema==='prism-manual-research-records-v1')return descriptor(raw,{kind:'legacy-archive',context:null,archive:input,integritySha256:null},crypto);
 if(!exact(input,'schema,context,authority,executionAllowed,networkAllowed,archive,integritySha256')||input.schema!==MANUAL_RECOVERY_SNAPSHOT_SCHEMA||input.authority!=='none'||input.executionAllowed!==false||input.networkAllowed!==false||typeof input.integritySha256!=='string'||!(/^[a-f0-9]{64}$/).test(input.integritySha256))fail('MANUAL_RECOVERY_SCHEMA');
 checkContext(input.context);
 const payload=payloadFor(input.context,input.archive);
 if(await sha256(JSON.stringify(payload),crypto)!==input.integritySha256)fail('MANUAL_RECOVERY_HASH');
 return descriptor(raw,{kind:'snapshot',context:input.context,archive:input.archive,integritySha256:input.integritySha256},crypto);
}
export async function readManualRecoveryFile(file,{crypto=globalThis.crypto,isCurrent=()=>true}={}){
 if(isCurrent()!==true)return null;
 const name=file?.name,size=file?.size;
 if(typeof name!=='string'||!name.length||name.length>255||!Number.isSafeInteger(size)||size<1||size>MANUAL_RECOVERY_FILE_MAX_BYTES||typeof file?.arrayBuffer!=='function')fail('MANUAL_RECOVERY_FILE_SIZE');
 const buffer=await file.arrayBuffer();if(isCurrent()!==true)return null;
 if(file.name!==name||file.size!==size)fail('MANUAL_RECOVERY_FILE_CHANGED');
 if(Object.prototype.toString.call(buffer)!=='[object ArrayBuffer]'||buffer.byteLength!==size)fail('MANUAL_RECOVERY_FILE_LENGTH');
 let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}catch{fail('MANUAL_RECOVERY_FILE_ENCODING')}
 const result=await readManualRecoverySnapshot(raw,{crypto});return isCurrent()===true?result:null;
}
