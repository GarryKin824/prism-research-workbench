import {readOnlyProjectView} from './project-archive-core.mjs';
import {createWorkflow,exportWorkflow,importWorkflow,sha256} from './custom-core.mjs';
// Isolated draft packet, never an active store or execution controller.
export function createDerivedDraftController({archiveController,storage,namespace,crypto,withLock}) {
 if(typeof namespace!=='string'||!namespace||namespace.length>200)throw Error('INVALID_NAMESPACE');
 const tokens=new WeakMap(),prefix=namespace+':derived-draft-v1:';
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x),identifier=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(x);
 const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
 async function prepare({slotId,paperId,workflowId,graphVersion}) {
  const source=await archiveController.open(slotId),v=await readOnlyProjectView(source.raw,crypto);
  const row=v.papers.find(x=>x.id===paperId);if(!row?.paper)throw Error('PAPER_NOT_PRESENT');
  const old=row.workflows.find(x=>x.id===workflowId),graph=old?.graphs.find(x=>x.version===graphVersion);if(!graph)throw Error('EXPLICIT_TEMPLATE_SELECTION_REQUIRED');
  const paper={id:crypto.randomUUID(),title:row.paper.title,source:row.paper.source,document:row.paper.document??null};
  const policy={...graph.policy,mode:'manual',allowSynthetic:false,libraryAdvance:'manual'};
  const workflow=await createWorkflow({nodes:graph.nodes.map(({promptVersion,...n})=>n),policy,source:null,legacy:null},crypto);
  const packet={schema:'prism-derived-draft/v1',id:crypto.randomUUID(),createdAt:new Date().toISOString(),authority:'none',executionAllowed:false,origin:{archiveSha256:await sha256(source.raw,crypto),slotId,paperId,workflowId,graphVersion},paper,templateRaw:await exportWorkflow(workflow,crypto)};
  packet.sha256=await sha256(JSON.stringify(packet),crypto);
  const raw=JSON.stringify(packet),bytes=new TextEncoder().encode(raw).length;if(bytes>4000000)throw Error('DRAFT_TOO_LARGE');
  const preview={kind:'create-isolated-derived-draft',packet,byteLength:bytes,differences:{newIds:{paper:paper.id,workflow:workflow.id,draft:packet.id},copied:['selected paper title/source/document','selected graph nodes/prompts/dependencies'],excluded:['history','results','reviews','acceptances','project memberships','queue state','Host','credentials','metadata'],policyBefore:graph.policy,policyAfter:policy,activation:'none; not installed in paper library or project'}};
  tokens.set(preview,{raw,display:JSON.stringify(preview),sourceRaw:source.raw,slotId,key:prefix+packet.id});return preview;
 }
 async function confirm(preview,{explicitConfirmation=false}={}) {
  if(!explicitConfirmation)throw Error('CONFIRMATION_REQUIRED');if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  return withLock(prefix+'write',async()=>{const t=tokens.get(preview);if(!t||JSON.stringify(preview)!==t.display)throw Error('PREVIEW_INVALID');
   const source=await archiveController.open(t.slotId);if(source.raw!==t.sourceRaw)throw Error('ARCHIVE_CHANGED');
   if(tokens.get(preview)!==t||JSON.stringify(preview)!==t.display)throw Error('PREVIEW_INVALID');if(storage.getItem(t.key)!==null)throw Error('DRAFT_EXISTS');
   if(!Number.isSafeInteger(storage.length)||storage.length>10000)throw Error('DRAFT_SCAN_LIMIT');let count=0;for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(prefix))count++;}if(count>=50)throw Error('DRAFT_LIST_LIMIT');
   // Consume before write: write-then-error is unknown, never retried automatically.
   tokens.delete(preview);try{storage.setItem(t.key,t.raw);if(storage.getItem(t.key)!==t.raw)throw Error('READBACK_MISMATCH')}catch{throw Error('DRAFT_WRITE_UNKNOWN_CHECK_EXACT_KEY:'+t.key)}
   return {key:t.key,raw:t.raw,active:false,authority:'none'};
  });
 }
 async function open(key){
  if(typeof key!=='string'||!key.startsWith(prefix)||!uuid(key.slice(prefix.length)))throw Error('DRAFT_KEY_INVALID');
  const raw=storage.getItem(key);if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4000000)throw Error('DRAFT_INVALID');
  const p=JSON.parse(raw),{sha256:hash,...body}=p;if(Object.keys(p).sort().join(',')!=='authority,createdAt,executionAllowed,id,origin,paper,schema,sha256,templateRaw'||p.schema!=='prism-derived-draft/v1'||p.authority!=='none'||p.executionAllowed!==false||prefix+p.id!==key||hash!==await sha256(JSON.stringify(body),crypto))throw Error('DRAFT_INVALID');
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys;
  if(!exact(p.paper,'document,id,source,title')||!exact(p.origin,'archiveSha256,graphVersion,paperId,slotId,workflowId')||!uuid(p.id)||!uuid(p.paper.id)||!validDate(p.createdAt)||typeof p.paper.title!=='string'||!p.paper.title.trim()||p.paper.title.length>500||typeof p.paper.source!=='string'||p.paper.source.length>1000||!identifier(p.origin.paperId)||!identifier(p.origin.workflowId)||!/^slot-[0-9a-f-]{36}$/.test(p.origin.slotId)||!Number.isSafeInteger(p.origin.graphVersion)||p.origin.graphVersion<1||!['archiveSha256','paperId','slotId','workflowId'].every(k=>typeof p.origin[k]==='string')||!/^[a-f0-9]{64}$/.test(p.origin.archiveSha256))throw Error('DRAFT_INVALID');
  if(p.paper.document!==null){const d=p.paper.document;if(!exact(d,'byteLength,filename,mime,sha256,text')||typeof d.text!=='string'||typeof d.filename!=='string'||!d.filename.trim()||d.filename.length>255||/[\\/\x00-\x1f\x7f]/.test(d.filename)||!(/\.(txt|md)$/i).test(d.filename)||!['text/plain','text/markdown'].includes(d.mime)||(/\.txt$/i).test(d.filename)&&d.mime!=='text/plain'||!d.text.trim()||d.text.length>200000||Array.from(d.text).some(ch=>ch.length===1&&ch.charCodeAt(0)>=0xd800&&ch.charCodeAt(0)<=0xdfff)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d.text)||/^\ufeff?%PDF-/i.test(d.text)||!Number.isSafeInteger(d.byteLength)||d.byteLength<1||d.byteLength>524288||new TextEncoder().encode(d.text).length!==d.byteLength||await sha256(d.text,crypto)!==d.sha256)throw Error('DRAFT_DOCUMENT_INVALID');}
  await importWorkflow(p.templateRaw,crypto);const w=JSON.parse(p.templateRaw).state;if(w.source!==null||w.legacy!==null||w.syntheticAuthorized||w.runs.length||w.approvals.length||Object.keys(w.currentRuns).length||w.graphs.length!==1||w.graphs[0].policy.allowSynthetic||w.graphs[0].policy.mode!=='manual')throw Error('DRAFT_AUTHORITY_INVALID');
  if(storage.getItem(key)!==raw)throw Error('DRAFT_CHANGED');return {key,raw,packet:p,readOnly:true,active:false};
 }
 async function list(){if(!Number.isSafeInteger(storage.length)||storage.length>10000)throw Error('DRAFT_SCAN_LIMIT');const keys=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(typeof k==='string'&&k.startsWith(prefix))keys.push(k)}if(keys.length>50)throw Error('DRAFT_LIST_LIMIT');const rows=[];for(const key of keys)rows.push(await open(key));return rows;}
 return {prepare,confirm,list,open,cancel(preview){tokens.delete(preview)}};
}
