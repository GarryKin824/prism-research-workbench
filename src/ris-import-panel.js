// Offline, user-selected RIS metadata. No network or implicit project/queue mutations.
function RisImportPanel({store,projectId,projectRevisionSha256,disabled=false,format='ris',guided=false}){
 const isBibtex=format==='bibtex',prefix=isBibtex?'bibtex':'ris',label=isBibtex?'BibTeX':'RIS';
 const hasWindowEvents=typeof globalThis.window?.addEventListener==='function'&&typeof globalThis.window?.removeEventListener==='function';
 disabled=disabled||!hasWindowEvents||!['ris','bibtex'].includes(format);
 const ctl=React.useMemo(()=>createDiscoveryIntakeController({store,storage:globalThis.localStorage,crypto:globalThis.crypto,withLock:typeof globalThis.navigator?.locks?.request==='function'?(name,fn)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},fn):undefined}),[store]);
 const [readAck,setReadAck]=React.useState(false),[replaceAck,setReplaceAck]=React.useState(false),[source,setSource]=React.useState(null),[selected,setSelected]=React.useState([]),[filters,setFilters]=React.useState({text:'',yearFrom:null,yearTo:null,hideKnown:false}),[preview,setPreview]=React.useState(null),[ack,setAck]=React.useState(false),[busy,setBusy]=React.useState(false),[saved,setSaved]=React.useState([]),[linked,setLinked]=React.useState(false),[message,setMessage]=React.useState(guided?'':'未读取文件；无网络请求。'),[papers,setPapers]=React.useState(()=>store.getSnapshot().papers);
 const life=React.useRef({alive:true,epoch:0,busy:false,preview:null}),scope=JSON.stringify([store.getStorageKey(),projectId||'',projectRevisionSha256||'',disabled,format]),owner=React.useRef(ctl),scopeRef=React.useRef(scope),scopeVersion=React.useRef(0),readRef=React.useRef(readAck);readRef.current=readAck;
 if(owner.current!==ctl||scopeRef.current!==scope){life.current.epoch++;scopeVersion.current++;owner.current=ctl;scopeRef.current=scope}
 function invalidate(){life.current.epoch++;if(life.current.preview)ctl.cancel(life.current.preview.value);life.current.preview=null;setPreview(null);setAck(false)}
 function resetActions(){invalidate();setSelected([]);setSaved([]);setLinked(false)}
 React.useEffect(()=>{life.current.alive=true;return()=>{life.current.alive=false;life.current.epoch++;ctl.close()}},[ctl]);
 React.useLayoutEffect(()=>{resetActions();setReadAck(false);readRef.current=false;setReplaceAck(false);if(source)setMessage('项目、目标版本或入口状态已变化；旧文件仅只读保留，请重新读取文件后操作。')},[scope,ctl]);
 React.useEffect(()=>store.subscribe(()=>{setPapers(store.getSnapshot().papers);if(!life.current.busy){invalidate();setSaved([]);setLinked(false)}}),[store,ctl]);
 React.useEffect(()=>{if(!hasWindowEvents)return;const eventWindow=globalThis.window,changed=e=>{if(e.key===null||e.key===store.getStorageKey()||e.key===store.getStorageKey()+':project-planning-v1'||e.key===store.getStorageKey()+':project-library-v1'){resetActions();setMessage('存储已变化；原预览保留，请重新核对选择与项目。')}};eventWindow.addEventListener('storage',changed);return()=>eventWindow.removeEventListener('storage',changed)},[store,ctl,hasWindowEvents]);
 const hasLocks=typeof globalThis.navigator?.locks?.request==='function';
 const stale=!!source&&(source.scope!==scope||source.owner!==ctl||source.scopeVersion!==scopeVersion.current),blocked=disabled||busy||stale;
 let view={items:[],existingMatches:[]},filterError='';try{view=discoverySourcesCore.filterDiscoveryCandidates(source?.data?.candidates||[],filters,papers)}catch(e){filterError='筛选无效，请核对年份范围：'+e.message}
 async function run(fn){if(life.current.busy||disabled)return;life.current.busy=true;setBusy(true);const epoch=life.current.epoch,owned=ctl,captured=scope,current=()=>life.current.alive&&owner.current===owned&&scopeRef.current===captured&&life.current.epoch===epoch;try{await fn(current)}catch(e){if(current())setMessage('未完成：'+e.message+'。不自动重试；如写入结果未知，请保留页面并核查。')}finally{life.current.busy=false;if(life.current.alive)setBusy(false)}}
 async function readFile(event){
  const file=event.target.files?.[0];
  event.target.value='';
  const readAllowed=()=>guided||readRef.current;
  if(!file||!readAllowed()||source&&!replaceAck||life.current.busy||disabled)return;
  resetActions();
  setReplaceAck(false);
  const captured=scope,capturedVersion=scopeVersion.current;
  await run(async current=>{
   const name=file.name,size=file.size;
   if(typeof name!=='string'||name.length>255||!(isBibtex?/^.+\.(bib|bibtex)$/i:/^.+\.ris$/i).test(name)||!Number.isSafeInteger(size)||size<1||size>1048576||typeof file.arrayBuffer!=='function'){
    throw Error(isBibtex?'仅接受非空 .bib / .bibtex UTF-8 文件，最多 1 MiB':'仅接受非空 .ris UTF-8 文件，最多 1 MiB');
   }
   const bytes=await file.arrayBuffer();
   if(!current()||!readAllowed())return;
   if(file.name!==name||file.size!==size||Object.prototype.toString.call(bytes)!=='[object ArrayBuffer]'||bytes.byteLength!==size)throw Error('文件读取长度或身份变化');
   const core=isBibtex?bibtexImportCore.createBibtexImportPreview:risImportCore.createRisImportPreview;
   const data=await core({bytes:new Uint8Array(bytes),filename:name,importedAt:new Date().toISOString()},globalThis.crypto);
   if(!current()||!readAllowed())return;
   setSource({scope:captured,scopeVersion:capturedVersion,owner:ctl,filename:name,data});
   setFilters({text:'',yearFrom:null,yearTo:null,hideKnown:false});
   setMessage(guided?'':'已只读解析；未建档、关联项目或入队。请核对所有诊断和映射。');
  });
 }
 function changeFilter(key,value){invalidate();setSelected([]);setFilters(old=>({...old,[key]:value}))}
 function choose(id,value){invalidate();setSelected(old=>value?[...old,id]:old.filter(x=>x!==id))}
 async function prepare(kind){if(blocked||filterError||!source)return;invalidate();await run(async current=>{const value=kind==='import'?await ctl.prepareImport({candidates:source.data.candidates,selectedIds:selected}):kind==='link'?await ctl.prepareLink({projectId,paperIds:saved}):await ctl.prepareQueue({projectId,paperIds:saved});if(!current()){ctl.cancel(value);return}const p={kind,value};life.current.preview=p;setPreview(p);setMessage('仅预览，请核对下方完整变更后明确确认。')})}
 async function confirm(){if(blocked||!ack||!preview)return;const p=preview;setAck(false);await run(async current=>{const result=await ctl[p.kind==='import'?'confirmImport':p.kind==='link'?'confirmLink':'confirmQueue'](p.value,{explicit:true},current);if(!current())return;life.current.preview=null;setPreview(null);if(p.kind==='import'){setSelected([]);setSaved(result.status==='saved'?result.paperIds:[]);setLinked(false);setMessage(guided&&result.status==='saved'?'书目已保存。新增 '+result.added+' 条，复用 '+result.existing+' 条。正文需另行导入。':(guided?'无法确认书目已保存。':'建档状态：'+result.status+'；新增 '+result.added+'、已有 '+result.existing+'。')+(result.warnings||[]).join('；'))}else{if(p.kind==='link')setLinked(true);setMessage(p.kind==='link'?'项目关系已确认；尚未入队。':'已确认追加项目计划队列；未获取全文或启动研究。')}})}
 const pre=(value,id)=>h('pre',{'data-testid':id,style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:340,overflow:'auto'}},typeof value==='string'?value:JSON.stringify(value,null,2)),button=(id,label,onClick,off)=>h('button',{'data-testid':id,type:'button',disabled:disabled||busy||off,onClick},label);
 if(guided){
  const counts=source?.data.summary;
  const fileDisabled=disabled||busy||!!source&&!replaceAck;
  const targetLabels={import:'保存书目',link:'加入项目',queue:'加入计划队列'};
  const formatHelp=isBibtex
   ? '支持常见标准条目、花括号或双引号包围的值和裸整数。@string、@preamble、@comment、裸宏、# 拼接、crossref、xdata、重复字段和重复引用键不导入。TeX 命令按原文显示。'
   : '从 RIS 标签提取标题、作者、DOI、年份、摘要和链接。无效或缺少必填字段的记录会列入诊断。';
  return h('section',{'data-testid':prefix+'-import',className:'prism-form','aria-label':label+' 文件导入'},
   !hasWindowEvents?h('p',{'data-testid':prefix+'-no-window-events',role:'alert'},'当前宿主无法安全处理文件导入。'):null,
   source?h('label',null,h('input',{'data-testid':prefix+'-replace-consent',type:'checkbox',checked:replaceAck,disabled:disabled||busy,onChange:e=>setReplaceAck(e.target.checked)}),'更换文件并放弃本次预览'):null,
   h('label',{className:'prism-button prism-file','data-disabled':fileDisabled},'选择 '+label+' 文件',
    h('input',{'data-testid':prefix+'-file',type:'file','aria-label':'选择 '+label+' 文件',accept:isBibtex?'.bib,.bibtex':'.ris',disabled:fileDisabled,onChange:readFile})),
   h('div',{className:'prism-muted'},(isBibtex?'.bib / .bibtex':'.ris')+' · UTF-8 · 1 MiB / 50 条 · 书目信息'),
   guidedHelp('格式帮助',h(React.Fragment,null,
    h('p',null,formatHelp),
    h('p',null,'在本机读取标题、作者、DOI、年份、摘要和链接。原书目记录仅供本页核对，附件不读取。入库保存书目、文件哈希和记录号。'),
    counts?pre(source.data.diagnostics||[],prefix+'-diagnostics'):null,
    counts?pre(source.data.records||[],prefix+'-original-records'):null)),
   counts?h('div',null,
    h('strong',{'data-testid':prefix+'-filename'},source.filename),
    h('p',{'data-testid':prefix+'-counts',role:'status'},counts.candidateCount+' 条可选 · '+counts.rejectedCount+' 条拒绝 · '+counts.duplicateCount+' 条合并 · '+counts.warningCount+' 条提示'),
    stale?h('p',{role:'alert','data-testid':prefix+'-stale'},'项目已变更。请重新选文件后导入。'):null,
    guidedHelp('筛选',h(React.Fragment,null,
     h('label',null,'标题、作者或摘要 ',h('input',{'data-testid':prefix+'-text-filter',value:filters.text,disabled:blocked,onChange:e=>changeFilter('text',e.target.value)})),
     ...['yearFrom','yearTo'].map(key=>h('label',{key},key==='yearFrom'?'起始年份 ':'截止年份 ',h('input',{'data-testid':prefix+'-'+key,type:'number',value:filters[key]??'',disabled:blocked,onChange:e=>changeFilter(key,e.target.value===''?null:Number(e.target.value))}))),
     h('label',null,h('input',{'data-testid':prefix+'-hide-known',type:'checkbox',checked:filters.hideKnown,disabled:blocked,onChange:e=>changeFilter('hideKnown',e.target.checked)}),'隐藏已入库'))),
    filterError?h('p',{role:'alert'},filterError):null,
    view.items.map(candidate=>h('article',{className:'prism-candidate',key:candidate.id,['data-'+prefix+'-candidate']:candidate.id},
     h('label',null,h('input',{'data-testid':prefix+'-select','data-candidate-id':candidate.id,type:'checkbox',checked:selected.includes(candidate.id),disabled:blocked||!!filterError||source.data.canImport===false,onChange:e=>choose(candidate.id,e.target.checked)}),candidate.title),
     h('p',{className:'prism-muted'},[candidate.authors.join(', '),candidate.year,candidate.doi,view.existingMatches.some(m=>m.candidateId===candidate.id)?'已入库':'',candidate.conflicts.length?'字段冲突':''].filter(Boolean).join(' · ')),
     guidedHelp('条目详情',pre(candidate,prefix+'-candidate-detail')))),
    !preview&&view.items.length?button(prefix+'-import-preview','预览所选（'+selected.length+'）',()=>prepare('import'),blocked||!!filterError||!selected.length||source.data.canImport===false):null):null,
   preview?h('div',{className:'prism-form'},
    h('h3',null,targetLabels[preview.kind]+'预览'),
    preview.kind==='import'?h(React.Fragment,null,
     h('div',null,'新增 '+preview.value.newCount+' 条 · 复用 '+preview.value.existingCount+' 条'),
     h('ul',null,preview.value.candidates.map(candidate=>h('li',{key:candidate.id},candidate.title))),
     h('p',{'data-testid':prefix+'-version-compat',className:'prism-muted'},'新条目需用当前版本打开。')):h('p',{className:'prism-muted'},preview.value.changed
      ?preview.kind==='link'?'将所选书目加入当前项目。':'将所选书目加入计划队列。'
      :preview.kind==='link'?'所选书目已在当前项目。':'所选书目已在计划队列。'),
    guidedHelp('完整变更',pre(preview,prefix+'-write-preview')),
    h('label',null,h('input',{'data-testid':prefix+'-write-consent',type:'checkbox',checked:ack,disabled:busy,onChange:e=>setAck(e.target.checked)}),'已核对本次变更'),
    h('div',{className:'prism-actions'},
     h('button',{'data-testid':prefix+'-confirm',type:'button',className:'prism-primary',onClick:confirm,disabled:blocked||!ack},targetLabels[preview.kind]),
     button(prefix+'-cancel','取消预览',()=>{invalidate();setMessage('')},false))):null,
   saved.length&&projectId?h('div',{className:'prism-actions'},
    button(prefix+'-link-preview','预览加入项目',()=>prepare('link'),blocked||!hasLocks||linked),
    linked?button(prefix+'-queue-preview','预览加入计划队列',()=>prepare('queue'),blocked||!hasLocks):null,
    !hasLocks?h('span',{className:'prism-muted'},'当前浏览器无法写入项目关联或队列。'):null):null,
   busy?h('p',{role:'status'},'正在处理…'):null,
   message?h('p',{'data-testid':prefix+'-status',role:'status'},message):null);
 }
 return h('section',{'data-testid':prefix+'-import',style:{border:'1px solid #777',padding:16,marginTop:16}},h('h3',null,''+label+' 引用文件离线导入 · 用户提供的未验证元数据'),!hasWindowEvents?h('p',{'data-testid':prefix+'-no-window-events',role:'alert'},'当前宿主缺少窗口事件监听能力，无法可靠监听存储变化，'+label+' 入口不可用：禁止文件读取、建档、项目关联和排队，不降级绕过。'):null,h('p',null,'不联网、不搜索、不自动读取链接或全文。先预览并逐条选择，再分别确认建档、关联项目和计划队列。元数据不是正文或研究成果。文件最多 1 MiB / 50 条；完整诊断在下方，拒绝项不暗中修造。原 '+label+' 和附件不保存，文件名仅在预览显示；新建记录会明文保存文件哈希、原记录编号及映射后的书目信息；复用的旧记录不覆盖、不补写本次来源。哈希不是来源认证。'),
 h('p',{'data-testid':prefix+'-version-compat'},'新 '+label+' 条目使用本地来源 v2；旧版应用不能读取含这些条目的库。请先保留原库备份，不要用旧版打开同一资料区。已有 Crossref / 合成条目不改写。'),!hasLocks?h('p',{'data-testid':prefix+'-no-locks',role:'alert'},'此环境缺少 Web Locks，仍可预览并明确导入元数据，但不能关联项目或加入计划队列；不会绕过协调锁。'):null,
 isBibtex?h('p',{'data-testid':'bibtex-subset'},'支持常见标准条目、花括号/双引号值和裸整数；仅映射标题、作者、DOI、年份、摘要、URL。@string/@preamble/@comment、裸宏、# 拼接、crossref/xdata、重复字段/引用键不导入，结构损坏会拒绝整个文件。引用键、条目类型和未映射字段仅在当前预览，不持久化；原 BibTeX 文件及附件不保存。新来源只保存文件哈希和记录号等映射信息。其他普通字段仅提示、不保存。TeX 命令和内层花括号按原文显示，不执行或转为 Unicode，不自动下载链接/附件。请核对全部诊断；原始条目仅留在本页预览。'):null,
 h('label',null,h('input',{'data-testid':prefix+'-read-consent',type:'checkbox',checked:readAck,disabled:disabled||busy,onChange:e=>{setReadAck(e.target.checked);readRef.current=e.target.checked;if(!e.target.checked)resetActions()}}),' 我同意在当前页读取主动选择的 '+label+' 全部明文'),source?h('label',null,h('input',{'data-testid':prefix+'-replace-consent',type:'checkbox',checked:replaceAck,disabled:disabled||busy,onChange:e=>setReplaceAck(e.target.checked)}),' 我明确重新选择文件，放弃当前未处理选择和预览；不会删除已保存数据'):null,h('input',{'data-testid':prefix+'-file',type:'file',accept:isBibtex?'.bib,.bibtex':'.ris',disabled:disabled||busy||!readAck||!!source&&!replaceAck,onChange:readFile}),h('button',{'data-testid':prefix+'-cancel',type:'button',onClick:()=>{resetActions();setMessage('已取消；已开始的写入可能发生，未自动回滚或重试，请核查。')}},'取消当前操作/预览，保留只读文件'),
 source?h('div',null,h('p',{'data-testid':prefix+'-filename'},source.filename),stale?h('p',{role:'alert','data-testid':prefix+'-stale'},'旧范围只读预览，不能写入当前项目。请明确重新选择文件。'):null,pre(source.data.diagnostics||[],prefix+'-diagnostics'),pre(source.data.summary||{},prefix+'-counts'),h('p',null,'解析与来源详情'),pre(Object.fromEntries(Object.entries(source.data).filter(([k])=>!['candidates','diagnostics','records'].includes(k))),prefix+'-summary'),h('details',null,h('summary',null,'查看全部原始记录、字段映射与逐条诊断（含拒绝项，仅页内存）'),pre(source.data.records||[],prefix+'-original-records')),
 h('label',null,'筛选标题/作者/摘要',h('input',{'data-testid':prefix+'-text-filter',value:filters.text,disabled:blocked,onChange:e=>changeFilter('text',e.target.value)})),...['yearFrom','yearTo'].map(key=>h('label',{key},key==='yearFrom'?'起始年份':'截止年份',h('input',{'data-testid':prefix+'-'+key,type:'number',value:filters[key]??'',disabled:blocked,onChange:e=>changeFilter(key,e.target.value===''?null:Number(e.target.value))}))),h('label',null,h('input',{'data-testid':prefix+'-hide-known',type:'checkbox',checked:filters.hideKnown,disabled:blocked,onChange:e=>changeFilter('hideKnown',e.target.checked)}),' 隐藏库中已有'),filterError?h('p',{role:'alert'},filterError):null,
 h('p',{'data-testid':prefix+'-selection-count'},'候选 '+(source.data.candidates?.length||0)+' 条，当前显示 '+(view.items?.length||0)+' 条，库中已有 '+(view.knownCount||0)+' 条，已选 '+selected.length+' 条；默认不选择，筛选变化清空选择。'),(view.items||[]).map(c=>h('article',{key:c.id,['data-'+prefix+'-candidate']:c.id},h('label',null,h('input',{'data-testid':prefix+'-select','data-candidate-id':c.id,type:'checkbox',checked:selected.includes(c.id),disabled:blocked||!!filterError||source.data.canImport===false,onChange:e=>choose(c.id,e.target.checked)}),c.title),h('p',{'data-testid':prefix+'-existing-match'},view.existingMatches.some(m=>m.candidateId===c.id)?'库中已有对应元数据，确认入库将复用且不覆盖。':'尚未匹配库内记录；相似项仅提示，请人工核对。'),pre(c,prefix+'-candidate-detail'))),
 button(prefix+'-import-preview','预览所选元数据建档',()=>prepare('import'),blocked||!!filterError||!selected.length||source.data.canImport===false),button(prefix+'-link-preview','另行预览关联当前项目',()=>prepare('link'),blocked||!hasLocks||!projectId||!saved.length),button(prefix+'-queue-preview','另行预览加入项目计划队列',()=>prepare('queue'),blocked||!hasLocks||!projectId||!saved.length||!linked)):null,
 preview?h('div',null,pre(preview,prefix+'-write-preview'),h('label',null,h('input',{'data-testid':prefix+'-write-consent',type:'checkbox',checked:ack,disabled:busy,onChange:e=>setAck(e.target.checked)}),' 我确认以上当前范围变更；不授权联网、全文获取、AI 或研究执行'),button(prefix+'-confirm','确认此项变更',confirm,blocked||!ack)):null,h('p',{'data-testid':prefix+'-status',role:'status'},message));
}
