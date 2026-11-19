const zoteroMessages={
 ZOTERO_UNREACHABLE:'无法连接 Zotero。请确认桌面应用已运行，并使用默认本地端口。',
 ZOTERO_DISABLED:'Zotero 本地访问未启用。请在 Zotero 的「设置 → 高级」中开启「允许这台电脑上的其他应用与 Zotero 通信」。',
 ZOTERO_UNSUPPORTED:'当前 Zotero 本地接口或响应不受支持。',
 ZOTERO_HOST_UNAVAILABLE:'当前工作台未启用 Zotero 本地接入。',
 ZOTERO_TIMEOUT:'Zotero 响应超时，请刷新后重试。',
 ZOTERO_LIBRARY_CHANGED:'Zotero 数据库已更换。请重新连接并选择文献。',
 ZOTERO_NOT_FOUND:'Zotero 条目或文件夹已不可用，请刷新列表。',
 ZOTERO_PDF_UNSUPPORTED:'无法通过支持的本机接口读取此附件。',
 ZOTERO_PDF_MISSING:'本机没有这份附件。可先在 Zotero 打开附件确认是否已下载。',
 ZOTERO_PDF_TOO_LARGE:'原件超过 32 MiB，无法在当前原件库保存。',
 ZOTERO_PDF_INVALID:'附件内容无法识别为 PDF。',
 ZOTERO_PDF_CHANGED:'附件版本或文件已变化，请关闭预览后重新选取。',
 ZOTERO_PDF_NOT_READABLE:'当前用户无法读取这份附件。',
 ZOTERO_PDF_VAULT:'原件库未能确认保存；本次只导入书目。请在原件库核对后再补存。',
 PDF_NO_TEXT_NO_OCR:'没有可提取的文字。可以保留 PDF 原件，扫描件暂不做文字识别。',
 PDF_PAGE_LIMIT:'超过 300 页，未能提取文字；可保留 PDF 原件。',
 PDF_PASSWORD_REQUIRED:'文件需要密码。可保留 PDF 原件，正文需另外提供。',
 PDF_TIMEOUT:'提取文字超时；可保留 PDF 原件。',
 DUPLICATE_ZOTERO_ITEM:'同一 Zotero 条目已导入。',
 DUPLICATE_DOI:'已有相同 DOI 的论文。',
 ZOTERO_PREVIEW_STALE:'论文库已变化。请取消预览并重新核对。',
};
const zoteroMessage=code=>zoteroMessages[code]||'操作未完成，请核对状态后重试。';

