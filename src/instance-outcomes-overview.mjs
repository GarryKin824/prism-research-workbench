import {sha256} from './custom-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {createResearchInstancesController} from './research-instances-controller.mjs';
import {createInstanceManualResultsController,inspectInstanceManualResultsExport} from './instance-manual-results.mjs';
import {createInstanceReviewDecisionsController,inspectInstanceReviewDecisionsExport} from './instance-review-decisions.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)},exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===k.split(',').sort().join();
export const INSTANCE_OUTCOMES_EXPORT_LIMIT=12*1024*1024;
export async function inspectInstanceOutcomesExport(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>INSTANCE_OUTCOMES_EXPORT_LIMIT)fail('INSTANCE_OUTCOMES_SIZE');const p=JSON.parse(raw);
 if(!exact(p,'schema,namespace,projectId,paperId,instanceId,manualResultsRaw,reviewDecisionsRaw,sourceStatuses,recordAssessment,authority,notice,sha256')||p.schema!=='prism-instance-outcomes-appendix/v1'||p.authority!=='none'||['namespace','projectId','paperId','instanceId'].some(k=>typeof p[k]!=='string'||!p[k]||p[k].length>200)||typeof p.notice!=='string'||p.notice.length>2000||!exact(p.sourceStatuses,'results,decisions')||Object.values(p.sourceStatuses).some(x=>!['available','unknown','not-recorded'].includes(x)))fail('INSTANCE_OUTCOMES_SCHEMA');
 const {sha256:d,...body}=p;if(await sha256(JSON.stringify(body),crypto)!==d)fail('INSTANCE_OUTCOMES_HASH');
 const a=await inspectInstanceManualResultsExport(p.manualResultsRaw,crypto),b=await inspectInstanceReviewDecisionsExport(p.reviewDecisionsRaw,crypto);
 for(const data of [a,b])if(data.namespace!==p.namespace||data.projectId!==p.projectId||data.instanceId!==p.instanceId||data.records.some(r=>r.binding.target.paperId!==p.paperId))fail('INSTANCE_OUTCOMES_SCOPE');
 if(!exact(p.recordAssessment,'results,decisions'))fail('INSTANCE_OUTCOMES_ASSESSMENT');for(const [name,data] of [['results',a],['decisions',b]]){const items=p.recordAssessment[name];if(!Array.isArray(items)||items.length!==data.records.length||new Set(items.map(x=>x?.id)).size!==items.length||items.some(x=>!exact(x,'id,status')||!data.records.some(r=>r.id===x.id)||!['current','historical','stale','unavailable','unknown'].includes(x.status)))fail('INSTANCE_OUTCOMES_ASSESSMENT')}
 return {...p,manualResults:a,reviewDecisions:b,readOnly:true,unverified:true,executionAllowed:false};
}
function historicalBinding(record,instance,decision=false){
 try{if(!instance)return false;const b=record.binding,t=b.target;if(t.instanceId!==instance.id||t.projectId!==instance.projectId||t.paperId!==instance.sourcePaperId||b.sourceSha256!==instance.sourceSha256||b.projectRevisionSha256!==instance.projectRevisionSha256)return false;
 const env=instance.versions.map(raw=>JSON.parse(raw)).find(e=>e.sha256===t.workflowSha256),graph=env?.state.graphs.find(g=>g.version===t.graphVersion),node=graph?.nodes.find(n=>n.id===t.nodeId);if(!node||graph.sha256!==t.graphSha256)return false;
 if(decision)return node.kind==='review'&&b.prompt===node.prompt&&b.reviewTarget===node.reviewTarget&&JSON.stringify(b.dependsOn)===JSON.stringify(node.dependsOn)&&record.upstream.every(r=>historicalBinding(r,instance));
 const source=JSON.parse(instance.sourcePaperRaw);return record.prompt===node.prompt&&record.source.title===source.title&&record.source.documentSha256===(source.document?.sha256??null);
 }catch{return false}
}
export function createInstanceOutcomesOverviewController({store,storage,projectId,crypto=globalThis.crypto}){
 const namespace=store.getStorageKey();let generation=0;const resultKey=namespace+':instance-manual-results-v1:'+JSON.stringify(projectId),reviewKey=namespace+':instance-review-decisions-v1:'+JSON.stringify(projectId);
 async function capture({explicitReadConsent=false,paperId=null,instanceId=null}={},isCurrent=()=>true){
  if(explicitReadConsent!==true)fail('INSTANCE_OUTCOMES_READ_CONSENT');if(typeof projectId!=='string'||!projectId)fail('INSTANCE_OUTCOMES_PROJECT_REQUIRED');let unknownGuard=()=>{};const g=generation,keys=[namespace,namespace+':project-planning-v1',namespace+':project-library-v1',namespace+':research-instances-v1',resultKey,reviewKey,resultKey+':intent-v1',reviewKey+':intent-v1'],raws=new Map(keys.map(k=>[k,storage.getItem(k)])),papersRaw=JSON.stringify(store.getSnapshot().papers);
  const stable=()=>{unknownGuard();store.assertCurrentStorage();if(g!==generation||!isCurrent()||store.getStorageKey()!==namespace||JSON.stringify(store.getSnapshot().papers)!==papersRaw||keys.some(k=>storage.getItem(k)!==raws.get(k)))fail('INSTANCE_OUTCOMES_CAPTURE_CHANGED')};stable();
  const library=createProjectLibraryController({store,storage,crypto});await library.initialize();stable();const scope=await library.snapshot(projectId);stable();scope.stable();const papers=scope.papers.filter(p=>scope.paperIds.includes(p.id));if(paperId&&!papers.some(p=>p.id===paperId))fail('INSTANCE_OUTCOMES_PAPER_NOT_MEMBER');
  const instances=createResearchInstancesController({store,storage,crypto});let instanceRows=[],instanceState='available';try{const s=await instances.initialize();stable();instanceRows=s.state.instances.filter(i=>i.projectId===projectId)}catch(e){stable();instanceState='unavailable'}
  const verifyNavigation=(t,current)=>{stable();if(instanceState!=='available')fail('INSTANCE_OUTCOMES_INSTANCE_UNAVAILABLE');return instances.verifyNavigation(t,()=>{try{stable();return current()}catch{return false}})};
  const results=createInstanceManualResultsController({store,storage,projectId,crypto,verifyNavigation}),reviews=createInstanceReviewDecisionsController({store,storage,projectId,crypto,verifyNavigation});const recoveryMark=JSON.stringify([results.recovery(),reviews.recovery()]);unknownGuard=()=>{if(JSON.stringify([results.recovery(),reviews.recovery()])!==recoveryMark)fail('INSTANCE_OUTCOMES_UNKNOWN_CHANGED')};const sources={results:'not-recorded',decisions:'not-recorded',instances:instanceState},errors={};let rr=[],dr=[];
  for(const [name,controller,key] of [['results',results,resultKey],['decisions',reviews,reviewKey]])try{const data=await controller.read({explicitReadConsent:true,isCurrent:()=>{try{stable();return true}catch{return false}}});stable();sources[name]=data.outcome==='unknown'?'unknown':raws.get(key)===null?'not-recorded':'available';if(name==='results')rr=data.records;else dr=data.records}catch(e){stable();sources[name]='unavailable';errors[name]=e.message}
  const selectedPapers=paperId?papers.filter(p=>p.id===paperId):papers,rows=[];
  for(const paper of selectedPapers){const ids=new Set([...instanceRows.filter(i=>i.sourcePaperId===paper.id).map(i=>i.id),...rr.filter(r=>r.binding.target.paperId===paper.id).map(r=>r.binding.target.instanceId),...dr.filter(r=>r.binding.target.paperId===paper.id).map(r=>r.binding.target.instanceId)]),list=[];
   for(const id of ids){if(instanceId&&id!==instanceId)continue;const instance=instanceRows.find(i=>i.id===id&&i.sourcePaperId===paper.id),resultRows=[],decisionRows=[],quarantined=[],matches=r=>r.binding.target.instanceId===id&&r.binding.target.paperId===paper.id;
    for(const record of rr.filter(matches)){if(!historicalBinding(record,instance)){quarantined.push({kind:'result',record:clone(record),status:'unavailable',reason:'Historical instance/workflow/node/source binding not verified'});continue}let status=sources.results==='unknown'?'unknown':!historicalBinding(record,instance)?'unavailable':'stale';if(instance&&status!=='unknown'&&status!=='unavailable'){const result=await results.checkRecord(record,{isCurrent:()=>{try{stable();return true}catch{return false}}});stable();if(result.status==='current'){const latest=rr.filter(r=>matches(r)&&r.binding.target.nodeId===record.binding.target.nodeId).at(-1);status=latest?.id===record.id?'current':'historical'}else status=instanceState==='available'?'stale':'unavailable'}resultRows.push({record:clone(record),status})}
    for(const record of dr.filter(matches)){if(!historicalBinding(record,instance,true)){quarantined.push({kind:'decision',record:clone(record),status:'unavailable',reason:'Historical review and upstream binding not verified'});continue}let status=sources.decisions==='unknown'?'unknown':!historicalBinding(record,instance,true)?'unavailable':'stale';if(instance&&status!=='unknown'&&status!=='unavailable'){const result=await reviews.checkRecord(record,{isCurrent:()=>{try{stable();return true}catch{return false}}});stable();status=result.status==='current'?'current':result.status==='superseded'?'historical':result.status==='unknown'?'unknown':'stale'}decisionRows.push({record:clone(record),status})}
    list.push({instanceId:id,sourceStatus:instance?'available':'unavailable',results:resultRows,decisions:decisionRows,quarantined});
   }rows.push({paperId:paper.id,title:paper.title,instances:list});
  }
  if(instanceId&&!rows.some(p=>p.instances.some(i=>i.instanceId===instanceId)))fail('INSTANCE_OUTCOMES_INSTANCE_NOT_IN_SCOPE');
  stable();
  function sourceForResult(id){
   stable();
   for(const paper of rows){
    for(const scope of paper.instances){
     const saved=scope.results.find(item=>item.record.id===id);
     if(!saved)continue;
     if(saved.status==='unknown')fail('INSTANCE_OUTCOMES_UNCERTAIN');
     const instance=instanceRows.find(item=>item.id===scope.instanceId);
     return {record:clone(saved.record),sourcePaperRaw:instance.sourcePaperRaw,requirements:clone(instance.outputRequirements??[])};
    }
   }
   return fail('INSTANCE_OUTCOMES_RESULT_MISSING');
  }
  const overview={namespace,projectId,papers:rows,sources,errors,authority:'none',researchCompletionEstablished:false,notice:'人工结果是用户提供的未核验原文；审核决定是人工判断，不是科学验证、执行许可或研究完成。current仅表示此捕获时与已保存来源一致。旧报告及便携备份不包含本附录。'};
  return {overview,results,reviews,stable,sourceForResult};
 }
 async function read(options,isCurrent){const c=await capture(options,isCurrent);return {...c.overview,stable:c.stable,sourceForResult:c.sourceForResult}}
 async function prepareExportSelected({paperId,instanceId,explicitReadConsent=false}={},isCurrent=()=>true){if(!paperId||!instanceId)fail('INSTANCE_OUTCOMES_SELECTION_REQUIRED');const c=await capture({paperId,instanceId,explicitReadConsent},isCurrent);if(['results','decisions'].some(k=>c.overview.sources[k]==='unavailable'))fail('INSTANCE_OUTCOMES_UNREADABLE_NO_EXPORT');const manualResultsRaw=await c.results.exportJSON({explicitReadConsent:true,instanceId,isCurrent});c.stable();const reviewDecisionsRaw=await c.reviews.exportJSON({explicitReadConsent:true,instanceId,isCurrent});c.stable();const instance=c.overview.papers[0].instances[0],recordAssessment={results:[...instance.results.map(x=>({id:x.record.id,status:x.status})),...instance.quarantined.filter(x=>x.kind==='result').map(x=>({id:x.record.id,status:'unavailable'}))],decisions:[...instance.decisions.map(x=>({id:x.record.id,status:x.status})),...instance.quarantined.filter(x=>x.kind==='decision').map(x=>({id:x.record.id,status:'unavailable'}))]};const body={schema:'prism-instance-outcomes-appendix/v1',namespace,projectId,paperId,instanceId,manualResultsRaw,reviewDecisionsRaw,recordAssessment,sourceStatuses:{results:c.overview.sources.results,decisions:c.overview.sources.decisions},authority:'none',notice:'Two original-format selected-instance export JSON strings are retained verbatim. recordAssessment is an unverified capture-time projection, never a restored current-state determination. Not raw project-wide storage bytes, full source documents, current approval, execution permission, or part of the old portable backup.'},raw=JSON.stringify({...body,sha256:await sha256(JSON.stringify(body),crypto)});c.stable();await inspectInstanceOutcomesExport(raw,crypto);c.stable();return {raw,stable:c.stable}}
 async function exportSelected(options,isCurrent){return (await prepareExportSelected(options,isCurrent)).raw}
 return {read,exportSelected,prepareExportSelected,cancel:()=>{generation++}};
}
