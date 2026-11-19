function DictionaryPanel({store,disabled=false,guided=false}){
 const withLock=typeof globalThis.navigator?.locks?.request==='function'?(name,fn)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},fn):undefined;
 const controller=React.useMemo(()=>createDictionaryController({store,storage:globalThis.localStorage,withLock}),[store]);
 const names={meaning:'含义/定义',unit:'单位',dataSource:'数据来源',sample:'样本/范围',specialCodes:'特殊编码/缺失值',transform:'变换/计算',versionNote:'口径版本说明'},labels={unknown:'未知',manual:'用户录入，未独立验证',ai_unverified:'AI 内容待验证，人工粘贴'};
 const [query,setQuery]=React.useState(''),[mode,setMode]=React.useState('active'),[sort,setSort]=React.useState('label'),[selected,setSelected]=React.useState([]);
 const panel=useAnnotationEditor(controller,store,disabled);
 const {info,draft:editor,preview,pending,notice,recovery}=panel;
 const fields=editor?.fields;
 const sources=info?.sources??[];
 const paperOptions=editor&&!sources.some(x=>x.paperId===editor.source.paperId)?[editor.source,...sources]:sources;
 const busy=pending!==null,replacementBlocked=busy&&pending!=='preview',editLocked=busy||!!recovery;
 function open(row=null){
  const entryId=row?.entryId??null;
  if(editor&&editor.entryId===entryId)return;
  const source=row?info.sources.find(x=>x.paperId===row.source.paperId):info.sources[0];
  if(source)panel.replaceDraft({entryId,source,label:row?.label||'',fields:row&&!row.stale?row.fields:dictionaryCore.emptyFields()});
 }
 function selectPaper(paperId){
  if(!editor||editor.entryId||paperId===editor.source.paperId)return;
  const source=info?.sources.find(x=>x.paperId===paperId);
  if(source)panel.replaceDraft({entryId:null,source,label:'',fields:dictionaryCore.emptyFields()});
 }
 function updateFields(update){
  panel.changeDraft(current=>{const fields=JSON.parse(JSON.stringify(current.fields));update(fields);return {...current,fields}});
 }
 function change(key,prop,value){
  updateFields(fields=>{
   if(prop==='status'&&value==='unknown')fields[key]={status:'unknown',text:'',evidence:[]};
   else fields[key][prop]=value;
  });
 }
 function evidence(key,index,prop,value){updateFields(fields=>{fields[key].evidence[index][prop]=value})}
 function archive(row){
  const expectedSource=info.sources.find(x=>x.paperId===row.source.paperId);
  if(!expectedSource||!panel.replaceDraft(null))return;
  return panel.prepare(()=>controller.prepareArchive({entryId:row.entryId,paperId:row.source.paperId,archived:!row.archived,expectedSource}));
 }
 function download(format){
  return panel.run('export',async current=>{
   const raw=await controller.exportData(format);
   if(!current())return;
   const u=URL.createObjectURL(new Blob([raw],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'})),a=document.createElement('a');
   a.href=u;a.download='PRISM-variable-dictionary.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
  });
 }
 if(disabled)return null;
 let rows=(info?.rows||[]).filter(r=>(mode==='all'||mode==='archived'?mode==='all'||r.archived:!r.archived)&&JSON.stringify([r.label,r.source.title,r.fields]).toLowerCase().includes(query.toLowerCase()));rows=[...rows].sort((a,b)=>sort==='paper'?a.source.title.localeCompare(b.source.title):a.label.localeCompare(b.label));const compared=(info?.rows||[]).filter(r=>selected.includes(r.entryId));
 function cell(row,key){const v=row.fields[key];return h('div',null,h('small',null,labels[v.status]),h('p',{style:{whiteSpace:'pre-wrap'}},v.text||'未知'),v.evidence.length?h('details',null,h('summary',null,'录入证据 '+v.evidence.length),v.evidence.map((e,i)=>h('div',{key:i},h('p',null,e.sourceLabel,' · ',e.locator),h('blockquote',{style:{whiteSpace:'pre-wrap'}},e.quote)))):h('small',null,'无录入证据'))}
 return h('section',{'data-testid':'dictionary-center',style:{...box,marginBottom:20}},h('h2',null,guided?'变量词典':'变量与数据口径词典'),guided?h(React.Fragment,null,h('p',{className:'prism-muted'},'共享论文库 · 变量定义、单位和计算口径'),guidedHelp('来源与版本说明',h(React.Fragment,null,h('p',null,'按论文分别记录变量定义、单位和计算口径。未知不补造；AI 标签只表示人工粘贴的待验证内容。不自动识别同名变量为同一指标，也不自动合并数据。每项的录入来源和证据数量不是可信度评分或真实性认证。'),h('p',null,'仅本地档案保存，不发送给模型/第三方。引用为人工录入，正文哈希沿用原档案。来源变化后旧内容明确失效；编辑从未知开始，旧历史保留。')))):h(React.Fragment,null,h('p',null,'按论文分别记录变量定义、单位和计算口径。未知不补造；AI 标签只表示人工粘贴的待验证内容。不自动识别同名变量为同一指标，也不自动合并数据。每项的录入来源和证据数量不是可信度评分或真实性认证。'),h('p',null,'仅本地档案保存，不发送给模型/第三方。引用为人工录入，正文哈希沿用原档案。来源变化后旧内容明确失效；编辑从未知开始，旧历史保留。')),!withLock?h('p',{role:'alert'},'缺少 Web Locks：只读，不能保存或归档。'):null,
 h('button',{style:secondary,disabled:busy||!!recovery,onClick:panel.refresh},'刷新变量词典'),h('button',{style:btn,disabled:replacementBlocked||!!recovery||!withLock||!info?.sources.length,onClick:()=>open()},'新增变量条目'),h('input',{'aria-label':'检索变量词典',placeholder:'变量名、论文或字段内容',style:field,value:query,onChange:e=>setQuery(e.target.value)}),h('select',{'aria-label':'变量归档筛选',style:field,value:mode,onChange:e=>setMode(e.target.value)},h('option',{value:'active'},'未归档'),h('option',{value:'archived'},'已归档'),h('option',{value:'all'},'全部含历史归档')),h('select',{'aria-label':'变量排序',style:field,value:sort,onChange:e=>setSort(e.target.value)},h('option',{value:'label'},'变量名排序'),h('option',{value:'paper'},'论文排序')),h(AnnotationWriteStatus,{notice,recovery}),
 rows.map(row=>h('div',{key:row.entryId,style:{borderTop:'1px solid #363636',padding:'12px 0'}},h('label',null,h('input',{type:'checkbox',checked:selected.includes(row.entryId),disabled:!selected.includes(row.entryId)&&selected.length>=6,onChange:e=>setSelected(old=>e.target.checked?[...old,row.entryId]:old.filter(x=>x!==row.entryId))}),'加入并排对照（最多6项）'),h('h3',null,row.label,' · ',row.source.title),h('p',null,row.archived?'已归档；历史仍保留':'未归档','；',row.missing?'源论文缺失':row.stale?'来源已变化：旧口径仅供历史参考':'当前来源'),h('p',null,'可信度声明：未知 ',row.declarations.unknown,'；用户录入 ',row.declarations.manual,'；AI待验证 ',row.declarations.ai_unverified,'；录入证据 ',row.declarations.evidenceCount,'。以上均未经独立核验。'),h('button',{style:secondary,disabled:replacementBlocked||!!recovery||!withLock||row.missing||row.archived,onClick:()=>open(row)},'编辑变量口径'),h('button',{style:secondary,disabled:busy||!!recovery||!withLock||row.missing,onClick:()=>archive(row)},row.archived?'预览恢复条目':'预览归档条目'),h('details',null,h('summary',null,'口径与来源详情'),Object.keys(names).map(k=>h('div',{key:k},h('h4',null,names[k]),cell(row,k))),h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify({entryId:row.entryId,source:row.source,revisionSha256:row.revisionSha256},null,2))))),
 compared.length?h('div',{'data-testid':'dictionary-compare',style:{overflowX:'auto'}},h('h3',null,'人工选择的跨论文口径对照'),h('p',null,'同名不等价：请逐项核对单位、样本、编码和变换。这里不作兼容/可合并判断。筛选列表不改变已选对照。'),h('button',{style:secondary,onClick:()=>setSelected([])},'清空对照选择'),h('table',{style:{minWidth:900}},h('thead',null,h('tr',null,h('th',null,'口径'),compared.map(r=>h('th',{key:r.entryId},r.label,' / ',r.source.title,' / ',r.stale?'旧来源':'当前来源',' / ',r.archived?'已归档':'未归档')))),h('tbody',null,Object.keys(names).map(k=>h('tr',{key:k},h('th',null,names[k]),compared.map(r=>h('td',{key:r.entryId,style:{verticalAlign:'top',padding:10,minWidth:180}},cell(r,k)))))))):null,
 editor&&fields?h('div',{'data-testid':'dictionary-editor'},h('h3',null,editor.entryId?'修改口径，新建历史版本':'新变量，不自动与同名条目合并'),h('label',null,'归属论文',h('select',{'aria-label':'变量归属论文',style:field,value:editor.source.paperId,disabled:replacementBlocked||!!recovery||!!editor.entryId,onChange:e=>selectPaper(e.target.value)},paperOptions.map(s=>h('option',{key:s.paperId,value:s.paperId},s.title)))),h('label',null,'变量名 / 字段名',h('input',{'aria-label':'变量名称',style:field,value:editor.label,maxLength:300,disabled:editLocked,onChange:e=>{const label=e.target.value;panel.changeDraft(draft=>({...draft,label}))}})),Object.keys(names).map(k=>h('fieldset',{key:k,style:{marginTop:12,border:'1px solid #363636'}},h('legend',null,names[k]),h('select',{'aria-label':k+'来源',style:field,value:fields[k].status,disabled:editLocked,onChange:e=>change(k,'status',e.target.value)},Object.entries(labels).map(([value,label])=>h('option',{key:value,value},label))),h('textarea',{'aria-label':k+'内容',style:field,value:fields[k].text,maxLength:6000,disabled:editLocked||fields[k].status==='unknown',onChange:e=>change(k,'text',e.target.value)}),fields[k].evidence.map((ev,i)=>h('div',{key:i},['sourceLabel','locator','quote'].map(prop=>h('textarea',{key:prop,'aria-label':k+i+prop,placeholder:{sourceLabel:'来源名称',locator:'页码、段落或表号',quote:'原句 / 原始编码说明'}[prop],style:field,value:ev[prop],disabled:editLocked,maxLength:{sourceLabel:500,locator:1000,quote:2000}[prop],onChange:e=>evidence(k,i,prop,e.target.value)})),h('button',{style:secondary,disabled:editLocked,onClick:()=>change(k,'evidence',fields[k].evidence.filter((_,n)=>n!==i))},'移除口径证据'))),h('button',{style:secondary,disabled:editLocked||fields[k].status==='unknown'||fields[k].evidence.length>=5,onClick:()=>change(k,'evidence',[...fields[k].evidence,{sourceLabel:'',locator:'',quote:''}])},'添加口径证据'))),h('button',{style:secondary,disabled:replacementBlocked,onClick:()=>panel.replaceDraft(null)},'取消词典编辑'),h('button',{style:btn,disabled:editLocked||!info,onClick:()=>panel.prepare(()=>controller.prepare({entryId:editor.entryId,paperId:editor.source.paperId,label:editor.label,fields,expectedSource:editor.source}))},'预览口径新版本')):null,
 pending==='preview'?h('button',{style:secondary,onClick:panel.cancelPreview},'取消词典预览'):null,
 preview?h('div',{'data-testid':'dictionary-preview'},h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:320,overflow:'auto'}},JSON.stringify(preview,null,2)),h('button',{style:btn,disabled:editLocked,onClick:panel.save},'确认词典变更（不代表验证）'),h('button',{style:secondary,disabled:busy,onClick:panel.cancelPreview},'取消词典预览')):null,
 h('button',{style:secondary,disabled:busy||!!recovery||!info,onClick:()=>download('json')},'导出词典完整 JSON'),h('button',{style:secondary,disabled:busy||!!recovery||!info,onClick:()=>download('csv')},'导出词典 CSV'),h('p',null,'导出包含全部条目（含归档），不受筛选或对照选择影响。CSV为当前视图，JSON保留历史；导出后请核对再分享。'),h('details',null,h('summary',null,'所有口径修订与归档审计'),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}},JSON.stringify(info?.state,null,2))));
}