function ZoteroImportPanel({store,disabled,active,scopeToken,onOpenPaper}) {
 const {ZOTERO_ROUTE,ZOTERO_BATCH_SIZE,zoteroMetadata,zoteroDuplicate,zoteroPdfExtraction,zoteroFilename}=zoteroImportCore;
 const [connection,setConnection]=React.useState(null),[scope,setScope]=React.useState({group:'',path:[],query:''});
 const [query,setQuery]=React.useState(''),[page,setPage]=React.useState(null),[folders,setFolders]=React.useState(null);
 const [selected,setSelected]=React.useState([]),[preview,setPreview]=React.useState(null),[outcomes,setOutcomes]=React.useState([]);
 const [busy,setBusy]=React.useState(''),[notice,setNotice]=React.useState(''),[problem,setProblem]=React.useState('');
 const pending=React.useRef(null),availability=React.useRef(null),parserHost=React.useRef(null),previewHeading=React.useRef(null);
 const previewButton=React.useRef(null),searchForm=React.useRef(null),connectionButton=React.useRef(null);
 availability.current={store,scopeToken,active,disabled};
 const titleId=React.useId();
 const local=window.__PRISM_ZOTERO_LOCAL__===true;
 const snapshot=React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const queryScope=(source,browse)=>({server:source.serverId??'',...(browse.group?{group:browse.group}:{})});

 async function read(op,params,signal,binary=false){
  const response=await fetch(ZOTERO_ROUTE+'?'+new URLSearchParams({op,...params}),
   {method:'GET',headers:{'X-PRISM-Zotero':'read'},credentials:'same-origin',redirect:'error',cache:'no-store',signal});
  if (!response.ok) {
   const data=await response.json().catch(()=>null);
   throw Error(data?.code??'ZOTERO_HOST_UNAVAILABLE');
  }
  if (!binary) return response.json();
  let filename;
  try {filename=decodeURIComponent(response.headers.get('X-PRISM-Filename')??'')} catch {}
  if (!zoteroFilename(filename)||response.headers.get('Content-Type')!=='application/pdf')throw Error('ZOTERO_PDF_INVALID');
  return new File([await response.blob()],filename,{type:'application/pdf'});
 }

 function cancelWork(){
  const work=pending.current;
  pending.current=null;
  work?.abort.abort();
 }
 React.useLayoutEffect(()=>{
  if (!active || disabled) {
   cancelWork();
   setBusy('');
   setPreview(null);
  }
 },[active,disabled,store,scopeToken]);
 React.useLayoutEffect(()=>{
  setBusy('');setSelected([]);setPreview(null);setOutcomes([]);
  return ()=>cancelWork();
 },[store,scopeToken]);
 React.useLayoutEffect(()=>{if(preview)previewHeading.current?.focus()},[Boolean(preview)]);

 async function run(label,job){
  if (pending.current||!active||disabled)return;
  const work={abort:new AbortController()};
  pending.current=work;
  const live=()=>pending.current===work && !work.abort.signal.aborted && availability.current.active
    && !availability.current.disabled && availability.current.store===store && availability.current.scopeToken===scopeToken;
  setBusy(label);
  setProblem('');
  setNotice('');
  try{await job(work.abort.signal,live)}
  catch(error){
   if(live()){
    setProblem(zoteroMessage(error.message));
    if(['ZOTERO_LIBRARY_CHANGED','ZOTERO_DISABLED','ZOTERO_UNREACHABLE','ZOTERO_HOST_UNAVAILABLE'].includes(error.message)){
     setConnection(null);setPage(null);setFolders(null);setSelected([]);setPreview(null);
    }
   }
  }finally{if(pending.current===work){pending.current=null;setBusy('')}}
 }

 async function browse(source,next,signal,{itemsAt=0,foldersAt=0,includeFolders=true}={}){
  const filter={...queryScope(source,next),...(next.path.length?{folder:next.path.at(-1).key}:{})};
  const [items,collections]=await Promise.all([
   read('items',{...filter,start:itemsAt,q:next.query},signal),
   includeFolders?read('folders',{...filter,start:foldersAt},signal):null,
  ]);
  return {items:{...items,start:itemsAt},collections};
 }

 function connect(refresh=false){
  const next=refresh?scope:{group:'',path:[],query:''};
  return run('正在读取 Zotero…',async(signal,live)=>{
   const source=await read('connect',{},signal);
   const kept=(!refresh||source.serverId===connection?.serverId)&&(!next.group||source.groups.some(g=>g.id===Number(next.group)));
   const destination=kept?next:{group:'',path:[],query:''};
   const data=await browse(source,destination,signal);
   if(!live())return;
   setQuery(destination.query);setScope(destination);setFolders(data.collections);setPage(data.items);setConnection(source);
   setSelected([]);setPreview(null);
   setNotice(refresh?'已刷新 Zotero 文献。':'已连接本机 Zotero（只读）。');
  });
 }

 function changeBrowse(next,{start=0,newScope=true}={}){
  return run('正在读取文献…',async(signal,live)=>{
   const data=await browse(connection,next,signal,{itemsAt:start,includeFolders:newScope});
   if(!live())return;
   setScope(next);setPage(data.items);setPreview(null);
   if(newScope){setFolders(data.collections);setSelected([])}
   requestAnimationFrame(()=>{
    if(document.activeElement===document.body)searchForm.current?.querySelector('input')?.focus();
   });
  });
 }

 function moreFolders(){
  return run('正在读取文件夹…',async(signal,live)=>{
   const filter={...queryScope(connection,scope),...(scope.path.length?{folder:scope.path.at(-1).key}:{})};
   const result=await read('folders',{...filter,start:folders.next},signal);
   if(live())setFolders({folders:[...folders.folders,...result.folders],next:result.next});
  });
 }

 function disconnect(){
  cancelWork();
  setBusy('');setConnection(null);setPage(null);setFolders(null);setQuery('');
  setSelected([]);setPreview(null);setProblem('');setNotice('已断开。本次浏览和选择已清除。');
  requestAnimationFrame(()=>connectionButton.current?.focus());
 }

 function prepare(){
  return run('正在核对所选书目…',async(signal,live)=>{
   const revision=store.getSnapshot().revision;
   const rows=await Promise.all(selected.map(async item=>{
    try {
     const result=await read('preview',{...queryScope(connection,scope),item:item.itemKey},signal);
     const supported=result.attachments.filter(value=>value.mode==='stored');
     return {...result,attachment:supported.length===1?supported[0].key:'',file:null,parsed:null,pdfProblem:''};
    }catch(error){return {item,error:error.message}}
   }));
   if(live())setPreview({revision,rows});
  });
 }

 function updateRow(key,changes){
  setPreview(old=>old&&{...old,rows:old.rows.map(row=>row.item.itemKey===key?{...row,...changes}:row)});
 }

 function checkPdf(row){
  return run('正在本机核对 PDF…',async(signal,live)=>{
   const key=row.item.itemKey;
   const attachment=row.attachments.find(entry=>entry.key===row.attachment&&entry.mode==='stored');
   if(!attachment)return;
   updateRow(key,{file:null,parsed:null,pdfProblem:''});
   let file;
   try {
    file=await read('pdf',{...queryScope(connection,scope),item:key,attachment:attachment.key,version:attachment.version},signal,true);
   }catch(error){if(live())updateRow(key,{pdfProblem:zoteroMessage(error.message)});return}
   if(!live())return;
   const context={namespace:store.getStorageKey(),revision:preview.revision,selectedPaperId:null};
   let parser,parsed=null,pdfProblem='';
   const cancel=()=>parser?.cancel();
   signal.addEventListener('abort',cancel,{once:true});
   try {
    parser=createPdfIntake({mount:parserHost.current,getContext:()=>({...context,revision:store.getSnapshot().revision})});
    parsed=await parser.run(file,{confirmed:true,context});
   }catch(error){pdfProblem=zoteroMessages[error.message]||'未能提取正文；可以保留 PDF 原件。'}
   finally{signal.removeEventListener('abort',cancel);parser?.destroy()}
   if(live())updateRow(key,{file,parsed,pdfProblem});
  });
 }

 function cancelPreview(){
  cancelWork();
  setBusy('');setPreview(null);setProblem('');setNotice('已取消导入预览。');
  requestAnimationFrame(()=>previewButton.current?.focus());
 }

 function save(){
  return run('正在保存到 PRISM…',async(signal,live)=>{
   let revision=preview.revision;
   const stable=()=>live()&&store.getSnapshot().revision===revision;
   if(!stable())throw Error('ZOTERO_PREVIEW_STALE');
   store.assertCurrentStorage();
   const result=[];
   setOutcomes([]);
   for(const row of preview.rows){
    if(!stable())break;
    store.assertCurrentStorage();
    const title=row.item.title;
    if(row.error){result.push({title,message:zoteroMessage(row.error)});continue}
    const before=store.getSnapshot();
    const duplicate=zoteroDuplicate(before.papers,zoteroMetadata(row.item,row.attachments));
    if(duplicate){
     result.push({title,paperId:duplicate.paper.id,message:duplicate.kind==='item'?'同一 Zotero 条目已存在，已跳过。':'已有相同 DOI 的论文，已跳过。'});
     continue;
    }
    let original=null,extract=null,document,originalMessage='';
    if(row.file){
     const vault=createPdfOriginalVaultController({namespace:store.getStorageKey()});
     try{
      const prepared=await vault.prepare(row.file,{isCurrent:stable});
      const saved=prepared.ok?await vault.commit(prepared.preview,{explicitConfirmation:true,isCurrent:stable}):prepared;
      if(saved.ok||saved.code==='DUPLICATE'){
       const {sha256:pdfSha256,size:byteLength}=saved.record;
       original={attachmentKey:row.attachment,pdfSha256,byteLength,filename:row.file.name};
       originalMessage='PDF 原件已保存。';
       if(row.parsed&&row.parsed.metadata.pdfSha256===pdfSha256){
        extract=zoteroPdfExtraction(row.parsed);
        document=pdfPreparedImport(row.parsed).document;
       }
      }else originalMessage=zoteroMessage('ZOTERO_PDF_VAULT');
     }finally{vault.close()}
    }
    if(!stable())break;
    try {
     const after=await store.dispatch({type:'importZoteroItem',revision,title,
      metadata:zoteroMetadata(row.item,row.attachments,original,extract),document,signal,isCurrent:stable});
     revision=after.revision;
     const paper=after.papers.at(-1);
     result.push({title,paperId:paper.id,message:(after.persistence.saved?'书目已保存。':'浏览器未确认保存，内容仍在当前页面。请先导出核对。')
      +(paper.document?(extract.truncated?'提取的正文已截断。':'已导入提取的正文。'):document?'同样的正文已在论文库，本条目保留书目和原件。':'')
      +originalMessage+(row.pdfProblem?' '+row.pdfProblem:'')});
     if(!after.persistence.saved)break;
    }catch(error){
     result.push({title,message:zoteroMessage(error.message)+(original?'PDF 原件已保留在原件库。':originalMessage)});
     if(!['DUPLICATE_ZOTERO_ITEM','DUPLICATE_DOI','INVALID_ZOTERO_SOURCE'].includes(error.message))break;
    }
    if(live())setOutcomes([...result]);
   }
   if(live()){
    setOutcomes(result);setPreview(null);setSelected([]);
    setNotice(result.length===preview.rows.length?'本次导入已结束。':'本次导入已停止。请核对已处理的条目，再重新选择其余文献。');
   }
  });
 }

 const duplicateFor=item=>zoteroDuplicate(snapshot.papers,zoteroMetadata(item,[]));
 const button=(label,onClick,options)=>guidedButton(label,onClick,options);
 const pageStart=page?.start??0;
 const connected=!!connection;
 return h('section',{className:'prism-zotero prism-form','aria-labelledby':titleId,'data-testid':'zotero-intake'},
  h('h3',{id:titleId},'Zotero'),
  h('div',{className:'prism-actions'},
   connected?button('刷新 Zotero',()=>connect(true),{disabled:!!busy||disabled}):
    h('button',{type:'button',ref:connectionButton,className:'prism-primary',onClick:()=>connect(),disabled:!!busy||disabled||!local},'连接 Zotero'),
   connected?button('断开 Zotero',disconnect,{disabled:busy==='正在保存到 PRISM…'}):null,
   busy&&busy!=='正在保存到 PRISM…'?button('取消当前操作',()=>{cancelWork();setBusy('');setNotice('已取消当前操作。')}):null),
  !local?h('p',null,zoteroMessage('ZOTERO_HOST_UNAVAILABLE')):null,
  !connected?h('p',{className:'prism-muted'},'读取本机 Zotero 的文献和已下载附件。需要 Zotero 桌面应用处于运行状态。'):null,
  connected?h('p',{className:'prism-muted'},'本机已连接 · 只读',connection.groupsUnavailable?' · 当前无法列出群组库':'',connection.moreGroups?' · 仅显示前 100 个群组库':''):null,
  busy||notice?h('p',{role:'status'},busy||notice):null,
  problem?h('p',{role:'alert'},problem):null,
  connected&&!preview?h(React.Fragment,null,
   h('div',{className:'prism-zotero-filters'},
    h('label',null,'文献库',h('select',{'aria-label':'文献库',value:scope.group,disabled:!!busy,onChange:event=>{
     setQuery('');changeBrowse({group:event.target.value,path:[],query:''})
    }},h('option',{value:''},'个人文献库'),connection.groups.map(group=>h('option',{key:group.id,value:group.id},group.name)))),
    h('form',{ref:searchForm,className:'prism-actions',onSubmit:event=>{event.preventDefault();changeBrowse({...scope,query:query.trim()})}},
     h('label',null,'搜索 Zotero 文献',h('input',{type:'search',maxLength:300,value:query,onChange:event=>setQuery(event.target.value)})),
     h('button',{type:'submit',disabled:!!busy},'搜索'))),
   h('div',{className:'prism-zotero-folders'},
    h('p',null,'当前文件夹 · ',scope.path.map(folder=>folder.name).join(' / ')||'全部文献'),
    folders?.folders.length?h('label',null,'打开文件夹',
     h('select',{'aria-label':'打开文件夹',value:'',disabled:!!busy,onChange:event=>{
      const folder=folders.folders.find(item=>item.key===event.target.value);
      if(folder)changeBrowse({...scope,path:[...scope.path,folder]});
     }},h('option',{value:''},'选择子文件夹'),folders.folders.map(folder=>h('option',{key:folder.key,value:folder.key},folder.name)))):null,
    scope.path.length?button('返回上级文件夹',()=>changeBrowse({...scope,path:scope.path.slice(0,-1)}),{disabled:!!busy}):null,
    folders?.next!==null&&folders?.next!==undefined?button('载入更多文件夹',moreFolders,{disabled:!!busy}):null),
   page?.items.length?h('ul',{className:'prism-zotero-list','aria-label':'Zotero 文献'},page.items.map(item=>{
    const checked=selected.some(saved=>saved.itemKey===item.itemKey);
    const duplicate=duplicateFor(item);
    return h('li',{key:item.itemKey},h('label',null,
     h('input',{type:'checkbox',checked,disabled:!!busy||!checked&&selected.length>=ZOTERO_BATCH_SIZE,
      onChange:event=>setSelected(old=>event.target.checked?[...old,item]:old.filter(saved=>saved.itemKey!==item.itemKey))}),
     h('span',null,h('strong',null,item.title),h('small',null,[item.authors.join('、'),item.year,item.publication].filter(Boolean).join(' · ')),
      duplicate?h('small',null,duplicate.kind==='item'?'同一 Zotero 条目已导入':'已有相同 DOI 的论文'):null)));
   })):h('p',{className:'prism-muted'},scope.query?'这一页没有符合条件的书目。':'这一页没有可导入的书目。'),
   h('div',{className:'prism-actions'},
    h('button',{type:'button',ref:previewButton,className:'prism-primary',onClick:prepare,disabled:!!busy||!selected.length},'预览导入（'+selected.length+' / '+ZOTERO_BATCH_SIZE+'）'),
    pageStart>0?button('上一页',()=>changeBrowse(scope,{start:Math.max(0,pageStart-zoteroImportCore.ZOTERO_PAGE_SIZE),newScope:false}),{disabled:!!busy}):null,
    page?.next!==null&&page?.next!==undefined?button('下一页',()=>changeBrowse(scope,{start:page.next,newScope:false}),{disabled:!!busy}):null),
   ):null,
  preview?h('section',{className:'prism-form','aria-label':'Zotero 导入预览','data-testid':'zotero-import-preview'},
   h('h4',{ref:previewHeading,tabIndex:-1},'核对导入内容'),
   h('p',{className:'prism-muted'},'每篇可带一份已下载的 PDF。只核对你信任的文件。确认后保存到论文库，加入项目需另行确认。'),
   h('ul',{className:'prism-zotero-list'},preview.rows.map(row=>{
    const duplicate=!row.error&&duplicateFor(row.item);
    const options=row.attachments?.filter(entry=>entry.mode==='stored')??[];
    return h('li',{key:row.item.itemKey},h('strong',null,row.item.title),
     row.item.doi?h('small',null,'DOI '+row.item.doi):null,
     row.error?h('p',{role:'alert'},zoteroMessage(row.error)):null,
     duplicate?h('p',null,duplicate.kind==='item'?'同一 Zotero 条目已导入，本次跳过。':'已有相同 DOI 的论文，本次跳过。',
      ' ',duplicate.paper.title,' ',button('定位论文',()=>onOpenPaper(duplicate.paper.id))):null,
     !row.error&&!duplicate?h(React.Fragment,null,
      options.length?h('div',{className:'prism-actions'},
       h('label',null,'选择 PDF',h('select',{'aria-label':'选择 PDF',value:row.attachment,disabled:!!busy,onChange:event=>updateRow(row.item.itemKey,
        {attachment:event.target.value,file:null,parsed:null,pdfProblem:''})},h('option',{value:''},'只导入书目'),
        options.map(entry=>h('option',{key:entry.key,value:entry.key},entry.label)))),
       button('核对所选 PDF',()=>checkPdf(row),{disabled:!!busy||!row.attachment})):null,
      !row.attachments.length?h('p',null,row.otherAttachments?'已有附件，暂无受支持的 PDF。':'没有 PDF 附件。'):null,
      row.attachments.some(entry=>entry.mode==='unsupported')?h('p',null,'有 PDF 属于链接或不支持的附件类型。可在 Zotero 中打开后手动导入。'):null,
      row.moreAttachments?h('p',null,'仅核对前 100 个附件。'):null,
      row.attachment&&!row.file&&!row.pdfProblem?h('p',{className:'prism-muted'},'PDF 尚未核对。当前可以只导入书目。'):null,
      row.file?h('p',null,'确认导入时保留原件 · ',row.file.name,row.parsed?(row.parsed.metadata.truncated?' · 提取的正文已截断':' · 已提取正文'):''):null,
      row.pdfProblem?h('p',{role:'status'},row.pdfProblem):null,
      ):null);
   })),
   preview.revision!==snapshot.revision?h('p',{role:'alert'},zoteroMessage('ZOTERO_PREVIEW_STALE')):null,
   h('div',{className:'prism-actions'},
    button('确认导入 Zotero 文献',save,{primary:true,disabled:!!busy||preview.revision!==snapshot.revision
     ||!preview.rows.some(row=>!row.error&&!duplicateFor(row.item))}),
    button('取消预览',cancelPreview,{disabled:busy==='正在保存到 PRISM…'}))):null,
  outcomes.length?h('ul',{className:'prism-zotero-list','aria-label':'Zotero 导入结果'},outcomes.map((row,index)=>h('li',{key:index},
   h('strong',null,row.title),h('small',null,row.message),row.paperId?button('定位论文',()=>onOpenPaper(row.paperId)):null))):null,
  h('div',{ref:parserHost}));
}

