function SourceTracePanel({store,paper,active=false,disabled=false,scopeToken=null,guided=false}){
 const rows=sourceTraceCore.sourceTraceRows(paper),binding=JSON.stringify([paper?.id,paper?.metadata,scopeToken,active,disabled]);
 const live=React.useRef({binding,epoch:0});if(live.current.binding!==binding)live.current={binding,epoch:live.current.epoch+1};
 const [result,setResult]=React.useState(null),[busy,setBusy]=React.useState(null);
 React.useEffect(()=>()=>{live.current={binding:null,epoch:live.current.epoch+1}},[]);
 async function verify(file,row,index){
  const token=++live.current.epoch,captured=binding;let sourceGuard=null;try{store.assertCurrentStorage();const ns=store.getStorageKey();sourceGuard={ns,paper:JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id)),planning:localStorage.getItem(ns+':project-planning-v1'),membership:localStorage.getItem(ns+':project-library-v1')}}catch{}setResult(null);setBusy({binding,index,epoch:token});
  const current=()=>{if(live.current.binding!==captured||live.current.epoch!==token||!sourceGuard)return false;try{store.assertCurrentStorage();return store.getStorageKey()===sourceGuard.ns&&JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id))===sourceGuard.paper&&localStorage.getItem(sourceGuard.ns+':project-planning-v1')===sourceGuard.planning&&localStorage.getItem(sourceGuard.ns+':project-library-v1')===sourceGuard.membership}catch{return false}};
  const same=()=>live.current.binding===captured&&live.current.epoch===token;
  try{if(!current())throw Error('SOURCE_CHANGED');const value=await sourceTraceCore.matchSourceFile(file,row.fileSha256);if(current())setResult({binding,index,epoch:token,...value});else if(same())setResult({binding,index,epoch:token,stale:true})}catch{if(same())setResult({binding,index,epoch:token,error:current(),stale:!current()})}finally{if(same())setBusy(null)}
 }
 if(!paper||!active)return null;
 const labels={'zotero-local':'本机 Zotero 书目','local-file':'用户导入引用文件（未验证）','public-metadata':'公开书目元数据（非全文核验）',synthetic:'合成演示来源（不是真实文献证据）'};
 return h('section',{'data-testid':'source-trace',style:box},h('h3',null,guided?'书目来源':'书目来源追溯'),guided?h(React.Fragment,null,guidedHelp('来源核对规则',h(React.Fragment,null,h('p',null,'此处解释已保存来源，不修改原始书目信息。原始引用文件和未映射字段未归档；文件一致不等于出版真实性或内容正确。')))):h(React.Fragment,null,h('p',null,'此处解释已保存来源，不修改原始书目信息。原始引用文件和未映射字段未归档；文件一致不等于出版真实性或内容正确。')),
 
 !rows.length?h('p',null,'此档案没有可追溯的书目来源记录。文档附件与书目来源不是同一项。'):rows.map((row,index)=>h('details',{key:binding+':'+index},h('summary',null,row.label,' · ',labels[row.mode]||'来源模式未知'),
 h('p',null,'记录时间（UTC）：',row.retrievedAt||'未记录'),h('p',null,'检索词/导入说明：',row.query||'未记录'),h('p',{style:{overflowWrap:'anywhere'}},'原来源记录：',row.recordId),
 row.fileSha256?h(React.Fragment,null,h('p',{style:{overflowWrap:'anywhere'}},'原引用文件 SHA-256：',row.fileSha256,'；文件内记录序号：',row.recordNumber,'（不是 PDF 页码）'),
 h('label',null,'选择原引用文件核对（只在本页读取，不上传、不保存）',h('input',{type:'file',accept:'.ris,.bib,.bibtex','aria-label':'核对来源文件 '+index,disabled:disabled||busy?.binding===binding&&busy.epoch===live.current.epoch,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file&&!disabled)verify(file,row,index)}})),
 busy?.binding===binding&&busy.epoch===live.current.epoch&&busy.index===index?h('p',{role:'status'},'正在本页计算文件哈希…'):null,
 result?.binding===binding&&result.epoch===live.current.epoch&&result.index===index?h('p',{'data-testid':'source-file-match',role:'status'},result.stale?'来源或项目范围已变化，未采用此次核对结果，请刷新后重新核对。':result.error?'无法核对：仅接受可读取的 1 MiB 以内非空文件，请重新选择。':result.matched?'文件字节与已保存来源哈希一致。未重新解析条目，未核验出版真实性。':'文件字节不匹配，不能认定为原导入文件。换行或编码变化也会改变哈希。'):null):null)),
 paper.metadata?.discovery?.conflicts?.length?h('p',{role:'alert'},'入库时发现字段冲突：',paper.metadata.discovery.conflicts.map(f=>({title:'标题',authors:'作者',year:'年份',abstract:'摘要',links:'链接'})[f]||'其他字段').join('、'),'。保留的是入库时选择的值，不代表冲突已解决。'):null);
}
