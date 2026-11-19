/** Explicit in-memory review/export only. Never mutates execution intent or retries. */
import {createHash} from 'node:crypto';
import {withReviewableIntent} from './adapter.mjs';
import {readBoundEventEvidence} from './event-correlation.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
export function createResultReview({adapter,observer}={}){
 const previews=new WeakMap(),receipts=new WeakMap();let closed=false;
 function evidence(intent){if(closed)throw Error('REVIEW_CLOSED');const e=readBoundEventEvidence(observer),c=e.context,b=intent.binding,r=e.report;
 if(r.status!=='candidate-completed'||r.interruption!==null||c.requestId!==intent.request.requestId||c.sessionId!==b.sessionId||c.intentSha256!==intent.sha256||c.text!==intent.request.content[0].text||c.provider!==b.provider||c.model!==b.model||c.isSeeded!==false||!r.outputs.length)throw Error('COMPLETE_BOUND_EVIDENCE_REQUIRED');return e;
 }
 function document(intent,e){return {schema:'prism-result-review-fixture/v1',intent,events:e.snapshot,outputs:e.report.outputs,throughSeq:e.report.throughSeq,fixtureOnly:true,authority:'none',scientificallyVerified:false,intentMutationAllowed:false}}
 async function preview(requestId){return withReviewableIntent(adapter,requestId,intent=>{const e=evidence(intent),body=document(intent,e),digest=sha(JSON.stringify(body)),p=freeze({...body,digest});previews.set(p,{requestId,digest,body:JSON.stringify(body)});return p})}
 async function adopt(p,{explicit=false,digest}={}){const issued=previews.get(p);if(!issued||explicit!==true||digest!==issued.digest)throw Error('EXPLICIT_RESULT_REVIEW_REQUIRED');return withReviewableIntent(adapter,issued.requestId,intent=>{const e=evidence(intent),body=document(intent,e);if(JSON.stringify(body)!==issued.body)throw Error('RESULT_PREVIEW_STALE');if(!previews.has(p))throw Error('RESULT_PREVIEW_CONSUMED');previews.delete(p);const receipt=freeze({...body,digest:issued.digest,review:'user-accepted-as-unverified-result',storage:'in-memory-download-required'});receipts.set(receipt,{requestId:issued.requestId,body:issued.body});return receipt})}
 async function exportReceipt(receipt){const r=receipts.get(receipt);if(!r)throw Error('REVIEW_RECEIPT_REQUIRED');return withReviewableIntent(adapter,r.requestId,intent=>{if(JSON.stringify(document(intent,evidence(intent)))!==r.body)throw Error('RESULT_RECEIPT_STALE');return JSON.stringify(receipt,null,2)})}
 return Object.freeze({preview,adopt,exportReceipt,close(){closed=true},fixtureOnly:true,realModelConnected:false})
}