function ZoteroPaperSource({paper}){
 const z=paper?.metadata?.zotero;
 if(!z)return null;
 return h('details',{className:'prism-zotero-source'},
  h('summary',null,'Zotero 来源',z.original?' · 已登记 PDF 原件':''),
  h('p',null,[paper.metadata.authors.join('、'),paper.metadata.year,paper.metadata.publication].filter(Boolean).join(' · ')),
  paper.metadata.doi?h('p',null,'DOI ',paper.metadata.doi):null,
  z.original?h('p',null,z.original.filename,z.extraction?.truncated?' · 正文提取已截断':''):null,
  h('details',null,h('summary',null,'来源标识'),
   h('dl',null,h('dt',null,'文献库'),h('dd',null,z.libraryType==='user'?'个人库':'群组库',' · ',z.libraryId),
    h('dt',null,'条目'),h('dd',null,z.itemKey,' · 版本 ',z.itemVersion),
    z.serverId?h(React.Fragment,null,h('dt',null,'本地数据库'),h('dd',null,z.serverId)):null,
    z.attachments.length?h(React.Fragment,null,h('dt',null,'PDF 附件'),h('dd',null,z.attachments.map(a=>a.key).join('、'))):null,
    z.original?h(React.Fragment,null,h('dt',null,'已登记原件的 SHA-256'),h('dd',null,z.original.pdfSha256)):null)));
}
