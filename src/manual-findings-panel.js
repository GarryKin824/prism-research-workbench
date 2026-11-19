// Export is a separate, read-only operation. The preview and consent never
// survive a changed selection, filter, view or source snapshot.
function ManualFindingsReport({view,findings,filter,binding=''}){
 const context=JSON.stringify([binding,filter,findings.map(r=>[r.id,r.recordSha256])]);
 const latest=React.useRef(null);latest.current={view,context};
 const generation=React.useRef(0),alive=React.useRef(true),consentRef=React.useRef(null);
 const [format,setFormat]=React.useState('markdown'),[preview,setPreview]=React.useState(null),[consent,setConsent]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
 React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;consentRef.current=null}},[]);
 function clear(){generation.current++;consentRef.current=null;view.invalidateReport?.();setConsent(false);setPreview(null);setBusy(false);setError('');setNotice('')}
 React.useEffect(()=>{clear()},[view,context]);
 function current(operation){return alive.current&&latest.current.view===view&&latest.current.context===context&&generation.current===operation}
 function stable(){(view.checkCurrent||view.stable)()}
 let usable=false,shown=null;
 try{stable();usable=findings.length>0;if(preview&&preview.view===view&&preview.context===context&&preview.format===format&&current(preview.operation)){view.validateReport(preview.report,()=>current(preview.operation));shown=preview}}catch{generation.current++;consentRef.current=null}
 async function prepare(){
  clear();if(!findings.length)return;
  const operation=++generation.current;setBusy(true);
  try{
   stable();const report=await view.prepareReport({findings:findings.map(r=>({findingId:r.id,expectedRecordSha256:r.recordSha256})),format,filter:{...filter}},()=>current(operation));
   if(!current(operation))return;
   stable();view.validateReport(report,()=>current(operation));setPreview({report,view,context,format,operation});
  }catch(e){if(current(operation)){setPreview(null);const messages={FINDINGS_REPORT_TOO_LARGE:'报告超过 16 MB，请缩小筛选范围后重试。未截断任何内容。',FINDINGS_REPORT_INVALID:'记录文本或字段不符合报告限制，未生成文件，也未截断或改动记录。',FINDINGS_REPORT_EMPTY:'当前筛选没有可导出的结论。'};setError(messages[e?.message]||'无法生成报告，资料或范围可能已变化。请刷新结论后重新预览。')}}finally{if(current(operation))setBusy(false)}
 }
 function download(){
  if(!shown||consentRef.current!==shown.report)return;
  let url=null,anchor=null;
  try{
   const report=view.validateReport(shown.report,()=>current(shown.operation)&&consentRef.current===shown.report);
   if(report!==shown.report)throw Error('REPORT_CHANGED');
   // Names are fixed by format, never derived from user content or metadata.
   const filename=report.format==='csv'?'manual-findings-report.csv':'manual-findings-report.md';
   const blob=new Blob([report.text],{type:report.format==='csv'?'text/csv;charset=utf-8':'text/markdown;charset=utf-8'});
   view.validateReport(report,()=>current(shown.operation)&&consentRef.current===report);
   url=URL.createObjectURL(blob);anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();
   consentRef.current=null;setConsent(false);setNotice('已请求浏览器下载。请自行确认下载结果；未改动研究记录。');
  }catch{clear();setError('下载未完成，资料或范围可能已变化。请重新预览并确认。')}finally{anchor?.remove();if(url)URL.revokeObjectURL(url)}
 }
 return h('section',{'data-testid':'manual-findings-report',style:{borderTop:'1px solid '+palette.line,paddingTop:12}},
  h('h4',null,'导出当前筛选的人工结论'),
  h('p',null,'仅导出当前范围内匹配筛选的已保存结论及引用元数据。全部未验证；原件不随附，报告不表示已核对原件，不接收、不评分，不改变论文或流程选择。'),
  h('label',null,'报告格式',h('select',{'aria-label':'人工结论报告格式',value:format,onChange:e=>{clear();setFormat(e.target.value)}},h('option',{value:'markdown'},'Markdown'),h('option',{value:'csv'},'Excel CSV'))),
  h('button',{type:'button',disabled:!usable||busy,onClick:prepare},'预览当前筛选报告'),
  h('button',{type:'button',onClick:clear},'清除或取消报告'),
  !findings.length?h('p',null,'没有可导出的匹配结论。'):null,
  busy?h('p',{role:'status'},'正在生成只读报告预览…'):null,
  shown?h(React.Fragment,null,
   h('p',{'data-testid':'manual-findings-report-summary'},'范围：',shown.report.summary.scopeLabel,'；导出 ',shown.report.summary.count,' / ',shown.report.summary.total,' 条；范围排除 ',shown.report.summary.excludedScopeCount,' 条。来源比较：一致 ',shown.report.summary.sourceCounts.same,'，变化 ',shown.report.summary.sourceCounts.changed,'，不可用 ',shown.report.summary.sourceCounts.unavailable,'，不一致 ',shown.report.summary.sourceCounts.inconsistent,'。全部未验证；原件未随附、未在此报告中核对。'),
   shown.report.format==='markdown'?h(typeof ResearchContent==='function'?ResearchContent:({text,...props})=>h('div',props,text),{text:shown.report.text,'data-testid':'manual-findings-report-rich'}):null,h('pre',{'data-testid':'manual-findings-report-preview',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflow:'auto'}},shown.report.text),
   h('label',null,h('input',{type:'checkbox','data-testid':'manual-findings-report-consent',checked:consent&&consentRef.current===shown.report,onChange:e=>{try{view.validateReport(shown.report,()=>current(shown.operation));consentRef.current=e.target.checked?shown.report:null;setConsent(e.target.checked)}catch{clear();setError('资料已变化，请重新预览。')}}}),' 我已检查上述完整内容，同意将此预览下载到本机；其中可能包含结论与引用信息。'),
   h('button',{type:'button',disabled:!consent||consentRef.current!==shown.report,onClick:download},'下载已确认的报告')):null,
  error?h('p',{role:'alert','data-testid':'manual-findings-report-error'},error):null,
  notice?h('p',{role:'status'},notice):null
 );
}

