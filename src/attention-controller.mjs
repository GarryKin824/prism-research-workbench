import * as attentionCore from './attention-core.mjs';
import * as graphCore from './custom-core.mjs';
import * as libraryCore from './library-core.mjs';
export function createAttentionController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey(),key=namespace+':attention-journal-v1';let baseline=storage.getItem(key),journal=null,ready=false;
 function check(){store.assertCurrentStorage();if(storage.getItem(key)!==baseline)throw Error('ATTENTION_STORAGE_CONFLICT')}
 async function initialize(){check();journal=baseline===null?await attentionCore.createJournal({namespace},crypto):await attentionCore.loadJournal(baseline,{namespace},crypto);check();ready=true;return journal}
 async function snapshot(){check();if(!ready)throw Error('ATTENTION_NOT_READY');const papers=store.getSnapshot().papers,sourceRaw=JSON.stringify(papers),reads=new Map(),workflows=[],queues=[],issues=[];
  const read=k=>{const raw=storage.getItem(k);if(reads.has(k)&&reads.get(k)!==raw)throw Error('ATTENTION_SOURCE_CHANGED');reads.set(k,raw);return raw};
  for(const p of papers){const raw=read(namespace+':custom-workflow-v1:'+p.id);if(raw===null)continue;try{await graphCore.importWorkflow(raw,crypto);const workflow=JSON.parse(raw).state;if(workflow.source.namespace!==namespace||workflow.source.paperId!==p.id||workflow.source.paperTitle!==p.title||workflow.source.documentSha256!==(p.document?.sha256||null))throw Error('WORKFLOW_SOURCE_CHANGED');workflows.push({namespace,paperId:p.id,workflow})}catch(e){issues.push({paperId:p.id,label:p.title,code:e.message})}}
  const raw=read(namespace+':library-queue-v1');if(raw!==null)try{await libraryCore.importQueue(raw,crypto);const queue=JSON.parse(raw).queue;queues.push({namespace,queue});const view=libraryCore.queueView(queue),targets=[view.pending?.entry,view.active?.entry,view.nextEntry].filter(Boolean);for(const target of targets){const targetRaw=read(namespace+':custom-workflow-v1:'+target.paperId),paper=papers.find(p=>p.id===target.paperId);if(!paper||targetRaw===null)issues.push({paperId:target.paperId,label:target.label,code:'QUEUE_TARGET_UNAVAILABLE_OBSERVED'});else if(!workflows.some(x=>x.paperId===target.paperId))issues.push({paperId:target.paperId,label:target.label,code:'QUEUE_TARGET_UNVERIFIED_OBSERVED'})}}catch(e){issues.push({paperId:null,label:'跨论文队列',code:e.message})}
  const attention=await attentionCore.deriveAttention({workflows,queues},crypto);
  function stable(){check();if(JSON.stringify(store.getSnapshot().papers)!==sourceRaw)throw Error('ATTENTION_SOURCE_CHANGED');for(const [k,v]of reads)if(storage.getItem(k)!==v)throw Error('ATTENTION_SOURCE_CHANGED')}
  stable();return {attention,issues,journal,stable};
 }
 async function prepare(itemId,status,note=''){const s=await snapshot();if(s.issues.length)throw Error('ATTENTION_UNVERIFIED_SOURCE');const preview=await attentionCore.prepareAction(journal,{attention:s.attention,itemId,status,note},crypto);s.stable();return preview}
 async function confirm(preview){if(!withLock)throw Error('WEB_LOCKS_REQUIRED');return withLock(namespace+':attention-write',async()=>{const s=await snapshot();if(s.issues.length)throw Error('ATTENTION_UNVERIFIED_SOURCE');const next=await attentionCore.confirmAction(journal,preview,{attention:s.attention},crypto),raw=await attentionCore.exportJournal(next,crypto);s.stable();storage.setItem(key,raw);baseline=raw;journal=next;return journal})}
 return {initialize,snapshot,prepare,confirm,async exportJSON(){check();if(!ready)throw Error('ATTENTION_NOT_READY');const raw=await attentionCore.exportJournal(journal,crypto);check();return raw}};
}
