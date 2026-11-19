import {sha256} from './custom-core.mjs';
const schema='prism-terminal-review-decisions-v1',limit=200,maxBytes=800000;
const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)};
const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.split(',').sort().join(',');
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function subject(s){
 if(!exact(s,'namespace,projectId,paperId,nodeId,graphSha256,graphVersion,sourceSnapshotSha256,documentSha256,recordId,preparationSha256,replyId,replySha256')||typeof s.namespace!=='string'||!s.namespace||s.namespace.length>300)fail('TERMINAL_SUBJECT');
 for(const k of ['projectId','paperId','nodeId','recordId','replyId'])if(!id(s[k]))fail('TERMINAL_SUBJECT_ID');
 for(const k of ['graphSha256','sourceSnapshotSha256','documentSha256','preparationSha256','replySha256'])if(!hash(s[k]))fail('TERMINAL_SUBJECT_HASH');
 if(!Number.isSafeInteger(s.graphVersion)||s.graphVersion<1||s.graphVersion>10000)fail('TERMINAL_SUBJECT_VERSION');
}
export function makeSubject(r){const s={namespace:r.origin.namespace,projectId:r.origin.projectId,paperId:r.origin.paperId,nodeId:r.preparation.trace.nodeId,graphSha256:r.preparation.trace.graphSha256,graphVersion:r.preparation.trace.graphVersion,sourceSnapshotSha256:r.targetSource.snapshotSha256,documentSha256:r.targetSource.documentSha256,recordId:r.recordId,preparationSha256:r.preparation.integritySha256,replyId:r.reply.id,replySha256:r.reply.sha256};subject(s);return s}
// Scope intentionally excludes versions: a new decision supersedes every older version of this node.
export function manualReviewScope(s){subject(s);return JSON.stringify([s.namespace,s.projectId,s.paperId,s.nodeId])}
export function emptyManualReviews(namespace){return {schema,namespace,authority:'none',events:[]}}
export function validateManualReviews(s){
 if(!exact(s,'schema,namespace,authority,events')||s.schema!==schema||typeof s.namespace!=='string'||!s.namespace||s.namespace.length>300||s.authority!=='none'||!Array.isArray(s.events)||s.events.length>limit)fail('TERMINAL_LEDGER');
 const ids=new Set(),heads=new Map();
 for(const [i,e] of s.events.entries()){
  if(!exact(e,'id,sequence,decision,subject')||!id(e.id)||ids.has(e.id)||e.sequence!==i+1||!['approved','returned','revoked'].includes(e.decision))fail('TERMINAL_EVENT');
  subject(e.subject);if(e.subject.namespace!==s.namespace)fail('TERMINAL_NAMESPACE');const key=manualReviewScope(e.subject),old=heads.get(key);
  if(e.decision==='revoked'&&(!old||old.decision!=='approved'||JSON.stringify(old.subject)!==JSON.stringify(e.subject)))fail('TERMINAL_REVOKE');ids.add(e.id);heads.set(key,e);
 }
 const approvals=[...heads.values()].filter(e=>e.decision==='approved');if(s.events.length+approvals.length>limit)fail('TERMINAL_REVOCATION_RESERVED');
 const reserve=clone(s);for(const e of approvals)reserve.events.push({id:'r'.repeat(128),sequence:reserve.events.length+1,decision:'revoked',subject:e.subject});
 if(new TextEncoder().encode(JSON.stringify({...reserve,integritySha256:'0'.repeat(64)})).length>maxBytes)fail('TERMINAL_REVOCATION_BYTES');return true;
}
export function latestManualReview(s,sub){validateManualReviews(s);return s.events.findLast(e=>manualReviewScope(e.subject)===manualReviewScope(sub))||null}
export function appendManualReview(s,e){const n=clone(s);validateManualReviews(n);n.events.push(clone(e));validateManualReviews(n);return n}
export async function exportManualReviews(s,crypto=globalThis.crypto){validateManualReviews(s);return JSON.stringify({...s,integritySha256:await sha256(JSON.stringify(s),crypto)})}
export async function loadManualReviews(raw,namespace,crypto=globalThis.crypto){if(typeof raw!=='string'||new TextEncoder().encode(raw).length>maxBytes)fail('TERMINAL_SIZE');const x=JSON.parse(raw);if(!exact(x,'schema,namespace,authority,events,integritySha256')||!hash(x.integritySha256))fail('TERMINAL_FORMAT');const {integritySha256,...s}=x;validateManualReviews(s);if(s.namespace!==namespace||await sha256(JSON.stringify(s),crypto)!==integritySha256)fail('TERMINAL_INTEGRITY');return s}
