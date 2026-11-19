import {createRestrictedEditor} from './restricted-editor.mjs';
import * as G from './custom-core.mjs';
const LIMIT=4000000,validNS=x=>typeof x==='string'&&/^lab-bundle-[a-z0-9-]{1,70}$/.test(x),clone=x=>JSON.parse(JSON.stringify(x));
export async function inspectRestrictedBundle(raw,crypto){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>LIMIT)throw Error('IMPORT_SIZE');
 let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('IMPORT_JSON')}
 if(!validNS(parsed?.namespace))throw Error('IMPORT_NAMESPACE');const key=parsed.namespace+':bundle-v1';
 const editor=createRestrictedEditor({namespace:parsed.namespace,crypto,storage:{getItem:k=>k===key?raw:null,setItem(){throw Error('VALIDATION_WRITE_FORBIDDEN')}}});
 return editor.load();
}
export function createRestrictedImport({storage,crypto,withLock,scope}){
 if(typeof scope!=='string'||!scope||scope.length>300)throw Error('IMPORT_SCOPE');
 const tokens=new WeakMap(),inflight=new WeakMap(),prefixPromise=G.sha256(scope,crypto).then(h=>'lab-bundle-i-'+h.slice(0,16)+'-');
 const scopedKeys=async()=>{const prefix=await prefixPromise;if(!Number.isSafeInteger(storage.length)||storage.length>10000)throw Error('IMPORT_SCAN_LIMIT');const keys=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(typeof k==='string'&&k.startsWith(prefix))keys.push(k)}if(keys.length>50)throw Error('IMPORT_LIST_LIMIT');return keys;};
 async function prepare(raw){
  const source=await inspectRestrictedBundle(raw,crypto),namespace=(await prefixPromise)+crypto.randomUUID(),key=namespace+':bundle-v1';
  if(!validNS(namespace)||storage.getItem(key)!==null)throw Error('IMPORT_DESTINATION_EXISTS');
  const origin=JSON.parse(source.entries['data/origin']),current={paper:JSON.parse(source.entries['data/paper']),project:JSON.parse(source.entries['data/project']),membership:JSON.parse(source.entries['data/membership']),workflow:source.entries['data/workflow']};
  const newPaperId=crypto.randomUUID(),newProjectId=crypto.randomUUID(),mapping=[];
  async function rebind(snapshot){
   const paper={...clone(snapshot.paper),id:newPaperId},project={...clone(snapshot.project),id:newProjectId},old=JSON.parse(snapshot.workflow).state,g=old.graphs[0];
   const membership={paperId:newPaperId,projectId:newProjectId,paperSha256:await G.sha256(JSON.stringify(paper),crypto),projectSha256:await G.sha256(JSON.stringify(project),crypto)};
   const workflow=await G.createWorkflow({nodes:g.nodes.map(({promptVersion,...n})=>n),policy:clone(g.policy),source:{namespace,paperId:newPaperId,paperTitle:paper.title,documentSha256:paper.document?.sha256??null,sourceArchiveSha256:membership.paperSha256},legacy:null},crypto);
   mapping.push({old:old.id,new:workflow.id});return {paper,project,membership,workflow:await G.exportWorkflow(workflow,crypto)};
  }
  const history=[];for(const s of origin.history)history.push(await rebind(s));const latest=await rebind(current);
  const nextOrigin={schema:'prism-editor-origin/v2',draftKey:origin.draftKey,draftRaw:origin.draftRaw,draftSha256:origin.draftSha256,history,copy:{sourceBundleSha256:await G.sha256(raw,crypto),sourceNamespace:source.namespace,sourceRevision:source.revision}};
  const entries={'data/paper':JSON.stringify(latest.paper),'data/project':JSON.stringify(latest.project),'data/membership':JSON.stringify(latest.membership),'data/workflow':latest.workflow,'data/origin':JSON.stringify(nextOrigin)};
  const body={schema:'prism-lab-bundle/v1',namespace,revision:source.revision,authority:'none',entries},targetRaw=JSON.stringify({...body,sha256:await G.sha256(JSON.stringify(body),crypto)});
  await inspectRestrictedBundle(targetRaw,crypto);
  const preview={kind:'restricted-import-new-copy',targetNamespace:namespace,targetKey:key,sourceNamespace:source.namespace,sourceSha256:nextOrigin.copy.sourceBundleSha256,revision:source.revision,historyCount:history.length,byteLength:new TextEncoder().encode(targetRaw).length,ids:{paper:{old:current.paper.id,new:newPaperId},project:{old:current.project.id,new:newProjectId},workflows:mapping},contents:entries,authority:'none',executionAllowed:false,notice:'New isolated editable copy only; original untouched; historical snapshots rebound, no execution authority, hashes are not signatures. Prior copy metadata replaced by immediate-parent digest; original derived packet retained once.'};
  tokens.set(preview,{display:JSON.stringify(preview),raw:targetRaw,key});return preview;
 }
 async function confirm(p,{explicitConfirmation=false,signal}={}){
  if(!explicitConfirmation)throw Error('CONFIRMATION_REQUIRED');if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');const t=tokens.get(p);if(!t||JSON.stringify(p)!==t.display)throw Error('IMPORT_PREVIEW_INVALID');
  tokens.delete(p);const controller=new AbortController();inflight.set(p,controller);const check=()=>{if(controller.signal.aborted||signal?.aborted)throw Error('IMPORT_CANCELLED')};
  try{return await withLock((await prefixPromise)+':write',async()=>{check();await inspectRestrictedBundle(t.raw,crypto);check();if(JSON.stringify(p)!==t.display)throw Error('IMPORT_PREVIEW_INVALID');if(storage.getItem(t.key)!==null)throw Error('IMPORT_DESTINATION_EXISTS');const keys=await scopedKeys();check();if(JSON.stringify(p)!==t.display)throw Error('IMPORT_PREVIEW_INVALID');if(keys.length>=50)throw Error('IMPORT_LIST_LIMIT');if(storage.getItem(t.key)!==null)throw Error('IMPORT_DESTINATION_EXISTS');
   try{storage.setItem(t.key,t.raw);if(storage.getItem(t.key)!==t.raw)throw Error('READBACK')}catch{throw Error('IMPORT_WRITE_UNKNOWN_CHECK_KEY:'+t.key)}return {key:t.key,raw:t.raw,namespace:p.targetNamespace,active:false,authority:'none'};
  })}finally{inflight.delete(p)}
 }
 async function open(key){const prefix=await prefixPromise;if(typeof key!=='string'||!key.startsWith(prefix)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:bundle-v1$/).test(key.slice(prefix.length)))throw Error('IMPORT_KEY_SCOPE');const raw=storage.getItem(key),result=await inspectRestrictedBundle(raw,crypto);if(result.namespace+':bundle-v1'!==key||storage.getItem(key)!==raw)throw Error('IMPORT_CHANGED');return {key,...result};}
 async function list(){const keys=await scopedKeys(),rows=[],raws=new Map(keys.map(k=>[k,storage.getItem(k)]));for(const key of keys){const b=await open(key);if(b.raw!==raws.get(key))throw Error('IMPORT_CHANGED');rows.push({key,namespace:b.namespace,revision:b.revision,title:JSON.parse(b.entries['data/project']).title,authority:'none'})}if(JSON.stringify(await scopedKeys())!==JSON.stringify(keys)||[...raws].some(([k,v])=>storage.getItem(k)!==v))throw Error('IMPORT_CHANGED');return rows;}
 return {prepare,confirm,list,open,cancel(p){tokens.delete(p);inflight.get(p)?.abort()}};
}
