import {readInstanceManualResults} from './instance-manual-results.mjs';
import {readInstanceReviewDecisions} from './instance-review-decisions.mjs';
import {readInstanceFindingsLedger} from './instance-findings.mjs';
import {assertWorkbenchExecutionSource,assertWorkbenchExecutionReferences,readWorkbenchExecutions} from './workbench-model-execution.mjs';
import {sha256} from './custom-core.mjs';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const fail=code=>{throw Error(code)};
const bytes=value=>new TextEncoder().encode(value).length;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function inspectInstanceResearchAnnex(entries,view,namespace,crypto=globalThis.crypto){
 const projects=view.researchProjects??[],ids=projects.map(p=>p.id),instances=view.researchInstances?.record?.instances??[];
 if(!Array.isArray(entries)||entries.length!==ids.length||new Set(entries.map(e=>e?.projectId)).size!==entries.length)fail('INSTANCE_ANNEX_PROJECT_SCOPE');

 function sourceFor(target,projectId){
  const instance=instances.find(row=>row.id===target.instanceId&&row.projectId===projectId&&row.sourcePaperId===target.paperId);
  const project=projects.find(row=>row.id===projectId);
  if(target.namespace!==namespace||target.projectId!==projectId||!instance
     ||!project?.revisions.some(row=>row.sha256===instance.projectRevisionSha256))fail('INSTANCE_ANNEX_BINDING');
  const version=instance.versions.map(JSON.parse).find(row=>row.sha256===target.workflowSha256);
  const graph=version?.state.graphs.find(row=>row.version===target.graphVersion);
  const node=graph?.nodes.find(row=>row.id===target.nodeId);
  if(!node||graph.sha256!==target.graphSha256)fail('INSTANCE_ANNEX_WORKFLOW_BINDING');
  return {instance,node,paper:JSON.parse(instance.sourcePaperRaw)};
 }

 async function executionSource(record,projectId,results,reviews){
  const target=record.input.target,{instance,node,paper}=sourceFor(target,projectId);
  if(node.kind!==(record.mode==='review'?'review':'work'))fail('INSTANCE_ANNEX_EXECUTION_NODE');
  assertWorkbenchExecutionSource(record,{target,sourceSha256:instance.sourceSha256,
   projectRevisionSha256:instance.projectRevisionSha256,promptSha256:await sha256(node.prompt,crypto),
   promptVersion:node.promptVersion,documentSha256:paper.document?.sha256??null,prompt:node.prompt,
   documentText:paper.document?.text,outputRequirementsHistory:instance.outputRequirements});
  assertWorkbenchExecutionReferences(record,results?.records??[],reviews?.records??[],node);
 }

 async function binding(record,projectId,review=false){
  const b=record.binding,{instance,node,paper}=sourceFor(b.target,projectId);
  if(b.sourceSha256!==instance.sourceSha256||b.projectRevisionSha256!==instance.projectRevisionSha256
     ||(review?b.prompt:record.prompt)!==node.prompt||await sha256(node.prompt,crypto)!==b.promptSha256)fail('INSTANCE_ANNEX_WORKFLOW_BINDING');
  if(review){
   if(node.kind!=='review'||node.reviewTarget!==b.reviewTarget||!same(node.dependsOn,b.dependsOn))fail('INSTANCE_ANNEX_REVIEW_BINDING');
   for(const upstream of record.upstream)await binding(upstream,projectId);
  }else if(record.source.paperId!==paper.id||record.source.title!==paper.title
           ||record.source.sourceSha256!==instance.sourceSha256||record.source.documentSha256!==(paper.document?.sha256??null)){
   fail('INSTANCE_ANNEX_SOURCE_BINDING');
  }
 }

 const result=[];
 for(const entry of entries){
  const hasExecutions=Object.hasOwn(entry??{},'executionsRaw');
  const fields=['resultsRaw','reviewsRaw','findingsRaw',...(hasExecutions?['executionsRaw']:[])];
  if(!exact(entry,['projectId',...fields].join(','))||!ids.includes(entry.projectId)
     ||fields.some(key=>!(entry[key]===null||typeof entry[key]==='string'&&bytes(entry[key])<=2*1024*1024)))fail('INSTANCE_ANNEX_COMPONENT');
  const {projectId,resultsRaw,reviewsRaw,findingsRaw,executionsRaw}=entry;
  const results=resultsRaw===null?null:await readInstanceManualResults(resultsRaw,namespace,projectId,crypto);
  const reviews=reviewsRaw===null?null:await readInstanceReviewDecisions(reviewsRaw,namespace,projectId,crypto);
  const findings=findingsRaw===null?null:await readInstanceFindingsLedger(findingsRaw,namespace,projectId,crypto);
  const executions=executionsRaw==null?null:await readWorkbenchExecutions(executionsRaw,namespace,projectId,crypto);
  for(const execution of executions?.records??[])await executionSource(execution,projectId,results,reviews);
  for(const record of results?.records??[]){
   await binding(record,projectId);
   if(record.execution&&!executions?.records.some(row=>same(row,record.execution)))fail('INSTANCE_ANNEX_EXECUTION_MISSING');
  }
  for(const record of reviews?.records??[]){
   await binding(record,projectId,true);
   for(const upstream of record.upstream)
    if(!results?.records.some(row=>same(row,upstream)))fail('INSTANCE_ANNEX_ORIGINAL_MISSING');
  }
  for(const record of findings?.records??[]){
   const original=JSON.parse(record.resultRaw).records[0];
   await binding(original,projectId);
   if(!results?.records.some(row=>same(row,original)))fail('INSTANCE_ANNEX_ORIGINAL_MISSING');
   const {paper:{document}}=sourceFor(original.binding.target,projectId);
   const evidence=JSON.parse(record.evidenceRaw).state.records[0];
   if(!document||typeof document.text!=='string'||bytes(document.text)!==document.byteLength
      ||await sha256(document.text,crypto)!==evidence.documentSha256||document.sha256!==evidence.documentSha256
      ||!document.text.includes(evidence.quote))fail('INSTANCE_ANNEX_QUOTE_SOURCE_MISMATCH');
  }
  result.push({...entry,results,reviews,findings,...(hasExecutions?{executions}:{}),authority:'none',
   historyOnly:true,currentSourceChecked:false,restoresApprovals:false,restoresIntent:false});
 }
 return {entries:result,authority:'none',readOnly:true,historyOnly:true,authenticated:false,executionAllowed:false,restoresApprovals:false,restoresIntent:false};
}
