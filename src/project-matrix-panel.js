function ProjectMatrixPanel({store,projectId,disabled,guided=false}){
 const ref=React.useRef({projectId,disabled,epoch:0});if(ref.current.projectId!==projectId||ref.current.disabled!==disabled)ref.current.epoch++;Object.assign(ref.current,{projectId,disabled});
 const lock=typeof globalThis.navigator?.locks?.request==='function'?(name,f)=>navigator.locks.request(name,{mode:'exclusive'},f):undefined;
 const ctl=React.useMemo(()=>projectMatrixCore.createProjectMatrix({store,storage:globalThis.localStorage,withLock:lock}),[store]);
 const [view,setView]=React.useState(null),[drafts,setDrafts]=React.useState({}),[preview,setPreview]=React.useState(null),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);const running=React.useRef(false);
 const tableId='prism-project-matrix'+React.useId();
 const key=store.getStorageKey()+'|'+projectId;const draft=drafts[key];
 React.useEffect(()=>()=>{ctl.close();ref.current.epoch++},[ctl]);
 React.useEffect(()=>{setView(null);setPreview(null)},[key,disabled]);
 React.useEffect(()=>{
  if(!view)return;
  let active=true,checking=false;
  const check=async()=>{
   if(checking)return;
   checking=true;
   try{await view.verify()}catch{
    if(active){setView(null);setPreview(null);setMessage('来源或项目范围变化，旧矩阵已隐藏；草稿保留，请刷新核对。')}
   }finally{checking=false}
  };
  const timer=setInterval(check,1000),unsubscribe=store.subscribe(check);
  globalThis.window?.addEventListener?.('storage',check);
  return()=>{active=false;clearInterval(timer);unsubscribe?.();globalThis.window?.removeEventListener?.('storage',check)};
 },[view,store]);
 async function run(fn){if(running.current||disabled||!projectId)return;running.current=true;setBusy(true);const epoch=ref.current.epoch,g=()=>ref.current.epoch===epoch&&!ref.current.disabled;try{await fn(g)}catch(e){if(g()){setView(null);setPreview(null);setMessage(e.message+'；草稿保留，未自动重试。')}}finally{running.current=false;setBusy(false)}}
 function refresh(){return run(async g=>{const v=await ctl.read(projectId,g);if(g()){setView(v);setMessage('已读取当前项目成员与保存的对照内容。');setDrafts(d=>d[key]?d:{...d,[key]:v.columns})}})}
 function change(columns){if(preview)ctl.cancel(preview);setPreview(null);setDrafts(d=>({...d,[key]:columns}))}
 function download(format){return run(async g=>{const raw=await ctl.exportData(projectId,format,g);if(!g())return;const url=URL.createObjectURL(new Blob([raw],{type:format==='csv'?'text/csv':'application/json'}));const a=document.createElement('a');a.href=url;a.download='PRISM-project-matrix.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('已请求下载已保存布局的当前项目矩阵；未保存草稿不包含在内。')})}
 let current=null;try{if(view&&view.projectId===projectId&&!disabled){view.stable();current=view}}catch{}
 const off=disabled||busy||!projectId;
 const exports=['json','csv'].map(format=>({label:'导出当前项目矩阵 '+format.toUpperCase(),
  disabled:off||!current,onClick:()=>download(format)}));
 const scopeHelp=h('p',null,'矩阵使用当前项目成员的已保存人工对照。共享论文沿用同一份对照，布局和成员范围归属当前项目。未知、AI 待验证和来源变化均保留标记。');
 const layoutDraft=draft?h('div',null,
  draft.map((column,index)=>h('div',{key:index},
   h('input',{'aria-label':'维度名称 '+(index+1),value:column.label,maxLength:100,disabled:off,
    onChange:e=>change(draft.map((item,i)=>i===index?{...item,label:e.target.value}:item))}),
   h('select',{'aria-label':'维度来源 '+(index+1),value:column.field,disabled:off,
    onChange:e=>change(draft.map((item,i)=>i===index?{...item,field:e.target.value}:item))},
    Object.entries(projectMatrixCore.MATRIX_NAMES).map(([key,label])=>h('option',{key,value:key},label))),
   h('button',{disabled:off||index===0,onClick:()=>{
    const columns=[...draft];
    [columns[index-1],columns[index]]=[columns[index],columns[index-1]];
    change(columns);
   }},'上移'),
   h('button',{disabled:off||draft.length===1,onClick:()=>change(draft.filter((_,i)=>i!==index))},'删除维度'))),
  h('button',{disabled:off||draft.length>=12,onClick:()=>change([...draft,{label:'新维度 '+(draft.length+1),field:'findings'}])},'增加维度'),
  h('button',{disabled:off||!lock,onClick:()=>run(async g=>{const p=await ctl.prepare(projectId,draft,g);if(g())setPreview(p)})},'预览保存布局'),
  h('p',null,'草稿按项目留在本页，切换项目不会套用到其他项目。关页前请确认保存；布局单独导出，未纳入旧便携项目备份。')):null;
 const layoutPreview=preview?h('div',null,
  h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify(preview,null,2)),
  h('button',{disabled:off,onClick:()=>run(async g=>{
   const saved=await ctl.confirm(preview,{explicit:true},g);
   if(g()){setView(saved);setPreview(null);setMessage('布局已保存并读回核验；原人工结论未修改。')}
  })},'确认仅保存布局'),
  h('button',{disabled:off,onClick:()=>{ctl.cancel(preview);setPreview(null)}},'取消预览')):null;
 return h('section',{'data-testid':'project-matrix'},
  guided?h('p',{className:'prism-muted'},'本项目论文 · 已保存对照'):h('h2',null,'项目维度对照矩阵'),
  !guided?scopeHelp:null,!projectId?h('p',null,'先选择项目。'):null,
  guided?h(PrismTableToolbar,{label:'项目矩阵操作',controls:current?.rows.length?tableId:undefined,
   refresh:{label:'读取／刷新项目矩阵',disabled:off,onClick:refresh},exportLabel:'当前项目矩阵导出',exports}):
   h('button',{disabled:off,onClick:refresh},'读取／刷新项目矩阵'),
  h('p',{role:'status',className:guided?'prism-table-note':undefined},message),
  !guided?h(React.Fragment,null,layoutDraft,layoutPreview):null,
  current?renderMatrix():null,
  guided&&draft?guidedDisclosure('编辑矩阵布局',h(React.Fragment,null,layoutDraft,layoutPreview),{className:'prism-support prism-table-editor'}):null,
  guided?guidedHelp('范围与版本',scopeHelp):null,
  !guided&&current?exports.map(action=>h('button',{key:action.label,disabled:action.disabled,onClick:action.onClick},action.label)):null);
 function renderMatrix(){
  const headers=current.columns.map(c=>h(React.Fragment,null,c.label,h('small',null,'保存字段：'+projectMatrixCore.MATRIX_NAMES[c.field])));
  const rows=current.rows.map(r=>{
   const titleId=tableId+'-'+r.paperId;
   const source=h('th',{scope:'row','aria-labelledby':titleId},h('strong',{id:titleId},r.source.title),
    h('p',null,r.stale?'来源已变化，仅历史参考':'当前来源绑定'),
    h('details',null,h('summary',null,'来源及版本'),
     h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify({source:r.source,currentSource:r.currentSource,revisionSha256:r.revisionSha256},null,2))));
   const cells=current.columns.map((c,i)=>{
    const value=r.fields[c.field];
    if(guided&&value.status==='unknown')return h('td',{key:i},h('span',{className:'prism-muted'},'未知'));
    return h('td',{key:i,style:guided?undefined:{minWidth:220,verticalAlign:'top'}},
     h('small',null,{unknown:'未知',manual:'人工录入，未独立验证',ai_unverified:'AI 内容待验证'}[value.status]),
     h(ResearchContent,{text:value.text||'未知'}),
     !guided||value.evidence.length?h('details',null,h('summary',null,'录入引用（非自动核验）'),
      h('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify(value.evidence,null,2))):
      h('small',null,'无录入证据'));
   });
   return h('tr',{key:r.paperId},source,...cells);
  });
  if(guided){
   return rows.length?h(PrismResearchTable,{id:tableId,caption:'当前项目论文矩阵',sourceHeading:'论文／来源',headers,rows}):
    h('p',{className:'prism-table-note'},'当前项目没有关联论文。');
  }
  return h('div',{style:{overflowX:'auto'}},h('table',null,
   h('thead',null,h('tr',null,h('th',{scope:'col'},'论文／来源'),headers.map((item,i)=>h('th',{key:i,scope:'col'},item)))),
   h('tbody',null,rows)));
 }
}
