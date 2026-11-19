/** Default-off in-process UI contract. Fixed synthetic fixture ONLY, no Host route.
 * This composes the actual intent/observer/review bridge; it is not a fake success DTO.
 */
import {createNativeIntentAdapter,createSyntheticRemote} from './adapter.mjs';
import {createEventCorrelation} from './event-correlation.mjs';
import {createResultReview} from './result-review.mjs';
import {randomUUID} from 'node:crypto';
const clone=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
export function createFixtureReviewUiSession({enabled=false}={}){
 if(enabled!==true)return Object.freeze({getSnapshot:()=>Object.freeze({enabled:false,fixtureOnly:true,realModelConnected:false})});
 let closed=false,busy=false,adapter,observer,review,intent,preview,receipt,token=null,draft=null,revision=0,raw=null,writes=0;
 const remote=createSyntheticRemote();
 const b={namespace:'prism-fixed-ui-fixture',projectId:'synthetic-project',paperId:'synthetic-paper',sourceSha256:'a'.repeat(64),nodeId:'synthetic-node',promptVersion:'1',projectVersion:'1',workspaceId:'synthetic-workspace',sessionId:randomUUID(),provider:'fixture',model:'fixture',generation:'1'};
 const input='仅离线合成输入：核对示例研究发现。',output='## 合成结果\n\n这是固定示例，不是真实论文发现。公式：$y = \\alpha + \\beta x$。';
 function available(){if(closed)throw Error('UI_SESSION_CLOSED')}
 function snapshot(){return freeze({enabled:!closed,fixtureOnly:true,realModelConnected:false,authority:'none',busy,phase:closed?'closed':draft!==null?'draft':preview?'preview':'idle',preview:preview?{token,body:clone(preview)}:null,draft:draft===null?null:{text:draft,revision,edited:draft!==output},storage:'memory-only-explicit-export',scope:'fixed-synthetic-not-current-user-project'})}
 async function run(fn){available();if(busy)throw Error('UI_SESSION_BUSY');busy=true;try{const value=await fn();available();return value}finally{busy=false}}
 async function init(){if(review)return;adapter=createNativeIntentAdapter({enabled:true,remote,journal:{read:async()=>raw,compareAndSwap:async(old,next)=>{if(raw!==old)return false;raw=next;writes++;return true}},resolve:()=>({binding:b,text:input,authorized:!closed})});intent=await adapter.prepare();available();await adapter.confirm(intent,{explicit:true,sha256:intent.sha256});available();
 const c={sessionId:b.sessionId,requestId:intent.request.requestId,intentSha256:intent.sha256,text:input,afterSeq:0,provider:b.provider,model:b.model,isSeeded:false};observer=createEventCorrelation(c);const ev=(seq,type,data,surfaceOp)=>({type:'event',event:{seq,type,time:seq,data,...(surfaceOp?{surfaceOp}:{})}});
 observer.feed({sessionId:b.sessionId,records:[ev(1,'turn/start',{turn:1}),ev(2,'step/start',{turn:1,step:1}),ev(3,'user/message',{id:'u',role:'user',source:{kind:'user',rpcId:c.requestId},content:[{type:'text',text:input}]},'append'),ev(4,'assistant/message',{turn:1,step:1,message:{id:'a',role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'text',text:output}]},stream:[]},'append'),ev(5,'step/end',{turn:1,step:1}),ev(6,'turn/end',{turn:1,reason:{kind:'completed'}})]});review=createResultReview({adapter,observer});}
 return Object.freeze({getSnapshot:snapshot,
 async preview(){return run(async()=>{if(draft!==null)throw Error('DRAFT_EXISTS');await init();preview=await review.preview(intent.request.requestId);available();token=randomUUID();return snapshot()})},
 async adopt({previewToken,explicit=false}={}){return run(async()=>{if(!preview||previewToken!==token||explicit!==true||draft!==null)throw Error('EXPLICIT_CURRENT_PREVIEW_REQUIRED');receipt=await review.adopt(preview,{explicit:true,digest:preview.digest});available();draft=receipt.outputs.map(x=>x.text).join('\n\n');revision=1;token=null;preview=null;return snapshot()})},
 editDraft({text,expectedRevision}={}){available();if(busy||draft===null||expectedRevision!==revision||typeof text!=='string'||text.length>262144)throw Error('DRAFT_EDIT_REFUSED');draft=text;revision++;return snapshot()},
 async exportDraft({expectedRevision}={}){return run(async()=>{if(draft===null||expectedRevision!==revision)throw Error('DRAFT_REVISION_REQUIRED');const original=JSON.parse(await review.exportReceipt(receipt));available();return JSON.stringify({schema:'prism-ui-result-draft-fixture/v1',scope:'fixed-synthetic-not-current-user-project',original,draft:{text:draft,revision,edited:draft!==output},fixtureOnly:true,authority:'none',executionIntentState:'accepted-unchanged',syntheticSubmissions:remote.inspect().length},null,2)})},
 close({discardDraft=false}={}){if(closed)return;if(draft!==null&&discardDraft!==true)throw Error('EXPLICIT_DISCARD_OR_EXPORT_REQUIRED');closed=true;review?.close();adapter?.close();preview=null;receipt=null;token=null;draft=null},
 inspectFixture(){return freeze({syntheticSubmissions:remote.inspect().length,journalWrites:writes,intentStates:raw?JSON.parse(raw).intents.map(x=>x.status):[],credentialCapability:false,networkCapability:false})}
 })
}
