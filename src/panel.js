// Embedded inside the official lazy DSH client-module factory by build-client.mjs.
const PANEL='prism-local-workbench';
const PRISM_GUIDED_WORKSPACE = usesGuidedWorkspace();
const prismControlTypes = {
 textarea: prismUi.Textarea, select: prismUi.NativeSelect, label: prismUi.Label,
 details: prismUi.AccordionItem, summary: prismUi.AccordionTrigger,
};
function h(type, props, ...children) {
 if (!PRISM_GUIDED_WORKSPACE || typeof type !== 'string') return React.createElement(type, props, ...children);
 let component;
 if (type === 'button') {
  const primary = props?.className?.split(/\s+/).includes('prism-primary') || props?.style?.background === btn.background;
  component = prismUi.Button;
  props = { variant: primary ? 'default' : 'outline', ...props };
  if (props.style === btn || props.style === secondary) delete props.style;
 } else if (type === 'input' && !['file','checkbox','radio','hidden','range','color','date','datetime-local','time','month','week','image'].includes(props?.type)) {
  component = prismUi.Input;
 } else if (Object.hasOwn(prismControlTypes, type)) {
  component = prismControlTypes[type];
 }
 return React.createElement(component || type, props, ...children);
}
const labels={ready:'待执行',blocked:'等待上游',running:'模拟运行中',completed:'演示产物就绪',needs_revision:'需返修',passed:'模拟审核通过',cancelled:'已取消',interrupted:'已中断'};
const errors={NOT_SAVED:'还没有保存过档案',RESTORED_STATE_NOT_SAVED:'恢复状态尚未重新保存',INVALID_OR_UNAVAILABLE_STORAGE:'原有浏览器数据无法读取或校验，已阻止覆盖；请勿清除浏览器数据',STORAGE_CONFLICT:'另一页面已更改记录，请先导出当前内存记录，再刷新核对',STORAGE_WRITE_FAILED:'浏览器拒绝保存或配额已满',STORAGE_UNAVAILABLE:'浏览器存储不可用',STORAGE_RECOVERY_REQUIRED:'旧记录异常，已阻止操作与覆盖',CRYPTO_UNAVAILABLE:'当前环境缺少SHA-256，不能执行或接收',REVISION_CONFLICT:'状态已变化，请核对后重试',UPSTREAM_REQUIRED:'请先完成当前版本的上游步骤',REVIEW_REQUIRED:'请先完成当前版本的模拟审核',HASH_MISMATCH:'证据哈希不一致，已拒绝接收'};
Object.assign(errors,{DUPLICATE_DOI:'此DOI已建档，未覆盖原记录',INVALID_QUERY:'请输入不超过300字符的检索词',TIMEOUT:'Crossref检索超时，未自动重试；请稍后手动重试',NETWORK_ERROR:'无法访问Crossref（网络或浏览器跨域限制），未伪造结果',HTTP_ERROR:'Crossref服务暂时返回错误，未自动重试；请稍后手动重试',SEARCH_BUSY:'本页面已有检索尚未结束（可能正在取消或等待网络释放），未再发请求；请稍后手动重试',RATE_LIMITED:'Crossref检索冷却中，未再发请求',CROSSREF_RATE_LIMITED:'Crossref请求过于频繁（429），未自动重试',ABORTED:'检索已取消',RESPONSE_TOO_LARGE:'返回内容过大，已中止',INVALID_RESPONSE:'Crossref响应无法校验',DOCUMENT_VERIFICATION_FAILED:'正文完整性核验未完成，已阻止操作和导出；原始存储未覆盖',DOCUMENT_VERIFICATION_PENDING:'正在重新核验已保存的论文正文，暂不能操作或导出',DOCUMENT_HASH_MISMATCH:'已保存的论文正文与哈希不一致，已阻止操作与导出；原始存储未覆盖',UNSUPPORTED_FILE:'这里接收 TXT 或 Markdown 正文。PDF 请用「提取 PDF 正文」；RIS 或 BibTeX 请用「导入书目」。',FILE_TOO_LARGE:'请选非空的正文文件，大小不超过 512 KiB。',FILE_SIZE_CHANGED:'文件大小已变化，请重新选择',INVALID_UTF8:'文件不是有效UTF-8，请先转换编码',INVALID_TEXT_FILE:'文件为空、过长或含二进制/控制字符，已拒绝',DUPLICATE_DOCUMENT:'相同文本已存在，未重复建档',INVALID_DOCUMENT:'文档格式不符合本地导入限制'});
Object.assign(errors,{STORAGE_WRITE_NOT_SAVED:'存储回读与本次档案不一致；新增内容仍在内存，请先导出',STORAGE_OUTCOME_UNKNOWN:'存储写入结果不确定，已阻止后续写入；请先导出内存档案并人工核对，不自动重试',IMPORT_CONTEXT_CHANGED:'导入上下文已变化，未新建档案；请重新选择并核对',IMPORT_CANCELLED:'导入已取消',FILE_CHANGED:'所选文件已变化，请重新选择',HANDOFF_STALE:'交接预览已过期：该节点 Prompt 或版本已变化，请重新生成；未下载。',HANDOFF_NODE_MISSING:'交接节点不存在，请重新选择。'});
const explain=x=>x==='EDIT_CONTEXT_CHANGED'?'编辑稿仍绑定原论文/步骤版本，当前上下文已变化；未写入任何论文。请返回原上下文核对或放弃草稿。':x==='PROMPT_HISTORY_LIMIT'?'此步骤已保留 30 个历史 Prompt，未删除旧版本，也未保存此次修改。请先导出完整档案，再在新的论文或流程副本中继续；不要覆盖原档案。':errors[x]||x;
const palette={bg:'#f8f9fc',panel:'#fff',line:'#e4e8f0',text:'#171e2d',muted:'#545f73'};
const btn={background:'var(--prism-accent,#2854ce)',color:'#fff',border:'1px solid var(--prism-accent,#2854ce)',borderRadius:8,padding:'8px 12px',cursor:'pointer',font:'inherit'};
const secondary={...btn,background:'var(--prism-panel,#fff)',color:'var(--prism-ink,#171e2d)',borderColor:'var(--prism-control,#d9dfea)'};
const field={display:'block',width:'100%',boxSizing:'border-box',background:'var(--prism-panel,#fff)',border:'1px solid var(--prism-control,#d9dfea)',color:'var(--prism-ink,#171e2d)',borderRadius:8,padding:10,font:'inherit',margin:'7px 0'};
const box={background:palette.panel,border:'1px solid '+palette.line,borderRadius:14,padding:18,minWidth:0};
function Icon(){return h('span',{'aria-label':'PRISM'},'◈');}
function requestPlanningLeave(namespace,kind,nextPaperId){if(typeof document==='undefined'||typeof document.dispatchEvent!=='function')return true;try{const EventType=document.defaultView?.CustomEvent||globalThis.CustomEvent;if(typeof EventType!=='function')return false;return document.dispatchEvent(new EventType('prism-planning-leave',{cancelable:true,detail:{namespace,kind,nextPaperId}}));}catch{return false;}}
function usesGuidedWorkspace(){
 const {location,__PRISM_LOCAL_PROFILE__:profile}=globalThis.window??{};
 return PRISM_DEVELOPMENT_PREVIEW||location?.protocol==='dsh-app:'
  ||(profile?.required===true&&typeof profile.storageNamespace==='string'
   &&Boolean(workbenchModelNamespace('prism-native-profile-v1:'+profile.storageNamespace)));
}
function Panel({store,sessionController,syntheticController,dedicatedController,providerReviewController,httpFixtureController,hostWorkbench,isOriginal=true,readingDraftMemory}){
 const snapshot=React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const guided=PRISM_GUIDED_WORKSPACE;
 const stageRoot=React.useRef(null),moveFocus=React.useRef(false);
 const candidateNamespace=isOriginal?workbenchModelNamespace(store.getStorageKey()):null;
 const [modelStatus,setModelStatus]=React.useState('local');
 const [modelRefresh,setModelRefresh]=React.useState(0);
 React.useEffect(()=>{
  if(!candidateNamespace)return;
  const controller=new AbortController();
  setModelStatus('checking');
  readWorkbenchModelStatus(controller.signal).then(status=>{
   if(!controller.signal.aborted)setModelStatus(status);
  });
  return ()=>controller.abort();
 },[candidateNamespace,modelRefresh]);
 const accountModel=candidateNamespace&&(modelStatus==='ready'||modelStatus==='signed-out');
 const [preparationTarget,setPreparationTarget]=React.useState(null);
 const [instanceTarget,setInstanceTarget]=React.useState(null);
 const [area,setArea]=React.useState(guided?'library':'planning'),[context,setContext]=React.useState(null),[nodeJump,setNodeJump]=React.useState(null),[projectContext,setProjectContext]=React.useState(null);const [selected,rawSetSelected]=React.useState(null),[tab,setTab]=React.useState('workflow'),[message,setMessage]=React.useState(''),[title,setTitle]=React.useState(''),[source,setSource]=React.useState(''),[editBinding,setEditBinding]=React.useState(null),[editing,setEditing]=React.useState(null),[draft,setDraft]=React.useState(''),[pending,setPending]=React.useState(false);
 const [stagedPaperId,setStagedPaperId]=React.useState(null);
 const [intakeTool,setIntakeTool]=React.useState('text');
 const [resultTool,setResultTool]=React.useState('saved');
 const [bibliographyFormat,setBibliographyFormat]=React.useState('ris');
 const [planReady,setPlanReady]=React.useState(false);
 const [oversizeBackup,setOversizeBackup]=React.useState(null);
 const [intake,setIntake]=React.useState(null),[intakeOutcome,setIntakeOutcome]=React.useState(null);
 const intakeEpoch=React.useRef(0),intakeFlight=React.useRef(null),intakeMounted=React.useRef(true),intakeContext=React.useRef(null),intakeChoice=React.useRef(0);
 const intakeHeading=React.useRef(null);
 React.useLayoutEffect(()=>{if(guided&&intake)intakeHeading.current?.focus()},[guided,intake]);
 function navigateStage(next,focus=true){
  if(next===area)return true;
  if(guided&&area==='library'&&(intake||intakeFlight.current)){
   setMessage('请先确认或取消当前文件导入。');
   return false;
  }
  setMessage('');
  moveFocus.current=focus;
  setArea(next);
  return true;
 }
 function viewSavedResults(){
  if(navigateStage('results'))setResultTool('saved');
 }
 React.useLayoutEffect(()=>{
  if(!guided||!moveFocus.current)return;
  moveFocus.current=false;
  const root=stageRoot.current;
  if(!root)return;
  const shell=root.closest('.prism-shell');
  if(shell)shell.scrollTop=0;
  const panel=root.querySelector('#workspace-zone-'+area);
  (panel?.querySelector('#prism-reader-title')||panel?.querySelector('[data-prism-stage-heading]')||panel)?.focus();
 },[area,guided]);

 const [searchTerm,setSearchTerm]=React.useState(''),[manual,setManual]=React.useState(true),[maxAdd,setMaxAdd]=React.useState(3),[searching,setSearching]=React.useState(false),[candidates,setCandidates]=React.useState([]),[importedDois,setImportedDois]=React.useState([]);
 const searchRef=React.useRef(null);
 const [candidateQuery,setCandidateQuery]=React.useState(null),[memoryDois,setMemoryDois]=React.useState([]);
 React.useEffect(()=>{if(snapshot.persistence.saved)setMemoryDois([])},[snapshot.persistence.saved,snapshot.revision]);
 const [searchCooldownUntil,setSearchCooldownUntil]=React.useState(0),[searchClock,setSearchClock]=React.useState(()=>Date.now());
 const searchCooldownSeconds=Math.max(0,Math.ceil((searchCooldownUntil-searchClock)/1000));
 React.useEffect(()=>{const now=Date.now();if(searchCooldownUntil<=now){if(searchClock<searchCooldownUntil)setSearchClock(now);return}const timer=setTimeout(()=>setSearchClock(Date.now()),Math.min(1000,searchCooldownUntil-now));return()=>clearTimeout(timer)},[searchCooldownUntil,searchClock]);
 const [findingsProjectReady,setFindingsProjectReady]=React.useState(false);
 const [projectScope,setProjectScope]=React.useState({projectId:null,paperIds:[],ready:true});
 const projectScopeProvider=React.useCallback(async()=>{if(!projectContext?.id)throw Error('PROJECT_MISSING');const c=createProjectLibraryController({store,storage:globalThis.localStorage});await c.initialize();return c.snapshot(projectContext.id)},[store,projectContext?.id,projectScope.raw]);
 const queueNavigationGuard=React.useRef(null),[queueNavigationRevision,setQueueNavigationRevision]=React.useState(0);
 const receiveQueueNavigationGuard=React.useCallback(guard=>{queueNavigationGuard.current=guard;setQueueNavigationRevision(n=>n+1)},[]);
 const checkQueueNavigation=React.useCallback(()=>{if(typeof queueNavigationGuard.current!=='function')throw Error('QUEUE_NAVIGATION_NOT_READY');return queueNavigationGuard.current()},[]);
 const [membershipRefresh,setMembershipRefresh]=React.useState(0);
 const [legacyOwned,setLibraryOwned]=React.useState(false),[libraryRefresh,setLibraryRefresh]=React.useState(0),libraryOwnership=React.useRef(false);
 const [projectExecutionOwned,setProjectExecutionOwned]=React.useState(()=>{try{const raw=globalThis.localStorage.getItem(store.getStorageKey()+':project-execution-owner-v1');return raw!==null&&JSON.parse(raw).body.phase!=='released'}catch{return true}});const [instanceOwned,setInstanceOwned]=React.useState(()=>{try{const raw=globalThis.localStorage.getItem(store.getStorageKey()+':research-instances-v1');return raw!==null&&(JSON.parse(raw).state.activeId!==null||!!JSON.parse(raw).state.queueState?.activeQueueId)}catch{return true}});const libraryOwned=legacyOwned||projectExecutionOwned||instanceOwned;
 React.useEffect(()=>{const onStorage=e=>{if(e.key&&e.key!==store.getStorageKey()+':project-execution-owner-v1')return;try{const raw=globalThis.localStorage.getItem(store.getStorageKey()+':project-execution-owner-v1');setProjectExecutionOwned(raw!==null&&JSON.parse(raw).body.phase!=='released')}catch{setProjectExecutionOwned(true)}};globalThis.addEventListener?.('storage',onStorage);return()=>globalThis.removeEventListener?.('storage',onStorage)},[store]);
 React.useEffect(()=>{const listener=e=>{if(e.key&&e.key!==store.getStorageKey()+':research-instances-v1')return;try{const raw=globalThis.localStorage.getItem(store.getStorageKey()+':research-instances-v1');setInstanceOwned(raw!==null&&(JSON.parse(raw).state.activeId!==null||!!JSON.parse(raw).state.queueState?.activeQueueId))}catch{setInstanceOwned(true)}};globalThis.addEventListener?.('storage',listener);return()=>globalThis.removeEventListener?.('storage',listener)},[store]);
 const handleLibraryOwnership=React.useCallback(value=>{if(libraryOwnership.current&&!value)setLibraryRefresh(x=>x+1);libraryOwnership.current=value;setLibraryOwned(value)},[]);
 const [handoff,setHandoff]=React.useState(null),[handoffBusy,setHandoffBusy]=React.useState(false);
 let handoffStale=false;try{if(handoff)assertCurrentHandoff(snapshot,handoff)}catch{handoffStale=true}
 React.useEffect(()=>()=>searchRef.current?.abort(),[]);
 const scopeReady=!projectContext?.id||(projectScope.ready&&projectScope.projectId===projectContext.id);
 const scopedPapers=React.useMemo(()=>projectContext?.id?(scopeReady?snapshot.papers.filter(p=>projectScope.paperIds.includes(p.id)):[]):snapshot.papers,[snapshot.papers,projectContext?.id,projectScope,scopeReady]);
 const paper=selected?scopedPapers.find(p=>p.id===selected):scopedPapers[0];
 const lastVerifiedPaper=React.useRef(null);if(scopeReady&&paper)lastVerifiedPaper.current={projectId:projectContext?.id||null,paperId:paper.id};
 const planningPaper=paper||(lastVerifiedPaper.current?.projectId===(projectContext?.id||null)?snapshot.papers.find(p=>p.id===lastVerifiedPaper.current.paperId):null);
 function acceptProjectScope(value){
  const prior=lastVerifiedPaper.current;
  if(value.ready){
   if(stagedPaperId&&value.paperIds.includes(stagedPaperId)){rawSetSelected(stagedPaperId);setStagedPaperId(null)}
   else if(value.projectId===prior?.projectId)rawSetSelected(prior.paperId);
   else rawSetSelected(null);
  }
  setProjectScope(value);
 }
 function selectImportedPaper(){
  const newest=store.getSnapshot().papers.at(-1);
  if(newest)selectIntakePaper(newest.id);
 }
 function selectIntakePaper(id){
  if(guided&&(!projectContext?.id||!projectScope.paperIds.includes(id))){
   setStagedPaperId(id);
   if(projectContext?.id)return;
  }
  setSelected(id);
 }
 const applicationNav=React.useRef(null);const navKey=JSON.stringify([projectContext?.id,projectScope.raw,scopeReady,paper?.id,area,snapshot.revision]);if(applicationNav.current?.key!==navKey)applicationNav.current={key:navKey};
 async function navigateInstance(target){
  const token=applicationNav.current,t=target?.instanceTarget;
  if(!t||t.namespace!==store.getStorageKey()||t.projectId!==projectContext?.id||!scopeReady||!scopedPapers.some(p=>p.id===t.paperId))return false;
   try{target.stable();const ctl=createResearchInstancesController({store,storage:localStorage});await ctl.initialize();const fresh=await ctl.verifyNavigation(t,()=>applicationNav.current===token);target.stable();fresh.verify();if(setSelected(t.paperId,()=>{target.stable();fresh.verify()})===false)return false;setInstanceTarget(Object.freeze({...t}));setArea(guided?'execution':'library');return true}catch{setMessage('实例来源或版本已变化，未定位，也未回退到共享流程；请刷新成果后重试。');return false}
 }
 async function navigateApplication(target){const token=applicationNav.current;if(!target||!['planning','library','execution','results'].includes(target.area)||target.projectId!==projectContext?.id||!scopeReady||!scopedPapers.some(p=>p.id===target.paperId)){setMessage('目标尚未进入当前已核验项目范围，请完成明确关联并等待范围核验；未切换论文。');return false}try{target.stable?.();const c=createProjectLibraryController({store,storage:globalThis.localStorage});await c.initialize();const s=await c.snapshot(target.projectId);s.stable();target.stable?.();if(applicationNav.current!==token||!s.paperIds.includes(target.paperId))return false;if(setSelected(target.paperId)===false)return false;setArea(target.area);setLibraryRefresh(n=>n+1);return true}catch(e){setMessage('无法核验目标项目关联，未导航：'+e.message);return false}}
 function setSelected(id,beforeCommit){if(!id||!store.getSnapshot().papers.some(p=>p.id===id)||(projectContext?.id&&(!scopeReady||!projectScope.paperIds.includes(id))))return false;if(id!==paper?.id&&!requestPlanningLeave(store.getStorageKey(),'paper',id))return false;if(beforeCommit)beforeCommit();rawSetSelected(id);return true;}
 const editContextValid=editing!==null&&editBinding&&editBinding.namespace===store.getStorageKey()&&editBinding.projectId===(projectContext?.id||null)&&editBinding.paperId===paper?.id&&editBinding.stepIndex===editing&&editBinding.promptVersion===paper?.steps[editing]?.promptVersion&&editBinding.prompt===paper?.steps[editing]?.prompt;
 function prepareNode(target){
  try{if(!scopeReady||target.paperId!==paper?.id)throw Error('scope');store.assertCurrentStorage();
   const raw=localStorage.getItem(store.getStorageKey()+':custom-workflow-v1:'+paper.id),w=JSON.parse(raw).state,g=w.graphs.find(g=>g.version===w.currentVersion);
   if(g?.sha256!==target.graphSha256||g.version!==target.graphVersion||!g.nodes.some(n=>n.id===target.nodeId))throw Error('stale');
   setPreparationTarget({namespace:store.getStorageKey(),projectId:projectContext?.id||'',paperId:paper.id,nodeId:target.nodeId,graphSha256:g.sha256,workflowRaw:raw});setArea('execution');
  }catch{setMessage('节点来源已变化，未选择人工准备来源；请等待当前图核验。')}
 }
 function jumpToNode(target){
  try{if(!scopeReady||!scopedPapers.some(p=>p.id===target.paperId))return false;
   store.assertCurrentStorage();const raw=localStorage.getItem(store.getStorageKey()+':custom-workflow-v1:'+target.paperId),w=JSON.parse(raw).state,g=w.graphs.find(g=>g.version===w.currentVersion);
   if(!g||g.sha256!==target.graphSha256||g.version!==target.graphVersion||!g.nodes.some(n=>n.id===target.nodeId))throw Error('NODE_NAVIGATION_STALE');
   const p=store.getSnapshot().papers.find(p=>p.id===target.paperId);if(!p||!setSelected(p.id))return false;
   setNodeJump({namespace:store.getStorageKey(),projectId:projectContext?.id||'',paperId:p.id,nodeId:target.nodeId,focusPrompt:target.focusPrompt===true,graphSha256:g.sha256,workflowRaw:raw,paperRaw:JSON.stringify(p)});setArea('planning');return true;
  }catch{setMessage('节点来源已经变化或不可核验，未定位；请刷新当前进展后重试。');return false}
 }
 React.useEffect(()=>{if(nodeJump&&(area!=='planning'||nodeJump.projectId!==(projectContext?.id||'')||nodeJump.paperId!==paper?.id||!scopeReady))setNodeJump(null)},[area,projectContext?.id,paper?.id,scopeReady]);
 const verificationBlocked=['DOCUMENT_VERIFICATION_FAILED','DOCUMENT_VERIFICATION_PENDING','DOCUMENT_HASH_MISMATCH','CRYPTO_UNAVAILABLE','INVALID_DIGEST','INVALID_OR_UNAVAILABLE_STORAGE','STORAGE_CONFLICT'].includes(snapshot.persistence.error);
 const locked=libraryOwned||verificationBlocked||searching||pending||paper?.steps.some(s=>s.status==='running');
 const readerOpen=guided&&area==='library'&&intakeTool==='reader'&&scopeReady&&paper&&!verificationBlocked;
 const readingScope=readerOpen?{namespace:store.getStorageKey(),projectId:projectContext?.id||null,paperId:paper.id}:null;
 const readerKey=readingScope?readingEvidenceCore.readingKey(readingScope):null;
 function readCurrentReadingPapers(error='READING_SOURCE_CHANGED'){
  if(!scopeReady||verificationBlocked)throw Error(error);
  store.assertCurrentStorage();
  if(projectContext?.id&&localStorage.getItem(store.getStorageKey()+':project-library-v1')!==projectScope.raw){
   throw Error(error);
  }
  const papers=store.getSnapshot().papers;
  return projectContext?.id?papers.filter(item=>projectScope.paperIds.includes(item.id)):papers;
 }
 function verifyReadingSource(){
  return readCurrentReadingPapers().find(item=>item.id===readingScope.paperId)?.document;
 }
 React.useLayoutEffect(()=>{
  if(readerKey)stageRoot.current?.querySelector('#prism-reader-title')?.focus({preventScroll:true});
 },[readerKey]);
 async function act(type,extra={}){setPending(true);setMessage('');try{if(type==='editPrompt'){const latest=store.getSnapshot().papers.find(p=>p.id===editBinding?.paperId)?.steps[editBinding?.stepIndex];if(!editContextValid||extra.stepIndex!==editBinding.stepIndex||latest?.promptVersion!==editBinding.promptVersion||latest?.prompt!==editBinding.prompt)throw Error('EDIT_CONTEXT_CHANGED');}await store.dispatch({type,paperId:paper?.id,revision:store.getSnapshot().revision,...extra});if(type==='editPrompt')setEditing(null);if(type==='addPaper'||type==='importPaper'||type==='importCandidate'){setTitle('');setSource('');selectImportedPaper();}}catch(e){setMessage(explain(e.message)||'操作未完成');}finally{setPending(false)}}
 async function importCandidate(candidate){setPending(true);setMessage('');try{await store.dispatch({type:'importCandidate',candidate,revision:store.getSnapshot().revision});setImportedDois(v=>[...v,candidate.doi]);setSelected(store.getSnapshot().papers.at(-1).id);if(!store.getSnapshot().persistence.saved){setMemoryDois(v=>[...v,candidate.doi]);setMessage('此条仅在当前页面内存，尚未保存到浏览器；请备份，刷新可能丢失。未自动重试。')}else setMessage('此条已保存到浏览器。仅元数据建档，未读取全文或执行研究。')}catch(e){if(e.code==='DUPLICATE_DOI')setImportedDois(v=>[...v,candidate.doi]);setMessage(explain(e.code||e.message))}finally{setPending(false)}}
 async function discover(e){e.preventDefault();if(searching||verificationBlocked||Date.now()<searchCooldownUntil)return;const controller=new AbortController();searchRef.current=controller;setSearching(true);setMessage('');const requireManual=manual,count=maxAdd;let added=0,duplicates=0,memoryOnly=0,fetched=false;
  try{const result=await searchCrossref(searchTerm,{signal:controller.signal,limit:10});if(controller.signal.aborted)return;fetched=true;setCandidates(result.items);setImportedDois([]);setCandidateQuery(result.query);if(requireManual){setMessage('Crossref元数据候选已列出，请核对后逐条确认。未获取全文，也未执行研究。');return}
   for(const candidate of result.items){if(controller.signal.aborted||added>=count)break;try{await store.dispatch({type:'importCandidate',candidate,revision:store.getSnapshot().revision});setImportedDois(v=>[...v,candidate.doi]);if(!store.getSnapshot().persistence.saved){memoryOnly++;setMemoryDois(v=>[...v,candidate.doi]);throw Error('CANDIDATE_NOT_SAVED')}added++}catch(err){if(err.code==='DUPLICATE_DOI'){duplicates++;setImportedDois(v=>[...v,candidate.doi]);continue}throw err}}
   if(!controller.signal.aborted)setMessage('自动建档 '+added+' 篇；跳过重复 '+duplicates+' 篇。仅建立待研究档案，未调用模型或自动执行模拟。');
  }catch(err){if(!controller.signal.aborted){const ms=Number.isFinite(err.retryAfterMs)?Math.max(0,err.retryAfterMs):0;if(ms){const now=Date.now();setSearchClock(now);setSearchCooldownUntil(now+ms)}setMessage((err.message==='CANDIDATE_NOT_SAVED'?'本批已停止：有条目仅在当前页面内存，尚未保存到浏览器；请备份，刷新可能丢失。未自动重试。':explain(err.code||err.message))+(added||duplicates||memoryOnly?'；本次已保存 '+added+' 篇、仅内存 '+memoryOnly+' 篇、跳过重复 '+duplicates+' 篇，已完成部分保留，未回滚。':'')+(fetched?'；本次候选保留，可稍后处理。':'；未用失败请求替换当前候选。')+(ms?'。请等待约 '+Math.ceil(ms/1000)+' 秒后手动点击检索；不会后台自动请求。':''))}}finally{if(searchRef.current===controller){searchRef.current=null;setSearching(false)}}
 }
 // The text preview is bound to the scope in which it was selected. These are
 // defensive currentness guards; importing still targets only the shared base.
 intakeContext.current={store,namespace:store.getStorageKey(),revision:snapshot.revision,selectedPaperId:paper?.id||null,projectId:projectContext?.id||null,scope:projectScope.raw??null,area,disabled:verificationBlocked||libraryOwned};
 function cancelTextIntake(){intakeEpoch.current++;if(intakeFlight.current){intakeFlight.current=null;setPending(false)}setIntake(null)}
 React.useLayoutEffect(()=>{cancelTextIntake()},[store,snapshot.revision,paper?.id,projectContext?.id,projectScope.raw,area,verificationBlocked,libraryOwned]);
 React.useEffect(()=>{intakeMounted.current=true;return()=>{intakeMounted.current=false;intakeEpoch.current++;intakeFlight.current=null}},[store]);
 function textCurrent(p){const c=intakeContext.current,b=p.binding;return intakeMounted.current&&intakeEpoch.current===p.n&&c.store===b.store&&c.namespace===b.namespace&&store.getStorageKey()===b.namespace&&store.getSnapshot().revision===b.revision&&c.selectedPaperId===b.selectedPaperId&&c.projectId===b.projectId&&c.scope===b.scope&&c.area===b.area&&!c.disabled}
 async function chooseFile(e){const files=Array.from(e.target.files||[]);e.target.value='';if(intakeContext.current.disabled)return;cancelTextIntake();setIntakeOutcome(null);intakeChoice.current++;if(!files.length)return;if(files.length!==1){setMessage('请选择一份文本文件。');return}
  const token={binding:{...intakeContext.current},n:intakeEpoch.current,choice:intakeChoice.current};intakeFlight.current=token;setPending(true);setMessage('');
  try{const item=await readLocalPaper(files[0]);if(textCurrent(token))setIntake({...token,item})}catch(err){if(textCurrent(token))setMessage(explain(err.message))}finally{if(intakeFlight.current===token){intakeFlight.current=null;setPending(false)}}
 }
 async function confirmTextIntake(){const p=intake;if(!p||intakeFlight.current||!textCurrent(p))return;const token={...p};intakeFlight.current=token;setPending(true);setMessage('');
  try{const result=await store.dispatch({type:'importPaper',revision:p.binding.revision,...p.item,isCurrent:()=>textCurrent(p)});
   // Own commit changes the revision and may select the first paper. Preserve
   // its outcome even after that invalidation, without touching a newer choice.
   if(intakeMounted.current&&intakeContext.current.store===p.binding.store&&intakeChoice.current===p.choice){setIntakeOutcome({item:p.item,persistence:result.persistence});setIntake(null);if(guided)selectImportedPaper()}
  }catch(err){if(textCurrent(p))setMessage(explain(err.code||err.message))}finally{if(intakeFlight.current===token){intakeFlight.current=null;setPending(false)}}
 }
 async function prepareHandoff(stepIndex){setHandoffBusy(true);setHandoff(null);setMessage('');try{store.assertCurrentStorage();const prepared=await createHandoff(store.getSnapshot(),paper.id,stepIndex);store.assertCurrentStorage();assertCurrentHandoff(store.getSnapshot(),prepared);setHandoff(prepared)}catch(e){setMessage(explain(e.message))}finally{setHandoffBusy(false)}}
 function downloadHandoff(){try{store.assertCurrentStorage();assertCurrentHandoff(store.getSnapshot(),handoff);const blob=new Blob([handoffJSON(handoff)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PRISM-manual-handoff-'+handoff.payload.paperId+'-step'+handoff.payload.stepIndex+'-v'+handoff.payload.promptVersion+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setMessage(explain(e.message))}}
 function downloadRecords(raw){const blob=new Blob([raw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PRISM-native-demo-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function exportRecords(){try{const raw=store.exportJSON(),bytes=new TextEncoder().encode(raw).length;if(bytes>4000000){setOversizeBackup({raw,bytes,namespace:store.getStorageKey()});return}setOversizeBackup(null);downloadRecords(raw)}catch(e){setMessage(explain(e.code||e.message))}}
 function downloadOversize(){try{if(!oversizeBackup||oversizeBackup.namespace!==store.getStorageKey()||store.exportJSON()!==oversizeBackup.raw){setOversizeBackup(null);throw Error('档案已变化，请重新预览下载大小。')}downloadRecords(oversizeBackup.raw);setOversizeBackup(null)}catch(e){setMessage(explain(e.code||e.message))}}

 const actionButton=(text,fn,disabled=false,primary=false)=>h('button',{type:'button',onClick:fn,disabled:disabled||verificationBlocked,style:{...(primary?btn:secondary),opacity:disabled?.45:1,cursor:disabled?'not-allowed':'pointer'}},text);
 const importedText=intakeOutcome?.item.document;
 const importSaved=intakeOutcome?.persistence.saved;
 const importMessage=importSaved?'正文已保存到此浏览器的论文库。':
  intakeOutcome?.persistence.error==='STORAGE_OUTCOME_UNKNOWN'?'本次存储结果不确定，不能确认已保存。文本仍保留在本页内存；请先导出并人工核对，不要重复导入。':
  '本次文本档案仅保留在本页内存，尚未保存到浏览器；刷新或关闭可能丢失，请先导出。';
 const textIntakeOutcome=importedText?h('section',{'data-testid':'text-import-outcome',className:guided?'prism-import-feedback':undefined,style:guided?undefined:box},
  !guided?h('h3',null,'正文导入结果'):null,
  h('div',{className:guided?'prism-import-receipt':undefined},
   guided?h(prismUi.FileText,{size:16,'aria-hidden':true}):null,
   h('p',{role:'status'},importMessage),
   h('strong',null,importedText.filename)),
  !guided||!importSaved?h('button',{type:'button',style:secondary,onClick:exportRecords},'下载当前基础档案'):null,
  guidedDisclosure('查看本次导入文本',h(React.Fragment,null,
   h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflow:'auto'}},importedText.text),
   h('p',null,'若要在当前项目使用，请另行加入项目。下载的基础档案包含正文。完整项目和未提交的表单需另行备份。'),
   guided&&importSaved?h('button',{type:'button',style:secondary,onClick:exportRecords},'下载当前基础档案'):null))):null;
 const status=s=>h('span',{style:{fontSize:12,padding:'3px 8px',border:'1px solid #5d5d5d',borderRadius:20,color:s==='needs_revision'?'#f1c98e':'#ddd'}},labels[s]||s);
 const notice=(text,color='#545f73')=>guided?h(prismUi.Alert,{className:'prism-notice',role:undefined,variant:color==='#545f73'?'default':'destructive'},h(prismUi.AlertDescription,null,text)):h('div',{style:{padding:'12px 16px',border:'1px solid #414141',borderRadius:10,color,marginBottom:14}},text);
 const toolEntry=(label,content)=>guided&&content?guidedDisclosure(label,content):content;
 const resultTools=[['saved','已保存结果'],['reading','摘录对照'],...(projectContext?.id?[['argument','研究论证']]:[]),
  ['comparison','对照表'],['matrix','项目矩阵'],['progress','研究进度']];
 const activeResult=resultTools.some(([id])=>id===resultTool)?resultTool:'saved';
 const canReadPaper=!!paper&&!intake&&!pending&&scopeReady&&!verificationBlocked;
 const canPlanPaper=!!paper&&(!projectContext?.id||!stagedPaperId)&&!intake;
 function openCurrentReader(){
  if(canReadPaper&&navigateStage('library',false))setIntakeTool('reader');
 }
 function openBaseArchive(){
  const box=stageRoot.current?.closest('.prism-shell')?.querySelector('[data-testid=workspace-profile-restore]');
  if(!box)return;
  box.open=true;
  requestAnimationFrame(()=>box.querySelector('summary')?.focus());
 }
 function openWorkspaceShortcut(destination){
  if(destination==='reader'&&!canReadPaper||destination==='argument'&&!projectContext?.id)return false;
  const next=['library','search','reader'].includes(destination)?'library':
   ['planning','execution'].includes(destination)?destination:'results';
  if(!navigateStage(next,false))return false;
  if(next==='library')setIntakeTool(destination==='reader'?'reader':'text');
  if(next==='results')setResultTool(destination);
  requestAnimationFrame(()=>{
   const panel=stageRoot.current?.querySelector('#workspace-zone-'+next);
   const search=destination==='search'?panel?.querySelector('[data-testid=local-paper-query]'):null;
   const selector=destination==='reader'?'#prism-reader-title':'[data-prism-stage-heading]';
   const field=search||panel?.querySelector(selector)||panel;
   field?.focus();
  });
  return true;
 }
 function openPortableBackup(){
  const archive=stageRoot.current?.querySelector('[data-testid=workspace-archive]');
  const portable=archive?.querySelector('[data-testid=portable-project-backup-panel]')?.parentElement.closest('details');
  if(!portable)return;
  const tools=archive.parentElement.closest('details');
  if(tools)tools.open=true;
  archive.open=true;
  portable.open=true;
  requestAnimationFrame(()=>portable.querySelector('summary')?.focus());
 }
 const comparisonEntry=h(ComparisonPanel,{store,guided,disabled:verificationBlocked,
  active:area==='results'&&(!guided||activeResult==='comparison'),libraryRevision:snapshot.revision});
 const matrixEntry=h(ProjectMatrixPanel,{store,guided,projectId:projectContext?.id||'',disabled:verificationBlocked||!scopeReady});
 const progressEntry=h(ResearchProgressPanel,{store,guided,projectId:projectContext?.id||'',
  scopeReady:!verificationBlocked&&findingsProjectReady&&projectScope.ready&&projectScope.projectId===(projectContext?.id||null),
  scopeToken:projectScope.raw,active:area==='results'&&(!guided||activeResult==='progress'),selectedId:paper?.id,onNavigate:target=>{
   if(target.instanceTarget)return navigateInstance(target);
   if(target.nodeId)return jumpToNode(target);
   if(!['library','planning','execution'].includes(target.area)||!scopedPapers.some(p=>p.id===target.paperId))return false;
   if(target.paperId!==paper?.id){if(setSelected(target.paperId)===false)return false;setEditing(null);setHandoff(null)}
   return navigateStage(target.area);
  }});
 const projectLibrary=!verificationBlocked?h(ProjectLibraryPanel,{store,guided,stagedPaperId,projectId:projectContext?.id||'',
  externalRevision:projectContext?.id?JSON.stringify([membershipRefresh,snapshot.papers.map(p=>[p.id,p.title,p.document?.sha256??null])]):membershipRefresh,
  beforeConfirm:p=>{const id=paper?.id||planningPaper?.id;return !id||!p.diff?.removed?.some(x=>x.id===id)||requestPlanningLeave(store.getStorageKey(),'paper')},
  onScope:acceptProjectScope,disabled:verificationBlocked}):null;
 function chooseWorkspacePaper(id){
  if(id===paper?.id)return true;
  if(setSelected(id)===false)return false;
  setEditing(null);setHandoff(null);return true;
 }
 const paperLookup=h(LocalPaperLookupPanel,{guided,papers:scopedPapers,selectedId:paper?.id,scopeReady,onSelect:chooseWorkspacePaper});
 const workspace=h('div',{className:guided?'prism-column':undefined},
   !guided?h('header',{style:{marginBottom:12}},h('h1',{style:{fontWeight:500,fontSize:26,margin:'0 0 8px'}},'PRISM 工作台')):null,
  !guided&&accountModel?h('p',{style:{color:palette.muted}},'选择项目并关联论文，在「论文库 → 项目研究实例」保存工作节点的 Prompt 后，可用 DeepSeek 账号发送。'):null,
  ((!guided&&!accountModel)||!snapshot.persistence.saved&&snapshot.persistence.error!=='NOT_SAVED')?notice(snapshot.persistence.saved?'论文基础档案已写入此浏览器 localStorage，不是云端或 DSH 项目备份；内容以明文保存，同源页面脚本可读取，请勿存放密码、密钥或不宜长期保留的敏感材料。清理浏览器数据会丢失，请定期导出。':'论文基础档案尚未可靠保存（项目模板等模块独立存储）：'+(explain(snapshot.persistence.error)||'当前仅保存在内存中。')+(verificationBlocked?' 当前核验受阻，导出已禁用；不要清理浏览器数据。':' 请先导出，不要依赖刷新后的状态。'),snapshot.persistence.saved?'#545f73':'#8c4e0c'):null,
  !snapshot.persistence.saved&&['STORAGE_WRITE_FAILED','STORAGE_WRITE_NOT_SAVED','STORAGE_OUTCOME_UNKNOWN','STORAGE_UNAVAILABLE'].includes(snapshot.persistence.error)?h('aside',{'data-testid':'unsaved-memory-backup',role:'alert',style:{...box,borderColor:'#b89148',marginBottom:14}},h('strong',null,snapshot.persistence.error==='STORAGE_OUTCOME_UNKNOWN'?'保存结果不确定：本页内存档案仍可导出；不能确认浏览器中的版本。已阻止后续写入，不自动重试。':'保存失败：新增或修改的基础档案目前只在本页内存中，刷新或关闭可能丢失。'),h('p',null,'先主动下载当前基础档案，再确认文件已保存。下载为明文，包含论文正文、基础 Prompt 历史和基础记录；不包含独立项目模块、未提交表单或人工交接草稿，不是完整项目备份。'),actionButton('下载本页保留的基础档案',exportRecords),h('p',null,'文件符合恢复条件时，可在「基础档案备份与恢复」创建副本。若文件过大或浏览器空间不足，请保留下载文件，恢复前不要关闭本页。保存状态不明确时，常规备份可能不可用。')):null,
  oversizeBackup?h('section',{'data-testid':'oversize-backup',role:'alert',style:{...box,marginBottom:14}},h('strong',null,'此文件过大，只能下载留存'),h('p',{'data-testid':'backup-size'},'此留存文件超过 4 MB，无法直接创建恢复副本。可到「基础档案备份与恢复」尝试下载常规备份；能否恢复仍取决于档案大小和浏览器空间。'),h('p',null,'下载会保留完整内容。请保留文件和本页。可用文本工具查看原文，再逐篇录入；运行历史和独立项目需另外处理。'),guidedHelp('文件大小详情',h('p',null,'实际大小 ',oversizeBackup.bytes,' UTF-8 字节。此格式的恢复上限为 4,000,000 UTF-8 字节。')),actionButton('仅下载完整留存文件（不能一键恢复）',downloadOversize),actionButton('取消此次下载',()=>setOversizeBackup(null))):null,
  snapshot.persistence.restoredRequiresReaccept&&!paper?.accepted?notice('历史记录已保留。重新打开档案后，请核对当前演示结果并重新确认接收。','#f1c98e'):null,
  snapshot.persistence.restoredInterrupted?notice('检测到未完成的模拟运行，已标记中断；没有自动重发。','#f1c98e'):null,
  guided?h('div',{role:'status'},message?h('p',{style:{color:'#8c4e0c',padding:12,border:'1px solid #e5cda9',marginBottom:14}},message):null)
   :message?h('div',{role:'alert',style:{color:'#8c4e0c',padding:12,border:'1px solid #e5cda9',marginBottom:14}},message):null,

  editing!==null&&!editContextValid?h('aside',{'data-testid':'stale-prompt-draft',role:'status'},h('strong',null,'未保存草稿仍属于：'+(editBinding?.paperTitle||'原论文')+'，不是当前论文；不会自动改绑或保存。'),h('details',null,h('summary',null,'查看保留的原编辑稿'),h('pre',{'data-testid':'stale-prompt-text',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},draft)),h('button',{type:'button',onClick:()=>{setEditing(null);setEditBinding(null);setDraft('')}},'放弃这份未保存草稿')):null,
   h('div',{hidden:guided},h(WorkspaceContext,{store,paper,project:projectContext,modelStatus:candidateNamespace?modelStatus:'local',papers:scopedPapers,onContext:setContext,onSelect:id=>{if(!setSelected(id))return false;setEditing(null);setHandoff(null);return true}})),
   !guided?h('nav',{'aria-label':'研究工作台主导航',style:{display:'flex',flexWrap:'wrap',gap:8,margin:'16px 0'}},h('div',{role:'tablist','aria-label':'工作区域',style:{display:'flex',gap:8,flexWrap:'wrap'}},[['planning','项目规划'],['library','论文库'],['execution','执行工作台'],['results','研究成果'],['attention','待我处理']].map(([id,label],index,list)=>h('button',{key:id,id:'workspace-tab-'+id,role:'tab','aria-selected':area===id,'aria-controls':'workspace-zone-'+id,tabIndex:area===id?0:-1,type:'button',style:{...secondary,borderColor:area===id?'#eee':'#444',background:area===id?'#ededed':'#171717',color:area===id?'#080808':'#ededed'},onClick:()=>setArea(id),onKeyDown:e=>{let next;if(e.key==='ArrowRight')next=(index+1)%list.length;else if(e.key==='ArrowLeft')next=(index+list.length-1)%list.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=list.length-1;else return;e.preventDefault();setArea(list[next][0]);document.getElementById('workspace-tab-'+list[next][0])?.focus()}},label)))):null,
   !guided?h('p',{'data-testid':'navigation-boundary',style:{color:palette.muted}},'切换区域不会启动/停止研究任务，研究草稿保留；未确认的文件导入预览和在途导入会失效，需要重新选择。项目规划可独立于论文；单篇执行绑定所选论文。应用模板不会启动节点。'):null,
  h('section',{id:'workspace-zone-planning',role:'tabpanel',tabIndex:guided&&area==='planning'?-1:undefined,className:guided?'prism-stage':undefined,'aria-labelledby':'workspace-tab-planning',hidden:area!=='planning','data-testid':'workspace-planning'},
   guided?h('h2',{tabIndex:-1,className:'prism-stage-heading','data-prism-stage-heading':''},'编辑步骤'):null,
   !verificationBlocked?h(ProjectPlanningPanel,{store,hostWorkbench,guided,onProject:(value,ready)=>{setProjectContext(value);setFindingsProjectReady(ready)},onApplied:()=>{setLibraryRefresh(x=>x+1)},onMembershipChanged:()=>setMembershipRefresh(x=>x+1),onApplicationNavigate:navigateApplication,applicationScopeToken:JSON.stringify([area,paper?.id,projectScope.raw,scopeReady]),disabled:verificationBlocked||libraryOwned||snapshot.papers.some(p=>p.steps.some(s=>s.status==='running'))}):null,
   !guided?h('p',null,'项目模板应用后，各论文可独立调整步骤和 Prompt。'):null,
   guided&&projectContext?.id&&!paper?h('section',{className:'prism-card'},h('h3',null,'选择项目论文'),h('p',{className:'prism-muted'},'先将论文加入当前项目，再配置步骤。'),guidedButton('前往导入论文',()=>navigateStage('library'),{primary:true})):null,
   guidedDisclosure(guided?'共享论文流程与旧版配置':'当前论文的流程规划与覆盖调整',h(React.Fragment,null,libraryOwned?notice('跨论文队列已接管单篇自定义图；请在论文库队列区暂停/取消，避免并行编辑。'):null,planningPaper?h(React.Fragment,null,!scopeReady?h('p',{'data-testid':'planning-scope-pending',role:'status'},'项目范围待重新核验；此前论文的流程草稿仅保留查看，不能保存、运行或据此导航。未知或核验失败不会恢复权限。'):null,h(CustomWorkflowPanel,{key:planningPaper.id,store,paper:planningPaper,disabled:locked||!scopeReady||planningPaper.id!==paper?.id,active:area==='planning',sourceRefresh:libraryRefresh,navigationTarget:nodeJump,onNavigationDone:target=>setNodeJump(old=>old===target?null:old)})):notice('请先在论文库建立或选择论文档案。')),{open:guided?undefined:true})),
  h('section',{id:'workspace-zone-library',role:'tabpanel',tabIndex:guided&&area==='library'?-1:undefined,className:guided?'prism-stage':undefined,'aria-labelledby':'workspace-tab-library',hidden:area!=='library','data-testid':'workspace-library'},
   guided?h('div',{className:'prism-library-surface',hidden:!!readerOpen},
    h('div',{className:'prism-view-heading'},
     h('h2',{id:'prism-import-heading',tabIndex:-1,className:'prism-stage-heading','data-prism-stage-heading':''},'论文库')),
    h(GuidedLibrarySummary,{project:projectContext,papers:scopedPapers,ready:scopeReady,blocked:verificationBlocked}),
    h('section',{className:'prism-library-intake','aria-label':'导入资料'},
     h('div',{className:'prism-intake'},
      h('div',{className:'prism-actions','aria-label':'论文导入方式'},
       h('label',{className:'prism-button prism-file'+(intakeTool==='text'?' prism-primary':''),'data-disabled':verificationBlocked||pending||!!intake},
        '导入正文（TXT / Markdown）',h('input',{type:'file','aria-label':'导入正文（TXT / Markdown）',accept:'.txt,.md,text/plain,text/markdown',onChange:event=>{setIntakeTool('text');chooseFile(event)},disabled:verificationBlocked||pending||!!intake})),
       ...[['pdf','提取 PDF 正文'],['bibliography','导入书目'],['zotero','Zotero'],['search','在线检索']].map(([id,label])=>h('button',{key:id,type:'button','aria-pressed':intakeTool===id,'aria-controls':'prism-intake-'+id,onClick:()=>setIntakeTool(current=>current===id?'text':id)},label))),
      intakeTool==='text'&&!intake?h('small',{className:'prism-muted'},'选择 UTF-8 编码的 .txt 或 .md 正文文件，最大 512 KiB。'):null,
      intake?h('section',{className:'prism-form','aria-labelledby':'prism-import-preview'},
       h('h3',{ref:intakeHeading,id:'prism-import-preview',tabIndex:-1},'导入预览 · '+intake.item.document.filename),
       h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:180}},intake.item.document.text.slice(0,1500)),
       h('div',{className:'prism-actions'},guidedButton('确认导入',confirmTextIntake,{primary:true,disabled:pending}),guidedButton('取消预览',()=>{
        cancelTextIntake();
        requestAnimationFrame(()=>stageRoot.current?.querySelector('.prism-file input')?.focus());
       }))):null,
      intakeTool==='text'?textIntakeOutcome:null),
     h('div',{className:'prism-intake-body'},
      h('div',{id:'prism-intake-pdf',hidden:intakeTool!=='pdf'},h(PdfIntakePanel,{
       store,paper,guided:true,disabled:locked,
       scopeToken:JSON.stringify([area,projectContext?.id||null,projectScope.raw??null]),
       onExport:exportRecords,onImported:selectImportedPaper,
      })),
      h('section',{id:'prism-intake-bibliography',hidden:intakeTool!=='bibliography',className:'prism-card','aria-label':'导入书目'},
       h('h3',null,'文献目录'),
       h('p',null,'从 RIS 或 BibTeX 导入题名、作者等书目信息。正文和附件需单独导入。'),
       h('div',{className:'prism-actions','aria-label':'文献文件格式'},
        ...[['ris','RIS'],['bibtex','BibTeX']].map(([id,label])=>h('button',{key:id,type:'button','aria-pressed':bibliographyFormat===id,'aria-controls':'prism-bibliography-'+id,onClick:()=>setBibliographyFormat(id)},label))),
       ...['ris','bibtex'].map(format=>h('div',{key:format,id:'prism-bibliography-'+format,hidden:bibliographyFormat!==format,style:{marginTop:12}},
        h(RisImportPanel,{store,projectId:projectContext?.id||null,projectRevisionSha256:projectContext?.revisionSha256||null,disabled:verificationBlocked,format,guided:true})))),
      h('div',{id:'prism-intake-zotero',hidden:intakeTool!=='zotero'},
       h(ZoteroImportPanel,{store,disabled:verificationBlocked||libraryOwned,active:area==='library'&&intakeTool==='zotero',
        scopeToken:projectContext?.id??null,onOpenPaper:id=>{
         selectIntakePaper(id);
         setIntakeTool('text');
         requestAnimationFrame(()=>stageRoot.current?.querySelector('#prism-library-heading')?.focus());
        }})),
      h('div',{id:'prism-intake-search',hidden:intakeTool!=='search'},
       h(DiscoveryWorkspacePanel,{store,projectId:projectContext?.id||null,projectRevisionSha256:projectContext?.revisionSha256||null,disabled:verificationBlocked,guided:true})))),
    h('div',{className:'prism-library-columns'},
     h('section',{className:'prism-library-list-pane','aria-labelledby':'prism-library-heading'},
      h('h3',{id:'prism-library-heading',tabIndex:-1},'论文列表'),paperLookup),
     h('div',{className:'prism-library-context-pane'},
      h(GuidedLibraryTask,{paper,project:projectContext,persistence:snapshot.persistence,ready:scopeReady,blocked:verificationBlocked,
       canOpen:canReadPaper,canPlan:canPlanPaper,planReady,onRead:openCurrentReader,onNavigate:navigateStage}),
      projectLibrary))):null,
   readerOpen?h(PaperReader,{key:readerKey,store,scope:readingScope,paper,currentDocument:verifyReadingSource,currentPapers:readCurrentReadingPapers,draftMemory:readingDraftMemory,onExit:()=>{
    setIntakeTool('text');
    requestAnimationFrame(()=>stageRoot.current?.querySelector('[data-testid=open-paper-reader]')?.focus());
   }}):null,
   !guided?h(React.Fragment,null,h('h2',null,'论文库 · 导入、查找与换篇'),projectLibrary):null,
   !guided?h('p',{'data-testid':'project-scope-notice'},projectContext?.id?'当前论文列表和顶部选择器仅显示已确认关联论文。导入仍进入共享基础库，请显式关联。':'共享基础库模式；选择项目后按确认关系筛选。'):null,
   h('details',{className:guided?'prism-support':undefined,open:guided?undefined:true},guided?h('summary',null,'更多论文工具'):null,
    h('div',{style:guided?undefined:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:16,marginBottom:22}},
     !guided?paperLookup:null,
     toolEntry('手工建档',h('form',{onSubmit:e=>{e.preventDefault();act('addPaper',{title,source})},style:{marginTop:15}},h('label',null,guided?'论文标题':'新论文标题',h('input',{value:title,onChange:e=>setTitle(e.target.value),maxLength:500,style:field,required:true})),h('label',null,guided?'来源或 DOI（可选）':'来源或 DOI（仅作为文本保存，不联网）',h('input',{value:source,onChange:e=>setSource(e.target.value),maxLength:1000,style:field})),h('button',{type:'submit',disabled:verificationBlocked||pending||!title.trim(),style:secondary},guided?'保存档案':'建立本地档案'))),
     !guided?h('section',{style:box},h('h2',{style:{fontSize:17,marginTop:0}},'导入本地论文'),h('hr',{style:{border:0,borderTop:'1px solid #333',margin:'20px 0'}}),h('label',null,'导入本地论文文本（UTF-8 TXT / Markdown，≤512 KiB）',h('input',{type:'file',accept:'.txt,.md,text/plain,text/markdown',onChange:chooseFile,disabled:verificationBlocked||pending,style:field})),h('p',{style:{color:palette.muted}},'本地导入不联网。请填写标题建立档案，或用上方文件入口导入 UTF-8 TXT / Markdown；PDF 可在下方默认关闭的实验入口启用后导入。正文支持安全 Markdown 与 LaTeX 数学显示；不执行原始 HTML、不自动加载图片，无法识别的公式保留源码。'),!guided&&intake?h('div',null,h('p',null,'待确认：',intake.item.document.filename,' · ',intake.item.document.byteLength,' bytes'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:160,overflow:'auto'}},intake.item.document.text.slice(0,1500)),actionButton('确认导入文本',confirmTextIntake,pending,true),actionButton('放弃导入',()=>{cancelTextIntake();setMessage('已放弃文本导入；未自动重试。')})):null):null,
     toolEntry('论文档案',h('section',{style:box},h('h2',{style:{fontSize:17,marginTop:0}},paper?.title||'尚无档案'),h('p',{style:{color:palette.muted,overflowWrap:'anywhere'}},paper?.source||'来源尚未记录'),paper?.metadata?h('details',null,h('summary',null,paper.metadata.zotero?'Zotero 书目信息':paper.metadata.discovery?.simulation?'合成来源元数据（非真实研究）':paper.metadata.discovery?'多来源文献元数据（非全文核验）':'Crossref元数据（非全文核验）'),h('p',null,paper.metadata.authors.join(', ')||'作者缺失',' · ',paper.metadata.year||'年份缺失'),h('p',{style:{whiteSpace:'pre-wrap'}},paper.metadata.abstract||'摘要缺失'),h('p',{style:{overflowWrap:'anywhere'}},paper.metadata.links.map(l=>l.url).join('；')||'登记链接缺失'),paper.metadata.discovery?h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify(paper.metadata.discovery,null,2)):null,h('p',null,'检索时间：',paper.metadata.retrievedAt,'；全文、数据、代码可得性未核验。')):null,!guided?h(React.Fragment,null,h('p',null,'步骤 ',paper?.steps.length||0,' · 历史运行 ',paper?.runs.length||0),h('p',null,paper?.accepted?'已接收当前演示版本':'尚未人工接收演示版本'),h('p',{style:{color:palette.muted}},'上游 Prompt 改动或重跑会使下游审核失效。通过模拟审核 ≠ 科学有效性。'),(paper?.events||[]).slice(-3).reverse().map((e,i)=>h('p',{key:i,style:{fontSize:12,color:palette.muted}},e.time,' · ',explain(e.text)))):null))),
   guided?null:textIntakeOutcome,
    toolEntry('论文笔记',h(BibliographyNotesPanel,{store,paper,guided,papers:scopedPapers,projectId:projectContext?.id||'',scopeToken:JSON.stringify([projectScope.raw??null,scopeReady]),active:area==='library',disabled:locked||!scopeReady,onSelect:setSelected})),
    toolEntry('书目来源',h(SourceTracePanel,{store,paper,guided,active:area==='library',disabled:locked||!scopeReady,scopeToken:JSON.stringify([projectContext?.id||null,projectScope.raw??null])})),
    !guided?h(PdfIntakePanel,{store,paper,disabled:locked,scopeToken:JSON.stringify([area,projectContext?.id||null,projectScope.raw??null]),onExport:exportRecords}):null,
    toolEntry('挂接正文',typeof DocumentAttachmentPanel==='function'?h(DocumentAttachmentPanel,{store,paper,guided,disabled:locked,active:area==='library',scopeToken:JSON.stringify([projectContext?.id||null,projectScope.raw??null]),onChanged:()=>setLibraryRefresh(n=>n+1)}):null),
    !guided?h(DiscoveryWorkspacePanel,{store,projectId:projectContext?.id||null,projectRevisionSha256:projectContext?.revisionSha256||null,disabled:verificationBlocked}):null,
    h('details',{style:{...box,marginBottom:20}},h('summary',null,guided?'旧版 Crossref 检索':'旧版单来源 Crossref 检索与逐篇建档'),h('h2',{style:{fontSize:18}},'公开文献检索 · 用户主动提交至 Crossref'),h('p',{style:{color:palette.muted}},'仅在点击检索或按回车提交此检索表单时，将检索框的全部内容（去除首尾空格）作为 URL 查询参数发送给 https://api.crossref.org/works，用于查找文献元数据。不自动附带本地论文正文、档案、账号凭据或邮箱；但你粘贴到检索框的任何内容都会发送，不会自动识别或脱敏。请勿填写秘密或个人敏感信息。服务及网络中介可能记录查询词和网络信息（如出口 IP）。关键词相关性检索，不是已完成的系统综述。'),
   h('form',{onSubmit:discover},h('label',null,'公开检索词（不要输入秘密或敏感信息）',h('input',{value:searchTerm,onChange:e=>setSearchTerm(e.target.value),maxLength:300,style:field,required:true,'data-testid':'crossref-query'})),
    h('label',{style:{display:'block',margin:'12px 0'}},h('input',{type:'checkbox','data-testid':'crossref-manual',checked:manual,onChange:e=>setManual(e.target.checked),disabled:searching}),' 人工筛选（默认开启；关闭后按Crossref顺序自动建档，不自动研究）'),
    h('label',null,'本次最多自动建档 ',h('select',{'data-testid':'crossref-limit',value:maxAdd,onChange:e=>setMaxAdd(Number(e.target.value)),disabled:searching||manual,style:secondary},[1,2,3,4,5].map(n=>h('option',{key:n,value:n},n))),' 篇；重复DOI跳过继续'),
    h('div',{style:{display:'flex',gap:8,marginTop:12}},h('button',{type:'submit',disabled:verificationBlocked||pending||searching||searchCooldownSeconds>0||!searchTerm.trim(),style:btn},searching?'正在获取真实元数据…':searchCooldownSeconds>0?'冷却中（'+searchCooldownSeconds+'秒）':'检索 Crossref'),h('button',{type:'button',disabled:!searching,onClick:()=>{searchRef.current?.abort();setMessage('已请求取消检索；无法撤回已经发送的查询词，也不能保证服务端停止处理。原候选及已经建档的条目保留，取消不撤销已提交的建档。')},style:secondary},'取消检索'))),
   h('p',{style:{color:palette.muted}},'检索只获取元数据，不读取全文或执行研究；不会后台重试。请求协调仅限当前页面运行实例，不保证跨标签或其他设备的共享出口限速。Crossref可能缺摘要或全文链接；有链接不等于开放获取。数据与代码可得性均未核验。候选仅本次内存保留，已建档元数据会保存。查询词会随建档元数据保存在本机，也会包含在你主动下载的候选清单中；这些内容是明文。'),
   h(CandidateArchivePanel,{query:candidateQuery,candidates,importedDois,memoryDois}),
   candidateQuery!==null?h('p',{'data-testid':'crossref-candidate-query',style:{color:palette.muted,overflowWrap:'anywhere'}},'当前候选来自：',candidateQuery,'；共 ',candidates.length,' 条。再次检索成功才替换这批候选；刷新页面不会保留未建档候选。'):null,
   candidates.map(c=>h('article',{key:c.doi,style:{borderTop:'1px solid #363636',padding:'15px 0'}},h('h3',{style:{fontSize:16}},c.title),h('p',{style:{overflowWrap:'anywhere'}},c.doi,' · ',c.year||'年份缺失',' · ',c.authors.join(', ')||'作者缺失'),h('details',null,h('summary',null,c.abstract?'摘要元数据（未核验全文）':'Crossref未提供摘要'),h('p',{style:{whiteSpace:'pre-wrap'}},c.abstract||'无摘要')),h('p',{style:{color:palette.muted,overflowWrap:'anywhere'}},'出版方登记链接：',c.links.map(l=>l.url).join('；')||'缺失','。全文/数据/代码均未核验。'),actionButton(memoryDois.includes(c.doi)?'仅当前内存，未保存':importedDois.includes(c.doi)?'已建档或已存在':'确认建档',()=>importCandidate(c),pending||searching||importedDois.includes(c.doi)||memoryDois.includes(c.doi))))),
   !verificationBlocked&&projectContext?.id?h(React.Fragment,null,h(ProjectQueuePanel,{store,onNavigationGuard:receiveQueueNavigationGuard,projectId:projectContext.id,scopeProvider:projectScopeProvider,currentPaperId:paper?.id,onNavigate:t=>{t.verify();if(t.namespace!==store.getStorageKey()||t.projectId!==projectContext?.id)return false;if(setSelected(t.paperId,t.verify)===false)return false;setEditing(null);setHandoff(null);setArea('execution');return true}}),projectScope.ready&&projectScope.projectId===projectContext.id?h(ProjectExecutionPanel,{store,projectId:projectContext.id,scopeProvider:projectScopeProvider,onOwnership:setProjectExecutionOwned}):null):null,h('details',{'data-testid':'legacy-shared-queue'},h('summary',null,'旧共享合成调度器（非项目队列）'),h('p',null,'此执行器仍使用共享基础库。项目交接必须经上方明确预览/确认；有项目归属时旧入口禁止写入。'),!verificationBlocked?h(LibraryQueuePanel,{store,onOwnership:handleLibraryOwnership,onSelect:id=>{setSelected(id);setEditing(null);setHandoff(null)}}):null),
   !guided&&!verificationBlocked&&projectContext?.id?h(ResearchInstancesPanel,{store,stage:null,paper,scopeReady,onNavigate:navigateStage,onPlanReady:setPlanReady,modelStatus,onModelRefresh:()=>setModelRefresh(value=>value+1),modelNamespace:candidateNamespace,onNextPaper:(n,verify)=>{verify();if(n.namespace!==store.getStorageKey()||n.projectId!==projectContext?.id)return false;if(setSelected(n.paperId,verify)===false)return false;setEditing(null);setHandoff(null);return true},projectId:projectContext.id,onOwnership:setInstanceOwned,active:guided?area==='planning'||area==='execution':area==='library',navigationTarget:instanceTarget,onNavigationDone:t=>setInstanceTarget(old=>old===t?null:old)}):null)),
   guided&&!verificationBlocked&&projectContext?.id?h('div',{hidden:area!=='planning'&&area!=='execution',className:'prism-stage','aria-label':'当前论文研究计划'},h(ResearchInstancesPanel,{store,stage:area,paper,scopeReady,projectRevisionSha256:projectContext.revisionSha256,onNavigate:navigateStage,onViewSavedResults:viewSavedResults,onPlanReady:setPlanReady,modelStatus,onModelRefresh:()=>setModelRefresh(value=>value+1),modelNamespace:candidateNamespace,onNextPaper:(n,verify)=>{verify();if(n.namespace!==store.getStorageKey()||n.projectId!==projectContext?.id)return false;if(setSelected(n.paperId,verify)===false)return false;setEditing(null);setHandoff(null);return true},projectId:projectContext.id,onOwnership:setInstanceOwned,active:guided?area==='planning'||area==='execution':area==='library',navigationTarget:instanceTarget,onNavigationDone:t=>setInstanceTarget(old=>old===t?null:old)})):null,
  h('section',{id:'workspace-zone-execution',className:guided?'prism-stage':undefined,role:'tabpanel',tabIndex:guided&&area==='execution'?-1:undefined,'aria-labelledby':'workspace-tab-execution',hidden:area!=='execution','data-testid':'workspace-execution'},guided?h('h2',{tabIndex:-1,className:'prism-stage-heading','data-prism-stage-heading':''},'开始研究'):h('h2',{tabIndex:-1},'执行工作台 · 平台计划与人工交接'),
    guided&&!projectContext?.id?h('section',{className:'prism-card'},h('p',null,'先创建项目并保存论文的研究步骤。'),guidedButton('编辑步骤',()=>navigateStage('planning'),{primary:true})):null,
    guided&&projectContext?.id&&!paper?h('section',{className:'prism-card'},h('p',null,'先选择项目中的论文。'),guidedButton('前往导入论文',()=>navigateStage('library'),{primary:true})):null,
    h('details',{className:guided?'prism-support':undefined,open:guided?undefined:true},guided?h('summary',null,'手动交接与历史流程工具'):null,
   h(LocalPreparationPanel,{store,guided,projectScopeProvider,checkQueueNavigation,queueNavigationRevision,onTerminalNavigate:t=>{t.verify();if(t.namespace!==store.getStorageKey()||t.projectId!==projectContext?.id)return false;if(setSelected(t.paperId,t.verify)===false)return false;setEditing(null);setHandoff(null);setArea('execution');return true},navigationTarget:preparationTarget,onNavigationDone:t=>setPreparationTarget(old=>old===t?null:old),preparationScopeReady:scopeReady&&!verificationBlocked&&(!planningPaper||planningPaper.id===paper?.id),operationsScopeReady:(!planningPaper||planningPaper.id===paper?.id)&&!verificationBlocked&&findingsProjectReady&&projectScope.ready&&projectScope.projectId===(projectContext?.id||null),operationsScopeToken:projectScope.raw,onSelectPaper:id=>{if(id===paper?.id)return true;if(setSelected(id)===false)return false;setEditing(null);setHandoff(null);return true},key:'local-prep|'+store.getStorageKey(),context:{namespace:store.getStorageKey(),projectId:projectContext?.id||'',paperId:planningPaper?.id||'',paperTitle:planningPaper?.title||'未选择论文'},customGraph:context&&paper&&context.paperId===paper.id?context.graph:null,steps:paper?.steps?.map((s,i)=>({index:i,name:s.name,promptVersion:s.promptVersion}))||[],label:planningPaper?.title||'未选择论文',readCurrent:(index=0)=>{if(!scopeReady||planningPaper?.id!==paper?.id)throw Error('项目范围尚未核验，不能读取当前来源');if(!paper?.document)return null;store.assertCurrentStorage();let step;if(typeof index==='object'){if(!context||context.paperId!==paper.id)throw Error('自定义流程尚未核验');const raw=JSON.parse(localStorage.getItem(store.getStorageKey()+':custom-workflow-v1:'+paper.id)||'null');const g=raw?.state?.graphs?.find(g=>g.version===raw.state.currentVersion);if(raw?.state?.source?.namespace!==store.getStorageKey()||raw.state.source.paperId!==paper.id||raw.state.source.paperTitle!==paper.title||raw.state.source.documentSha256!==(paper.document.sha256??null)||!g||g.version!==context.version||JSON.stringify(g)!==JSON.stringify(context.graph))throw Error('图版本已变化，等待重新核验后再复制；原草稿保留');const n=g.nodes.find(n=>n.id===index.nodeId);if(!n)throw Error('所选节点已不存在');step={name:n.name,prompt:n.prompt,promptVersion:n.promptVersion,nodeId:n.id,graphVersion:g.version,graphSha256:g.sha256};}else step=paper.steps?.[index]?{index,name:paper.steps[index].name,prompt:paper.steps[index].prompt,promptVersion:paper.steps[index].promptVersion}:null;return {document:{filename:paper.document.filename,text:paper.document.text},step};}}),
    !guided?accountModel?h('p',null,'实际发送入口在论文库的项目工作节点。'):h('p',null,'本区是本地合成流程。'):null,
   toolEntry(guided?'查看共享流程步骤':'节点索引',h(React.Fragment,null,!guided?actionButton('返回当前论文流程与节点',()=>setArea('planning')):null,context&&paper&&context.paperId===paper.id?h('section',{'data-testid':'execution-node-index'},h('h3',null,guided?'当前论文的共享流程':'节点索引 · 图 v'+context.version),guided?guidedHelp('流程版本详情',h('p',null,'图版本 ',context.version,' · 图指纹 ',context.graph.sha256)):h('p',null,'同一稳定节点 ID 贯穿 Prompt、平台规划、合成运行和人工审核；下方平台只是计划，不表示已接通。'),context.graph.nodes.map(n=>h('div',{key:n.id,style:{borderTop:'1px solid #363636',padding:'10px 0'}},h('strong',null,guided?n.name:n.name+' ['+n.id+']'),h('span',null,guided?' · '+(n.kind==='review'?'复核步骤':'研究步骤')+' · 依赖 '+(n.dependsOn.map(id=>context.graph.nodes.find(item=>item.id===id)?.name||'未找到对应步骤').join('、')||'无'):' · Prompt v'+n.promptVersion+' · '+(n.kind==='review'?'审核':'工作')+' · 上游 '+(n.dependsOn.join(', ')||'无')),guided?guidedHelp('步骤标识与指令版本',h('p',null,n.id,' · Prompt v',n.promptVersion)):null,actionButton(guided?'编辑步骤：'+n.name:'前往节点 '+n.id,()=>jumpToNode({paperId:paper.id,nodeId:n.id,graphSha256:context.graph.sha256,graphVersion:context.version})),actionButton(guided?'准备交接：'+n.name:'准备此节点人工交接 '+n.id,()=>prepareNode({paperId:paper.id,nodeId:n.id,graphSha256:context.graph.sha256,graphVersion:context.version}))))):guided?h('p',null,'暂无可查看的共享流程。可在「编辑步骤」的共享流程工具中查看或创建。'):null)),
    toolEntry(guided?'拟定平台分工并试跑':'平台计划',!verificationBlocked?h(PlatformPlanPanel,{key:paper?.id||'no-paper',store,paper,disabled:locked,guided}):null),
    toolEntry(guided?'准备人工复核与登记返工':'节点复核',h(NodeReviewPanel,{store,paper,disabled:locked,guided})),
   h('details',{'data-testid':'legacy-external-tools',className:guided?'prism-support':undefined},h('summary',null,guided?'导入外部答复与下载旧流程材料':'旧三步外部材料与手动交接（兼容记录）'),guided&&!handoff?h('p',{className:'prism-muted'},'如需下载交接材料，请先到「查看结果 → 更多工具与档案 → 旧版流程与论文原文」选择「预览手动交接」，再回到这里下载。'):null,h(ExternalInbox,{store,paper,disabled:locked,guided}),handoff?h('section',{'data-testid':'manual-handoff',style:{...box,marginBottom:20}},h('h2',null,'手动交接 · 未连接 / 未发送'),h('p',null,'由你自行下载并复制到任意平台。下面是即将下载的完整 JSON；不自动附带论文全文或上游产物，也不会改变研究状态。'),handoffStale?h('p',{role:'alert'},'此预览已过期：Prompt 或版本发生变化。下载已禁用，请重新生成。'):null,h('pre',{'data-testid':'handoff-preview',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:330,overflow:'auto'}},handoffJSON(handoff)),h('div',{style:{display:'flex',gap:8}},actionButton('下载此交接 JSON',downloadHandoff,handoffStale||handoffBusy),actionButton('关闭交接预览',()=>setHandoff(null)))):null))),
  h('section',{id:'workspace-zone-results',className:guided?'prism-stage':undefined,role:'tabpanel',tabIndex:guided&&area==='results'?-1:undefined,'aria-labelledby':'workspace-tab-results',hidden:area!=='results','data-testid':'workspace-results'},
    guided?h(GuidedResultTools,{items:resultTools,active:activeResult,onSelect:setResultTool,
      actions:h('div',{className:'prism-view-actions','aria-label':'成果操作'},
       paper?guidedButton('阅读当前论文',openCurrentReader,{disabled:!canReadPaper}):null,
       guidedButton('转到项目便携备份',openPortableBackup)),
      panes:{
      saved:h(GuidedResults,{store,projectId:projectContext?.id,paper,active:area==='results'&&activeResult==='saved'&&scopeReady&&!verificationBlocked,onNavigate:navigateStage,planReady,currentPapers:readCurrentReadingPapers}),
      reading:h(ReadingComparison,{
       key:JSON.stringify([store.getStorageKey(),projectContext?.id??null]),store,projectId:projectContext?.id??null,
       scopeToken:projectScope.raw,libraryRevision:snapshot.revision,papers:scopedPapers,active:area==='results'&&activeResult==='reading',
       ready:scopeReady&&!verificationBlocked,currentPapers:()=>readCurrentReadingPapers('READING_COMPARISON_SCOPE_CHANGED'),
      }),
      argument:projectContext?.id?h(ResearchArgumentPanel,{
       key:JSON.stringify([store.getStorageKey(),projectContext.id]),store,projectId:projectContext.id,
       scopeToken:projectScope.raw,libraryRevision:snapshot.revision,papers:scopedPapers,draftMemory:readingDraftMemory,
       active:area==='results'&&activeResult==='argument',ready:scopeReady&&!verificationBlocked,
       currentPapers:()=>readCurrentReadingPapers('ARGUMENT_SCOPE_CHANGED'),
      }):null,
      comparison:comparisonEntry,matrix:matrixEntry,progress:progressEntry,
     }}):null,
    h('details',{className:guided?'prism-support':undefined,open:guided?undefined:true},guided?h('summary',null,'更多结果工具'):null,
     !guided?h(React.Fragment,null,h('h2',null,'研究成果 · 结论、证据与口径'),h('p',null,'人工结论总览按下方标明的范围查阅；其他比较、证据及口径工具仍为共享档案视图，不受项目论文列表筛选。'),h('p',null,'结论和人工记录未独立验证，合成结果不是研究发现。')):null,
     toolEntry('证据图',h(InstanceEvidenceMapPanel,{store,guided,projectId:projectContext?.id||'',scopeReady:!verificationBlocked&&findingsProjectReady&&projectScope.ready&&projectScope.projectId===(projectContext?.id||null),active:area==='results'})),
     !guided?progressEntry:null,
     toolEntry('人工结论',h(ManualFindingsPanel,{store,guided,projectId:projectContext?.id||'',scopeReady:!verificationBlocked&&findingsProjectReady&&projectScope.ready&&projectScope.projectId===(projectContext?.id||null),scopeToken:projectScope.raw,active:area==='results',selectedId:paper?.id,onSelect:id=>{if(id===paper?.id){setArea('library');return true}if(setSelected(id)===false)return false;setEditing(null);setHandoff(null);setArea('library');return true}})),
     !guided?matrixEntry:null,
     toolEntry('自定义矩阵',h(CustomMatrixPanel,{store,guided,projectId:projectContext?.id||'',disabled:verificationBlocked||!scopeReady})),
     toolEntry('恢复矩阵版本',h(CustomMatrixRestorePanel,{store,guided,projectId:projectContext?.id||'',disabled:verificationBlocked||!scopeReady})),
     toolEntry('跨论文证据',!verificationBlocked?h(MultiEvidencePanel,{store}):null),
     !guided?comparisonEntry:null,
     toolEntry('变量词典',h(DictionaryPanel,{store,guided,disabled:verificationBlocked})),
     toolEntry('可行性检查',!verificationBlocked?h(FeasibilityPanel,{store}):null))),
   h('details',{className:guided?'prism-support':undefined,open:guided?undefined:true},guided?h('summary',null,'更多工具与档案'):null,
  toolEntry('待我处理',h('section',{id:'workspace-zone-attention',role:'tabpanel','aria-labelledby':'workspace-tab-attention',hidden:guided?undefined:area!=='attention','data-testid':'workspace-attention'},!guided?h('h2',null,'待我处理'):null,h('p',null,guided?'共享论文库':'本区为共享档案的待处理记录，不受项目论文列表筛选。'),!verificationBlocked?h(AttentionPanel,{store,onSelect:id=>{if(!scopeReady||!scopedPapers.some(p=>p.id===id)){setMessage('该论文不在当前已核验范围，未切换或改动草稿；请先明确选择共享范围或对应项目。');return false}if(setSelected(id)===false)return false;setEditing(null);setHandoff(null);setArea('execution');return true}}):null)),
  h('details',{'data-testid':'workspace-archive',className:guided?'prism-support':undefined,style:guided?undefined:{...box,marginTop:20}},h('summary',null,guided?'归档与备份':'归档与备份 · 项目便携包为主入口'),!guided?h('p',null,'整合归档包含已保存的论文、图版本、证据和讨论草稿；只读恢复不会继续执行。未保存的表单不会自动备份。'):h('p',{className:'prism-muted'},store.workspaceRecovery?'便携档案用于只读核对。统一恢复在工作台顶部的本机副本。':'归档包含已保存内容。表单草稿需单独导出。'),
   toolEntry('项目便携备份',h(PortableProjectBackupPanel,{store,guided,exportDisabled:verificationBlocked})),
   toolEntry('PDF 原件库',h(PdfOriginalVaultPanel,{key:'pdf-vault:'+store.getStorageKey(),store,guided})),
   toolEntry('PDF 原件包',typeof PdfOriginalBundlePanel==='function'?h(PdfOriginalBundlePanel,{store}):null),
   toolEntry('项目归档',!verificationBlocked?h(ProjectArchivePanel,{store,guided}):null),
   toolEntry('从归档派生草稿',!verificationBlocked?h(DerivedDraftPanel,{key:store.getStorageKey(),store}):null),
   toolEntry('受限工作区导入',!verificationBlocked?h(RestrictedImportPanel,{key:'import:'+store.getStorageKey(),store}):null),
   h('details',null,h('summary',null,'高级：单流程归档与基础档案导出'),!verificationBlocked?h(WorkflowArchivePanel,{store}):null,actionButton('导出本地记录',exportRecords,snapshot.persistence.error==='INVALID_OR_UNAVAILABLE_STORAGE'))),
  h('details',{'data-testid':'workspace-legacy',className:guided?'prism-support':undefined,style:guided?undefined:{...box,marginTop:16}},h('summary',null,guided?'旧版流程与论文原文':'历史兼容 · 旧三步演示与原文'),paper?h(React.Fragment,null,
   notice('下方为旧三步演示与历史兼容区；上方自定义图独立存储和执行，不把旧运行或人工送审记录冒充新图完成结果。'),
   h('nav',{style:{display:'flex',gap:8,marginBottom:18}},actionButton('流程与 Prompt',()=>setTab('workflow'),false,tab==='workflow'),actionButton('证据与版本',()=>setTab('evidence'),false,tab==='evidence'),actionButton('论文原文',()=>setTab('document'),false,tab==='document')),
   tab==='workflow'?h(React.Fragment,null,
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,270px),1fr))',gap:14}},paper.steps.map((s,i)=>h('section',{key:i,style:box},
     h('div',{style:{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}},h('span',{style:{color:palette.muted,fontSize:12}},'STEP 0',i+1),status(s.status)),h('h3',{style:{fontWeight:500}},s.name),h('div',{style:{fontSize:12,color:palette.muted}},'Prompt v',s.promptVersion,' · 本地模拟执行器'),
     editing===i&&editContextValid?h('div',null,h('label',null,'编辑本步骤 Prompt',h('textarea',{value:draft,onChange:e=>setDraft(e.target.value),maxLength:16000,style:{...field,minHeight:150}})),h('div',{style:{display:'flex',gap:8}},actionButton('保存新版本',()=>act('editPrompt',{stepIndex:i,prompt:draft}),locked||!draft.trim()||draft===s.prompt,true),actionButton('取消编辑',()=>setEditing(null)))):h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',minHeight:60}},s.prompt),
     h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}},actionButton(s.status==='needs_revision'?'模拟返修':'模拟执行',()=>act('run',{stepIndex:i}),locked||s.status==='blocked',s.status==='ready'),actionButton('编辑 Prompt',()=>{setEditBinding({namespace:store.getStorageKey(),projectId:projectContext?.id||null,paperId:paper.id,paperTitle:paper.title,stepIndex:i,promptVersion:s.promptVersion,prompt:s.prompt});setEditing(i);setDraft(s.prompt)},locked),actionButton('预览手动交接',()=>prepareHandoff(i),locked||handoffBusy))))),
    h('section',{style:{...box,marginTop:16}},h('h3',null,'审核与接收'),h('p',null,'演示审核仅检查结果是否记录“分母”。失败时请在第二步 Prompt 加入“分母”并重跑，再执行审核。'),h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},actionButton('接收当前演示版本',()=>act('accept'),locked||paper.steps[2].status!=='passed'||!!paper.accepted,true),actionButton('取消当前模拟',()=>act('cancel'),pending||!paper.steps.some(s=>s.status==='running')))))
   :tab==='document'?h('section',{style:box},h('h2',null,'本地导入文本'),paper.document?h(React.Fragment,null,h('p',null,paper.document.filename,' · ',paper.document.byteLength,' UTF-8 bytes'),h('p',{style:{overflowWrap:'anywhere',fontSize:12}},verificationBlocked?'未核验的已存文本 SHA-256：':'已核验文本 SHA-256：',paper.document.sha256),h('p',{style:{color:palette.muted}},'仅校验本地文本一致性，不证明作者或来源。此正文不会被模拟研究步骤使用或发送。'),h(typeof ResearchContent==='function'?ResearchContent:({text,...props})=>h('div',props,text),{text:paper.document.text,'data-source-id':paper.id,'data-testid':'paper-document-rich'}),h('details',null,h('summary',null,'查看原始文本（逐字保留）'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},paper.document.text))):h('p',null,'此档案尚未导入正文。')):h('div',null,paper.runs.length?paper.runs.slice().reverse().map(r=>h('article',{key:r.id,style:{...box,marginBottom:14}},h('div',{style:{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}},h('h3',{style:{margin:0,overflowWrap:'anywhere'}},paper.steps[r.stepIndex]?.name||paper.steps[Number(r.step)]?.name||'运行', ' · ',r.id),status(r.status)),h('p',{style:{color:palette.muted}},'本地模拟 · Prompt v',r.promptVersion,' · ',r.started||''),h('details',null,h('summary',null,'运行时 Prompt 快照'),h(typeof ResearchContent==='function'?ResearchContent:({text,...props})=>h('div',props,text),{text:r.prompt,'data-source-id':r.id,'data-testid':'run-prompt-rich'}),h('details',null,h('summary',null,'查看原始文本（逐字保留）'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},r.prompt))),r.errorCode?h('p',{role:'alert',style:{color:'#f1c98e'}},'模拟中断：',explain(r.errorCode)):null,r.reviewedRun?h('p',null,'审核固定运行：',r.reviewedRun):null,(r.artifacts||[]).map((a,j)=>h('details',{key:j,open:true},h('summary',null,a.name||'演示产物'),h('p',{style:{fontSize:11,color:palette.muted,overflowWrap:'anywhere'}},'SHA-256 ',a.sha256),h(typeof ResearchContent==='function'?ResearchContent:({text,...props})=>h('div',props,text),{text:a.content,'data-source-id':r.id+':'+j,'data-testid':'run-artifact-rich'}),h('details',null,h('summary',null,'查看原始文本（逐字保留）'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13}},a.content)))))):notice('还没有模拟运行。历史产物保留，不能据此推断真实研究结论。')),
   h('footer',{style:{color:palette.muted,fontSize:12,marginTop:25}},'PRISM 原生演示 · 状态版本 ',snapshot.revision,' · 不包含真实模型执行')):null),
  null
 ));
 return h('main',{'data-testid':'prism-workspace',className:guided?'prism-workspace':undefined,ref:stageRoot,style:{background:guided?undefined:palette.bg,color:guided?undefined:palette.text,padding:guided?undefined:'20px clamp(12px, 3vw, 24px)',minWidth:0,minHeight:0,flex:'0 0 auto',fontFamily:guided?undefined:'system-ui,sans-serif',fontSize:guided?undefined:14,lineHeight:1.6,boxSizing:'border-box'}},
  guided?h('style',{'data-prism-style':''},prismShadcnStyles+'\n'+guidedStyles+'\n'+workspaceLayout):null,
  guided?h('a',{className:'prism-skip',href:'#workspace-zone-'+area},'跳到当前工作区'):null,
  guided?h(GuidedWorkspaceChrome,{
   project:projectContext,paper,papers:scopeReady&&!verificationBlocked?scopedPapers:[],onSelect:chooseWorkspacePaper,
   modelStatus:candidateNamespace?modelStatus:'local',area,destination:readerOpen?'reader':area==='results'?activeResult:area,
   onNavigate:navigateStage,onShortcut:openWorkspaceShortcut,onArchive:openPortableBackup,onRestore:openBaseArchive,
   canRead:canReadPaper,canSelectPaper:!intake&&!pending&&scopeReady&&!verificationBlocked,
   scopeStatus:verificationBlocked?'档案待核对':!scopeReady?'正在核验论文范围':null,
  },workspace):workspace);
}
function createWorkbenchPlugin(resolveDocument=null){return {Config:{'~standard':{version:1,vendor:'prism-local-workbench',validate(raw){try{return {value:resolveProfileConfig(raw,window.__PRISM_LOCAL_PROFILE__)}}catch(e){return {issues:[{message:e.message}]}}}}},inject:resolveDocument?['slots','connection']:['slots'],apply(ctx,config){
 const hostWorkbench=planningWorkbenchHostCore.createPlanningWorkbenchHost(resolveDocument?{ctx,resolveDocument}:{});
 const profileConfig=resolveProfileConfig(config,window.__PRISM_LOCAL_PROFILE__),originalKey=profileStorageKey(profileConfig);
 const readingDraftMemory=new Map();
 const keepReadingDrafts=event=>{
  if([...readingDraftMemory.values()].some(entry=>entry.draft)){event.preventDefault();event.returnValue=''}
 };
 globalThis.window?.addEventListener?.('beforeunload',keepReadingDrafts);

 let storage;try{storage=globalThis.localStorage}catch{}
 // The native window owns the persistent annotation database. Non-browser
 // embeddings keep using their injected storage adapters.
 const annotationStorage=globalThis.document?.defaultView===globalThis?createAnnotationStorage({storage}):undefined;
 const editorDrafts=storage&&workspaceRecoveryCore.createWorkspaceEditorDrafts(storage,originalKey,readingDraftMemory);
 const locksAvailable=typeof globalThis.navigator?.locks?.request==='function';
 const manager=createRestoreManager({storage,profileId:profileConfig.storageNamespace,createStore,crypto:globalThis.crypto,withLock:locksAvailable?(name,fn)=>navigator.locks.request(name,{mode:'exclusive'},fn):undefined});
 const recovery=storage&&annotationStorage&&window.__PRISM_WORKSPACE_RECOVERY__===window.location.origin
  ? workspaceRecoveryCore.createWorkspaceRecovery({
    storage,namespace:originalKey,lock:locksAvailable?(name,fn)=>navigator.locks.request(name,fn):undefined,
    materials:workspaceRecoveryCore.createWorkspaceMaterials({
      storage,namespace:originalKey,annotations:annotationStorage,volatileDrafts:readingDraftMemory,
    }),
    async validateBase(entries){
      const raws=new Map(entries);
      const isolatedStorage={getItem:key=>raws.get(key)??null,setItem:(key,raw)=>raws.set(key,raw)};
      const copy=createStore({storage:isolatedStorage,key:originalKey});
      try{
        const checked=await copy.ready;
        if(!checked.ready)throw Error('RECOVERY_BASE');
        const plans=raws.get(originalKey+':project-planning-v1');
        const instances=raws.get(originalKey+':research-instances-v1');
        if(plans!==undefined)await projectPlanningCore.loadProjects(plans,originalKey,globalThis.crypto);
        if(instances!==undefined)await researchInstancesCore.loadInstances(instances,originalKey,globalThis.crypto);
      }finally{copy.destroy()}
    },
  }):null;
 let connection,active,serial=0,disposed=false,switching=false,unmountConnection;const runtimeListeners=new Set();
 const gatedController=c=>Object.fromEntries(Object.entries(c).map(([name,value])=>[name,typeof value==='function'&&!['getSnapshot','subscribe','close'].includes(name)?(...args)=>{if(switching)throw Error('SLOT_SWITCH_BUSY');return value(...args)}:value]));
 const make=key=>{
  const baseStore=createStore({storage,crypto:globalThis.crypto,key});let pendingDispatches=0;
  const gate=()=>{if(switching)throw Error('SLOT_SWITCH_BUSY')};
  const store={...baseStore,annotationStorage,editorDrafts:key===originalKey?editorDrafts:null,workspaceRecovery:key===originalKey?recovery:null,assertCurrentStorage(){gate();return baseStore.assertCurrentStorage()},dispatch(action){
   gate();
   // Admit before the store's first await, even before a run or import is visible.
   // A slot switch must not destroy a runtime whose command already started.
   pendingDispatches++;
   try{return Promise.resolve(baseStore.dispatch(action)).finally(()=>{pendingDispatches--})}
   catch(error){pendingDispatches--;throw error}
  },exportJSON(){gate();return baseStore.exportJSON()}};
  const isOriginal=key===originalKey,wire=isOriginal?connection:undefined;
  return {key,originalKey,serial:++serial,store,isOriginal,hasPendingDispatch:()=>pendingDispatches>0,syntheticController:gatedController(createSyntheticController({store,connection:wire})),dedicatedController:gatedController(createDedicatedController({store,connection:wire})),httpFixtureController:gatedController(createHttpFixtureController({store,connection:wire})),providerReviewController:gatedController(createProviderReview({store}))};
 };
 const closeRuntime=r=>{r.syntheticController.close();r.dedicatedController.close();r.httpFixtureController.close();r.providerReviewController.close();r.store.destroy()};
 let uiSnapshot;const notify=()=>{uiSnapshot={runtime:active,switching};for(const f of runtimeListeners)f()};active=make(originalKey);uiSnapshot={runtime:active,switching};
 const remake=()=>{if(disposed)return;const old=active,store=old.store,wire=old.isOriginal?connection:undefined;old.syntheticController.close();old.dedicatedController.close();old.httpFixtureController.close();old.providerReviewController.close();active={...old,serial:++serial,syntheticController:gatedController(createSyntheticController({store,connection:wire})),dedicatedController:gatedController(createDedicatedController({store,connection:wire})),httpFixtureController:gatedController(createHttpFixtureController({store,connection:wire})),providerReviewController:gatedController(createProviderReview({store}))};notify()};

 let sessionController=gatedController(createNativeSessionController()),unmountSessions;const sessionListeners=new Set();

 const controllers=()=>[active.syntheticController,active.dedicatedController,active.httpFixtureController,active.providerReviewController,sessionController];
 const controllerFingerprint=()=>JSON.stringify(controllers().map(c=>c.getSnapshot()));
 const hasWork=()=>active.hasPendingDispatch()||active.store.getSnapshot().papers.some(p=>p.steps.some(s=>s.status==='running'))||controllers().some(c=>{const state=c.getSnapshot();return state.busy||(state.records||[]).some(r=>['preview_pending','confirm_pending','attempted','cancel_requested','unknown'].includes(r.status))});
 const switchSlot=async key=>{if(disposed||switching)throw Error('SLOT_SWITCH_BUSY');if(!manager.validateSlotKey(key)||!(key===originalKey||manager.listSlots().some(s=>s.slotKey===key)))throw Error('UNKNOWN_PROFILE_SLOT');if(key===active.key)return;if(!requestPlanningLeave(active.store.getStorageKey(),'slot'))throw Error('PLANNING_DRAFT_LEAVE_CANCELLED');if(hasWork())throw Error('SLOT_HAS_ACTIVE_WORK');
 const startSerial=active.serial,startRevision=active.store.getSnapshot().revision,startRaw=storage.getItem(active.key),startControllers=controllerFingerprint();switching=true;notify();let next;
 try{const raw=storage.getItem(key);if(key!==originalKey&&raw===null)throw Error('TARGET_SLOT_MISSING');if(raw!==null)await manager.validateStoredSlot(key,{isCurrent:()=>!disposed&&active.serial===startSerial});if(storage.getItem(key)!==raw)throw Error('TARGET_SLOT_CHANGED');next=make(key);const ready=await next.store.ready;if(disposed)throw Error('SLOT_SWITCH_CLOSED');if(active.serial!==startSerial||storage.getItem(key)!==raw)throw Error('TARGET_SLOT_CHANGED');if(!ready.ready)throw Error('TARGET_SLOT_VALIDATION_FAILED');
 if(active.store.getSnapshot().revision!==startRevision||storage.getItem(active.key)!==startRaw||hasWork()||controllerFingerprint()!==startControllers)throw Error('SOURCE_CHANGED_DURING_SWITCH');
 const old=active;active=next;next=undefined;closeRuntime(old);
 }finally{if(next)closeRuntime(next);switching=false;notify()}};
 const subscribeRuntime=f=>{runtimeListeners.add(f);return()=>runtimeListeners.delete(f)},getRuntime=()=>uiSnapshot;
 const subscribeSessions=f=>{sessionListeners.add(f);return()=>sessionListeners.delete(f)},getSessions=()=>sessionController;
 const canSaveRecovery=()=>!disposed&&!switching&&active.isOriginal&&!active.hasPendingDispatch()
   &&active.store.getSnapshot().persistence.saved;
 function restartRecoveredWorkspace(){
   const previous=active;
   active=make(originalKey);
   closeRuntime(previous);
   notify();
   void recovery.inspect();
 }
 const stopWhileSwitching=e=>{if(switching){e.preventDefault();e.stopPropagation()}};
 const BoundPanel=()=>{const view=React.useSyncExternalStore(subscribeRuntime,getRuntime,getRuntime),runtime=view.runtime,sessions=React.useSyncExternalStore(subscribeSessions,getSessions,getSessions),guided=PRISM_GUIDED_WORKSPACE;return h('fieldset',{'data-testid':'slot-global-gate',className:guided?'prism-shell':undefined,disabled:view.switching,'aria-busy':view.switching,style:{display:'flex',flexDirection:'column',flex:'1 1 auto',height:'100%',maxHeight:'100%',minWidth:0,minHeight:0,overflow:'auto',overscrollBehavior:'contain',boxSizing:'border-box',border:0,margin:0,padding:0,paddingTop:'var(--dsh-frame-top-clearance, 0px)',background:'var(--prism-bg,'+palette.bg+')',color:'var(--prism-ink,'+palette.text+')'},onClickCapture:stopWhileSwitching,onSubmitCapture:stopWhileSwitching,onChangeCapture:stopWhileSwitching,onInputCapture:stopWhileSwitching},view.switching?h('p',{role:'status'},'正在核验并切换档案，全部操作已暂停；原档案保持不变。'):null,runtime.isOriginal&&recovery?h(WorkspaceRecovery,{recovery,store:runtime.store,onRestore:restartRecoveredWorkspace,canSave:canSaveRecovery}):null,h(Panel,{key:runtime.serial,store:runtime.store,sessionController:sessions,syntheticController:runtime.syntheticController,dedicatedController:runtime.dedicatedController,httpFixtureController:runtime.httpFixtureController,providerReviewController:runtime.providerReviewController,hostWorkbench,isOriginal:runtime.isOriginal,readingDraftMemory}),h('details',{'data-testid':'workspace-profile-restore',className:guided?'prism-workspace prism-archive-disclosure prism-support':undefined,style:guided?undefined:{padding:'8px 24px 16px',margin:'0 auto',width:'min(100%,75rem)',boxSizing:'border-box'}},h('summary',null,'基础档案备份与恢复'),h(RestorePanel,{manager,locksAvailable,runtime,onSwitch:switchSlot,guided})),guided?h('div',{'data-prism-portal':''}):null)};
 ctx.effect(function*(){yield async()=>{disposed=true;globalThis.window?.removeEventListener?.('beforeunload',keepReadingDrafts);hostWorkbench.close();manager.destroy();closeRuntime(active);runtimeListeners.clear();await unmountConnection?.dispose();sessionController.close();sessionListeners.clear();await unmountSessions?.()};yield ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:PANEL},BoundPanel));yield ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL,order:15,label:()=> 'PRISM 工作台'},Icon));});
}};}
// This is a PRISM trusted-code composition seam, not a browser setting or authentication API.
// The supplied resolver must come from a reviewed Host-owned project registry deployment.
// Default manifest installation never invokes it and never requests the connection service.
return Object.assign(createWorkbenchPlugin(),{createWithTrustedPlanningHost(options){
 if(!options||typeof options!=='object'||Reflect.ownKeys(options).length!==1||typeof Object.getOwnPropertyDescriptor(options,'resolveDocument')?.value!=='function')throw Error('TRUSTED_HOST_RESOLVER_REQUIRED');
 return createWorkbenchPlugin(options.resolveDocument);
}});
