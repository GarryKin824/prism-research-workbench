import {normalizePaperDocument,validateDocumentAttachment} from './document-attachment-core.mjs';
import {sha256} from './custom-core.mjs';
import {assertScopeEditable} from './project-execution-owner.mjs';
import {importQueue,queueView} from './library-core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=code=>{throw Error(code)};
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x}
const exact=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===names.split(',').sort().join(',');
export function createDocumentAttachmentController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey();let epoch=0,issued=null,inflight=null,closed=false;
 function capture(paperId,isCurrent,operation){
  const check=()=>{if(closed||operation!==epoch||store.getStorageKey()!==namespace||isCurrent()!==true)fail('ATTACHMENT_CONTEXT_CHANGED');store.assertCurrentStorage()};check();
  const snapshot=store.getSnapshot(),paper=clone(snapshot.papers.find(p=>p.id===paperId)??null),baseRaw=storage.getItem(namespace);
  if(!paper)fail('ATTACHMENT_PAPER_MISSING');
  let durable;try{durable=JSON.parse(baseRaw)}catch{fail('ATTACHMENT_BASE_NOT_DURABLE')}
  if(snapshot.persistence?.saved!==true||durable.revision!==snapshot.revision||JSON.stringify(durable.papers?.find(p=>p.id===paperId))!==JSON.stringify(paper))fail('ATTACHMENT_BASE_NOT_DURABLE');
  const paperRaw=JSON.stringify(paper),workflowKey=namespace+':custom-workflow-v1:'+paper.id,workflowRaw=storage.getItem(workflowKey);
  const suffixes=['project-execution-owner-v1','research-instances-v1','library-queue-v1','project-library-v1','project-planning-v1','project-queues-v1'],keys=suffixes.map(s=>namespace+':'+s),raws=keys.map(k=>storage.getItem(k));
  const stable=()=>{check();if(storage.getItem(namespace)!==baseRaw||store.getSnapshot().revision!==snapshot.revision||JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paperId))!==paperRaw||storage.getItem(workflowKey)!==workflowRaw||keys.some((k,i)=>storage.getItem(k)!==raws[i]))fail('ATTACHMENT_SOURCE_CHANGED')};
  const guarded={randomUUID:()=>{stable();return crypto.randomUUID()},subtle:{digest:async(...args)=>{stable();try{return await crypto.subtle.digest(...args)}finally{stable()}}}};
  return {paper,paperRaw,revision:snapshot.revision,workflowRaw,baseRaw,raws,stable,guarded};
 }
 async function prepare(input,{isCurrent=()=>true}={}){
  const q=clone(input);if(!exact(q,'paperId,document,provenance')||typeof q.paperId!=='string')fail('ATTACHMENT_INPUT_INVALID');
  const operation=++epoch;issued=null;const c=capture(q.paperId,isCurrent,operation);
  if(Object.hasOwn(c.paper,'document')||Object.hasOwn(c.paper,'documentAttachment'))fail('DOCUMENT_ALREADY_ATTACHED');
  if(c.paper.runs.some(r=>r.status==='running'))fail('ATTACHMENT_PAPER_ACTIVE');
  const document=normalizePaperDocument(q.document);document.sha256=await sha256(document.text,c.guarded);c.stable();
  const provenance=q.provenance===null?{kind:'local-text',filename:document.filename,mime:document.mime,byteLength:document.byteLength,textSha256:document.sha256}:q.provenance;
  const attachment={schema:'prism-document-attachment/v1',id:crypto.randomUUID(),namespace,time:new Date().toISOString(),oldPaperRaw:c.paperRaw,oldPaperSha256:await sha256(c.paperRaw,c.guarded),oldWorkflowRaw:c.workflowRaw,oldWorkflowSha256:c.workflowRaw===null?null:await sha256(c.workflowRaw,c.guarded),documentSha256:document.sha256,provenance};
  const candidate={...c.paper,document,documentAttachment:attachment,accepted:null,steps:c.paper.steps.map((s,i)=>({...s,currentRunId:null,status:i===0?'ready':'blocked'}))};
  const checked=await validateDocumentAttachment(candidate,{namespace,crypto:c.guarded});c.stable();
  if(checked.oldWorkflow&&(checked.oldWorkflow.syntheticAuthorized||checked.oldWorkflow.runs.some(r=>r.status==='running')))fail('ATTACHMENT_WORKFLOW_ACTIVE');
  await assertScopeEditable(storage,namespace,c.guarded);c.stable();
  if(c.raws[2]!==null){await importQueue(c.raws[2],c.guarded);c.stable();const queue=JSON.parse(c.raws[2]).queue,view=queueView(queue);if(queue.allowed||view.active||view.pending)fail('ATTACHMENT_QUEUE_ACTIVE')}
  const next=JSON.parse(store.exportJSON());next.revision++;next.papers=next.papers.map(p=>p.id===q.paperId?candidate:p);if(JSON.stringify(next).length>4000000)fail('STORE_TOO_LARGE');c.stable();
  const duplicates=store.getSnapshot().papers.filter(p=>p.id!==q.paperId&&p.document?.sha256===document.sha256).map(p=>({paperId:p.id,title:p.title}));
  const preview=freeze({kind:'first-document-attachment',paperId:q.paperId,title:c.paper.title,document,attachment,duplicates,requiresWorkflowRebase:c.workflowRaw!==null,warning:'仅给明确选择的当前论文挂接首份正文，保留编号、元数据、项目关联和旧历史；清除旧模拟运行的当前标记与接收状态。不是文献身份认证，不合并或删除同文条目；已有流程需另行明确确认按新正文派生设计，不继承运行或批准。'});
  issued={preview,display:JSON.stringify(preview),operation,c};return preview;
 }
 async function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true)fail('ATTACHMENT_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_DOCUMENT_ATTACHMENT');
  const t=issued;if(!t||t.preview!==preview||JSON.stringify(preview)!==t.display||closed||t.operation!==epoch)fail('ATTACHMENT_PREVIEW_EXPIRED');issued=null;inflight=t;
  const current=()=>!closed&&t.operation===epoch&&isCurrent()===true;
  try{t.c.stable();if(!current())fail('ATTACHMENT_PREVIEW_EXPIRED');
  const result=await store.dispatch({type:'attachDocument',paperId:preview.paperId,revision:t.c.revision,document:preview.document,attachment:preview.attachment,isCurrent:()=>{if(!current())return false;try{t.c.stable();return true}catch{return false}}});
  // Own successful commit necessarily changes revision; do not run a stale UI guard after it.
  if(result.persistence?.saved!==true)fail('ATTACHMENT_WRITE_UNKNOWN_RELOAD_REQUIRED');
  return {committed:true,paperId:preview.paperId,requiresWorkflowRebase:preview.requiresWorkflowRebase,persistence:result.persistence};
  }finally{if(inflight===t)inflight=null}
 }
 async function inspect({paperId},{isCurrent=()=>true}={}){
  const operation=++epoch;issued=null;const c=capture(paperId,isCurrent,operation),value=await validateDocumentAttachment(c.paper,{crypto:c.guarded});c.stable();
  return freeze({paperId,title:c.paper.title,...value,raw:JSON.stringify(value.attachment,null,2),historyOnly:true,authority:'none'});
 }
 return {namespace,prepare,confirm,inspect,cancel(preview){if(preview===undefined||issued?.preview===preview||inflight?.preview===preview){epoch++;issued=null}},close(){closed=true;epoch++;issued=null}};
}
