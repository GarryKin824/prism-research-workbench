// Read-only archive containers. Never installs an active store, workflow, queue, or permission.
import {sha256,validateWorkflow} from './custom-core.mjs';
import {validateQueue,queueView} from './library-core.mjs';
import {createStore} from '../lib/store.mjs';
import {createRestoreManager,validateStoreSnapshot} from './restore-core.mjs';
import * as chunkedStoreCore from './chunked-store-core.mjs';
export const ARCHIVE_LIMIT=16000000;
export const WORKFLOW_ARCHIVE_V2_SCHEMA='prism-workflow-archive/v2';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)},keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===k.split(',').sort().join('|'),hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),str=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n&&!/[\u0000-\u001f]/.test(s),date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s,uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze)}return x},bytes=s=>new TextEncoder().encode(s).length;
function safe(x){let nodes=0;const walk=(v,d)=>{if(++nodes>600000||d>65)fail('STRUCTURE_LIMIT');if(v&&typeof v==='object')for(const [k,a]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('UNSAFE_KEY');walk(a,d+1)}};walk(x,0)}
function parse(raw,limit){if(typeof raw!=='string'||raw.length>limit||bytes(raw)>limit)fail('ARCHIVE_TOO_LARGE');let o;try{o=JSON.parse(raw)}catch{fail('INVALID_JSON')}safe(o);return o}
async function digestObject(o,c){const {sha256:_,...body}=o;return sha256(JSON.stringify(body),c)}
async function validateStoreRaw(raw,c,native=false){if(native){const data=parse(raw,chunkedStoreCore.STORE_NATIVE_BYTES),validated=await validateStoreSnapshot(data,{createStore,crypto:c,normalize:false,checkNativeCapacity:true});if(raw!==validated.raw)fail('STORE_CHUNK_NOT_COMPACT');return data}const data=parse(raw,4000000);const manager=createRestoreManager({storage:{getItem:()=>null,setItem:()=>fail('VALIDATION_WRITE_FORBIDDEN')},profileId:'00000000-0000-4000-8000-000000000001',createStore,crypto:c});try{await manager.prepare(raw)}finally{manager.destroy()}return data}
async function validateWorkflowRaw(raw,c){const e=parse(raw,4000000);if(!keys(e,'schema,notice,state,sha256')||e.schema!=='prism-custom-workflow-backup/v1'||!str(e.notice,1000)||!hash(e.sha256)||await digestObject(e,c)!==e.sha256)fail('WORKFLOW_ENVELOPE_INVALID');await validateWorkflow(e.state,c);return e.state}
async function validateQueueRaw(raw,c){const e=parse(raw,4000000);if(!keys(e,'schema,notice,queue,sha256')||e.schema!=='prism-library-queue-backup/v1'||!str(e.notice,1000)||!hash(e.sha256)||await digestObject(e,c)!==e.sha256)fail('QUEUE_ENVELOPE_INVALID');await validateQueue(e.queue,c);return e.queue}
async function validateContents(namespace,storeRaw,workflowRaws,queueRaws,c,native=false){if(!str(namespace,300)||!Array.isArray(workflowRaws)||workflowRaws.length>100||!Array.isArray(queueRaws)||queueRaws.length>30)fail('INVALID_CONTENTS');const store=await validateStoreRaw(storeRaw,c,native),papers=new Map(store.papers.map(p=>[p.id,p])),workflows=new Map(),queues=new Map(),warnings=[];for(const p of store.papers){if(!p.document)warnings.push({code:'PAPER_DOCUMENT_NOT_PRESENT',paperId:p.id});if(p.accepted||p.runs.some(r=>r.status==='running'))warnings.push({code:'LEGACY_ACCEPTANCE_OR_RUNNING_HISTORY_ONLY',paperId:p.id})}
 for(const raw of workflowRaws){const w=await validateWorkflowRaw(raw,c);if(workflows.has(w.id))fail('DUPLICATE_WORKFLOW');if(!w.source||w.source.namespace!==namespace)fail('WORKFLOW_NAMESPACE_MISMATCH');const p=papers.get(w.source.paperId);if(!p)fail('MISSING_WORKFLOW_PAPER:'+w.source.paperId);if(w.legacy){const oldStore={schema:1,revision:0,papers:[w.legacy.snapshot]};await validateStoreRaw(JSON.stringify(oldStore),c);if(w.legacy.snapshot.id!==w.source.paperId||w.legacy.snapshot.title!==w.source.paperTitle||(w.legacy.snapshot.document?.sha256??null)!==w.source.documentSha256)fail('LEGACY_SOURCE_BINDING_MISMATCH')}if(await sha256(JSON.stringify(p),c)!==w.source.sourceArchiveSha256)warnings.push({code:'WORKFLOW_SOURCE_SNAPSHOT_DRIFT',workflowId:w.id,paperId:p.id});if(w.source.documentSha256!==null&&p.document?.sha256!==w.source.documentSha256&&!w.legacy?.snapshot.document)fail('MISSING_HISTORICAL_DOCUMENT:'+w.id);if(w.runs.some(r=>r.status==='running')||w.syntheticAuthorized||w.approvals.length)warnings.push({code:'HISTORICAL_AUTHORITY_OR_RUNNING_NOT_RESTORED',workflowId:w.id,paperId:p.id});workflows.set(w.id,w)}
 for(const raw of queueRaws){const q=await validateQueueRaw(raw,c);if(queues.has(q.id))fail('DUPLICATE_QUEUE');for(const cfg of q.configs)for(const e of cfg.entries){if(e.namespace!==namespace)fail('QUEUE_NAMESPACE_MISMATCH');const w=workflows.get(e.workflowId);if(!w)fail('MISSING_QUEUE_WORKFLOW:'+e.workflowId);if(!papers.has(e.paperId))fail('MISSING_QUEUE_PAPER:'+e.paperId);if(w.source.paperId!==e.paperId)fail('QUEUE_WORKFLOW_PAPER_MISMATCH');if(!w.graphs.some(g=>g.sha256===e.graphSha256))fail('MISSING_QUEUE_GRAPH:'+e.id)}for(const event of q.events.filter(e=>e.type==='complete')){const r=event.data.receipt,w=workflows.get(r.workflowId),g=w?.graphs.find(g=>g.version===r.graphVersion&&g.sha256===r.graphSha256);if(!g)fail('MISSING_RECEIPT_GRAPH');if(JSON.stringify(r.nodeIds)!==JSON.stringify(g.policy.completion.nodeIds)||JSON.stringify(r.reviewIds)!==JSON.stringify(g.policy.completion.reviewIds))fail('RECEIPT_COMPLETION_POLICY_MISMATCH');for(const ev of r.evidence){const run=w.runs.find(x=>x.id===ev.runId);if(!run||run.nodeId!==ev.nodeId||run.graphVersion!==g.version||run.status!=='completed'||run.verdict!==ev.verdict||run.artifact?.sha256!==ev.artifactSha256)fail('RECEIPT_WORKFLOW_EVIDENCE_MISMATCH')}}const v=queueView(q);if(q.allowed||v.pending||v.active)warnings.push({code:'HISTORICAL_QUEUE_CONTROL_NOT_RESTORED',queueId:q.id});for(const target of [v.pending?.entry,v.active?.entry,v.nextEntry].filter(Boolean)){const w=workflows.get(target.workflowId);if(w.graphs.find(g=>g.version===w.currentVersion).sha256!==target.graphSha256)warnings.push({code:'QUEUE_CURRENT_GRAPH_DRIFT',queueId:q.id,entryId:target.id})}queues.set(q.id,q)}
 return {namespace,papers:store.papers.length,documents:store.papers.filter(p=>p.document).length,workflows:workflows.size,queues:queues.size,workflowRuns:[...workflows.values()].reduce((n,w)=>n+w.runs.length,0),queueEvents:[...queues.values()].reduce((n,q)=>n+q.events.length,0),warnings,readOnly:true,authority:'none'}
}
// Shallow known envelope inventory only. Count escaping before allocating its JSON text.
function envelopeBytes(value){
 let total=0;
 const add=n=>{total+=n;if(total>ARCHIVE_LIMIT)fail('ARCHIVE_TOO_LARGE')};
 function visit(v){
  if(v===null){add(4);return}
  if(typeof v==='number'){add(String(v).length);return}
  if(typeof v==='string'){
   add(2);for(let i=0;i<v.length;i++){const code=v.charCodeAt(i);if(code===34||code===92)add(2);else if(code<32)add([8,9,10,12,13].includes(code)?2:6);else if(code<128)add(1);else if(code<2048)add(2);else if(code>=0xd800&&code<=0xdbff){const next=v.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){add(4);i++}else add(6)}else add(code>=0xdc00&&code<=0xdfff?6:3)}return;
  }
  const array=Array.isArray(v);add(2);let first=true;for(const [k,item]of Object.entries(v)){if(!first)add(1);first=false;if(!array){visit(k);add(1)}visit(item)}
 }
 visit(value);return total;
}
async function decodeEnvelope(raw,c){
 const archive=parse(raw,ARCHIVE_LIMIT),v2=archive?.schema===WORKFLOW_ARCHIVE_V2_SCHEMA;
 if(!keys(archive,v2?'schema,namespace,createdAt,storeChunks,workflowRaws,queueRaws,sha256':'schema,namespace,createdAt,storeRaw,workflowRaws,queueRaws,sha256')||(!v2&&archive.schema!=='prism-workflow-archive/v1')||!date(archive.createdAt)||!hash(archive.sha256))fail('INVALID_ARCHIVE');
 if(v2)chunkedStoreCore.validateChunkedStoreLayout(archive.storeChunks);
 if(await digestObject(archive,c)!==archive.sha256)fail('ARCHIVE_HASH_MISMATCH');
 const storeRaw=v2?await chunkedStoreCore.decodeChunkedStore(archive.storeChunks,c):archive.storeRaw;
 return {archive,storeRaw,v2};
}
async function checked(raw,c){const decoded=await decodeEnvelope(raw,c),{archive,storeRaw,v2}=decoded;const summary=await validateContents(archive.namespace,storeRaw,archive.workflowRaws,archive.queueRaws,c,v2);return {...decoded,summary}}
// Internal project readers call this only after full archive inspection. It verifies the
// envelope and chunk integrity again, then exposes historical plain data, never a store.
export async function decodeArchiveComponents(raw,c=globalThis.crypto){const {archive,storeRaw}=await decodeEnvelope(raw,c);return {archive,storeRaw,store:parse(storeRaw,archive.schema===WORKFLOW_ARCHIVE_V2_SCHEMA?chunkedStoreCore.STORE_NATIVE_BYTES:4000000)}}
export async function createArchive({namespace,storeRaw,workflowRaws=[],queueRaws=[],version='auto'},c=globalThis.crypto){
 if(!['auto',1,2].includes(version))fail('INVALID_ARCHIVE_VERSION');
 if(typeof storeRaw!=='string'||storeRaw.length>ARCHIVE_LIMIT||bytes(storeRaw)>ARCHIVE_LIMIT)fail('ARCHIVE_TOO_LARGE');
 if(!str(namespace,300)||!Array.isArray(workflowRaws)||workflowRaws.length>100||!Array.isArray(queueRaws)||queueRaws.length>30)fail('INVALID_CONTENTS');
 let total=bytes(storeRaw);for(const item of [...workflowRaws,...queueRaws]){if(typeof item!=='string'||item.length>4000000||bytes(item)>4000000)fail('ARCHIVE_TOO_LARGE');total+=bytes(item);if(total>ARCHIVE_LIMIT)fail('ARCHIVE_TOO_LARGE')}
 const content={namespace,storeRaw,workflowRaws:[...workflowRaws],queueRaws:[...queueRaws]};
 let v2=version===2||version==='auto'&&bytes(storeRaw)>4000000;
 if(!v2){
  try{await validateContents(namespace,storeRaw,content.workflowRaws,content.queueRaws,c)}
  catch(e){if(version==='auto'&&(e.code||e.message)==='BACKUP_TOO_LARGE')v2=true;else throw e}
 }
 let a;
 if(v2){
  // The v2 component is explicitly compact JSON. Paper text/history/field order are
  // unchanged, but its hash does not claim the old pretty JSON's byte identity.
  const input=parse(storeRaw,ARCHIVE_LIMIT),validated=await validateStoreSnapshot(input,{createStore,crypto:c,normalize:false,checkNativeCapacity:true});
  const compact=validated.raw;
  await validateContents(namespace,compact,content.workflowRaws,content.queueRaws,c,true);
  a={schema:WORKFLOW_ARCHIVE_V2_SCHEMA,namespace,createdAt:new Date().toISOString(),storeChunks:await chunkedStoreCore.encodeChunkedStore(compact,c),workflowRaws:content.workflowRaws,queueRaws:content.queueRaws};
 }else a={schema:'prism-workflow-archive/v1',namespace,createdAt:new Date().toISOString(),storeRaw,workflowRaws:content.workflowRaws,queueRaws:content.queueRaws};
 envelopeBytes({...a,sha256:'0'.repeat(64)});
 return JSON.stringify({...a,sha256:await sha256(JSON.stringify(a),c)});
}
function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'}
export async function inspectArchive(raw,c=globalThis.crypto){const {archive,storeRaw,summary}=await checked(raw,c);const content={namespace:archive.namespace,store:JSON.parse(storeRaw),workflows:archive.workflowRaws.map(r=>JSON.parse(r).state).sort((a,b)=>a.id.localeCompare(b.id)),queues:archive.queueRaws.map(r=>JSON.parse(r).queue).sort((a,b)=>a.id.localeCompare(b.id))};return freeze({raw,byteSha256:await sha256(raw,c),fingerprint:await sha256(canonical(content),c),summary:{...summary,byteLength:bytes(raw)}})}
export async function validateArchive(raw,c=globalThis.crypto){await checked(raw,c);return true}
