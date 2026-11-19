/** Goal/version-bound, local search records. Hashes are integrity checks, not authority. */
import * as projectPlanningCore from './project-planning-core.mjs';
import * as discoverySourcesCore from './discovery-sources.mjs';
import {sha256} from './custom-core.mjs';
export const PROJECT_DISCOVERY_RECORD_LIMIT=1048576;
const PROTOCOL='prism-project-discovery-protocol/v1', RECORD='prism-project-discovery-record/v1';
const fail=code=>{throw Object.assign(new Error('PROJECT_DISCOVERY_'+code),{code:'PROJECT_DISCOVERY_'+code})};
const bytes=s=>new TextEncoder().encode(s).length;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Reflect.ownKeys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'));
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sourceId=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(x);
const unicode=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const text=(x,max,empty=false,lines=false)=>typeof x==='string'&&x.length<=max&&(empty||!!x.trim())&&!unicode.test(x)&&!(lines?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/:/[\x00-\x1f\x7f-\x9f]/).test(x);
const ids=(x,max=5)=>Array.isArray(x)&&x.length<=max&&x.every(sourceId)&&new Set(x).size===x.length;
const iso=x=>{try{return typeof x==='string'&&x.length===24&&new Date(x).toISOString()===x}catch{return false}};
function copy(input){
 let count=0,units=0;const seen=new Set();
 function visit(x,depth){
  if(++count>30000||depth>20||(units+=8)>PROJECT_DISCOVERY_RECORD_LIMIT)fail('COMPLEXITY_LIMIT');
  if(x===null||typeof x==='boolean')return x;
  if(typeof x==='string'){if((units+=x.length)>PROJECT_DISCOVERY_RECORD_LIMIT||unicode.test(x))fail('INVALID_TEXT');return x}
  if(typeof x==='number'){if(!Number.isFinite(x))fail('INVALID_NUMBER');return x}
  if(typeof x!=='object'||seen.has(x))fail('INVALID_DATA');seen.add(x);
  const keys=Reflect.ownKeys(x),array=Array.isArray(x),proto=Object.getPrototypeOf(x);if(keys.length>30000)fail('COMPLEXITY_LIMIT');
  if(array){if(keys.length!==x.length+1||!keys.every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9]\d*)$/.test(k)&&Number(k)<x.length))fail('INVALID_ARRAY')}
  else if(proto!==null&&Object.getPrototypeOf(proto)!==null)fail('INVALID_DATA');
  // Copy own data descriptors into fresh data-only containers. Cross-realm plain
  // objects are allowed, but accessors, inherited serializers and prototypes are not used.
  const result=array?[]:Object.create(null);
  for(const k of keys){const descriptor=Object.getOwnPropertyDescriptor(x,k);if(typeof k!=='string'||!descriptor||!Object.hasOwn(descriptor,'value'))fail('INVALID_DATA');if((units+=k.length)>PROJECT_DISCOVERY_RECORD_LIMIT)fail('TOO_LARGE');if(k!=='length'||!array)result[k]=visit(descriptor.value,depth+1)}
  seen.delete(x);return result;
 }
 const raw=JSON.stringify(visit(input,0));if(bytes(raw)>PROJECT_DISCOVERY_RECORD_LIMIT)fail('TOO_LARGE');return JSON.parse(raw);
}
function bindingValid(b){if(!exact(b,['namespace','projectId','revisionId','revisionSha256','revisionSeq','title','goal'])||!text(b.namespace,300)||!id(b.projectId)||!id(b.revisionId)||!hash(b.revisionSha256)||!Number.isSafeInteger(b.revisionSeq)||b.revisionSeq<1||b.revisionSeq>200||!text(b.title,500,false,true)||!text(b.goal,12000,false,true))fail('INVALID_BINDING')}
function protocolValid(p){if(!exact(p,['schema','binding','query','sourceIds','authority','executionAllowed','sha256'])||p.schema!==PROTOCOL||p.authority!=='none'||p.executionAllowed!==false||!hash(p.sha256)||!text(p.query,300)||p.query!==p.query.trim()||!ids(p.sourceIds)||!p.sourceIds.length)fail('INVALID_PROTOCOL');bindingValid(p.binding)}
function filtersValid(f){if(!exact(f,['text','yearFrom','yearTo','requireAbstract','sourceIds','hideKnown'])||!text(f.text,300,true)||!ids(f.sourceIds)||typeof f.requireAbstract!=='boolean'||typeof f.hideKnown!=='boolean')fail('INVALID_FILTERS');try{discoverySourcesCore.filterDiscoveryCandidates([],f,[])}catch{fail('INVALID_FILTERS')}}
async function digestValid(x,crypto){const {sha256:expected,...body}=x;if(await sha256(JSON.stringify(body),crypto)!==expected)fail('HASH_MISMATCH')}
function batchValid(b,p){
 if(!exact(b,['schema','query','createdAt','sourceStatuses','items','simulationOnly','fullTextRead','researchVerified','executionAllowed'])||b.schema!=='prism-discovery-results/v1'||b.query!==p.query||!iso(b.createdAt)||b.fullTextRead!==false||b.researchVerified!==false||b.executionAllowed!==false||typeof b.simulationOnly!=='boolean'||!Array.isArray(b.items)||b.items.length>50||!b.items.every(discoverySourcesCore.validateDiscoveryCandidate)||new Set(b.items.map(x=>x.id)).size!==b.items.length||new Set(b.items.map(x=>x.identity)).size!==b.items.length||!Array.isArray(b.sourceStatuses)||b.sourceStatuses.length!==p.sourceIds.length)fail('INVALID_BATCH');
 const statuses=new Map(),errors=new Set(['ABORTED','TIMEOUT','NETWORK_ERROR','HTTP_ERROR','INVALID_RESPONSE','RESPONSE_TOO_LARGE','SEARCH_BUSY','RATE_LIMITED','CROSSREF_RATE_LIMITED','CLOCK_UNAVAILABLE','SOURCE_ERROR']);
 for(let i=0;i<b.sourceStatuses.length;i++){const s=b.sourceStatuses[i];if(!exact(s,['sourceId','label','mode','status','count','error'])||s.sourceId!==p.sourceIds[i]||!text(s.label,100)||!['synthetic','public-metadata'].includes(s.mode)||!['success','error'].includes(s.status)||!Number.isInteger(s.count)||s.count<0||s.count>10||(s.status==='success'?s.error!==null:s.count!==0||!errors.has(s.error)))fail('INVALID_BATCH_STATUS');statuses.set(s.sourceId,s)}
 const successful=b.sourceStatuses.filter(s=>s.status==='success');if(!successful.length||b.simulationOnly!==successful.every(s=>s.mode==='synthetic'))fail('INVALID_BATCH_STATUS');
 for(const c of b.items){for(const v of c.provenance){const s=statuses.get(v.sourceId);if(!s||s.status!=='success'||v.sourceLabel!==s.label||v.mode!==s.mode||v.query!==p.query||v.retrievedAt!==b.createdAt)fail('BATCH_PROTOCOL_MISMATCH')}if(c.possibleDuplicateIds.some(id=>!b.items.some(x=>x.id===id)))fail('INVALID_BATCH')}
 // Normalization caps each merged candidate at ten provenance entries. Later
 // source entries can therefore be omitted; status counts are unverified source
 // summaries, not reconstructed evidence. Reject excess/inconsistent counts where
 // no such bounded truncation can explain the discrepancy.
 const capped=b.items.some(c=>c.provenance.length===10);
 for(const s of b.sourceStatuses){const count=b.items.filter(c=>c.provenance.some(v=>v.sourceId===s.sourceId)).length;if(count>s.count||count!==s.count&&!capped)fail('INVALID_BATCH_COUNT')}
 if(b.items.length>b.sourceStatuses.reduce((n,s)=>n+s.count,0))fail('INVALID_BATCH_COUNT');
}
const contexts=new WeakSet(),records=new WeakSet();
export async function captureProjectDiscoveryContext({store,storage,projectId,crypto=globalThis.crypto,guard=()=>true}={}){
 if(!store||typeof store.getStorageKey!=='function'||typeof store.assertCurrentStorage!=='function'||!storage||typeof storage.getItem!=='function'||!id(projectId)||typeof guard!=='function')fail('CONFIGURATION');
 const namespace=store.getStorageKey();if(!text(namespace,300))fail('CONFIGURATION');const key=namespace+':project-planning-v1';
 const check=()=>{if(guard()!==true||store.getStorageKey()!==namespace)fail('EXPIRED');store.assertCurrentStorage()};
 check();const raw=storage.getItem(key);if(raw===null)fail('PROJECT_MISSING');
 let revoked=false;
 const assertCurrent=()=>{if(revoked)fail('EXPIRED');try{check();if(storage.getItem(key)!==raw)fail('CONTEXT_CHANGED')}catch(error){revoked=true;throw error}};
 const state=await projectPlanningCore.loadProjects(raw,namespace,crypto);assertCurrent();const project=state.projects.find(p=>p.id===projectId);if(!project)fail('PROJECT_MISSING');const head=project.revisions.at(-1);
 const binding={namespace,projectId,revisionId:head.id,revisionSha256:head.sha256,revisionSeq:head.seq,title:head.title,goal:head.goal};bindingValid(binding);assertCurrent();const context=freeze({binding,assertCurrent});contexts.add(context);return context;
}
export async function createProjectDiscoveryProtocol(value={},crypto=globalThis.crypto){
 const input=copy(value);if(!exact(input,['binding','query','sourceIds']))fail('INVALID_PROTOCOL');bindingValid(input.binding);if(!text(input.query,300)||!ids(input.sourceIds)||!input.sourceIds.length)fail('INVALID_PROTOCOL');
 const body={schema:PROTOCOL,binding:input.binding,query:input.query.trim(),sourceIds:input.sourceIds,authority:'none',executionAllowed:false};const p={...body,sha256:await sha256(JSON.stringify(body),crypto)};protocolValid(p);return freeze(p);
}
function recordValid(r){
 if(!exact(r,['schema','protocol','batch','filters','selectedIds','readOnly','authority','executionAllowed','sha256'])||r.schema!==RECORD||r.readOnly!==true||r.authority!=='none'||r.executionAllowed!==false||!hash(r.sha256)||!Array.isArray(r.selectedIds)||r.selectedIds.length>50||new Set(r.selectedIds).size!==r.selectedIds.length)fail('INVALID_RECORD');
 protocolValid(r.protocol);filtersValid(r.filters);if(r.batch===null){if(r.selectedIds.length)fail('INVALID_SELECTION')}else{batchValid(r.batch,r.protocol);if(r.selectedIds.some(id=>typeof id!=='string'||!r.batch.items.some(c=>c.id===id)))fail('INVALID_SELECTION')}
}
export async function exportProjectDiscoveryRecord(value={},crypto=globalThis.crypto){
 const supplied=copy(value);if(!supplied||typeof supplied!=='object'||!Object.hasOwn(supplied,'protocol')||!Object.hasOwn(supplied,'filters')||Object.keys(supplied).some(k=>!['protocol','batch','filters','selectedIds'].includes(k)))fail('INVALID_RECORD');
 const input={protocol:supplied.protocol,batch:supplied.batch??null,filters:supplied.filters,selectedIds:Object.hasOwn(supplied,'selectedIds')?supplied.selectedIds:[]};protocolValid(input.protocol);await digestValid(input.protocol,crypto);
 const body={schema:RECORD,...input,readOnly:true,authority:'none',executionAllowed:false};const r={...body,sha256:await sha256(JSON.stringify(body),crypto)};recordValid(r);const raw=JSON.stringify(r,null,2);if(bytes(raw)>PROJECT_DISCOVERY_RECORD_LIMIT)fail('TOO_LARGE');return raw;
}
export async function parseProjectDiscoveryRecord(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||raw.length>PROJECT_DISCOVERY_RECORD_LIMIT||bytes(raw)>PROJECT_DISCOVERY_RECORD_LIMIT||unicode.test(raw))fail('TOO_LARGE');let parsed;try{parsed=JSON.parse(raw)}catch{fail('INVALID_JSON')}const r=copy(parsed);recordValid(r);await digestValid(r.protocol,crypto);await digestValid(r,crypto);freeze(r);records.add(r);return r;
}
export function matchProjectDiscoveryRecord(record,context){
 if(!records.has(record)||!contexts.has(context))fail('UNVERIFIED_RECORD_OR_CONTEXT');context.assertCurrent();
 if(Object.keys(context.binding).some(k=>record.protocol.binding[k]!==context.binding[k]))fail('BINDING_MISMATCH');
 const result=copy({query:record.protocol.query,sourceIds:record.protocol.sourceIds,filters:record.filters});context.assertCurrent();return result;
}
