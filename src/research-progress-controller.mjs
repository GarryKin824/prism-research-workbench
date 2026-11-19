import {loadTerminalResults,assertTerminalResultsHistory,createTerminalResults} from './terminal-review-results-core.mjs';
import {createDocumentSourceResults} from './document-source-results-core.mjs';
import {validateSourceRebaseWorkflow} from './document-source-rebase-core.mjs';
import {loadFindingEvidence,createFindingEvidenceProjection} from './finding-evidence-core.mjs';
import {createProjectResultsDetail,createProjectResultsView,projectQueueHistory,assertProjectQueueHistory} from './project-results-core.mjs';
import {loadCopyResults,assertCopyHistory,createCopyResults} from './copy-results-core.mjs';
import {loadApprovalResults,assertApprovalHistory,createApprovalResults} from './approval-results-core.mjs';
import {createPaperResultsDetail,createPaperResultsView} from './paper-results-core.mjs';
import {importWorkflow,sha256} from './custom-core.mjs';
import {loadInstances} from './research-instances-core.mjs';
import {loadInstanceReviews} from './instance-review-core.mjs';
import {loadNodeReviews} from './node-review-core.mjs';
import {loadProjectQueues,latestProjectQueue} from './project-queue-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {loadManualJournal} from './manual-reply-journal.mjs';
import {createManualFindingsView} from './manual-findings-core.mjs';
import {loadMulti,multiView} from './multi-evidence-core.mjs';
import {loadEvidenceMap,evidenceMapView} from './evidence-map-core.mjs';
import {freezeProgress,projectWorkflowProgress,projectBasicProgress,progressSourceStatus,progressAnnotation,PROGRESS_LIMITS} from './research-progress-core.mjs';
const SUFFIXES={terminalDecisions:':terminal-review-decisions-v1',findingEvidence:':finding-evidence-v1',copyLedger:':manual-handoff-ledger-v1',approvalDecisions:':manual-review-decisions-v1',instances:':research-instances-v1',instanceReviews:':instance-reviews-v1',nodeReviews:':node-review-v1',findings:':manual-reply-journal-v1',queue:':project-queues-v1',evidence:':evidence-map-v2',legacyEvidence:':evidence-map-v1',membership:':project-library-v1',projects:':project-planning-v1'};
/** Fresh read-only projection. No cache of authority, no runner, no writes. */
export function createResearchProgressController({store,storage,crypto=globalThis.crypto}){
 const namespace=store.getStorageKey(),observed=new Map();let generation=0;
 async function read({projectId,scopeReady}={},isCurrent=()=>true){
  const operation=++generation;if(scopeReady!==true||typeof projectId!=='string'||projectId.length>100)throw Error('PROGRESS_SCOPE_UNKNOWN');
  const check=()=>{if(generation!==operation||store.getStorageKey()!==namespace||isCurrent()!==true)throw Error('PROGRESS_CONTEXT_CHANGED');try{store.assertCurrentStorage()}catch{throw Error('PROGRESS_STORAGE_UNAVAILABLE')}};
  check();let paperSnapshot,papersRaw,papers,persistenceRaw,persistence;
  try{const snapshot=store.getSnapshot();paperSnapshot=snapshot.papers;persistenceRaw=JSON.stringify(snapshot.persistence??null);persistence={saved:snapshot.persistence?.saved===true,status:snapshot.persistence?.saved===true?'saved':snapshot.persistence?.saved===false?'memory-only':'unknown'};papersRaw=JSON.stringify(paperSnapshot);papers=JSON.parse(papersRaw);if(!Array.isArray(papers)||papers.length>PROGRESS_LIMITS.papers||new Set(papers.map(p=>p.id)).size!==papers.length||papers.some(p=>typeof p.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(p.id)||typeof p.title!=='string'||p.title.length>1000))throw Error()}catch{throw Error('PROGRESS_PAPERS_UNAVAILABLE')}
  // Capture every source synchronously before the first asynchronous digest.
  const captured=new Map(),unreadable=new Set(),raws={};let capturedBytes=papersRaw.length*2;
  // Upper bound for retained UTF-16 strings, including the paper snapshot.
  const capture=key=>{let value;try{value=storage.getItem(key)}catch{unreadable.add(key);return undefined}if(value!==null&&typeof value!=='string'){unreadable.add(key);return undefined}capturedBytes+=(value?.length??0)*2;if(capturedBytes>PROGRESS_LIMITS.captureBytes)throw Error('PROGRESS_READ_LIMIT');captured.set(key,value);return value};
  capture(namespace);for(const [source,suffix]of Object.entries(SUFFIXES))raws[source]=capture(namespace+suffix);
  const customRaws=new Map(papers.map(p=>[p.id,capture(namespace+':custom-workflow-v1:'+p.id)]));
  const stable=()=>{check();try{if(JSON.stringify(store.getSnapshot().persistence??null)!==persistenceRaw||JSON.stringify(store.getSnapshot().papers)!==papersRaw)throw Error();for(const [key,raw]of captured)if(storage.getItem(key)!==raw)throw Error();for(const key of unreadable){let failed=false;try{storage.getItem(key)}catch{failed=true}if(!failed)throw Error()}}catch{throw Error('PROGRESS_SOURCE_CHANGED')}};
  const checkCurrent=()=>{check();if(JSON.stringify(store.getSnapshot().persistence??null)!==persistenceRaw)throw Error('PROGRESS_SOURCE_CHANGED');const now=store.getSnapshot().papers;if(now!==paperSnapshot||!Object.isFrozen(paperSnapshot)){stable();return}try{for(const [key,raw]of captured)if(storage.getItem(key)!==raw)throw Error();for(const key of unreadable){let failed=false;try{storage.getItem(key)}catch{failed=true}if(!failed)throw Error()}}catch{throw Error('PROGRESS_SOURCE_CHANGED')}};
  const guardedCrypto={subtle:{digest:async(...args)=>{stable();const value=await crypto.subtle.digest(...args);stable();return value}}};
  // Session-local high-water marks contain only IDs, counts and digests, never
  // document/prompt/reply payloads. A fresh controller cannot prove older loss.
  const pendingObservations=new Map();
  function workflowChains(w){return [{name:'identity',values:[w.id]},{name:'graphs',values:w.graphs.map(g=>g.sha256)},{name:'runs',values:w.runs.map(r=>r.id)},...w.runs.filter(r=>r.status!=='running').map(r=>({name:'terminal:'+r.id,values:[JSON.stringify([r.status,r.artifact?.sha256??null,r.verdict])]}))];}
  function observe(key,raw,kind,value){
   const old=observed.get(key);if(raw===null){if(old)throw Error('PROGRESS_HISTORY_CHANGED');return}
   if(kind==='copyLedger'){assertCopyHistory(old,value.history);pendingObservations.set(key,value.history);return;}
   if(kind==='terminalDecisions'){const next={schema:value.state.schema,eventDigests:[...value.eventDigests]};assertTerminalResultsHistory(old,next);pendingObservations.set(key,next);return;}
   if(kind==='approvalDecisions'){const next={schema:value.state.schema,eventDigests:[...value.eventDigests]};assertApprovalHistory(old,next);pendingObservations.set(key,next);return;}
   if(kind==='instances'){const next=value.projectQueueObservation;assertProjectQueueHistory(observed.get(key+':queueHistory'),next);}
   const chains=[];const chain=(name,values)=>chains.push({name,values});
   if(['findingEvidence','findings','nodeReviews','instanceReviews'].includes(kind))chain('records',value.records.map(r=>r.sha256));
   else if(kind==='legacyEvidence')chain('revisions',value.revisions.map(r=>r.sha256));
   else if(kind==='evidence')for(const c of value.claims)chain('claim:'+c.id,JSON.parse(c.tableRaw).table.revisions.map(r=>r.sha256));
   else if(['queue','membership','projects'].includes(kind))for(const p of value.projects)chain('project:'+(p.projectId??p.id),p.revisions.map(r=>r.sha256));
   else if(kind==='instances')for(const i of value.instances)chain('instance:'+i.id,i.versions.map(raw=>JSON.parse(raw).sha256));
   else if(kind==='sharedWorkflow')chains.push(...workflowChains(value.state));else return;
   // A first-document checkpoint is the sole permitted source-lineage bridge.
   // Validate the entire previously observed prefix against the preserved old
   // workflow, not against the new ID. Future reads then pin the new lineage.
   const comparison=kind==='sharedWorkflow'&&value.sourceTransitionPrior?workflowChains(value.sourceTransitionPrior):chains;
   if(old)for(const prior of old){const current=comparison.find(c=>c.name===prior.name);if(!current||current.values.length<prior.length||prior.length&&current.values[prior.length-1]!==prior.head)throw Error('PROGRESS_HISTORY_CHANGED')}
   if(kind==='instances')pendingObservations.set(key+':queueHistory',value.projectQueueObservation);
   pendingObservations.set(key,chains.map(c=>({name:c.name,length:c.values.length,head:c.values.at(-1)??null})));
  }
  let scope=null;
  if(projectId){try{const controller=createProjectLibraryController({store,storage,crypto:guardedCrypto});await controller.initialize();stable();scope=await controller.snapshot(projectId);stable();observe(namespace+SUFFIXES.membership,raws.membership,'membership',scope.state);observe(namespace+SUFFIXES.projects,raws.projects,'projects',scope.projects)}catch{stable();throw Error('PROGRESS_SCOPE_UNAVAILABLE')}}
  const memberIds=new Set(scope?.paperIds??papers.map(p=>p.id)),selected=papers.filter(p=>memberIds.has(p.id)),issues=[],statuses={};
  async function optional(source,raw,parse,paperId=null){
   const key=paperId?namespace+':custom-workflow-v1:'+paperId:namespace+SUFFIXES[source];
   try{if(raw===null){observe(key,raw,source,null);if(!paperId)statuses[source]='missing';return null}if(raw===undefined)throw Error();const value=await parse(raw);stable();observe(key,raw,source,value);if(!paperId)statuses[source]='available';return value}catch{stable();if(!paperId)statuses[source]='unavailable';issues.push({source,code:'SOURCE_UNAVAILABLE',...(paperId?{paperId}:{})});return null}
  }
  const copies=await optional('copyLedger',raws.copyLedger,raw=>loadCopyResults(raw,namespace,guardedCrypto));
  const terminal=await optional('terminalDecisions',raws.terminalDecisions,raw=>loadTerminalResults(raw,namespace,guardedCrypto));
  const approvals=await optional('approvalDecisions',raws.approvalDecisions,raw=>loadApprovalResults(raw,namespace,guardedCrypto));
  const instances=await optional('instances',raws.instances,async raw=>{const state=await loadInstances(raw,namespace,guardedCrypto);const projectQueueObservation=await projectQueueHistory(state,guardedCrypto);return {...state,projectQueueObservation};});
  const instanceReviews=await optional('instanceReviews',raws.instanceReviews,raw=>{if(statuses.instances==='unavailable')throw Error();return loadInstanceReviews(raw,{namespace,instancesRaw:raws.instances},guardedCrypto)});
  const nodeReviews=await optional('nodeReviews',raws.nodeReviews,raw=>loadNodeReviews(raw,{namespace},guardedCrypto));
  const journal=await optional('findings',raws.findings,raw=>loadManualJournal(raw,namespace,guardedCrypto));
  const findingEvidence=await optional('findingEvidence',raws.findingEvidence,raw=>loadFindingEvidence(raw,namespace,guardedCrypto));
  const queues=projectId?await optional('queue',raws.queue,raw=>loadProjectQueues(raw,namespace,guardedCrypto)):null;if(!projectId)statuses.queue='missing';
  const multi=await optional('evidence',raws.evidence,raw=>loadMulti(raw,{namespace},guardedCrypto));
  const legacy=await optional('legacyEvidence',raws.legacyEvidence,raw=>loadEvidenceMap(raw,{namespace},guardedCrypto));
  const sourceById=new Map();
  for(const p of selected){const snapshotSha256=await sha256(JSON.stringify(p),guardedCrypto),documentSha256=typeof p.document?.text==='string'?await sha256(p.document.text,guardedCrypto):null;sourceById.set(p.id,{namespace,paperId:p.id,title:p.title,documentSha256,snapshotSha256,declaredDocumentSha256:p.document?.sha256??null,documentStatus:documentSha256===null?'missing':documentSha256!==p.document?.sha256?'inconsistent':'same'})}
  const findingRows=journal?(await createManualFindingsView({state:journal,papers:selected,projectId,paperIds:[...memberIds]},guardedCrypto)).rows.filter(r=>memberIds.has(r.paperId)&&r.projectId===projectId):[];stable();
  const annotationRows=multi?multiView(multi):[],legacyRows=legacy?evidenceMapView(legacy):[];
  const visibleInstances=instances?.instances.filter(i=>projectId&&i.projectId===projectId&&memberIds.has(i.sourcePaperId)&&sourceById.has(i.sourcePaperId))??[];
  const excludedUnlinkedInstances=instances?instances.instances.filter(i=>projectId&&i.projectId===projectId&&(!memberIds.has(i.sourcePaperId)||!sourceById.has(i.sourcePaperId))).length:null;
  const queue=queues?latestProjectQueue(queues,projectId):null,rows=[],paperDetails=new Map(),paperViews=new Map();
  for(const p of selected){
   const startIssue=issues.length,source=sourceById.get(p.id),workflows=[],rowSources={...statuses},customRaw=customRaws.get(p.id);
   const basic=await optional('basic',true,()=>projectBasicProgress(p,guardedCrypto),p.id);rowSources.basic=basic?'available':'unavailable';if(basic)workflows.push(basic);
   const custom=await optional('sharedWorkflow',customRaw,async raw=>{await importWorkflow(raw,guardedCrypto);const env=JSON.parse(raw);if(env.state.source?.namespace!==namespace||env.state.source.paperId!==p.id)throw Error();const prior=observed.get(namespace+':custom-workflow-v1:'+p.id)?.find(c=>c.name==='identity');if(prior&&prior.head!==env.state.id&&p.documentAttachment?.oldWorkflowRaw){const match=await validateSourceRebaseWorkflow(env.state,p,{namespace,crypto:guardedCrypto,allowSnapshotDrift:true});if(match.oldWorkflowId!==prior.head||match.newWorkflowId!==env.state.id)throw Error('PROGRESS_SOURCE_LINEAGE_CHANGED');env.sourceTransitionPrior=JSON.parse(p.documentAttachment.oldWorkflowRaw).state;}return env},p.id);
   rowSources.sharedWorkflow=custom?'available':customRaw===null&&!observed.has(namespace+':custom-workflow-v1:'+p.id)?'missing':'unavailable';
   if(custom){const origin=custom.state.source;workflows.push(projectWorkflowProgress({workflow:custom.state,id:custom.state.id,kind:'shared-workflow',workflowSha256:custom.sha256,sourceStatus:progressSourceStatus(source,{title:origin.paperTitle,documentSha256:origin.documentSha256,snapshotSha256:origin.sourceArchiveSha256})}))}
   const paperInstances=visibleInstances.filter(i=>i.sourcePaperId===p.id);
   for(const i of paperInstances){const env=JSON.parse(i.versions.at(-1)),origin=env.state.source;workflows.push({...projectWorkflowProgress({workflow:env.state,id:i.id,kind:'instance',workflowSha256:env.sha256,sourceStatus:progressSourceStatus(source,{title:origin.paperTitle,documentSha256:origin.documentSha256,snapshotSha256:i.sourceSha256})}),projectRevisionStatus:i.projectRevisionSha256===scope.project.revisions.at(-1).sha256?'same':'changed'})}
   const findings=findingRows.filter(r=>r.paperId===p.id).map(r=>({...r,conclusion:r.conclusion.slice(0,PROGRESS_LIMITS.note),conclusionTruncated:r.conclusion.length>PROGRESS_LIMITS.note,evidenceKind:'manual-ai-unverified'}));
   const notes=[];
   for(const r of instanceReviews?.records??[]){const i=paperInstances.find(i=>i.id===r.binding.instanceId&&r.binding.projectId===projectId);if(!i)continue;const w=JSON.parse(i.versions.at(-1)).state,run=w.runs.find(run=>run.id===r.binding.runId),current=w.graphs.at(-1).sha256===r.binding.graphSha256&&!!run&&w.currentRuns[run.nodeId]===run.id;notes.push({id:r.id,kind:'instance-note',scope:'project',status:r.status,note:r.note.slice(0,PROGRESS_LIMITS.note),noteTruncated:r.note.length>PROGRESS_LIMITS.note,sourceStatus:workflows.find(w=>w.id===i.id).sourceStatus,current,evidenceKind:'human-note-on-synthetic-artifact',recordSha256:r.sha256,instanceId:i.id,nodeId:run?.nodeId??null,artifactSha256:r.binding.artifactSha256,time:r.createdAt})}
   for(const r of nodeReviews?.records??[]){if(r.source.paperId!==p.id)continue;const status=progressSourceStatus(source,r.source),returned=nodeReviews.records.some(other=>other.revisionOf===r.sha256);notes.push({id:r.id,kind:'node-handoff',scope:'shared-paper',status:r.status,note:(r.instruction||r.summary).slice(0,PROGRESS_LIMITS.note),noteTruncated:(r.instruction||r.summary).length>PROGRESS_LIMITS.note,sourceStatus:status,current:status==='same'&&!!custom&&r.workflowRaw===customRaw,returned,evidenceKind:'human-handoff-unverified',recordSha256:r.sha256,nodeId:r.reviewNodeId,time:r.time})}
   notes.sort((a,b)=>b.time.localeCompare(a.time));
   const referenceContext={workflowRaw:customRaw,reviewRaw:raws.nodeReviews,workflowAvailable:rowSources.sharedWorkflow==='available',reviewAvailable:statuses.nodeReviews==='available'},annotations=annotationRows.filter(r=>r.source.paperId===p.id).map(r=>progressAnnotation(r,source,referenceContext)),old=legacyRows.find(r=>r.paperId===p.id&&r.revisionId),position=queue?.entries.findIndex(e=>e.paperId===p.id)??-1,entry=position<0?null:queue.entries[position];
   rows.push({paperId:p.id,title:p.title,scope:projectId?'project':'shared-paper',plan:{status:statuses.queue==='unavailable'?'unavailable':entry?'planned':'not-planned',position:entry?position+1:null,sourceStatus:entry?(entry.paperSha256===source.snapshotSha256?'same':'changed'):null},workflows,findings:{status:statuses.findings,count:statuses.findings==='unavailable'?null:findings.length,changedCount:statuses.findings==='unavailable'?null:findings.filter(r=>r.sourceStatus!=='same').length,items:findings.slice(0,PROGRESS_LIMITS.findings),omitted:Math.max(0,findings.length-PROGRESS_LIMITS.findings)},reviews:{status:statuses.nodeReviews==='unavailable'||projectId&&statuses.instanceReviews==='unavailable'?'unavailable':statuses.nodeReviews==='missing'&&(!projectId||statuses.instanceReviews==='missing')?'missing':'available',count:statuses.nodeReviews==='unavailable'||projectId&&statuses.instanceReviews==='unavailable'?null:notes.length,changedCount:statuses.nodeReviews==='unavailable'||projectId&&statuses.instanceReviews==='unavailable'?null:notes.filter(r=>r.sourceStatus!=='same'||!r.current).length,items:notes.slice(0,PROGRESS_LIMITS.reviews),omitted:Math.max(0,notes.length-PROGRESS_LIMITS.reviews)},evidence:{scope:'shared-paper',evidenceKind:'manual-annotations-unverified',status:statuses.evidence,claimCount:statuses.evidence==='unavailable'?null:annotations.length,locatorCount:statuses.evidence==='unavailable'?null:annotations.reduce((n,r)=>n+r.locatorCount,0),staleClaims:statuses.evidence==='unavailable'?null:annotations.filter(r=>r.sourceStatus!=='same'||['changed','unavailable'].includes(r.fixedReferenceStatus)).length,items:annotations.slice(0,PROGRESS_LIMITS.annotations),omitted:Math.max(0,annotations.length-PROGRESS_LIMITS.annotations),legacy:{status:statuses.legacyEvidence,present:statuses.legacyEvidence==='unavailable'?null:!!old,sourceStatus:old?progressSourceStatus(source,old.source):null,revisionSha256:old?.revisionSha256??null,fixedReferenceStatus:old?progressAnnotation(old,source,referenceContext).fixedReferenceStatus:'none',locatorCount:statuses.legacyEvidence==='unavailable'?null:old?Object.values(old.fields).reduce((n,v)=>n+v.evidence.length,0):0}},sources:rowSources,issues:[...issues.filter(i=>!i.paperId),...issues.slice(startIssue).filter(i=>i.paperId===p.id)]});
   // Full saved results reuse exactly the validated captured sources above, not
   // clipped dashboard rows, fresh storage reads, local drafts or model replies.
   const fullFindings=findingRows.filter(r=>r.paperId===p.id).map(r=>({...r,conclusionTruncated:false,evidenceKind:'manual-ai-unverified'}));
   const fullNotes=notes.map(n=>{
    const r=(n.kind==='instance-note'?instanceReviews?.records:nodeReviews?.records)?.find(r=>r.id===n.id);
    if(!r)throw Error('PROGRESS_REVIEW_SOURCE_CHANGED');
    return {...n,note:n.kind==='instance-note'?r.note:(r.instruction||r.summary),noteTruncated:false,summary:r.summary??null,instruction:r.instruction??null,excerpt:r.excerpt??null,binding:r.binding??null,source:r.source??null,revisionOf:r.revisionOf??null,workflowSha256:r.workflowSha256??r.binding?.workflowSha256??null,graphSha256:r.graphSha256??r.binding?.graphSha256??null,graphVersion:r.graphVersion??r.binding?.graphVersion??null,projectRevisionStatus:n.kind==='instance-note'?workflows.find(w=>w.id===n.instanceId)?.projectRevisionStatus??null:null,evidenceReferences:(r.evidence??[]).map(({nodeId,kind,runId,sourceLabel})=>({nodeId,kind,runId,sourceLabel}))};
   });
   const documentSourceHistory=await createDocumentSourceResults({paper:p,namespace},guardedCrypto);stable();
   const approvalDecisions=await createApprovalResults({state:approvals?.state??null,status:statuses.approvalDecisions,namespace,projectId,paperId:p.id,source,workflow:custom?.state??null,workflowStatus:rowSources.sharedWorkflow,projectMembershipStatus:projectId&&memberIds.has(p.id)?'same':'unavailable'},guardedCrypto);stable();
   paperDetails.set(p.id,createPaperResultsDetail({namespace,projectId,paper:p,row:rows.at(-1),source,persistence,documentSourceHistory,findings:fullFindings,claims:annotationRows.filter(r=>r.source.paperId===p.id),legacy:old??null,notes:fullNotes,referenceContext,findingEvidence:createFindingEvidenceProjection({state:findingEvidence,status:statuses.findingEvidence,namespace,projectId,paperId:p.id,findings:journal?.records??null,currentPaper:p,source}),terminalReviews:createTerminalResults({state:terminal?.state??null,status:statuses.terminalDecisions,namespace,projectId,paperId:p.id,source,workflow:custom?.state??null}),approvals:approvalDecisions,copies:createCopyResults({state:copies?.state??null,status:statuses.copyLedger,projectId,paperId:p.id})}));
  }
  // Search complete saved conclusions, not clipped dashboard excerpts or unsaved drafts.
  const searchIndex=rows.map(row=>({paperId:row.paperId,title:row.title.normalize('NFC').toLowerCase(),conclusions:findingRows.filter(f=>f.paperId===row.paperId).map(f=>f.conclusion.normalize('NFC').toLowerCase())}));
  function searchSaved(query){
   stable();if(typeof query!=='string'||query.length>200)throw Error('PROGRESS_SEARCH_INVALID');
   const terms=query.normalize('NFC').toLowerCase().trim().split(/\s+/u).filter(Boolean);if(terms.length>32)throw Error('PROGRESS_SEARCH_LIMIT');
   const matches=searchIndex.flatMap(row=>{
    const titleMatch=terms.every(t=>row.title.includes(t));
    const matched=row.conclusions.filter(text=>terms.every(t=>text.includes(t)));
    return titleMatch||matched.length?[{paperId:row.paperId,titleMatch,conclusionMatches:terms.length?matched.length:0}]:[];
   });stable();return freezeProgress({matches,scope:'current-project-saved-conclusions-and-title',findingsAvailable:statuses.findings!=='unavailable',authority:'none'});
  }
  let questionIssued=null;
  function questionCatalog(){stable();if(!projectId||statuses.findings==='unavailable')throw Error('QUESTION_FINDINGS_UNAVAILABLE');return freezeProgress(findingRows.map(r=>({...r})));}
  function prepareQuestion(input){
   stable();questionIssued=null;
   if(!input||Object.keys(input).sort().join(',')!=='question,selections'||typeof input.question!=='string'||!input.question.trim()||input.question.length>2000||!Array.isArray(input.selections)||!input.selections.length||input.selections.length>20||!projectId||statuses.findings==='unavailable')throw Error('QUESTION_SELECTION_INVALID');
   const seen=new Set(),items=input.selections.map(q=>{
    if(!q||Object.keys(q).sort().join(',')!=='findingId,paperId,recordSha256,relation'||!['unclassified','supports','challenges','context'].includes(q.relation))throw Error('QUESTION_SELECTION_INVALID');
    const r=findingRows.find(r=>r.id===q.findingId&&r.paperId===q.paperId&&r.recordSha256===q.recordSha256);
    const key=JSON.stringify([q.paperId,q.findingId]);if(!r||seen.has(key)||!paperDetails.has(q.paperId))throw Error('QUESTION_OUT_OF_SCOPE');seen.add(key);
    const e=paperDetails.get(q.paperId).findingEvidence;
    const linked=e.items.filter(x=>x.scope.namespace===namespace&&x.scope.projectId===projectId&&x.scope.paperId===q.paperId&&x.scope.findingId===r.id&&x.scope.findingSha256===r.recordSha256);
    return {manualRelation:q.relation,relationVerified:false,finding:r,evidence:{...e,items:linked,count:e.status==='available'?linked.length:null,activeCount:e.status==='available'?linked.filter(x=>x.isHead&&x.status==='active').length:null}};
   });
   const report={schema:'prism-research-question-review/v1',namespace,projectId,question:input.question,items,authority:'none',scientificallyVerified:false,relations:'用户临时分类，不是系统推断；supports/challenges分别指用户认为与所填问题一致/可能矛盾，不证明关系。',coverage:'仅所选已保存结论与精确关联逐字引用账本，含撤回/旧版本及来源状态；不包含原AI答复、全文、其他项目或未保存草稿。',persistence:'本次问题与分类未保存到项目，需下载自行保留；导出不是备份恢复或批准。'};
   const raw=JSON.stringify(report,null,2);if(new TextEncoder().encode(raw).length>1000000)throw Error('QUESTION_REPORT_LIMIT');stable();
   const preview=freezeProgress({report:JSON.parse(raw),raw});questionIssued=preview;return preview;
  }
  function exportQuestion(preview,{explicit=false}={}){stable();if(explicit!==true||preview!==questionIssued)throw Error('QUESTION_REVIEW_REQUIRED');questionIssued=null;return preview.raw;}
  let reopenedQuestion=null;
  function inspectQuestion(raw){
   stable();reopenedQuestion=null;
   if(typeof raw!=='string'||new TextEncoder().encode(raw).length>1000000)throw Error('QUESTION_IMPORT_LIMIT');
   const report=JSON.parse(raw);
   if(!report||report.schema!=='prism-research-question-review/v1'||report.namespace!==namespace||report.projectId!==projectId||!projectId||report.authority!=='none'||report.scientificallyVerified!==false||typeof report.question!=='string'||!report.question.trim()||report.question.length>2000||!Array.isArray(report.items)||!report.items.length||report.items.length>20)throw Error('QUESTION_IMPORT_SCOPE');
   const seen=new Set();const selections=report.items.map(i=>{
    const r=i?.finding;if(!r||typeof r.paperId!=='string'||typeof r.id!=='string'||typeof r.recordSha256!=='string'||i.relationVerified!==false||!['unclassified','supports','challenges','context'].includes(i.manualRelation))throw Error('QUESTION_IMPORT_INVALID');
    const k=JSON.stringify([r.paperId,r.id]);if(seen.has(k))throw Error('QUESTION_IMPORT_DUPLICATE');seen.add(k);
    return {paperId:r.paperId,findingId:r.id,recordSha256:r.recordSha256,relation:i.manualRelation};
   });
   const current=questionCatalog();const missing=selections.filter(s=>!current.some(r=>r.paperId===s.paperId&&r.id===s.findingId&&r.recordSha256===s.recordSha256));
   stable();reopenedQuestion=freezeProgress({raw,question:report.question,selections,restorable:missing.length===0,missing:missing.length,warning:'文件内容仅为外部历史快照，未验证真实性。恢复仅带入问题和人工分类；结论与证据重新读取当前项目，不导入旧来源或批准。'});return reopenedQuestion;
  }
  function restoreQuestion(imported,{explicit=false}={}){
   stable();if(explicit!==true||imported!==reopenedQuestion||!imported?.restorable)throw Error('QUESTION_RESTORE_REQUIRED');
   const fresh=prepareQuestion({question:imported.question,selections:imported.selections});reopenedQuestion=null;
   return freezeProgress({question:imported.question,selections:imported.selections,preview:fresh});
  }
  function openPaper(paperId){
   stable();if(typeof paperId!=='string'||!paperDetails.has(paperId))throw Error('PROGRESS_PAPER_OUT_OF_SCOPE');
   if(!paperViews.has(paperId)){const paper=selected.find(p=>p.id===paperId);paperViews.set(paperId,createPaperResultsView({detail:paperDetails.get(paperId),documentText:typeof paper.document?.text==='string'?paper.document.text:null,stable,checkCurrent,crypto:guardedCrypto}));}
   const view=paperViews.get(paperId);view.checkCurrent();return view;
  }
  const projectDetail=createProjectResultsDetail({namespace,projectId,project:scope?.project,members:scope?.members??[],rows:rows.map(row=>({...row,terminalReviewCount:paperDetails.get(row.paperId).terminalReviews.count,approvalCount:paperDetails.get(row.paperId).approvals.count,copyCount:paperDetails.get(row.paperId).copies.count,findingEvidenceCount:paperDetails.get(row.paperId).findingEvidence.count})),queues,instances,sources:statuses});let projectView=null;
  function openProject(){stable();if(!projectView)projectView=createProjectResultsView({detail:projectDetail,paperDetails,openPaper,stable,checkCurrent,crypto:guardedCrypto});projectView.checkCurrent();return projectView;}
  stable();for(const [key,value]of pendingObservations)observed.set(key,value);const anyWorkflowUnavailable=projectId&&statuses.instances==='unavailable'||rows.some(r=>r.sources.basic==='unavailable'||r.sources.sharedWorkflow==='unavailable');
  return freezeProgress({namespace,projectId,rows,issues,persistence,sources:statuses,summary:{papers:rows.length,plannedPapers:statuses.queue==='unavailable'?null:rows.filter(r=>r.plan.status==='planned').length,workflowCount:anyWorkflowUnavailable?null:rows.reduce((n,r)=>n+r.workflows.length,0),manualFindings:statuses.findings==='unavailable'?null:findingRows.length,syntheticArtifacts:anyWorkflowUnavailable?null:rows.reduce((n,r)=>n+r.workflows.reduce((n,w)=>n+w.syntheticArtifacts,0),0),evidenceClaims:statuses.evidence==='unavailable'?null:rows.reduce((n,r)=>n+r.evidence.claimCount,0),unavailableSources:issues.length,excludedUnlinkedInstances},authority:'none',realExecutionConnected:false,stable,checkCurrent,openPaper,openProject,searchSaved,questionCatalog,prepareQuestion,exportQuestion,inspectQuestion,restoreQuestion});
 }
 return Object.freeze({namespace,read,cancel(){generation++}});
}