// Originals exist only in the local async call, never in React state, storage,
// or rendered output. Cancellation invalidates both file reads and hashing.
function ManualOriginalsCheck({view,row}){
 const [consent,setConsent]=React.useState(false),[busy,setBusy]=React.useState(false),[report,setReport]=React.useState(null),[error,setError]=React.useState('');
 const generation=React.useRef(0),alive=React.useRef(true),consentRef=React.useRef(false),fileInput=React.useRef(null);
 React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[view,row.id,row.recordSha256]);
 function clear(){generation.current++;setReport(null);setError('');setBusy(false);if(fileInput.current)fileInput.current.value=''}
 async function open(event){
  const file=event.target.files?.[0];event.target.value='';clear();
  if(!file||!consentRef.current)return;
  const operation=++generation.current,current=()=>alive.current&&consentRef.current&&generation.current===operation;
  const stable=()=>{if(!current())throw Error('FINDINGS_CONTEXT_CHANGED');(view.checkCurrent||view.stable)()};
  setBusy(true);
  try{
   stable();const size=file.size;
   if(!Number.isSafeInteger(size)||size<1||size>MANUAL_ARCHIVE_MAX_BYTES)throw Error('MANUAL_ORIGINALS_FILE_SIZE');
   const buffer=await file.arrayBuffer();if(!current())return;stable();
   if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==size)throw Error('MANUAL_ORIGINALS_FILE_LENGTH');
   let archiveRaw;try{archiveRaw=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}catch{throw Error('MANUAL_ORIGINALS_FILE_ENCODING')}
   const result=await view.verifyOriginals({findingId:row.id,expectedRecordSha256:row.recordSha256,archiveRaw},current);
   if(!current())return;stable();setReport(result);
  }catch(e){if(current()){
   // Reader/native errors can contain source snippets. Never render them.
   const messages={MANUAL_ORIGINALS_FILE_SIZE:'请选择非空且不超过 8 MiB 的 JSON 记录包。',MANUAL_ORIGINALS_FILE_LENGTH:'文件长度发生变化，本次未完成核对。',MANUAL_ORIGINALS_FILE_ENCODING:'文件不是有效 UTF-8，本次未完成核对。',MANUAL_ORIGINALS_RECORD_MISSING:'记录包中没有这条引用对应的人工记录。',MANUAL_ORIGINALS_REPLY_MISSING:'记录包中没有这条引用对应的已提交答复；草稿不能代替答复。',MANUAL_REPLY_MISSING:'记录包中没有这条引用对应的已提交答复；草稿不能代替答复。',MANUAL_ORIGINALS_ORIGIN_MISSING:'旧记录缺少归属字段，无法与这条历史引用核对。',MANUAL_ORIGINALS_ORIGIN_MISMATCH:'记录包的归属字段与历史引用不一致。',MANUAL_ORIGINALS_PREPARATION_MISMATCH:'准备内容与历史引用不一致。',MANUAL_ORIGINALS_TRACE_MISMATCH:'准备来源记录与历史引用不一致。',MANUAL_ORIGINALS_REPLY_MISMATCH:'答复内容与历史引用不一致。',MANUAL_ORIGINALS_REPLY_SIZE_MISMATCH:'答复字节数与历史引用不一致。',MANUAL_ORIGINALS_REPLY_HASH_MISMATCH:'答复内容与历史引用不一致。',FINDINGS_CONTEXT_CHANGED:'范围或操作已变化，请刷新后重新选择记录包。',FINDINGS_SOURCE_CHANGED:'资料已变化，请刷新后重新选择记录包。',FINDINGS_SCOPE_CHANGED:'范围已变化，请刷新后重新选择记录包。'};
   setReport(null);setError(messages[e?.message]||'记录包格式、编码、内容或历史引用校验失败。本次未完成核对，也未改动研究记录。');
  }}finally{if(current())setBusy(false)}
 }
 return h('section',{'data-testid':'manual-originals-check',style:{borderTop:'1px solid '+palette.line,paddingTop:12}},
  h('h5',null,'原件内容与历史引用核对'),
  h('p',null,'选择你此前导出的人工交接记录包（JSON，最多 8 MiB）。仅临时读取并比较这条记录的原答复、准备内容与归属字段；不展示或保存包内原件，不导入研究状态。'),
  h('label',null,h('input',{type:'checkbox',checked:consent,'data-testid':'manual-originals-consent',onChange:e=>{consentRef.current=e.target.checked;setConsent(e.target.checked);clear()}}),' 我同意仅在内存读取所选包，理解其中可能包含论文正文、Prompt、答复及未提交草稿。'),
  h('input',{ref:fileInput,type:'file',accept:'.json,application/json',disabled:!consent,'aria-label':'选择原人工交接记录包','data-testid':'manual-originals-file',onChange:open}),
  h('button',{type:'button',style:secondary,onClick:clear},'清除本次核对'),
  busy?h('p',{role:'status'},'正在内存中核对原件内容…'):null,
  report?h('p',{'data-testid':'manual-originals-result',role:'status'},'内容与历史引用一致。所选包中的已提交答复、准备内容和归属字段匹配这条历史引用。结论仍为未验证；这不核验结论语义或原答复是否支持结论，也不证明作者身份、平台来源、实际发送、当前流程适用性或科学真实性。'):null,
  error?h('p',{'data-testid':'manual-originals-error',role:'alert'},error):null,
  h('p',{style:{color:palette.muted,fontSize:12}},'核对不改变 ai_unverified 状态，不接收或评分。当前来源比较与历史原件核对相互独立；取消勾选、清除、刷新、切换范围或导航后清除本次结果。')
 );
}
// Browses only explicitly saved conclusions, never generated/demo outputs.
function ManualFindingsPanel({store,projectId,scopeReady=false,scopeToken=null,active=true,selectedId,onSelect,guided=false}){
 const ctl=React.useMemo(()=>createManualFindingsController({store,storage:localStorage}),[store]);
 const binding=JSON.stringify([ctl.namespace,projectId,scopeReady,scopeToken,active]),bindingRef=React.useRef(binding);bindingRef.current=binding;
 const [verificationEpoch,setVerificationEpoch]=React.useState(0);
 const [reload,setReload]=React.useState(0),[info,setInfo]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const [evidenceTarget,setEvidenceTarget]=React.useState(null),evidenceGuard=React.useRef(null);
 const [query,setQuery]=React.useState(''),[paperFilter,setPaperFilter]=React.useState(''),[sourceFilter,setSourceFilter]=React.useState('all');
 React.useEffect(()=>{let live=true;setInfo(null);setError('');setBusy(false);if(!active||!scopeReady||typeof projectId!=='string')return;
  const current=()=>live&&bindingRef.current===binding;setBusy(true);
  ctl.read({projectId,scopeReady},current).then(view=>{if(current()){view.stable();setInfo({view,binding})}}).catch(e=>{if(current()){setInfo(null);setError(e.message)}}).finally(()=>{if(current())setBusy(false)});
  return()=>{live=false;ctl.cancel()};
 },[ctl,binding,reload]);
 React.useEffect(()=>{if(!active)return;const invalidate=()=>{ctl.cancel();setInfo(null);setBusy(false);setError('资料或范围已变化，请刷新重新核验。')};
  const changed=e=>{if(e.key===null||[ctl.namespace,ctl.key,ctl.namespace+':project-library-v1',ctl.namespace+':project-planning-v1'].includes(e.key))invalidate()};
  const target=typeof window!=='undefined'?window:null;target?.addEventListener?.('storage',changed);
  let timer;const poll=()=>{if(info?.binding===binding){try{(info.view.checkCurrent||info.view.stable)()}catch{invalidate();return}}timer=setTimeout(poll,1000)};timer=setTimeout(poll,1000);
  return()=>{target?.removeEventListener?.('storage',changed);clearTimeout(timer)};
 },[ctl,binding,info,active]);
 // Hide a stale or pending view synchronously, even before effects have run.
 let view=null,stale=false;if(active&&scopeReady&&info?.binding===binding)try{(info.view.checkCurrent||info.view.stable)();view=info.view}catch{stale=true}
 const rows=view?.rows??[],filtered=manualFindingsCore.filterManualFindings(rows,{query,paperId:paperFilter,sourceStatus:sourceFilter});
 const papers=[...new Map(rows.map(r=>[r.paperId,{id:r.paperId,title:r.currentTitle??r.recordedTitle,missing:!r.canNavigate}])).values()];
 const documentLabel={same:'当前正文与记录的哈希一致',changed:'当前正文与记录不同',missing:'当前档案未保存正文',inconsistent:'当前正文与档案声明的哈希不一致', 'paper-missing':'当前论文不可用'};
 function select(row){setVerificationEpoch(x=>x+1);try{if(!view||!row.canNavigate)return;view.stable();onSelect?.(row.paperId)}catch(e){setInfo(null);setError(e.message)}}
 return h('section',{'data-testid':'manual-findings','aria-label':'已保存人工结论总览',style:{...box,marginBottom:18}},
  h('h3',{style:{marginTop:0}},guided?'已保存结论':'已保存人工结论 · 跨论文查阅'),
  guided?h(React.Fragment,null,h('p',{className:'prism-muted'},!scopeReady?'正在核验范围。':projectId?'当前项目 · 人工登记':'共享论文库 · 人工登记'),guidedHelp('范围与来源说明',h(React.Fragment,null,h('p',{'data-testid':'manual-findings-scope'},!scopeReady?'当前范围尚未核验，暂不显示任何结论。':projectId?'当前项目：仅显示来源项目一致、且论文仍在已确认关联范围内的结论。同篇论文在其他项目或共享模式保存的记录不会自动迁入；旧单篇列表仍跨项目共享。':'共享基础库：显示当前档案空间的全部已保存人工关联结论，包含其他项目来源及已不可用论文的历史记录。'),
  h('p',null,'以下是你明确保存的人工结论，不是自动提取的研究发现。全部为未验证记录；用户粘贴答复的来源未认证，未自动接收或评分。'),
  h('p',{style:{color:palette.muted,fontSize:12}},'读取时校验日志结构与记录哈希一致性，不证明作者身份或科学真实性。原答复和准备包未随引用保存，可在每条详情中自选原人工交接记录包，临时核对内容与历史引用是否一致；不会核验结论语义，当前 Prompt 与自定义流程未复核。档案快照变化可能来自标题、事件或演示运行，不代表结论错误。')))):h(React.Fragment,null,h('p',{'data-testid':'manual-findings-scope'},!scopeReady?'当前范围尚未核验，暂不显示任何结论。':projectId?'当前项目：仅显示来源项目一致、且论文仍在已确认关联范围内的结论。同篇论文在其他项目或共享模式保存的记录不会自动迁入；旧单篇列表仍跨项目共享。':'共享基础库：显示当前档案空间的全部已保存人工关联结论，包含其他项目来源及已不可用论文的历史记录。'),
  h('p',null,'以下是你明确保存的人工结论，不是自动提取的研究发现。全部为未验证记录；用户粘贴答复的来源未认证，未自动接收或评分。'),
  h('p',{style:{color:palette.muted,fontSize:12}},'读取时校验日志结构与记录哈希一致性，不证明作者身份或科学真实性。原答复和准备包未随引用保存，可在每条详情中自选原人工交接记录包，临时核对内容与历史引用是否一致；不会核验结论语义，当前 Prompt 与自定义流程未复核。档案快照变化可能来自标题、事件或演示运行，不代表结论错误。')),
 h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}},
   h('label',null,'检索结论、论文、记录步骤、时间或来源项目',h('input',{'aria-label':'已保存结论检索词',type:'search',maxLength:manualFindingsCore.MANUAL_FINDINGS_LIMIT.query,value:query,style:field,onChange:e=>setQuery(e.target.value)})),
   h('label',null,'来源论文',h('select',{'aria-label':'结论来源论文',value:paperFilter,style:field,onChange:e=>setPaperFilter(e.target.value)},h('option',{value:''},'全部范围内论文'),paperFilter&&!papers.some(p=>p.id===paperFilter)?h('option',{value:paperFilter},'原筛选论文不在当前范围'):null,papers.map(p=>h('option',{key:p.id,value:p.id},p.title+(p.missing?'（当前不可用）':''))))),
   h('label',null,'与当前论文来源的比较',h('select',{'aria-label':'结论来源状态',value:sourceFilter,style:field,onChange:e=>setSourceFilter(e.target.value)},h('option',{value:'all'},'全部来源状态'),h('option',{value:'same'},'正文与档案快照一致'),h('option',{value:'changed'},'正文或档案快照已变化'),h('option',{value:'unavailable'},'论文或正文不可用'),h('option',{value:'inconsistent'},'当前正文哈希不一致')))),
  !guided?h('p',{style:{color:palette.muted,fontSize:12}},'按字面忽略大小写匹配，空格分词须全部命中（最多 32 词、200 字符）。仅检索上述记录字段，不读取其他材料；不联网、不保存检索词、不改变研究状态。新记录保存后可刷新。'):null,
  h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},h('button',{type:'button',style:secondary,disabled:busy||!active||!scopeReady,onClick:()=>{ctl.cancel();setInfo(null);setReload(x=>x+1)}},'刷新已保存结论'),h('button',{type:'button',style:secondary,disabled:!query&&!paperFilter&&sourceFilter==='all',onClick:()=>{setQuery('');setPaperFilter('');setSourceFilter('all')}},'清空结论检索与筛选')),
  busy?h('p',{role:'status'},'正在读取并校验已保存结论…'):null,
  error||stale?h('p',{role:'alert'},'结论暂不可显示，请核对档案后刷新；未覆盖任何记录。',error||'资料或范围已变化。'):null,
  filtered.error?h('p',{role:'alert'},filtered.error==='TOO_MANY_TERMS'?'请将检索词减少到 32 个以内。':'检索条件无效，请清空后重试。'):null,
  h('p',{'data-testid':'manual-findings-count',role:'status'},'匹配 ',filtered.results.length,' / ',filtered.total,' 条已保存结论（全部未验证）；按保存序号由新到旧。'),
  view&&!rows.length?h('p',{'data-testid':'manual-findings-empty'},view.journalPresent?'当前范围没有已保存人工结论。项目模式不会显示其他来源项目或已解除关联论文的历史。':'尚未建立独立人工结论日志。可在执行工作台的人工交接中明确保存结论；本区不自动生成。'):null,
  view&&rows.length&&!filtered.results.length&&!filtered.error?h('p',null,'没有匹配结论，请调整检索或筛选；当前论文未切换。'):null,
  view&&!filtered.error?h(ManualFindingsReport,{key:JSON.stringify([binding,reload,selectedId,verificationEpoch,query,paperFilter,sourceFilter]),view,findings:filtered.results,filter:{query,paperId:paperFilter,sourceStatus:sourceFilter},binding:JSON.stringify([binding,reload,selectedId,verificationEpoch])}):null,
  evidenceTarget&&typeof FindingEvidencePanel==='function'?h(FindingEvidencePanel,{key:evidenceTarget.row.id+'|'+evidenceTarget.projectId,store,row:evidenceTarget.row,projectId:evidenceTarget.projectId,contextKey:JSON.stringify([binding,selectedId]),allowed:active&&scopeReady&&projectId===evidenceTarget.projectId&&store.getStorageKey()===evidenceTarget.namespace,guardRef:evidenceGuard,onClose:()=>{setEvidenceTarget(null);evidenceGuard.current=null}}):null,
  h('div',{'data-testid':'manual-findings-results'},filtered.results.map(r=>h('article',{key:r.id,'data-finding-id':r.id,'data-paper-id':r.paperId,style:{borderTop:'1px solid '+palette.line,padding:'14px 0',overflowWrap:'anywhere'}},
   h('h4',{style:{margin:'0 0 8px'}},'未验证结论 #',r.seq,' · ',r.recordedTitle),
   h(typeof ResearchContent==='function'?ResearchContent:({text,...props})=>h('div',props,text),{text:r.conclusion,'data-source-id':r.id,'data-testid':'manual-finding-conclusion-rich'}),
   h('p',null,'记录步骤：',r.stepName,' · Prompt v',r.promptVersion,' · ',r.stepOrigin==='custom_graph'?'自定义流程':'基础流程','（记录时）'),
   h('p',null,'保存时间：',r.time,' · 来源项目：',r.projectId||'共享基础库（未选项目）'),
   h('p',{'data-testid':'manual-findings-source-status'},documentLabel[r.documentStatus],'；',r.snapshotStatus==='same'?'档案快照与记录一致':r.snapshotStatus==='changed'?'档案快照已变化，不代表结论错误':'当前档案快照不可用','。一致也不表示当前 Prompt 仍适用。'),
   r.canNavigate?h('button',{type:'button',style:secondary,'aria-current':selectedId===r.paperId?'true':undefined,onClick:()=>select(r)},'前往论文：',r.currentTitle):h('p',null,'当前论文不可用，仅保留历史引用，无法导航。'),
   r.currentTitle&&r.currentTitle!==r.recordedTitle?h('p',null,'当前标题：',r.currentTitle,'；以上保留记录时标题。'):null,
   typeof FindingEvidencePanel==='function'?h('button',{'data-testid':'finding-evidence-open',disabled:!r.canNavigate||r.projectId!==projectId,onClick:()=>{try{view.stable();if(evidenceTarget&&evidenceGuard.current?.()===false)return;setEvidenceTarget({row:r,projectId,namespace:ctl.namespace})}catch{setError('来源已变化，请刷新后重新选择结论。')}}},'为此结论录入论文引文（独立版本，不自动验证）'):null,
   h('details',null,h('summary',null,'查看完整结论与引用元数据'),h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},r.conclusion),h('p',null,'论文ID：',r.paperId,' · 人工记录：',r.recordId,' · 答复：',r.replyId),h('dl',{style:{overflowWrap:'anywhere'}},[['记录正文 SHA-256',r.recordedDocumentSha256],['记录档案快照 SHA-256',r.recordedSnapshotSha256],['当前正文 SHA-256',r.currentDocumentSha256],['当前档案快照 SHA-256',r.currentSnapshotSha256],['记录 Prompt SHA-256（未复核当前 Prompt）',r.recordedPromptSha256],['引用答复 SHA-256（原件未随附）',r.replySha256],['准备包 SHA-256（原件未随附）',r.preparationSha256],['结论记录 SHA-256',r.recordSha256]].map(([label,value])=>h(React.Fragment,{key:label},h('dt',null,label),h('dd',{style:{margin:'0 0 10px'}},value||'不可用')))),h(ManualOriginalsCheck,{key:JSON.stringify([binding,reload,selectedId,verificationEpoch,r.id,r.recordSha256]),view,row:r}))
  )))
 );
}
