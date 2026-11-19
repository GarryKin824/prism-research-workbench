// Offline, byte-preserving original-file bundle. No project restore or PDF parser.
function PdfOriginalBundlePanel({store}) {
 let namespace=null;try{namespace=store?.getStorageKey()}catch{}
 const captureScope=React.useMemo(()=>({store,namespace}),[store,namespace]);
 const scopeRef=React.useRef(captureScope);scopeRef.current=captureScope;
 const mounted=React.useRef(false),uiEpoch=React.useRef({capture:0,viewer:0});
 const [,refresh]=React.useState(0),[messages,setMessages]=React.useState({capture:'',viewer:''});
 const notify=(lane,message)=>{if(mounted.current)setMessages(old=>({...old,[lane]:message}))};
 const makeController=()=>createPdfOriginalBundleController({
  getCaptureContext(){const source=scopeRef.current;try{return source.store?.getStorageKey()===source.namespace?source:null}catch{return null}},
  createVault(value){let indexedDB,crypto,BlobType;try{indexedDB=globalThis.indexedDB}catch{}try{crypto=globalThis.crypto}catch{}try{BlobType=globalThis.Blob}catch{}return createPdfOriginalVaultController({namespace:value,indexedDB,crypto,Blob:BlobType})},
  requestDownload(blob,name,isCurrent){
   if(!isCurrent()||typeof document==='undefined'||!document||typeof document.createElement!=='function'||typeof URL==='undefined'||!URL||typeof URL.createObjectURL!=='function'||typeof URL.revokeObjectURL!=='function')return false;let url;
   try{
    url=URL.createObjectURL(blob);if(!isCurrent())return false;
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;if(!isCurrent())return false;
    anchor.click();const released=url;url=null;setTimeout(()=>{try{URL.revokeObjectURL(released)}catch{}},1000);return true;
   }finally{if(url)try{URL.revokeObjectURL(url)}catch{}}
  }
 });
 const ctlRef=React.useRef(null);if(!ctlRef.current)ctlRef.current=makeController();
 const state=ctlRef.current.getState();
 React.useLayoutEffect(()=>{
  mounted.current=true;if(ctlRef.current.getState().closed)ctlRef.current=makeController();
  const unsubscribe=ctlRef.current.subscribe(()=>{if(mounted.current)refresh(value=>value+1)});refresh(value=>value+1);
  const leave=event=>{if(event.detail?.kind==='slot'&&event.detail?.namespace===scopeRef.current.namespace){uiEpoch.current.capture++;ctlRef.current.invalidateCapture();notify('capture','档案槽正在切换；旧捕获和下载同意已撤回。所选离线文件不受影响。')}};
  const eventDocument=typeof document!=='undefined'?document:null;eventDocument?.addEventListener?.('prism-planning-leave',leave);
  return()=>{mounted.current=false;uiEpoch.current.capture++;uiEpoch.current.viewer++;unsubscribe();ctlRef.current.close();eventDocument?.removeEventListener?.('prism-planning-leave',leave)};
 },[]);
 React.useLayoutEffect(()=>{uiEpoch.current.capture++;ctlRef.current.invalidateCapture();notify('capture','')},[captureScope]);
 const errorText=code=>{
  const texts={
   CONSENT_REQUIRED:'请先明确同意对应的本地读取，尚未开始读取。',CONFIRMATION_REQUIRED:'请先对这一次下载明确确认。',
   INVALID_NAMESPACE:'当前完整档案槽不可用，未打开原件库；仍可在下方核验离线文件。',
   VAULT_ABSENT:'当前档案槽尚无原件库；未新建数据库，也未读取其他槽。',EMPTY_BUNDLE:'本次快照没有 PDF 原件，未生成空包。',
   UNSUPPORTED:'当前环境缺少本操作所需能力，已停止；未联网或改用其他存储。',
   SOURCE_CHANGED:'当前档案槽或来源已变化，旧预览不可用于下载。请重新明确捕获。',
   CANCELLED:'操作的同意、选择或页面上下文已变化，旧结果未用于后续下载。',
   BUSY:'已有操作正在等待结果，未重复启动。',CLOSED:'此入口已关闭，未开始新操作。',
   INVALID_FILE:'请选择一个非空、名称合规的原件包文件；只读取你明确选择的这一份文件。',
   PACKET_TOO_LARGE:'原件包超过 32 MiB 编码上限，未读取文件内容。',INPUT_CHANGED:'所选文件元数据或读取长度变化，已拒绝使用。',
   INVALID_UTF8:'文件不是严格 UTF-8，未显示可提取的原件。',NON_CANONICAL_PACKET:'文件不是受支持的原件包规范编码；请使用原样保存的导出包，未提供部分提取。',
   INVALID_SCHEMA:'原件包结构不受支持，未提供部分提取。',INVALID_PACKET:'原件包格式无效，未提供部分提取。',
   INVALID_BASE64:'原件字节编码不合法，整包拒绝提取。',DUPLICATE_ID:'原件包出现重复标识，整包拒绝提取。',
   VERIFY_FAILED:'字节大小或 SHA-256 核验失败，整包拒绝提取；保留外部原件。',
   NOT_PDF_HEADER:'存在缺少受支持 PDF 头标记的条目，整包拒绝提取。',LIMIT_EXCEEDED:'原件包超出 32 份、单份 32 MiB 或合计 40 MiB 限制。',
   CORRUPT_RECORD:'原件库存在异常记录，未把失败当作空库，也未提供不完整包。',
   REFRESH_REQUIRED:'原件库仍存在未确认结果；本入口不会清除或替代原件库的核对流程。',
   NO_PREVIEW:'尚无当前可下载的完整原件包预览。',NO_SELECTION:'请先选择一份已经整包核验的原件。',
   DOWNLOAD_UNSUPPORTED:'当前环境不能请求下载。',DOWNLOAD_FAILED:'下载请求失败或未确认；请核对浏览器，不会自动重试。'
  };
  return (texts[code]||'操作未完成；未自动重试、覆写或删除。请保留外部原件，并自行核对环境。')+'（'+(code||'UNKNOWN_ERROR')+'）';
 };
 async function run(lane,action){
  const ctl=ctlRef.current;if(ctl.getState()[lane==='capture'?'captureBusy':'viewerBusy'])return;
  const epoch=++uiEpoch.current[lane],source=scopeRef.current;notify(lane,'');
  try{const value=await action(ctl);if(!mounted.current||epoch!==uiEpoch.current[lane]||(lane==='capture'&&scopeRef.current!==source))return;
   const success={CAPTURED:'已只读捕获并核验当前槽的全部原件。以下清单是本次快照，不保证之后仍为最新；尚未请求下载。',INSPECTED:'整个所选原件包已通过结构、大小、编码和字节哈希核验。来源槽仅为未受认证的标注，不会选择或打开任何数据库。',DOWNLOAD_REQUESTED:'已请求下载原件包；浏览器接受请求不证明磁盘已保存。请自行重新选择该文件核验，并保留外部原件。',EXTRACTION_REQUESTED:'已请求下载所选原件的精确 PDF 字节；不证明磁盘已保存。请自行核对文件；没有写入原件库或当前项目。'};
   notify(lane,value.ok?(success[value.code]||value.code):errorText(value.code));
  }catch{if(mounted.current&&epoch===uiEpoch.current[lane])notify(lane,errorText('OPERATION_FAILED'))}
 }
 function consent(lane,method,value){uiEpoch.current[lane]++;ctlRef.current[method](value);notify(lane,value?'尚未自动读取或下载，请主动执行下一步。':'已撤回后续操作同意，旧操作结果不会用于新的下载。')}
 function clear(lane){uiEpoch.current[lane]++;ctlRef.current[lane==='capture'?'clearCapture':'clearViewer']();notify(lane,'已清除本页预览和下载同意；未修改原件库、当前项目或外部文件。')}
 function choose(event){const files=Array.from(event.target.files||[]);event.target.value='';if(!ctlRef.current.getState().readConsent||ctlRef.current.getState().viewerBusy)return;if(files.length!==1){clear('viewer');if(files.length)notify('viewer','每次只选择一个原件包文件。');return}run('viewer',ctl=>ctl.inspectFile(files[0]))}
 const summaryView=(summary,testId)=>h('div',{'data-testid':testId,style:{overflowWrap:'anywhere'}},
  h('p',null,'共 '+summary.fileCount+' 份 PDF 原件，原始字节合计 '+summary.totalBytes+'。'),
  h('p',null,'来源完整槽（仅标注）：'+summary.namespace),h('p',null,'原件包内容 SHA-256：'+summary.packetSha256),
  h('ul',null,summary.files.map(file=>h('li',{key:file.id},h('strong',null,file.name),h('p',null,file.size+' 字节；SHA-256：'+file.sha256)))),
  h('p',null,'哈希和 PDF 头标记不证明文件安全、有效、作者身份、来源或研究结论。'));
 const selected=state.viewerSummary?.files.find(file=>file.id===state.selectedId);
 return h('section',{'data-testid':'pdf-original-bundle-panel',style:{...box,marginTop:16}},
  h('h2',null,'PDF 原件包 · 批量备份字节与离线逐份提取'),
  h('p',{'data-testid':'pdf-bundle-boundary'},'这是独立 PDF 原件库的文件字节备份，不是完整项目备份，也不能恢复可编辑项目、论文关联或研究状态。最多 32 份、单份 32 MiB、原始合计 40 MiB，编码包最多 56 MiB。超出整包容量时，请从原件库逐份下载。本工具不自动写入原件库。'),
  h('p',{'data-testid':'pdf-bundle-privacy'},'默认不读取文件或打开原件库。原件包和提取 PDF 都是明文，拿到文件的人可以读取；同源脚本也可能访问本页字节。本功能不联网、不解析 PDF、不做恶意软件扫描或来源认证。始终保留外部原件；浏览器存储和下载均不保证永久保存。'),
  h('h3',null,'1. 从当前独立原件库捕获全部原件'),
  h('p',null,'此入口只做一次只读快照，不清除原件库的写入结果未知状态。主档案损坏不应阻止独立原件核验。'),
  h('p',{style:{overflowWrap:'anywhere'}},'当前完整槽：'+(typeof namespace==='string'?namespace.slice(0,1024):'不可用；下方离线查看仍可使用')),
  h('label',null,h('input',{type:'checkbox','data-testid':'pdf-bundle-capture-consent',checked:state.captureConsent,onChange:event=>consent('capture','setCaptureConsent',event.target.checked)}),' 我同意主动读取当前槽的全部原件字节，生成仅在本页的明文预览'),
  h('button',{type:'button',style:secondary,'data-testid':'pdf-bundle-capture',disabled:!state.captureConsent||state.captureBusy,onClick:()=>run('capture',ctl=>ctl.capture())},'只读捕获并核验全部原件'),
  h('button',{type:'button',style:secondary,'data-testid':'pdf-bundle-clear-capture',onClick:()=>clear('capture')},'清除捕获预览'),
  state.captureSummary?h(React.Fragment,null,summaryView(state.captureSummary,'pdf-bundle-capture-preview'),h('p',null,'编码包：'+state.captureByteLength+' 字节。清单列出全部条目，不在页面显示大段 Base64。'),
   h('label',null,h('input',{type:'checkbox','data-testid':'pdf-bundle-download-consent',checked:state.downloadConsent,onChange:event=>consent('capture','setDownloadConsent',event.target.checked)}),' 我已核对全部条目，同意这一次下载明文原件包，并会确认磁盘保存'),
   h('button',{type:'button',style:secondary,'data-testid':'pdf-bundle-download',disabled:!state.downloadConsent||state.captureBusy,onClick:()=>run('capture',ctl=>ctl.downloadBundle())},'下载这份原件包')):null,
  state.captureBusy?h('p',{role:'status'},'正在读取或核验快照；未自动重试。'):null,
  messages.capture?h('p',{'data-testid':'pdf-bundle-capture-message',role:'status'},messages.capture):null,
  h('h3',null,'2. 离线核验所选原件包并提取一份 PDF'),
  h('p',null,'不需要当前原件库、IndexedDB 或健康的主档案。文件中的命名空间只是来源标注，不会切换档案槽或打开存储。必须整个文件核验通过后才提供任何提取。请选择原样保存的导出包，不要手动编辑 JSON、改动空格或键顺序。'),
  h('label',null,h('input',{type:'checkbox','data-testid':'pdf-bundle-read-consent',checked:state.readConsent,onChange:event=>consent('viewer','setReadConsent',event.target.checked)}),' 我同意在本页读取、核验我主动选择的明文原件包'),
  h('label',null,'选择一个原件包（≤32 MiB）',h('input',{type:'file',accept:'.json,application/json','data-testid':'pdf-bundle-file',style:field,disabled:!state.readConsent||state.viewerBusy,onChange:choose})),
  h('button',{type:'button',style:secondary,'data-testid':'pdf-bundle-clear-viewer',onClick:()=>clear('viewer')},'清除所选文件预览'),
  state.viewerSummary?h(React.Fragment,null,h('p',{style:{overflowWrap:'anywhere'}},'所选文件：'+state.selectedFile.name+' · '+state.selectedFile.size+' 字节'),summaryView(state.viewerSummary,'pdf-bundle-viewer'),
   h('label',null,'选择一份已核验原件',h('select',{'data-testid':'pdf-bundle-selected-original',value:state.selectedId,disabled:state.viewerBusy,onChange:event=>{uiEpoch.current.viewer++;ctlRef.current.selectOriginal(event.target.value);notify('viewer','')}},h('option',{value:''},'请选择，不自动选中'),state.viewerSummary.files.map(file=>h('option',{key:file.id,value:file.id},file.name+' · '+file.size+' 字节 · '+file.sha256)))),
   selected?h('p',{style:{overflowWrap:'anywhere'}},'本次选择：'+selected.name+'；下载名为 PRISM-original-'+selected.id+'.pdf，原始名称仅作元数据保留。'):null,
   h('label',null,h('input',{type:'checkbox','data-testid':'pdf-bundle-extract-consent',checked:state.extractConsent,disabled:!selected,onChange:event=>consent('viewer','setExtractConsent',event.target.checked)}),' 我同意这一次下载所选 PDF 的精确明文字节；不会写入当前项目或原件库'),
   h('button',{type:'button',style:secondary,'data-testid':'pdf-bundle-extract',disabled:!state.extractConsent||state.viewerBusy,onClick:()=>run('viewer',ctl=>ctl.extractSelected())},'提取并下载所选 PDF')):null,
  state.viewerBusy?h('p',{role:'status'},'正在核验所选文件或请求提取；没有导入或写入存储。'):null,
  messages.viewer?h('p',{'data-testid':'pdf-bundle-viewer-message',role:'status'},messages.viewer):null);
}
