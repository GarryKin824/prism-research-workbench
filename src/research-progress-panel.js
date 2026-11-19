// A read-only index over verified local records. Existing editors remain mounted.
// There are no execution, write, export, network, or automatic navigation actions.
function ResearchProgressPanel({store,projectId,scopeReady=false,scopeToken=null,active=false,selectedId,onNavigate,guided=false}){
 const ctl=React.useMemo(()=>createResearchProgressController({store,storage:localStorage}),[store]);
 const binding=JSON.stringify([ctl.namespace,projectId,scopeReady,scopeToken,active]);
 const latest=React.useRef(null);latest.current={ctl,binding};
 const [reload,setReload]=React.useState(0),[info,setInfo]=React.useState(null),[phase,setPhase]=React.useState(null);
 const [openedPaper,setOpenedPaper]=React.useState(null),[openedProject,setOpenedProject]=React.useState(null);
 const [questionOpen,setQuestionOpen]=React.useState(false);
 const [query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all');
 const current=()=>latest.current.ctl===ctl&&latest.current.binding===binding;
 function invalidate(){ctl.cancel();setInfo(null);setPhase({binding,status:'changed'})}
 React.useEffect(()=>{
  let live=true;setInfo(null);setPhase(null);
  if(!active||!scopeReady||typeof projectId!=='string')return;
  const valid=()=>live&&latest.current.ctl===ctl&&latest.current.binding===binding;
  setPhase({binding,status:'reading'});
  ctl.read({projectId,scopeReady},valid).then(view=>{if(valid()){view.stable();setInfo({ctl,binding,view});setPhase(null)}}).catch(error=>{if(valid()){setInfo(null);setPhase({binding,status:error?.message==='PROGRESS_READ_LIMIT'?'limited':'unavailable'})}});
  return()=>{live=false;ctl.cancel()};
 },[ctl,binding,reload]);
 React.useEffect(()=>{
  if(!active)return;
  const changed=e=>{if(e.key===null||e.key===ctl.namespace||typeof e.key==='string'&&e.key.startsWith(ctl.namespace+':'))invalidate()};
  const target=typeof window!=='undefined'?window:null;target?.addEventListener?.('storage',changed);
  // Only inexpensive source identity/raw comparisons. Never re-project or hash on a timer.
  let timer;const poll=()=>{if(info?.ctl===ctl&&info.binding===binding){try{info.view.checkCurrent()}catch{invalidate();return}}timer=setTimeout(poll,1000)};
  timer=setTimeout(poll,1000);
  return()=>{target?.removeEventListener?.('storage',changed);clearTimeout(timer)};
 },[ctl,binding,info,active]);
 // Project/store/tab changes hide rows before effects run. Clicks re-check them.
 let view=null,stale=false;
 if(active&&scopeReady&&info?.ctl===ctl&&info.binding===binding)try{info.view.checkCurrent();view=info.view}catch{stale=true}
 const rows=view?.rows||[],busy=phase?.binding===binding&&phase.status==='reading';
 const sourceLabels={same:'论文与正文快照一致',changed:'来源已变化',unavailable:'来源不可用',inconsistent:'来源哈希不一致',missing:'未保存来源',absent:'未保存来源','paper-missing':'论文来源不可用'};
 const stateLabels={'plan-only':'仅规划，未有合成产物',ready:'下一节点待合成演示','human-gate':'等待人工处理',paused:'上次记录已暂停','running-record':'上次记录为运行中，未确认仍在运行',complete:'已满足配置的合成完成条件，不代表研究完成'};
 const statusLabels={'pending-human-review':'等待人工审核的交接记录','returned-for-rework':'人工已退回修改的交接记录',unverified:'未验证',needs_changes:'需修改',comment:'人工备注',approved:'人工准许后续操作',rejected:'人工未准许',pass:'合成审核通过',revise:'合成审核需返修',passed:'合成审核通过',needs_revision:'合成审核需返修',failed:'合成审核未通过',pending:'待处理'};
 const humanStatusLabels={'pending-human-review':'等待人工审核',needs_revision:'人工要求返修',needs_changes:'人工要求修改',unverified:'人工记录，未验证',comment:'人工备注'};
 const count=n=>Number.isSafeInteger(n)?String(n):'数量未知';
 const source=s=>sourceLabels[s]||'当前来源未核验';
 const referenceSource=s=>({same:'固定引用与当前绑定一致',changed:'固定引用已变化',unavailable:'固定引用当前不可用',none:'无固定引用'})[s]||'固定引用未核验';
 const issueLabels={plan:'项目规划',planning:'项目规划',instances:'项目实例',workflows:'共享论文流程',workflow:'共享论文流程',findings:'人工结论日志','manual-findings':'人工结论日志','manual-journal':'人工结论日志',queue:'项目规划队列',sharedWorkflow:'共享论文流程',basic:'旧三步演示',instanceReviews:'实例人工备注',nodeReviews:'共享论文人工审核',evidence:'证据标注',legacyEvidence:'旧版证据表',reviews:'人工审核记录','instance-reviews':'实例人工备注','node-reviews':'共享论文人工审核',library:'项目关联',papers:'论文档案'};
 const unknownWorkflow=row=>row.sources.basic==='unavailable'||row.sources.sharedWorkflow==='unavailable'||!!projectId&&row.sources.instances==='unavailable';
 const hasChanged=row=>row.plan?.sourceStatus==='changed'||row.workflows.some(w=>w.sourceStatus==='changed'||w.projectRevisionStatus==='changed')||row.findings.changedCount>0||row.reviews.changedCount>0||row.evidence?.items.some(e=>['changed','inconsistent'].includes(e.sourceStatus))||row.evidence?.legacy.sourceStatus==='changed'||row.evidence?.staleClaims>0||['changed','unavailable'].includes(row.evidence?.legacy.fixedReferenceStatus);
 const matches=row=>filter==='all'||filter==='manual'&&row.findings.count>0||filter==='synthetic'&&row.workflows.some(w=>w.syntheticArtifacts>0)||filter==='plan-only'&&!unknownWorkflow(row)&&row.workflows.every(w=>w.state==='plan-only')||filter==='human-gate'&&row.workflows.some(w=>w.state==='human-gate')||filter==='changed'&&hasChanged(row)||filter==='unavailable'&&(row.issues.length>0||row.findings.status==='unavailable'||row.reviews.status==='unavailable'||row.evidence?.status==='unavailable'||row.evidence?.legacy.status==='unavailable');
 const terms=query.normalize('NFC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean),tooManyTerms=terms.length>32;
 let searchResult=null;try{if(view&&!tooManyTerms)searchResult=view.searchSaved(query)}catch{view=null;stale=true}
 const matchedIds=new Set(searchResult?.matches.map(m=>m.paperId)||[]);
 const filtered=tooManyTerms?[]:rows.filter(row=>matchedIds.has(row.paperId)&&matches(row));
 function navigate(row,area){
  try{if(!view||!current()||!active||!scopeReady||!['library','planning','execution'].includes(area)||!view.rows.includes(row))return;view.stable();onNavigate?.({paperId:row.paperId,area})}catch{invalidate()}
 }
 const small={fontSize:12,color:palette.muted},wrap={whiteSpace:'pre-wrap',overflowWrap:'anywhere'};
 const badge=(text,key)=>h('span',{key,style:{fontSize:12,border:'1px solid '+palette.line,borderRadius:20,padding:'2px 9px'}},text);
 function navigateNode(row,w,n){
  try{if(!view||!current()||!active||!scopeReady||!['shared-workflow','instance'].includes(w.kind)||w.sourceStatus!=='same')return;view.stable();if(w.kind==='instance'){if(w.projectRevisionStatus!=='same')return;onNavigate?.({instanceTarget:{namespace:ctl.namespace,projectId,paperId:row.paperId,instanceId:w.id,workflowSha256:w.workflowSha256,graphVersion:w.graphVersion,graphSha256:w.graphSha256,nodeId:n.id},stable:view.stable});return;}onNavigate?.({paperId:row.paperId,area:'planning',nodeId:n.id,focusPrompt:true,graphSha256:w.graphSha256,graphVersion:w.graphVersion});}catch{invalidate()}
 }
 function workflowCard(w,row){return h('section',{key:w.id,'data-progress-workflow':w.id,style:{borderTop:'1px solid '+palette.line,paddingTop:10,marginTop:10}},
  h('strong',null,w.kind==='instance'?'项目研究实例':w.kind==='shared-basic'?'共享论文旧三步演示':'共享论文流程'),h('span',{style:small},' · ',w.scope==='project'?'项目归属':'共享论文，非项目专属',w.graphVersion?' · 图 v'+w.graphVersion:''),
  w.kind==='instance'?h('p',{'data-testid':'progress-project-revision'},w.projectRevisionStatus==='changed'?'当前项目规划已变化：此为历史规划实例，不表示适用于当前项目目标。':'实例绑定的项目规划版本一致；不表示科学结果已验证。'):null,
  h('p',null,stateLabels[w.state]||'本地状态不可用','；',w.currentStep?'当前记录节点：'+w.currentStep.name+' ['+w.currentStep.id+']':'当前记录没有下一节点','。'),
  h('p',null,'当前图有效合成节点 ',w.completedNodes,' / ',w.totalNodes,'；合成产物 ',w.syntheticArtifacts,'；历史产物 ',w.historicalArtifacts,'。',source(w.sourceStatus),'。'),
  h('details',{'data-testid':'progress-step-matrix'},h('summary',null,'逐步状态与依赖（',w.nodes.length,' 步）'),
   h('p',{style:small},'下列为已保存的合成流程记录，不是实时执行或真实研究完成。Prompt 仅显示版本；共享流程可点击节点旁的“定位此步骤 Prompt”；仅定位，不保存或执行。项目实例须在对应实例编辑器中修改，不会随共享流程自动更新。'),
   h('ol',null,w.nodes.map(n=>h('li',{key:n.id,'data-progress-node':n.id,style:{marginBottom:10}},
    h('strong',null,n.name,' [',n.id,']'),h('span',null,' · ',n.kind==='review'?'审核':'工作',' · Prompt v',n.promptVersion,' · ',({'completed':'当前版本合成完成','running-record':'记录为运行中，未确认仍在运行','needs-revision':'合成记录需返修','blocked':'等待前置步骤','interrupted':'上次执行中断','cancelled':'上次执行已取消','failed':'上次合成执行失败','paused':'流程记录已暂停','plan-only':'仅规划','human-gate':'等待人工处理','ready':'待合成演示'})[n.status]||'未知状态'),
    h('p',{style:small},'依赖：',n.dependsOn.join('、')||'无','；未满足：',n.unmetDependencies.join('、')||'无',n.reviewTarget?'；审核对象：'+n.reviewTarget:'','；历史合成产物：',n.historicalArtifacts),
    ['shared-workflow','instance'].includes(w.kind)?h('button',{type:'button','data-progress-node-open':n.id,disabled:w.sourceStatus!=='same'||w.kind==='instance'&&w.projectRevisionStatus!=='same',onClick:()=>navigateNode(row,w,n)},'定位此步骤 Prompt'):null
   )))
  ),
  w.omittedSyntheticReviews?h('p',{style:small},'仅展示最近 20 条合成审核，另有 ',w.omittedSyntheticReviews,' 条历史判定。'):null,
  w.syntheticReviews.length?h('div',{'data-testid':'progress-synthetic-reviews'},h('strong',null,'合成审核判定（不是人工审核）'),h('ul',null,w.syntheticReviews.map((r,i)=>h('li',{key:i},r.nodeId,'：',statusLabels[r.verdict]||'合成判定未识别',r.current?' · 当前版本':' · 历史版本')))):null,
  h('details',null,h('summary',null,'流程引用与版本'),h('p',{style:wrap},'流程 ID：',w.id,'；图 SHA-256：',w.graphSha256||'不可用','；流程 SHA-256：',w.workflowSha256||'不可用'))
 )}
 function findingCard(f){return h('li',{key:f.id,'data-progress-finding':f.id,style:{paddingBottom:12}},
  h('p',{style:wrap},f.conclusion),f.conclusionTruncated?h('p',{style:small},'此处仅显示前 1000 字符，完整结论可在下方已保存人工结论总览查看。'):null,h('p',{style:small},'人工保存 · ai_unverified · 未验证；',f.stepName,' · Prompt v',f.promptVersion,' · ',f.time,'。',source(f.sourceStatus),'；原答复与准备原件未随附，未核验语义或科学真实性。'),
  h('details',null,h('summary',null,'结论引用与来源'),h('p',{style:wrap},'来源项目：',f.projectId||'共享基础库','；记录：',f.recordId,'；答复：',f.replyId,'。'),h('p',{style:wrap},'答复 SHA-256：',f.replySha256,'；准备 SHA-256：',f.preparationSha256,'；记录 SHA-256：',f.recordSha256),h('p',{style:wrap},'记录正文 SHA-256：',f.recordedDocumentSha256||'未保存','；记录 Prompt SHA-256：',f.recordedPromptSha256||'未保存','；记录档案 SHA-256：',f.recordedSnapshotSha256||'未保存'))
 )}
 function reviewCard(r){return h('li',{key:r.id,'data-progress-review':r.id,style:{paddingBottom:10}},
  h('strong',null,r.kind==='instance-note'?'人工对合成产物的备注':'共享论文人工交接审核'),h('p',{style:small},r.scope==='project'?'项目归属':'共享论文，非项目专属',' · ',r.returned?'原交接已有后续退回记录':humanStatusLabels[r.status]||'人工记录',' · ',r.current?'当前绑定':'历史绑定',' · ',source(r.sourceStatus)),r.returned?h('p',{style:small},'此交接已有后续退回记录，不表示仍在等待审核。'):null,h('p',{style:wrap},r.note),r.noteTruncated?h('p',{style:small},'此处仅显示前 1000 字符，完整备注请在原记录工具查看。'):null,h('p',{style:small},'人工记录不等于合成审核判定，也不证明结论有效。'),h('details',null,h('summary',null,'审核引用'),h('p',{style:wrap},'记录 SHA-256：',r.recordSha256||'不可用',r.instanceId?'；实例：'+r.instanceId:'',r.nodeId?'；节点：'+r.nodeId:''))
 )}
 return h('section',{'data-testid':'research-progress','aria-label':'项目与论文进展总览',style:guided?undefined:{...box,marginBottom:18}},
  h('h3',{style:{marginTop:0}},guided?'研究进度':'项目与论文进展 · 只读总览'),
  guided?h(React.Fragment,null,h('p',{className:'prism-muted'},!scopeReady?'正在核验范围。':projectId?'当前项目':'共享论文库'),guidedHelp('范围与状态说明',h(React.Fragment,null,h('p',{'data-testid':'research-progress-scope'},!scopeReady?'当前范围尚未核验，暂不显示论文进展。':projectId?'当前项目：只展示已确认关联的论文；结论按保存时的来源项目筛选。共享论文流程与共享人工审核单独标明，不视为项目成果。':'共享基础库：仅展示共享论文流程与共享来源的人工记录。项目实例与项目来源结论需选择对应项目；本区计数不等于下方跨来源人工结论总量。'),
  h('p',null,'真实研究执行未接通。下方区分人工保存、仅规划与合成演示；节点计数不是科学研究完成率，“运行中”仅为上次保存的状态。来源一致仅指论文与正文快照，不证明当前 Prompt、流程适用性或科学真实性。')))):h(React.Fragment,null,h('p',{'data-testid':'research-progress-scope'},!scopeReady?'当前范围尚未核验，暂不显示论文进展。':projectId?'当前项目：只展示已确认关联的论文；结论按保存时的来源项目筛选。共享论文流程与共享人工审核单独标明，不视为项目成果。':'共享基础库：仅展示共享论文流程与共享来源的人工记录。项目实例与项目来源结论需选择对应项目；本区计数不等于下方跨来源人工结论总量。'),
  h('p',null,'真实研究执行未接通。下方区分人工保存、仅规划与合成演示；节点计数不是科学研究完成率，“运行中”仅为上次保存的状态。来源一致仅指论文与正文快照，不证明当前 Prompt、流程适用性或科学真实性。')),
 h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}},
   h('label',null,'检索论文标题或已保存结论',h('input',{type:'search','aria-label':'进展论文标题',maxLength:200,value:query,style:field,onChange:e=>setQuery(e.target.value)})),
   h('label',null,'本地记录筛选',h('select',{'aria-label':'进展记录状态',value:filter,style:field,onChange:e=>setFilter(e.target.value)},[['all','全部论文'],['plan-only','尚无合成产物'],['manual','有人工保存结论'],['synthetic','有合成演示产物'],['human-gate','等待人工处理'],['changed','来源已变化'],['unavailable','有不可用来源']].map(([value,label])=>h('option',{key:value,value},label))))),
  h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},h('button',{type:'button',style:secondary,disabled:busy||!active||!scopeReady,onClick:()=>{ctl.cancel();setInfo(null);setPhase(null);setReload(x=>x+1)}},'刷新进展总览'),h('button',{type:'button',style:secondary,disabled:!query&&filter==='all',onClick:()=>{setQuery('');setFilter('all')}},'清空进展筛选'),h('button',{type:'button',disabled:!view||!projectId,onClick:()=>setQuestionOpen(x=>!x)},'按研究问题整理结论与证据')),
  !guided?h('p',{style:small},'检索当前范围的论文标题或完整已保存人工结论（不是仅搜卡片摘要）；多个词须同在一个标题或一条结论中。人工结论未经科学验证；不检索正文、未保存草稿或其他项目。来源变化后需刷新。检索不联网、不保存、不改变选择。'):null,
  searchResult&&searchResult.findingsAvailable===false?h('p',{role:'alert'},'人工结论来源不可用：当前只能检索标题，不能据无结果判断没有相关结论。'):null,
  query.trim()&&searchResult?h('p',{'data-testid':'research-progress-search-count',style:small},'匹配 '+filtered.length+' 篇论文；其中 '+searchResult.matches.filter(m=>m.conclusionMatches>0&&filtered.some(r=>r.paperId===m.paperId)).length+' 篇含结论命中。可打开论文结果查看完整已保存记录。'):null,
  questionOpen&&view?h(ResearchQuestionReviewPanel,{key:binding,view}):null,
  busy?h('p',{role:'status'},'正在读取并校验本地进展…'):null,
  stale||phase?.binding===binding&&['changed','unavailable'].includes(phase.status)?h('p',{'data-testid':'research-progress-error',role:'alert'},'进展暂不可显示。资料或范围可能已变化，或来源无法校验；请核对后刷新。未覆盖任何记录。'):null,
  phase?.binding===binding&&phase.status==='limited'?h('p',{'data-testid':'research-progress-limit',role:'alert'},'本地来源总量超过本次只读读取上限，未生成进展总览，也未删减或改写任何记录。可在原记录工具按论文查阅。'):null,
  tooManyTerms?h('p',{role:'alert'},'请将检索词减少到 32 个以内。'):null,
  view?.issues.length?h('p',{'data-testid':'research-progress-partial',role:'alert'},'部分来源不可用：',[...new Set(view.issues.map(i=>issueLabels[i.source]||'本地记录'))].join('、'),'。这些来源未计入，空缺不代表没有记录；其余已校验记录仍可查阅。'):null,
  view?.summary.excludedUnlinkedInstances>0?h('p',{'data-testid':'research-progress-excluded',style:small},'另有 ',view.summary.excludedUnlinkedInstances,' 个当前项目实例的论文不在已确认关联范围，已排除，未自动纳入。'):null,
  view?.persistence?.saved===false?h('p',{'data-testid':'research-progress-memory',role:'alert'},'基础论文档案尚未可靠保存：本区含当前页面内存观察，刷新后可能不同或丢失。此只读总览不会保存或重试。'):null,
  view?h('p',{'data-testid':'research-progress-count',role:'status'},'显示 ',filtered.length,' / ',rows.length,' 篇；人工保存结论 ',count(view.summary.manualFindings),' 条（未验证）；合成演示产物 ',count(view.summary.syntheticArtifacts),' 个。'):null,
  view&&!rows.length?h('p',{'data-testid':'research-progress-empty'},projectId?'当前项目没有已确认关联的论文。':'当前基础库没有论文档案。'):view&&!filtered.length?h('p',{'data-testid':'research-progress-empty'},'没有符合当前标题与记录筛选的论文。'):null,
  projectId&&view&&typeof ProjectResultsPanel==='function'?h('button',{'data-testid':'progress-open-project-results',onClick:()=>{try{view.stable();setOpenedProject({view,binding})}catch{invalidate()}}},'项目多篇结果与队列'):null,
  openedProject&&view===openedProject.view&&binding===openedProject.binding&&typeof ProjectResultsPanel==='function'?h(ProjectResultsPanel,{store,projectId,key:binding+'|'+selectedId+'|'+(openedPaper?.paperId||''),view,binding:binding+'|'+selectedId+'|'+(openedPaper?.paperId||''),onClose:()=>setOpenedProject(null),onOpenPaper:id=>{view.stable();if(!view.rows.some(r=>r.paperId===id))return false;setOpenedPaper({view,paperId:id,binding});return true}}):null,
  h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,360px),1fr))',gap:14}},filtered.map(row=>h('article',{key:binding+'|'+row.paperId,'data-progress-paper':row.paperId,style:{border:'1px solid '+palette.line,borderRadius:12,padding:16,minWidth:0}},
   h('h4',{style:{margin:'0 0 10px',fontSize:17,overflowWrap:'anywhere'}},row.title),h('div',{style:{display:'flex',flexWrap:'wrap',gap:6}},badge(row.scope==='project'?'项目已确认关联':'共享论文','scope'),row.paperId===selectedId?badge('当前论文','selected'):null,badge('真实执行未接通','real')),
   h('p',null,row.plan.status==='planned'?'项目队列已规划（不表示执行）':row.plan.status==='unavailable'?'项目队列规划不可用':projectId?'项目队列尚无此论文的规划记录':'共享视图不汇总项目队列规划',row.plan.sourceStatus?' · '+source(row.plan.sourceStatus):''),
   h('p',null,'人工保存结论：',row.findings.status==='unavailable'?'不可用':row.findings.count+' 条未验证记录','；人工审核/备注：',row.reviews.status==='unavailable'?'不可用':count(row.reviews.count)+' 条','。'),
   row.issues.length?h('p',{role:'status',style:small},'此论文有部分来源不可用，请查看上方提示；不按零条有效成果解释。'):null,
   row.workflows.length?row.workflows.map(w=>workflowCard(w,row)):h('p',null,'没有可用的自定义流程或实例记录。现有规划不表示研究已执行。'),
   h('details',{'data-testid':'progress-manual-findings'},h('summary',null,'人工保存结论与证据引用（'+count(row.findings.count)+'）'),row.findings.items.length?h('ul',{style:{paddingLeft:20}},row.findings.items.map(findingCard)):h('p',null,row.findings.status==='unavailable'?'结论日志不可用，无法确认数量。':'此范围内没有已保存结论；其他项目或共享范围的结论不计入。')),
   row.findings.omitted?h('p',{style:small},'此处仅显示最近 20 条人工结论，另有 ',row.findings.omitted,' 条可在下方已保存人工结论总览查阅；上方总数和来源筛选仍涵盖完整记录。'):null,
   row.evidence?h('details',{'data-testid':'progress-evidence'},h('summary',null,'共享论文证据标注（未验证）'),h('p',{style:small},'完整定位信息与引用原句请在本页下方“研究成果证据地图”查看。该工具仍为共享论文范围，不受当前项目筛选。'),h('p',null,'人工标注 ',count(row.evidence.claimCount),' 条；来源定位 ',count(row.evidence.locatorCount),' 处；来源已变化 ',count(row.evidence.staleClaims),' 条。共享论文标注，不是本项目已验证证据。'),row.evidence.status==='unavailable'?h('p',null,'证据标注来源不可用，无法确认数量。'):null,h('ul',null,row.evidence.items.map(e=>h('li',{key:e.claimId},h('p',null,'标注 ',e.claimId,' · ',source(e.sourceStatus),' · 定位 ',e.locatorCount,' · 合成引用 ',e.syntheticReferences,' · 人工审核引用 ',e.humanReviewReferences,' · 固定引用状态：',referenceSource(e.fixedReferenceStatus)),h('p',{style:wrap},'版本 SHA-256：',e.revisionSha256),e.omittedFixedReferences?h('p',{style:small},'固定引用共 ',e.fixedReferenceCount,' 条；此处显示前 20 条，另有 ',e.omittedFixedReferences,' 条请在证据地图查看。'):null,e.fixedReferences?.length?h('ul',null,e.fixedReferences.map((ref,i)=>h('li',{key:i,style:wrap},ref.kind==='synthetic-run'?'合成演示引用':'人工审核引用',' · ',referenceSource(ref.sourceStatus),' · ',ref.recordId,' · SHA-256：',ref.sha256))):null))),h('p',{style:small},'旧版证据表独立记录：',row.evidence.legacy.status==='unavailable'?'不可用':row.evidence.legacy.present?'已保存；定位 '+count(row.evidence.legacy.locatorCount)+' 处；'+source(row.evidence.legacy.sourceStatus):'未保存','。旧版未合并计入上方标注数量。')):null,
   row.evidence?.omitted?h('p',{style:small},'此处仅显示前 20 条证据标注，另有 ',row.evidence.omitted,' 条请在下方研究成果证据地图查看；上方计数和来源筛选仍涵盖完整记录。'):null,
   h('details',{'data-testid':'progress-human-reviews'},h('summary',null,'人工审核与备注（'+count(row.reviews.count)+'）'),row.reviews.items.length?h('ul',{style:{paddingLeft:20}},row.reviews.items.map(reviewCard)):h('p',null,row.reviews.status==='unavailable'?'人工审核来源不可用。':'此范围内没有人工审核或备注；其他范围记录不计入。')),
   row.reviews.omitted?h('p',{style:small},'仅展示最近 50 条人工审核或备注，另有 ',row.reviews.omitted,' 条可在原记录工具查看。'):null,
   h('button',{'data-testid':'progress-open-paper-results',onClick:()=>{try{view.stable();setOpenedPaper({view,paperId:row.paperId,binding})}catch{invalidate()}}},'查阅本论文完整结果'),h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}},[['library','查看论文档案'],['planning','查看论文流程'],['execution','查看人工交接']].map(([area,label])=>h('button',{key:area,type:'button',style:secondary,'data-progress-navigate':area,onClick:()=>navigate(row,area)},label)))
  ))),openedPaper&&view===openedPaper.view&&binding===openedPaper.binding&&typeof PaperResultsPanel==='function'?h(PaperResultsPanel,{store,projectId,key:binding+'|'+openedPaper.paperId+'|'+selectedId,view,paperId:openedPaper.paperId,binding:binding+'|'+selectedId,onClose:()=>setOpenedPaper(null)}):null
 );
}

