// Local human choices only. No text originals, platform authority, execution or synthetic state.
import {sha256} from './custom-core.mjs';
export const MANUAL_REVIEW_SCHEMA='prism-manual-review-decisions-v1';
export const MANUAL_REVIEW_V2_SCHEMA='prism-manual-review-decisions-v2';
export const MANUAL_MULTI_REVIEW_SUBJECT_SCHEMA='prism-manual-review-subject-v2';
export const MANUAL_REVIEW_MAX_BYTES=800000;
export const MANUAL_REVIEW_LIMIT=200;
const exact=(x,n)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===n.split(',').sort().join(',');
const fail=c=>{throw Error(c)},clone=x=>JSON.parse(JSON.stringify(x));
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const subjectKeys='namespace,projectId,paperId,sourceSnapshotSha256,documentSha256,graphVersion,graphSha256,reviewNodeId,reviewTargetId,targetNodeId,targetPromptVersion,targetPromptSha256,recordId,preparationSha256,promptVersion,promptSha256,replyId,replyByteLength,replySha256,reviewInputRecordId,reviewInputReplyId,reviewInputReplySha256,reviewInputPreparationSha256';
function validateManualReviewSubjectV1(s){
 if(!exact(s,subjectKeys)||typeof s.namespace!=='string'||!s.namespace||s.namespace.length>300)fail('HUMAN_REVIEW_SUBJECT');
 for(const k of ['projectId','paperId','reviewNodeId','reviewTargetId','targetNodeId','recordId','replyId','reviewInputRecordId','reviewInputReplyId'])if(!id(s[k]))fail('HUMAN_REVIEW_SUBJECT_ID');
 for(const k of ['sourceSnapshotSha256','documentSha256','graphSha256','targetPromptSha256','preparationSha256','promptSha256','replySha256','reviewInputReplySha256','reviewInputPreparationSha256'])if(!hash(s[k]))fail('HUMAN_REVIEW_SUBJECT_HASH');
 for(const k of ['graphVersion','targetPromptVersion','promptVersion'])if(!Number.isSafeInteger(s[k])||s[k]<1||s[k]>10000)fail('HUMAN_REVIEW_SUBJECT_VERSION');
 if(!Number.isSafeInteger(s.replyByteLength)||s.replyByteLength<1||s.replyByteLength>192000||new Set([s.reviewNodeId,s.reviewTargetId,s.targetNodeId]).size!==3)fail('HUMAN_REVIEW_SUBJECT');return true;
}
const multiCommonKeys='namespace,projectId,paperId,sourceSnapshotSha256,documentSha256,graphVersion,graphSha256,reviewNodeId,reviewTargetId,targetNodeId,targetPromptVersion,targetPromptSha256,recordId,preparationSha256,promptVersion,promptSha256,replyId,replyByteLength,replySha256';
const multiInputKeys='nodeId,recordId,preparationSha256,promptVersion,promptSha256,replyId,replyByteLength,replySha256';
export function validateManualReviewSubject(s){
 if(!s||!Object.hasOwn(s,'schema'))return validateManualReviewSubjectV1(s);
 if(!exact(s,multiCommonKeys+',schema,reviewInputs')||s.schema!==MANUAL_MULTI_REVIEW_SUBJECT_SCHEMA||typeof s.namespace!=='string'||!s.namespace||s.namespace.length>300)fail('HUMAN_REVIEW_SUBJECT');
 for(const k of ['projectId','paperId','reviewNodeId','reviewTargetId','targetNodeId','recordId','replyId'])if(!id(s[k]))fail('HUMAN_REVIEW_SUBJECT_ID');
 for(const k of ['sourceSnapshotSha256','documentSha256','graphSha256','targetPromptSha256','preparationSha256','promptSha256','replySha256'])if(!hash(s[k]))fail('HUMAN_REVIEW_SUBJECT_HASH');
 for(const k of ['graphVersion','targetPromptVersion','promptVersion'])if(!Number.isSafeInteger(s[k])||s[k]<1||s[k]>10000)fail('HUMAN_REVIEW_SUBJECT_VERSION');
 if(!Number.isSafeInteger(s.replyByteLength)||s.replyByteLength<1||s.replyByteLength>192000||new Set([s.reviewNodeId,s.reviewTargetId,s.targetNodeId]).size!==3||!Array.isArray(s.reviewInputs)||s.reviewInputs.length<2||s.reviewInputs.length>8)fail('HUMAN_REVIEW_SUBJECT');
 const nodes=new Set(),records=new Set();let total=0;
 for(const u of s.reviewInputs){
  if(!exact(u,multiInputKeys)||['nodeId','recordId','replyId'].some(k=>!id(u[k]))||['preparationSha256','promptSha256','replySha256'].some(k=>!hash(u[k]))||!Number.isSafeInteger(u.promptVersion)||u.promptVersion<1||u.promptVersion>10000||!Number.isSafeInteger(u.replyByteLength)||u.replyByteLength<1||u.replyByteLength>192000||nodes.has(u.nodeId)||records.has(u.recordId)||[s.reviewNodeId,s.targetNodeId].includes(u.nodeId)||u.recordId===s.recordId)fail('HUMAN_REVIEW_SUBJECT_INPUT');
  nodes.add(u.nodeId);records.add(u.recordId);total+=u.replyByteLength;
 }
 if(!nodes.has(s.reviewTargetId)||total>1536000)fail('HUMAN_REVIEW_SUBJECT_INPUT');return true;
}
// Reserve actual serialized bytes as well as slots for revoking every latest approval.
function validateV2ReviewBudget(state,heads){
 if(state.schema!==MANUAL_REVIEW_V2_SCHEMA)return;
 const reserved=clone(state),approved=[...heads.values()].filter(e=>e.decision==='approved');
 for(const e of approved)reserved.events.push({id:'r'.repeat(128),sequence:reserved.events.length+1,decision:'revoked',subject:clone(e.subject)});
 const bytes=new TextEncoder().encode(JSON.stringify({...reserved,integritySha256:'0'.repeat(64)})).length;
 if(bytes>MANUAL_REVIEW_MAX_BYTES)fail('HUMAN_REVIEW_REVOCATION_BYTES_RESERVED');
}
// The scope's latest event wins, even if a different reply or material version was selected.
export function manualReviewScope(s){validateManualReviewSubject(s);return JSON.stringify([s.namespace,s.projectId,s.paperId,s.graphVersion,s.graphSha256,s.reviewNodeId,s.targetNodeId])}
export function emptyManualReviews(namespace){return {schema:MANUAL_REVIEW_SCHEMA,namespace,authority:'none',events:[]}}
export function validateManualReviews(state){
 if(!exact(state,'schema,namespace,authority,events')||![MANUAL_REVIEW_SCHEMA,MANUAL_REVIEW_V2_SCHEMA].includes(state.schema)||typeof state.namespace!=='string'||!state.namespace||state.namespace.length>300||state.authority!=='none'||!Array.isArray(state.events)||state.events.length>MANUAL_REVIEW_LIMIT)fail('HUMAN_REVIEW_LEDGER_SCHEMA');
 const ids=new Set();for(const [i,e] of state.events.entries()){
  if(!exact(e,'id,sequence,decision,subject')||!id(e.id)||ids.has(e.id)||e.sequence!==i+1||!['approved','returned','revoked'].includes(e.decision))fail('HUMAN_REVIEW_EVENT');
  validateManualReviewSubject(e.subject);if(state.schema===MANUAL_REVIEW_SCHEMA&&Object.hasOwn(e.subject,'schema'))fail('HUMAN_REVIEW_SUBJECT_VERSION');if(e.subject.namespace!==state.namespace)fail('HUMAN_REVIEW_NAMESPACE');ids.add(e.id);
  if(e.decision==='revoked'){const previous=state.events.slice(0,i).findLast(p=>manualReviewScope(p.subject)===manualReviewScope(e.subject));if(!previous||previous.decision!=='approved'||JSON.stringify(previous.subject)!==JSON.stringify(e.subject))fail('HUMAN_REVIEW_REVOKE_TARGET')}
 }const heads=new Map();for(const e of state.events)heads.set(manualReviewScope(e.subject),e);if(state.events.length+[...heads.values()].filter(e=>e.decision==='approved').length>MANUAL_REVIEW_LIMIT)fail('HUMAN_REVIEW_REVOCATION_CAPACITY_RESERVED');validateV2ReviewBudget(state,heads);return true;
}
export async function exportManualReviews(input,crypto=globalThis.crypto){const state=clone(input);validateManualReviews(state);return JSON.stringify({...state,integritySha256:await sha256(JSON.stringify(state),crypto)})}
export async function loadManualReviews(raw,namespace,crypto=globalThis.crypto){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MANUAL_REVIEW_MAX_BYTES)fail('HUMAN_REVIEW_LEDGER_SIZE');let x;try{x=JSON.parse(raw)}catch{fail('HUMAN_REVIEW_LEDGER_JSON')}
 if(!exact(x,'schema,namespace,authority,events,integritySha256')||!hash(x.integritySha256))fail('HUMAN_REVIEW_LEDGER_SCHEMA');const {integritySha256,...s}=x;validateManualReviews(s);if(s.namespace!==namespace)fail('HUMAN_REVIEW_NAMESPACE');if(await sha256(JSON.stringify(s),crypto)!==integritySha256)fail('HUMAN_REVIEW_LEDGER_HASH');return s;
}
export function latestManualReview(state,subject){validateManualReviews(state);const scope=manualReviewScope(subject);return state.events.findLast(e=>manualReviewScope(e.subject)===scope)||null}
export function appendManualReview(input,event){const state=clone(input);validateManualReviews(state);if(state.events.length>=MANUAL_REVIEW_LIMIT)fail('HUMAN_REVIEW_LEDGER_FULL');if(event?.subject?.schema===MANUAL_MULTI_REVIEW_SUBJECT_SCHEMA)state.schema=MANUAL_REVIEW_V2_SCHEMA;state.events.push(clone(event));validateManualReviews(state);const heads=new Map();for(const e of state.events)heads.set(manualReviewScope(e.subject),e);const approvals=[...heads.values()].filter(e=>e.decision==='approved').length;if(state.events.length+approvals>MANUAL_REVIEW_LIMIT)fail('HUMAN_REVIEW_REVOCATION_CAPACITY_RESERVED');return state}
export function requireManualReviewApproval(state,subject){const e=latestManualReview(state,subject);if(!e||e.decision!=='approved'||JSON.stringify(e.subject)!==JSON.stringify(subject))fail('HUMAN_REVIEW_CURRENT_APPROVAL_REQUIRED');return e}
// Explicit allowlisted projection. Never persist an entire reference (titles and step labels live there).
export function makeManualReviewSubject({reference:r,reviewInput:a,reviewTargetId,target,targetPromptSha256}){
 const t=r.preparation.trace;const s={namespace:r.origin.namespace,projectId:r.origin.projectId,paperId:r.origin.paperId,sourceSnapshotSha256:r.targetSource.snapshotSha256,documentSha256:r.targetSource.documentSha256,graphVersion:t.graphVersion,graphSha256:t.graphSha256,reviewNodeId:t.nodeId,reviewTargetId,targetNodeId:target.id,targetPromptVersion:target.promptVersion,targetPromptSha256,recordId:r.recordId,preparationSha256:r.preparation.integritySha256,promptVersion:t.promptVersion,promptSha256:r.preparation.promptSha256,replyId:r.reply.id,replyByteLength:r.reply.byteLength,replySha256:r.reply.sha256,reviewInputRecordId:a.recordId,reviewInputReplyId:a.reply.id,reviewInputReplySha256:a.reply.sha256,reviewInputPreparationSha256:a.preparation.integritySha256};validateManualReviewSubject(s);return s;
}
// Bind the complete ordered fan-in without saving any original text or labels.
export function makeManualMultiReviewSubject({reference:r,reviewInputs,reviewTargetId,target,targetPromptSha256}){
 const t=r.preparation.trace;
 const inputs=reviewInputs.map(a=>({nodeId:a.preparation.trace.nodeId,recordId:a.recordId,preparationSha256:a.preparation.integritySha256,promptVersion:a.preparation.trace.promptVersion,promptSha256:a.preparation.promptSha256,replyId:a.reply.id,replyByteLength:a.reply.byteLength,replySha256:a.reply.sha256}));
 const s={schema:MANUAL_MULTI_REVIEW_SUBJECT_SCHEMA,namespace:r.origin.namespace,projectId:r.origin.projectId,paperId:r.origin.paperId,sourceSnapshotSha256:r.targetSource.snapshotSha256,documentSha256:r.targetSource.documentSha256,graphVersion:t.graphVersion,graphSha256:t.graphSha256,reviewNodeId:t.nodeId,reviewTargetId,targetNodeId:target.id,targetPromptVersion:target.promptVersion,targetPromptSha256,recordId:r.recordId,preparationSha256:r.preparation.integritySha256,promptVersion:t.promptVersion,promptSha256:r.preparation.promptSha256,replyId:r.reply.id,replyByteLength:r.reply.byteLength,replySha256:r.reply.sha256,reviewInputs:inputs};validateManualReviewSubject(s);return s;
}
// Match a flat handoff to the recorded choice. The omitted A originals remain bound by R's preparation digest.
export function manualReviewMatchesHandoff(event,p){
 if(event?.decision!=='approved'||!p?.upstream?.reference||!p?.base)return false;
 const s=event.subject,r=p.upstream.reference,t=r.preparation.trace,b=p.base;
 try{validateManualReviewSubject(s)}catch{return false}
 const values={namespace:p.origin.namespace,projectId:p.origin.projectId,paperId:p.origin.paperId,sourceSnapshotSha256:p.source.snapshotSha256,documentSha256:p.source.documentSha256,graphVersion:p.target.graphVersion,graphSha256:p.target.graphSha256,reviewNodeId:t.nodeId,targetNodeId:p.target.nodeId,targetPromptVersion:b.trace.promptVersion,targetPromptSha256:b.step.sha256,recordId:r.recordId,preparationSha256:r.preparation.integritySha256,promptVersion:t.promptVersion,promptSha256:r.preparation.promptSha256,replyId:r.reply.id,replyByteLength:r.reply.byteLength,replySha256:r.reply.sha256};return Object.keys(values).every(k=>s[k]===values[k]);
}
