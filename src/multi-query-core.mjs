/** Offline evidence collection. No storage, network, intake or execution authority. */
import {parseProjectDiscoveryRecord} from './project-discovery-protocol.mjs';
import {sha256} from './custom-core.mjs';
export const MULTI_QUERY_LIMIT=4194304;
const schema='prism-multi-query-screening/v1';
const fail=x=>{throw Error('MULTI_QUERY_'+x)};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const size=s=>new TextEncoder().encode(s).length;
export function emptyMultiQuery(){return freeze({schema,records:[],decisions:[],authority:'none',executionAllowed:false})}
export async function inspectMultiQuery(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||raw.length>MULTI_QUERY_LIMIT||size(raw)>MULTI_QUERY_LIMIT)fail('LIMIT');
 let doc;try{doc=JSON.parse(raw)}catch{fail('JSON')}
 if(!exact(doc,['schema','records','decisions','authority','executionAllowed'])||doc.schema!==schema||doc.authority!=='none'||doc.executionAllowed!==false||!Array.isArray(doc.records)||doc.records.length>20||!Array.isArray(doc.decisions)||doc.decisions.length>1000)fail('FORMAT');
 let binding=null;const batches=[],seen=new Set(),groups=new Map();
 for(const recordRaw of doc.records){const r=await parseProjectDiscoveryRecord(recordRaw,crypto);if(!r.batch)fail('RESULTS_REQUIRED');const b=JSON.stringify(r.protocol.binding);if(binding!==null&&binding!==b)fail('SCOPE_MISMATCH');binding=b;if(seen.has(r.sha256))fail('DUPLICATE_RECORD');seen.add(r.sha256);batches.push(r);
 for(const c of r.batch.items){let g=groups.get(c.identity);if(!g){g={identity:c.identity,title:c.title,simulation:c.simulation,occurrences:[],conflicts:[]};groups.set(c.identity,g)}g.occurrences.push({recordSha256:r.sha256,query:r.protocol.query,candidate:c,originallySelected:r.selectedIds.includes(c.id)});for(const key of ['title','authors','year','abstract','links'])if(JSON.stringify(c[key])!==JSON.stringify(g.occurrences[0].candidate[key])&&!g.conflicts.includes(key))g.conflicts.push(key);}
 }
 for(let i=0;i<doc.decisions.length;i++){const d=doc.decisions[i],g=groups.get(d?.identity);if(!exact(d,['seq','identity','status','reason','observedRecords'])||d.seq!==i+1||!g||!['include','exclude','pending'].includes(d.status)||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>1000||/[\x00-\x1f\x7f]/.test(d.reason)||!Array.isArray(d.observedRecords)||!d.observedRecords.length||new Set(d.observedRecords).size!==d.observedRecords.length||d.observedRecords.some(h=>!g.occurrences.some(o=>o.recordSha256===h)))fail('DECISION');g.latest=d;}
 for(const g of groups.values())g.needsReview=!!g.latest&&g.occurrences.some(o=>!g.latest.observedRecords.includes(o.recordSha256));
 return freeze({document:doc,binding:binding?JSON.parse(binding):null,batches,groups:[...groups.values()]});
}
export async function appendMultiQuery(raw,recordRaw,crypto=globalThis.crypto){const view=await inspectMultiQuery(raw,crypto);const doc=JSON.parse(JSON.stringify(view.document));doc.records.push(recordRaw);return (await inspectMultiQuery(JSON.stringify(doc),crypto)).document}
export async function decideMultiQuery(raw,identity,status,reason,crypto=globalThis.crypto){const v=await inspectMultiQuery(raw,crypto),g=v.groups.find(g=>g.identity===identity);if(!g)fail('MISSING');const doc=JSON.parse(JSON.stringify(v.document));doc.decisions.push({seq:doc.decisions.length+1,identity,status,reason,observedRecords:g.occurrences.map(o=>o.recordSha256)});return (await inspectMultiQuery(JSON.stringify(doc),crypto)).document}
export async function exportMultiQuery(raw,crypto=globalThis.crypto){const v=await inspectMultiQuery(raw,crypto);const payload=JSON.stringify(v.document);return JSON.stringify({schema:'prism-multi-query-envelope/v1',payload,sha256:await sha256(payload,crypto)},null,2)}
export async function openMultiQuery(raw,crypto=globalThis.crypto){if(typeof raw!=='string'||size(raw)>MULTI_QUERY_LIMIT*2)fail('LIMIT');let e;try{e=JSON.parse(raw)}catch{fail('JSON')}if(!exact(e,['schema','payload','sha256'])||e.schema!=='prism-multi-query-envelope/v1'||typeof e.payload!=='string'||typeof e.sha256!=='string'||await sha256(e.payload,crypto)!==e.sha256)fail('HASH');return inspectMultiQuery(e.payload,crypto)}
