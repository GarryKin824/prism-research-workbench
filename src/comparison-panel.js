function ComparisonPanel({store,disabled=false,guided=false,active=false,libraryRevision}){
 const withLock=typeof globalThis.navigator?.locks?.request==='function'?(name,fn)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},fn):undefined;
 const controller=React.useMemo(()=>createComparisonController({store,storage:globalThis.localStorage,withLock}),[store]);
 const names={researchQuestion:'研究问题',data:'数据',sample:'样本',method:'方法',findings:'发现',limitations:'限制',availability:'可用性'},statuses={unknown:'未知',manual:'用户录入（未独立验证）',ai_unverified:'AI 内容待验证（人工粘贴）'};
 const [search,setSearch]=React.useState(''),[filter,setFilter]=React.useState('all'),[sort,setSort]=React.useState('title');
 const [shownField,setShownField]=React.useState('all');
 const [downloadMessage,setDownloadMessage]=React.useState('');
 const composing=React.useRef(false);
 const tableId='prism-paper-comparison'+React.useId();
 const panel=useAnnotationEditor(controller,store,disabled);
 const {info,draft,preview,pending,notice,recovery}=panel;
 const fields=draft?.fields,editing=draft?.source.paperId;
 const busy=pending!==null,replacementBlocked=busy&&pending!=='preview',editLocked=busy||!!recovery;
 const readRevision=React.useRef(libraryRevision);
 React.useEffect(()=>{
  if(!guided||!active||disabled||!info||busy||recovery||draft||preview)return;
  if(readRevision.current===libraryRevision)return;
  readRevision.current=libraryRevision;
  void panel.refresh();
 },[guided,active,disabled,info,busy,recovery,draft,preview,libraryRevision]);
 function open(row){
  if(editing===row.source.paperId)return;
  const source=info.sources.find(x=>x.paperId===row.source.paperId);
  if(source)panel.replaceDraft({source,fields:row.stale?comparisonCore.emptyFields():row.fields});
 }
 function updateFields(update){
  panel.changeDraft(current=>{const fields=JSON.parse(JSON.stringify(current.fields));update(fields);return {...current,fields}});
 }
 function change(field,key,value){
  updateFields(fields=>{
   if(key==='status'&&value==='unknown')fields[field]={status:'unknown',text:'',evidence:[]};
   else fields[field][key]=value;
  });
 }
 function evidence(field,index,key,value){updateFields(fields=>{fields[field].evidence[index][key]=value})}
 function download(format){
  return panel.run('export',async current=>{
   setDownloadMessage('');
   const raw=await controller.exportData(format);
   if(!current())return;
   const u=URL.createObjectURL(new Blob([raw],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'})),a=document.createElement('a');
   a.href=u;a.download='PRISM-paper-comparison.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
   setDownloadMessage('已请求下载全部论文对照 '+format.toUpperCase()+'。');
  });
 }
 if(disabled)return null;
 const allRows=info?.rows||[];
 const query=search.toLowerCase();
 const rows=allRows.filter(row=>JSON.stringify([row.source.title,row.fields]).toLowerCase().includes(query))
  .filter(row=>filter==='all'||filter==='stale'&&row.stale||Object.values(row.fields).some(f=>f.status===filter));
 rows.sort((a,b)=>sort==='unknown'
  ?Object.values(b.fields).filter(f=>f.status==='unknown').length-Object.values(a.fields).filter(f=>f.status==='unknown').length
  :a.source.title.localeCompare(b.source.title));
 const columns=shownField==='all'?Object.keys(names):[shownField];
 const sourceHelp=h(React.Fragment,null,
  h('p',null,'七项内容默认未知，不自动概括论文或生成结论。用户录入与人工粘贴的 AI 待验证内容分别标记；页码、原句和来源均由录入者提供，保存不代表已验证。仅存于当前浏览器档案，不发送给模型或第三方。'),
  h('p',null,'原文哈希为已有档案引用，不是本次重新读取 PDF。来源变化会标记旧版本失效；旧历史保留，不会静默迁移为新版证据。'));
 const refresh={label:'刷新论文对照表',disabled:busy||!!recovery,onClick:panel.refresh};
 const exports=[
  {label:'导出完整对照审计 JSON',disabled:refresh.disabled||!info,onClick:()=>download('json')},
  {label:'导出全部当前对照 CSV',disabled:refresh.disabled||!info,onClick:()=>download('csv')},
 ];
 const editLabel=guided?'编辑对照':'编辑七项对照';
 const searchInput=h('input',{
  id:tableId+'-search',type:'search',name:'comparisonSearch',autoCapitalize:'none',autoCorrect:'off',spellCheck:false,'aria-label':guided?undefined:'筛选论文对照',
  placeholder:'论文标题或字段内容',style:guided?undefined:field,defaultValue:search,
  onCompositionStart:()=>{composing.current=true},
  onCompositionEnd:event=>{composing.current=false;setSearch(event.currentTarget.value)},
  onChange:event=>{
   if(!composing.current&&!event.nativeEvent.isComposing)setSearch(event.currentTarget.value);
  },
 });
 const statusSelect=h('select',{id:tableId+'-status',style:guided?undefined:field,value:filter,onChange:e=>setFilter(e.target.value)},
  h('option',{value:'all'},'全部'),h('option',{value:'unknown'},'存在未知项'),h('option',{value:'manual'},'存在用户录入'),
  h('option',{value:'ai_unverified'},'存在 AI 待验证'),h('option',{value:'stale'},'来源已变化'));
 const orderSelect=h('select',{id:tableId+'-order',style:guided?undefined:field,value:sort,onChange:e=>setSort(e.target.value)},
  h('option',{value:'title'},'论文名称'),h('option',{value:'unknown'},'未知项多的优先'));
 const filters=guided?h(PrismSearch,{className:'prism-comparison-filters','aria-label':'筛选对照表'},
  h('div',{className:'prism-comparison-search'},h('label',{htmlFor:tableId+'-search'},'筛选论文对照'),searchInput),
  h('div',null,h('label',{htmlFor:tableId+'-status'},'筛选状态'),statusSelect),
  h('div',null,h('label',{htmlFor:tableId+'-order'},'排序'),orderSelect),
  h('div',null,h('label',{htmlFor:tableId+'-fields'},'显示字段'),
   h('select',{id:tableId+'-fields',value:shownField,onChange:e=>setShownField(e.target.value)},
    h('option',{value:'all'},'全部七项'),Object.entries(names).map(([key,label])=>h('option',{key,value:key},label))))):
  h(React.Fragment,null,searchInput,h('label',null,'筛选状态',statusSelect),h('label',null,'排序',orderSelect));
 const tableRows=rows.map(row=>{
  const titleId=tableId+'-'+row.source.paperId;
  return h('tr',{key:row.source.paperId},
   h('th',{scope:'row','aria-labelledby':titleId,style:guided?undefined:{verticalAlign:'top',padding:10}},
    h('strong',{id:titleId},row.source.title),
    h('p',null,row.stale?'来源变化：旧内容仅供历史参考':'当前来源'),
    h('button',{type:'button',style:guided?undefined:secondary,'aria-label':editLabel+' '+row.source.title,
     disabled:replacementBlocked||!!recovery||!withLock||!info.sources.some(x=>x.paperId===row.source.paperId),onClick:()=>open(row)},editLabel),
    h('details',null,h('summary',null,'来源绑定'),h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify(row.source,null,2)))),
   columns.map(key=>{
    const value=row.fields[key];
    if(guided&&value.status==='unknown')return h('td',{key},h('span',{className:'prism-muted'},'未知'));
    return h('td',{key,style:guided?undefined:{verticalAlign:'top',padding:10,borderTop:'1px solid #363636',maxWidth:260,overflowWrap:'anywhere'}},
     h('small',null,statuses[value.status]),h('p',{style:{whiteSpace:'pre-wrap'}},value.text||'未知'),
     value.evidence.length?h('details',null,h('summary',null,'页码与原句证据（录入）'),value.evidence.map((ev,i)=>
      h('div',{key:i},h('p',null,ev.sourceLabel,' · ',ev.locator),h('blockquote',{style:{whiteSpace:'pre-wrap'}},ev.quote)))):
      h('small',null,'无录入证据'));
   }));
 });
 const table=guided?(rows.length?h(PrismResearchTable,{id:tableId,caption:'共享论文库对照',sourceHeading:'论文／来源',
  headers:columns.map(key=>names[key]),rows:tableRows}):null):
  h('div',{style:{overflowX:'auto'}},h('table',{style:{borderCollapse:'collapse',minWidth:1300,width:'100%'}},
   h('thead',null,h('tr',null,h('th',{scope:'col'},'论文 / 来源'),columns.map(key=>h('th',{key,scope:'col'},names[key])))),
   h('tbody',null,tableRows)));
 let resultMessage='';
 if(info){
  if(!allRows.length)resultMessage='共享论文库暂无论文。';
  else if(!rows.length)resultMessage='没有符合当前筛选的论文。';
  else if(rows.length===allRows.length)resultMessage='共 '+allRows.length+' 篇。';
  else resultMessage='显示 '+rows.length+' 篇，共 '+allRows.length+' 篇。';
 }
 return h('section',{'data-testid':'comparison-center',style:guided?undefined:{...box,marginBottom:20}},
  guided?h('p',{className:'prism-muted'},'共享论文库 · 人工记录'):h('h2',null,'论文横向对照表'),
  !guided?sourceHelp:null,!withLock?h('p',{role:'alert'},'缺少 Web Locks：仅可查看和导出，不能写入。'):null,
  guided?h(PrismTableToolbar,{label:'论文对照操作',controls:rows.length?tableId:undefined,refresh,exportLabel:'完整对照导出',exports}):
   h('button',{style:secondary,disabled:refresh.disabled,onClick:refresh.onClick},refresh.label),
  guided?h('p',{className:'prism-table-note',role:'status'},downloadMessage):null,
  filters,h(AnnotationWriteStatus,{notice,recovery}),
  guided?h('p',{className:'prism-table-note',role:'status'},resultMessage):null,
  table,
 editing&&fields?h('div',{'data-testid':'comparison-editor'},h('h3',null,'编辑整行：',draft.source.title),h('p',null,'来源已变化的行从未知开始。引用可填写页码、段落或表号；不填时保持无证据，不会替你补出。不要粘贴凭据或无关个人信息。'),Object.keys(names).map(key=>h('fieldset',{key,style:{marginTop:12,border:'1px solid #363636'}},h('legend',null,names[key]),h('select',{'aria-label':names[key]+'内容来源',style:field,value:fields[key].status,disabled:editLocked,onChange:e=>change(key,'status',e.target.value)},Object.entries(statuses).map(([value,label])=>h('option',{key:value,value},label))),h('textarea',{'aria-label':names[key]+'内容',style:field,maxLength:6000,value:fields[key].text,disabled:editLocked||fields[key].status==='unknown',onChange:e=>change(key,'text',e.target.value)}),fields[key].evidence.map((ev,i)=>h('div',{key:i},['sourceLabel','locator','quote'].map(prop=>h('textarea',{key:prop,'aria-label':names[key]+'证据'+i+prop,placeholder:{sourceLabel:'来源文献/网页名称（不是来源认证）',locator:'页码、段落或表号',quote:'原句/表中内容'}[prop],style:field,value:ev[prop],disabled:editLocked,maxLength:{sourceLabel:500,locator:1000,quote:2000}[prop],onChange:e=>evidence(key,i,prop,e.target.value)})),h('button',{style:secondary,disabled:editLocked,onClick:()=>change(key,'evidence',fields[key].evidence.filter((_,n)=>n!==i))},'移除这条证据'))),h('button',{style:secondary,disabled:editLocked||fields[key].status==='unknown'||fields[key].evidence.length>=5,onClick:()=>change(key,'evidence',[...fields[key].evidence,{sourceLabel:'',locator:'',quote:''}])},'添加证据引用'))),h('button',{style:secondary,disabled:replacementBlocked,onClick:()=>panel.replaceDraft(null)},'取消编辑对照'),h('button',{style:btn,disabled:editLocked||!info,onClick:()=>panel.prepare(()=>controller.prepare(editing,fields,draft.source))},'预览对照表新版本')):null,
 pending==='preview'?h('button',{style:secondary,onClick:panel.cancelPreview},'取消对照预览'):null,
 preview?h('div',{'data-testid':'comparison-preview'},h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:360,overflow:'auto'}},JSON.stringify(preview,null,2)),h('button',{style:btn,disabled:editLocked,onClick:panel.save},'确认保存对照（不代表已验证）'),h('button',{style:secondary,disabled:busy,onClick:panel.cancelPreview},'取消对照预览')):null,
 !guided?exports.map(action=>h('button',{key:action.label,style:secondary,disabled:action.disabled,onClick:action.onClick},action.label)):null,
 guided?guidedHelp('来源与版本说明',sourceHelp):null,
 h('p',{className:guided?'prism-table-note':undefined},guided?'JSON 包含全部论文、字段、证据和版本。CSV 包含全部论文的当前对照。':'导出包含当前档案全部对照，不受显示筛选影响。CSV 是可读视图，不替代保留版本和证据的 JSON；请核对后自行分享。'),
 h('details',null,h('summary',null,'不可覆盖的对照版本历史'),
  h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}},JSON.stringify(info?.state,null,2))));
}
