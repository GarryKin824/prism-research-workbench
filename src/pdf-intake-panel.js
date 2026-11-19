function pdfPreparedImport(p){
 const m=p.metadata,text=p.text;
 const source='机器生成 PDF 提取来源（未审核，非独立真实性证据）：'+JSON.stringify({filename:m.name,pdfBytes:m.byteLength,pdfSHA256:m.pdfSha256,textSHA256:m.textSha256,pages:m.pages,pagesRead:m.pagesRead,truncated:m.truncated,parser:'PDF.js 6.3.289 derived classic',executor:m.actualExecutor,OCR:false,originalPDFBackedUp:false});
 if(source.length>1000)throw Error('PDF_SOURCE_TOO_LONG');
 const base=m.name.replace(/\.pdf$/i,'').replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,220)||'PDF';
 return {title:base,source,document:{text,filename:base+'.extracted.txt',mime:'text/plain',byteLength:new TextEncoder().encode(text).length,...(p.pageSpans?{pdfText:{version:2,pages:m.pages,pagesRead:m.pagesRead,truncated:m.truncated,pageSpans:p.pageSpans}}:{})}};
}
// Optional experimental intake. The parser never receives Host services or storage.
function PdfIntakePanel({store,paper,disabled=false,scopeToken='',onExport=null,onPrepared=null,onImported=null,guided=false,createController=createPdfIntake}){
 const snapshot=React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const [enabled,setEnabled]=React.useState(false),[risk,setRisk]=React.useState(false),[ack,setAck]=React.useState(false),[busy,setBusy]=React.useState(false),[preview,setPreview]=React.useState(null),[message,setMessage]=React.useState(''),[outcome,setOutcome]=React.useState(null);
 const [progress,setProgress]=React.useState(null),[keepOriginal,setKeepOriginal]=React.useState(true);
 const epoch=React.useRef(0),controller=React.useRef(null),sourceRead=React.useRef(null),mounted=React.useRef(true),host=React.useRef(null),current=React.useRef(null),flight=React.useRef(false),choice=React.useRef(0);
 const reference=globalThis.__PRISM_LOCAL_REFERENCE_PDF__;
 const referenceAvailable=guided&&!onPrepared&&reference?.origin===globalThis.location?.origin&&typeof reference?.name==='string';
 current.current={namespace:store.getStorageKey(),revision:snapshot.revision,selectedPaperId:paper?.id||null,disabled,scopeToken,store};
 function clear(){setProgress(null);epoch.current++;sourceRead.current?.abort();sourceRead.current=null;controller.current?.cancel();controller.current?.destroy();controller.current=null;flight.current=false;setBusy(false);setPreview(null);setRisk(false);setAck(false)}
 React.useLayoutEffect(()=>{clear()},[store,snapshot.revision,paper?.id,disabled,scopeToken]);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;sourceRead.current?.abort();controller.current?.cancel();controller.current?.destroy();controller.current=null}},[store]);
 const matches=(n,b)=>mounted.current&&epoch.current===n&&current.current.store===b.store&&current.current.scopeToken===b.scopeToken&&store.getStorageKey()===b.namespace&&store.getSnapshot().revision===b.revision&&current.current.selectedPaperId===b.selectedPaperId&&!current.current.disabled;
 const parserContext=b=>({namespace:b.namespace,revision:b.revision,selectedPaperId:b.selectedPaperId});
 async function choose(e){const files=Array.from(e.target.files||[]);e.target.value='';
  if(files.length!==1){setMessage('请选择一份 PDF。');return}
  await preparePdf(()=>files[0]);
 }
 async function chooseReference(){
  if(!referenceAvailable)return;
  await preparePdf(async signal=>{
   const response=await fetch('/api/prism-reference-pdf',{credentials:'same-origin',redirect:'error',cache:'no-store',signal});
   if(!response.ok||response.headers.get('content-type')!=='application/pdf')throw Error('LOCAL_REFERENCE_UNAVAILABLE');
   const blob=await response.blob();
   if(blob.size!==Number(response.headers.get('content-length'))||blob.size>32*1024*1024)throw Error('LOCAL_REFERENCE_UNAVAILABLE');
   return new File([blob],reference.name,{type:'application/pdf'});
  },reference.sha256);
 }
 async function preparePdf(read,expectedSha256){
  if(!enabled||!risk||disabled||flight.current)return;
  clear();setOutcome(null);choice.current++;
  const binding={...current.current},n=epoch.current,selectedChoice=choice.current;flight.current=true;setBusy(true);setMessage('仅在本地隔离组件提取，尚未建档。');
  const abort=new AbortController();sourceRead.current=abort;
  try{
   const signal=globalThis.AbortSignal?.any
    ?AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]):abort.signal;
   const file=await read(signal);
   if(!matches(n,binding))return;
   controller.current=createController({mount:host.current,getContext:()=>parserContext({...current.current,namespace:store.getStorageKey(),revision:store.getSnapshot().revision})});
   const p=await controller.current.run(file,{confirmed:true,context:parserContext(binding),onProgress:value=>{if(matches(n,binding))setProgress(value)}});
   if(!matches(n,binding))return;
   if(expectedSha256&&p.metadata.pdfSha256!==expectedSha256)throw Error('LOCAL_REFERENCE_UNAVAILABLE');
   setPreview({payload:p,file,binding,n,choice:selectedChoice});setMessage(typeof onPrepared==='function'?'提取完成，仅内存预览；尚未挂接或新建。':'提取完成，仅内存预览；请核对后明确确认新建档案。');
  }
  catch(e){if(matches(n,binding))setMessage(e.code||e.message||'PDF 提取未完成')}
  finally{if(matches(n,binding)){sourceRead.current=null;flight.current=false;setBusy(false)}}
 }
 async function confirm(){const p=preview;if(!p||!ack||flight.current||!matches(p.n,p.binding))return;flight.current=true;setBusy(true);setMessage('');
  try{const active=controller.current;active.assertCurrent(p.payload);const item=pdfPreparedImport(p.payload);let originalSaved=null;
   if(guided&&keepOriginal&&typeof onPrepared!=='function'){
    const vault=createPdfOriginalVaultController({namespace:p.binding.namespace});
    const guard=()=>matches(p.n,p.binding);
    try{
     const original=await vault.prepare(p.file,{isCurrent:guard});
     if(original.ok&&original.preview.sha256===p.payload.metadata.pdfSha256){
      const stored=await vault.commit(original.preview,{explicitConfirmation:true,isCurrent:guard});
      originalSaved=stored.ok||stored.code==='DUPLICATE';
     }else originalSaved=false;
    }catch{originalSaved=false}finally{vault.close()}
    if(!guard())return;
   }
   if(typeof onPrepared==='function'){await onPrepared(p.payload,()=>{if(!matches(p.n,p.binding))return false;active.assertCurrent(p.payload);return true});if(matches(p.n,p.binding)){clear();setMessage('提取结果已交给原位挂接预览；尚未保存正文，也未新建论文。')}return}const result=await store.dispatch({type:'importPaper',revision:p.binding.revision,...item,isCurrent:()=>{if(!matches(p.n,p.binding))return false;active.assertCurrent(p.payload);return true}});
   // The successful commit invalidates the preview's revision itself. Retain a
   // separate terminal summary, never a repeatable confirmation for that import.
   if(mounted.current&&current.current.store===p.binding.store&&choice.current===p.choice){clear();setOutcome({payload:p.payload,persistence:result.persistence,originalSaved});setMessage('');onImported?.()}
  }catch(e){if(mounted.current&&epoch.current===p.n){setMessage(e.code||e.message||'未能新建档案');setAck(false)}}
  finally{if(mounted.current&&epoch.current===p.n){flight.current=false;setBusy(false)}}
 }
 const outcomeMessage=persistence=>persistence.saved?'本次提取文本档案已写入浏览器并完成逐字回读核对。':persistence.error==='STORAGE_OUTCOME_UNKNOWN'?'本次存储结果不确定，不能确认已保存。文本仍保留在本页内存；请先导出并人工核对，不要重复导入。':'本次提取文本档案仅保留在本页内存，尚未保存到浏览器；刷新或关闭可能丢失，请先导出。';
 const button=(label,fn,off=false)=>h('button',{type:'button',onClick:fn,disabled:off,style:secondary},label);
 if(guided){
  const details=data=>h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:300}},JSON.stringify(data,null,2));
  const attaching=typeof onPrepared==='function';
  const issue=/^[A-Z][A-Z0-9_]+$/.test(message)?message:null;
  const issueText={
   NOT_PDF:'无法识别该文件为 PDF。请选择可打开的 PDF 原件。',
   PDF_MIME_REQUIRED:'请选择 PDF 文件。',
   PDF_SIZE_LIMIT:'文件为空或超过 32 MiB。请选择符合大小限制的 PDF。',
   PDF_PAGE_LIMIT:'此 PDF 超过 300 页，无法在这里提取。',
   PDF_PASSWORD_REQUIRED:'此 PDF 需要密码。请选择可以直接打开的副本。',
   PDF_NO_TEXT_NO_OCR:'此 PDF 没有可提取的文字。扫描页可先转成文本，再导入正文。',
   PDF_INVALID_TEXT:'此 PDF 的文字映射无法读取，请核对原件。',
   PDF_PARSE_REJECTED:'此 PDF 的结构或字体不受支持，无法提取正文。',
   PDF_TIMEOUT:'提取超时。请核对文件后再试。',
   PDF_SOURCE_MISMATCH:'当前论文或来源已变化。请重新选择文件并核对。',
   LOCAL_REFERENCE_UNAVAILABLE:'无法核验配置的本机参考 PDF。请检查宿主文件或手动选择原件。',
  };
  return h('section',{'data-testid':'pdf-intake-panel',className:'prism-card prism-form'},
   h('h3',null,attaching?'从 PDF 提取':'提取 PDF 正文'),
   h('label',null,h('input',{type:'checkbox','data-testid':'pdf-enable',checked:enabled,disabled,onChange:e=>{clear();setEnabled(e.target.checked)}}),'启用本次 PDF 导入'),
   h('div',{className:'prism-muted'},'提取在本机完成。可同时保存 PDF 原件，之后从摘录核对原页。'),
   enabled?h(React.Fragment,null,
    h('label',null,h('input',{type:'checkbox','data-testid':'pdf-risk',checked:risk,disabled:busy||disabled,onChange:e=>setRisk(e.target.checked)}),'本次选择可信 PDF，在本机提取'),
    h('label',{className:'prism-button prism-file','data-disabled':!risk||busy||disabled},'选择 PDF 提取文字',
     h('input',{type:'file',accept:'.pdf,application/pdf','aria-label':'选择 PDF 提取文字',disabled:!risk||busy||disabled,onChange:choose})),
    referenceAvailable?h('div',{className:'prism-actions'},button('导入已配置的本机 PDF',chooseReference,!risk||busy||disabled),h('small',null,reference.name)):null,
    busy?h('progress',{'aria-label':'PDF 文字提取进度',max:progress?.pages,value:progress?.page}):null,
    busy||preview?button('取消预览',()=>{clear();setMessage('已取消本次 PDF 预览。')}):null):null,
   preview?h('div',{'data-testid':'pdf-preview',className:'prism-form'},
    h('strong',null,preview.payload.metadata.name),
    h('p',null,'已检查 '+preview.payload.metadata.pagesRead+' / '+preview.payload.metadata.pages+' 页 · '+(preview.payload.pageSpans?.length??'—')+' 页有保存的文字 · '+preview.payload.text.length.toLocaleString()+' 字符。页码为 PDF 文件内顺序。'),
    preview.payload.metadata.truncated?h('p',{role:'alert'},'提取达到保存上限。仅保存已提取部分；外部原件请保留。'):null,
    preview.payload.pageSpans?.length<preview.payload.metadata.pagesRead?h('p',null,'有页未保留文字，可能为空白、图像页或达到提取上限；未做 OCR。'):null,
    preview.payload.text.includes('\ufffd')?h('p',null,'部分字符无法可靠解码，以 � 标记；引用时请核对 PDF 原页。'):null,
    h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',overflow:'auto',maxHeight:300}},preview.payload.text),
    !attaching?h('label',null,h('input',{type:'checkbox',checked:keepOriginal,disabled:busy,onChange:e=>setKeepOriginal(e.target.checked)}),'同时保存 PDF 原件以便核对原页'):null,
    guidedHelp('提取详情',details(preview.payload.metadata)),
    h('label',null,h('input',{type:'checkbox','data-testid':'pdf-confirm-ack',checked:ack,disabled:busy,onChange:e=>setAck(e.target.checked)}),attaching?'已核对正文，继续预览挂接':'已核对正文，保存为新档案'),
    h('div',{className:'prism-actions'},guidedButton(attaching?'预览挂接':'导入正文',confirm,{primary:true,disabled:!ack||busy||disabled}))):null,
   outcome?h('div',{'data-testid':'pdf-import-outcome'},
    h('p',{role:'status'},outcome.persistence.saved?('正文已导入。'+(outcome.originalSaved===true?' PDF 原件已核对并保存在原件库。':outcome.originalSaved===false?' 原件未确认保存，请保留原文件并检查原件库。':'')):outcomeMessage(outcome.persistence)),
    guidedHelp('导入详情',h(React.Fragment,null,details(outcome.payload),
     button('下载当前内存基础档案',()=>onExport(),typeof onExport!=='function')))):null,
   issue?h(React.Fragment,null,h('p',{role:'alert'},issueText[issue]||'未能完成 PDF 正文导入。请先核对论文库和错误详情。'),guidedHelp('提取错误详情',h('p',null,issue))):message?h('p',{role:'status'},message):null,
   guidedHelp('文件限制',h('p',null,'最大 32 MiB、300 页、200,000 字符（文本最多 512 KiB），提取最多 60 秒。扫描页不做文字识别，超出字符上限的文字会截断。')),
   h('div',{ref:host,'data-testid':'pdf-isolation-host'}));
 }
 return h('section',{'data-testid':'pdf-intake-panel',style:box},h(guided?'h3':'h2',null,guided?'提取 PDF 正文':typeof onPrepared==='function'?'原位挂接：实验性 PDF 文本提取':'实验性本地 PDF 文本提取'),
 h('p',null,guided?'选择可信 PDF，在本机提取正文。最多 32 MiB、300 页和 200,000 字符，扫描页暂不支持 OCR。':'默认关闭；单文件 ≤32 MiB、≤300 页、最多 200,000 字符、总截止 60 秒。不联网上传、不执行 PDF 脚本、不做 OCR；浏览器 Worker 不是硬内存沙箱，只处理你信任的文件。'),
 h('label',null,h('input',{type:'checkbox','data-testid':'pdf-enable',checked:enabled,disabled,onChange:e=>{clear();setEnabled(e.target.checked)}}),guided?'启用本次 PDF 导入':'启用本次实验性 PDF 导入'),
 enabled?h(React.Fragment,null,h('p',null,guided?'确认后将正文存入论文库。原 PDF 可在「归档与备份」的原件库另存。':'采用锁定 PDF.js 的派生 classic Worker 兼容构建，不代表所有 PDF 兼容。本次提取不会保存原 PDF 文件；仅确认后的文本和机器生成来源说明进入研究档案。归档区的独立原件库需另行启用、选择文件并确认，项目便携备份仍不包含它。'),
 h('label',null,h('input',{type:'checkbox','data-testid':'pdf-risk',checked:risk,disabled:busy||disabled,onChange:e=>setRisk(e.target.checked)}),'我理解上述限制，本次只选择可信 PDF（每次选择需重新确认）'),
 h('input',{type:'file',accept:'.pdf,application/pdf','aria-label':'选择实验性 PDF',disabled:!risk||busy||disabled,onChange:choose,style:field}),
 button('取消 PDF 提取或预览',()=>{clear();setMessage(outcome?'已取消当前提取或预览；下方导入结果保留，未撤销已建档内容，不自动重试。':'已取消；未保存预览，不自动重试。')}),
 preview?h('div',{'data-testid':'pdf-preview'},h('h3',null,typeof onPrepared==='function'?'待确认：仅将提取结果交给原位挂接预览，不保存':'待确认：新建文本档案，不替换已有论文'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflow:'auto'}},JSON.stringify(preview.payload,null,2)),h('p',null,'PDF 原始字节 SHA-256 与提取文本 SHA-256 是不同对象的哈希；机器生成来源说明不是独立真实性认证。截断结果不是全文；OCR=false 不代表扫描内容已识别。[PDF page N] 只是可被正文伪装的显示标记，不是认证页码或引用定位。'),h('label',null,h('input',{type:'checkbox','data-testid':'pdf-confirm-ack',checked:ack,disabled:busy,onChange:e=>setAck(e.target.checked)}),typeof onPrepared==='function'?'已核对提取结果，只交给原位挂接预览，仍需另行确认保存':'已核对预览，明确确认只新建文本档案'),button(typeof onPrepared==='function'?'使用这份提取结果预览原位挂接':'确认新建 PDF 提取文本档案',confirm,!ack||busy||disabled)):null):null,
 outcome?h('section',{'data-testid':'pdf-import-outcome'},h('h3',null,'本次 PDF 提取文本导入结果'),h('p',{role:'status'},outcomeMessage(outcome.persistence)),h('p',null,'本次文本导入没有保存原 PDF，也未自动关联独立原件库、项目或执行研究；未自动重试。请独立保留原件，并在刷新前主动导出和核对研究档案。'),h('p',null,'PDF 原始字节与提取文本的哈希对应不同对象；这些机器生成记录不是独立来源认证。[PDF page N] 不是认证页码或引用定位；截断和未识别的扫描内容不构成全文。'),h('details',null,h('summary',null,'查看本次文本和提取说明'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflow:'auto'}},JSON.stringify(outcome.payload,null,2))),button('下载当前内存基础档案',()=>onExport(),typeof onExport!=='function'),h('p',null,'导出为明文基础档案，包含已导入文本；不包含原 PDF、独立项目模块或未提交表单，不是完整项目备份。此入口下载裸 JSON，旧格式恢复上限为 4,000,000 UTF-8 字节；可在「基础档案备份与恢复」尝试下载较大档案；能否恢复取决于文件大小、内容和浏览器空间。')):null,
 message?h('p',{role:'status'},message):null,h('div',{ref:host,'data-testid':'pdf-isolation-host'}));
}