function ResearchQuestionReviewPanel({view}){
 const owner=React.useRef(view);
 const [importRaw,setImportRaw]=React.useState(''),[imported,setImported]=React.useState(null),[restoreConsent,setRestoreConsent]=React.useState(false);
 const [question,setQuestion]=React.useState(''),[query,setQuery]=React.useState(''),[selected,setSelected]=React.useState({}),[preview,setPreview]=React.useState(null),[consent,setConsent]=React.useState(false),[message,setMessage]=React.useState('');
 let rows=[],error=false;try{rows=view.questionCatalog()}catch{error=true}
 const update=fn=>{setPreview(null);setConsent(false);setRestoreConsent(false);setMessage('');fn()};
 const terms=query.normalize('NFC').toLowerCase().trim().split(/\s+/u).filter(Boolean);
 const found=rows.filter(r=>terms.every(t=>(r.conclusion+' '+r.currentTitle).normalize('NFC').toLowerCase().includes(t)));
 const key=r=>JSON.stringify([r.paperId,r.id]);
 function prepare(){try{const p=view.prepareQuestion({question,selections:rows.filter(r=>selected[key(r)]).map(r=>({paperId:r.paperId,findingId:r.id,recordSha256:r.recordSha256,relation:selected[key(r)]}))});setPreview(p);setConsent(false);setMessage('请检查完整报告及来源状态后再下载。')}catch{setPreview(null);setConsent(false);setMessage('无法生成：需填写问题并选择1至20条当前范围结论；来源变化或报告过大时请刷新/减少选择。')}}
 function download(){if(!preview||!consent)return;setConsent(false);try{const raw=view.exportQuestion(preview,{explicit:true});const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));try{const a=document.createElement('a');a.href=url;a.download='PRISM-research-question-review-'+Date.now()+'.json';a.click();setMessage('已请求浏览器下载，未验证磁盘保存。没有写入项目或形成批准。')}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}}catch{setPreview(null);setMessage('来源或预览已失效，未下载；请重新生成。')}}
 if(error||owner.current!==view)return h('p',{role:'alert'},'对照来源或范围已变化，旧预览已隐藏；请关闭本对照面板后重新打开。');
 return h('section',{'data-testid':'question-review-panel'},h('h3',null,'按研究问题整理已保存结论与证据'),h('p',null,'分类由你指定，不自动判定一致或矛盾。问题与分类仅在当前面板暂存，切换/关闭会丢失，请下载保留。报告只含所选结论及精确关联证据，不导出整篇论文。'),error?h('p',{role:'alert'},'当前项目结论不可用，请刷新后再试。'):null,
 h('details',null,h('summary',null,'只读重开已下载版本 / 恢复问题与分类'),h('p',null,'粘贴先前 JSON，只读查看不会写入项目。恢复会替换当前面板未保存的问题与分类，请先下载现有版本。导入文本未经真实性验证；不会恢复旧证据或执行权限。'),h('textarea',{'aria-label':'历史问题对照 JSON',value:importRaw,onChange:e=>{setImportRaw(e.target.value);setImported(null);setRestoreConsent(false)}}),h('button',{type:'button',onClick:()=>{setImported(null);setRestoreConsent(false);try{setImported(view.inspectQuestion(importRaw))}catch{setMessage('文件无效、超限或不属于当前项目，未恢复。')}}},'只读检查历史版本'),imported?h('div',null,h('p',null,imported.warning,' 当前缺失/变更结论：',imported.missing),h('pre',{'data-testid':'question-history',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},imported.raw),h('label',null,h('input',{type:'checkbox',checked:restoreConsent,onChange:e=>setRestoreConsent(e.target.checked)}),'我确认替换当前面板草稿，并重新核对当前来源'),h('button',{type:'button',disabled:!restoreConsent||!imported.restorable,onClick:()=>{try{const r=view.restoreQuestion(imported,{explicit:true});setQuestion(r.question);setSelected(Object.fromEntries(r.selections.map(x=>[JSON.stringify([x.paperId,x.findingId]),x.relation])));setPreview(r.preview);setConsent(false);setImported(null);setRestoreConsent(false);setMessage('已恢复到面板草稿，当前证据已重新读取。请复核并下载新的独立版本；未写入项目。')}catch{setImported(null);setRestoreConsent(false);setMessage('来源或历史预览失效，未恢复。')}}},'明确恢复为当前草稿')):null),
 h('label',null,'研究问题',h('textarea',{'aria-label':'对照研究问题',value:question,maxLength:2000,onChange:e=>update(()=>setQuestion(e.target.value))})),
 h('label',null,'筛选待选结论',h('input',{'aria-label':'对照结论筛选',value:query,maxLength:200,onChange:e=>setQuery(e.target.value)})),h('p',null,'符合筛选 '+found.length+' 条，已选 '+Object.keys(selected).length+' 条（最多20条）；筛选不清空已选。'),
 found.length>100?h('p',null,'这里只列前100条，请输入关键词缩小范围；未自动选取隐藏结论。'):null,
 found.slice(0,100).map(r=>h('div',{key:key(r)},h('p',null,r.currentTitle||r.recordedTitle,' · 来源：',r.sourceStatus,' · 未核验'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},r.conclusion),h('select',{'aria-label':'结论分类 '+r.id,value:selected[key(r)]||'',onChange:e=>update(()=>setSelected(old=>{const next={...old};if(e.target.value)next[key(r)]=e.target.value;else delete next[key(r)];return next}))},[['','不选入'],['unclassified','选入：待判断'],['supports','人工认为：与问题一致'],['challenges','人工认为：可能矛盾'],['context','人工认为：背景/限制']].map(([v,l])=>h('option',{key:v,value:v},l))))),
 h('button',{type:'button',disabled:error,onClick:prepare},'预览所选结论与精确证据'),message?h('p',{role:'status'},message):null,
 preview?h('div',null,h('p',null,'完整报告预览（人工分类未经核验，保留来源变化及证据撤回历史）'),h('pre',{'data-testid':'question-review-preview',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},preview.raw),h('label',null,h('input',{type:'checkbox',checked:consent,onChange:e=>setConsent(e.target.checked)}),'我已检查问题、所选结论、来源和人工分类'),h('button',{type:'button',disabled:!consent,onClick:download},'下载本次问题对照 JSON')):null);
}
