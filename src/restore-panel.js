const restoreMessages={
 INVALID_JSON:'无法读取备份文件的内容。请重新选择 PRISM 导出的备份文件。',
 INVALID_BACKUP:'此文件的备份格式无法识别。请选择 PRISM 导出的基础档案备份。',
 INVALID_UTF8:'无法读取此备份文件的文字编码。请重新选择原始备份文件。',
 STRUCTURE_LIMIT:'备份内容的结构超出可恢复范围。请保留原文件。',
 STORE_NATIVE_CAPACITY_EXCEEDED:'恢复后的内容超出浏览器可重新打开的档案大小。请保留原文件。',
 BACKUP_TOO_LARGE:'此格式的备份文件超过大小上限。请保留原文件，或从原档案重新导出备份。',
 RESTORE_FILE_SIZE:'文件为空或超过 16 MB。请选择有效的备份文件。',
 RESTORE_FILE_CHANGED:'读取时文件已变化。请重新选择并核对。',
 RESTORE_WRITE_FAILED_OR_ORPHANED:'无法确认新档案是否已创建。请保留备份，重新读取档案列表并核对，再决定是否重试。',
 EXCLUSIVE_LOCK_REQUIRED:'当前浏览器只能核对备份，暂时无法安全创建恢复副本。',
 SOURCE_CHANGED:'当前档案已变化。请重新核对后再操作。',
 SOURCE_CHANGED_DURING_SWITCH:'切换期间当前档案已变化，仍停留在当前档案。请核对后再试。',
 STALE_PREVIEW:'这次预览已失效。请重新选择备份并核对内容。',
 STORAGE_ENUMERATION_UNAVAILABLE:'暂时无法读取本地档案列表。请保留备份文件。',
 TARGET_SLOT_MISSING:'所选档案已找不到。请重新读取档案列表。',
 TARGET_SLOT_CHANGED:'所选档案在切换时发生变化。请重新读取档案列表并核对。',
 TARGET_SLOT_VALIDATION_FAILED:'所选档案未通过校验，仍停留在当前档案。',
 UNKNOWN_PROFILE_SLOT:'所选档案已不在当前列表中。请重新读取档案列表。',
 PLANNING_DRAFT_LEAVE_CANCELLED:'已取消切换，当前档案和编辑内容仍保留。',
 SLOT_HAS_ACTIVE_WORK:'当前档案还有进行中或待核对的操作。处理完成后再切换。',
 SLOT_SWITCH_BUSY:'正在切换档案，请等待操作完成。',
};

function restoreError(code){
 if(code.startsWith('STORE_CHUNK_')||code==='BACKUP_HASH_MISMATCH')return '备份内容未通过完整性校验。请保留原文件，重新选择完整的备份。';
 return restoreMessages[code]||'操作未完成。请保留备份文件并查看技术详情。';
}

function RestorePanel({manager,locksAvailable,runtime,onSwitch,guided}){
 const [preview,setPreview]=React.useState(null),[confirmed,setConfirmed]=React.useState(false),[message,setMessage]=React.useState(''),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[slots,setSlots]=React.useState([]),[chosen,setChosen]=React.useState('');
 const alive=React.useRef(true),generation=React.useRef(0),operation=React.useRef(null),context=React.useRef(null);
 context.current={manager,key:runtime.key,store:runtime.store};
 React.useLayoutEffect(()=>{alive.current=true;generation.current++;operation.current=null;setBusy(false);setPreview(null);setConfirmed(false);setMessage('');setError('');setChosen('');setSlots([]);return()=>{alive.current=false;generation.current++;operation.current=null}},[manager,runtime.key,runtime.store]);
 const valid=token=>alive.current&&operation.current===token&&generation.current===token.generation&&context.current.manager===token.manager&&context.current.key===token.key&&context.current.store===token.store;
 const act=async fn=>{
  if(!alive.current||operation.current)return;
  const token={generation:++generation.current,manager,key:runtime.key,store:runtime.store};
  operation.current=token;
  setBusy(true);setMessage('');setError('');
  try{await fn(token)}catch(e){if(valid(token))setError(String(e.code||e.message||'RESTORE_FAILED'))}
  finally{if(valid(token)){operation.current=null;setBusy(false)}}
 };
 async function choose(e){
  const file=e.target.files?.[0];
  e.target.value='';
  if(operation.current)return;
  setPreview(null);setConfirmed(false);
  if(!file)return;
  await act(async token=>{
   if(!Number.isSafeInteger(file.size)||file.size<1||file.size>16000000)throw Error('RESTORE_FILE_SIZE');
   const data=new Uint8Array(await file.arrayBuffer());
   if(!valid(token))return;
   if(data.byteLength!==file.size)throw Error('RESTORE_FILE_CHANGED');
   let raw;
   try{raw=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{throw Error('INVALID_UTF8')}
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
   if(!valid(token))return;
   const fileSha256=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
   const prepared=await manager.prepare(raw,{sourceKey:runtime.key,isCurrent:()=>valid(token)});
   if(valid(token))setPreview({...prepared,fileName:file.name,fileBytes:file.size,fileSha256,hashNote:'fileSha256 为原文件字节；summary.sha256 为 UTF-8 解码后的 JSON 文本，不证明作者或来源。'});
  });
 }
 function download(text,token){
  if(!valid(token))return;
  const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  try{a.href=url;a.download='PRISM-research-backup.json';a.click()}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
  setMessage('已请求下载备份。请确认文件已下载并妥善保存。');
 }
 function refreshList(){
  setSlots([{slotKey:runtime.originalKey},...manager.listSlots()]);
 }
 const button=(label,fn,disabled=false)=>h('button',{type:'button',style:guided?undefined:secondary,disabled:busy||disabled,onClick:()=>act(fn)},label);
 const technical=(label,...children)=>h('details',{className:guided?'prism-support':undefined},h('summary',null,label),...children);
 const summary=preview?.summary;
 return h('section',{'data-testid':'restore-panel',className:guided?'prism-restore':undefined,style:guided?undefined:{...box,color:'#eee',background:'#101010',margin:24},'aria-busy':busy},
  h('p',{'data-testid':'base-backup-scope'},'基础档案包含论文记录、已保存的正文、基础研究指令和历史运行记录。完整项目、未提交的表单草稿和 PDF 原件需另行备份。'),
  h('p',null,'备份文件可直接阅读，请妥善保管。档案保存在当前浏览器，清理网站数据后需用备份文件恢复。'),
  h('h3',null,'下载基础档案'),
  button('下载基础档案备份',async token=>download(await manager.exportCurrent(runtime.store,{sourceKey:runtime.key,isCurrent:()=>valid(token)}),token)),
  h('h3',null,'从备份创建恢复副本'),
  h('p',null,'先选备份并核对内容，再创建恢复副本。原档案保持原样，创建后仍停留在当前档案。历史审核和运行记录保留，恢复后须重新确认接收，进行中的运行不会续跑。'),
  !locksAvailable?h('p',{role:'alert'},'当前浏览器可以核对备份，但暂时无法安全创建恢复副本。'):null,
  h('label',{className:'prism-restore-field'},'选择基础档案备份文件',h('input',{'data-testid':'restore-file',type:'file',accept:'.json,application/json',disabled:busy,onChange:choose})),
  summary?h('section',{className:'prism-restore-preview'},
   h('h4',null,'核对备份内容'),
   h('p',{role:'status'},'文件已通过完整性检查。请选择是否创建恢复副本。'),
   h('p',null,'所选文件：',preview.fileName),
   summary.provenance.exportedAt?h('p',null,'备份导出时间：',new Date(summary.provenance.exportedAt).toLocaleString('zh-CN')):null,
   h('p',null,summary.papers,' 篇论文，',summary.documents,' 份正文，',summary.runs,' 条历史运行记录。'),
   summary.acceptancesCleared>0?h('p',null,summary.acceptancesCleared,' 篇论文的接收状态需要重新确认。'):null,
   h('p',null,'请根据文件来历判断是否可信。完整性检查无法确认备份的作者或研究结论。'),
   h('label',{className:'prism-check'},h('input',{'data-testid':'restore-ack',type:'checkbox',checked:confirmed,disabled:busy,onChange:e=>setConfirmed(e.target.checked)}),'我已核对备份，确认创建恢复副本'),
   button('创建恢复副本',async token=>{
    const result=await manager.confirm(preview.previewId,{explicitConfirmation:true,isCurrent:()=>valid(token)});
    if(!valid(token))return;
    setConfirmed(false);setPreview(null);setMessage('已创建恢复副本，当前档案保持不变。可在下方选择并打开副本。');
    refreshList();setChosen(result.slotKey);
   },!confirmed||!locksAvailable||!preview.canConfirm),
   technical('文件校验详情',h('pre',{'data-testid':'restore-summary',style:guided?undefined:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflow:'auto'}},JSON.stringify(preview,null,2)))):null,
  h('h3',null,'打开本地档案'),
  h('p',{'data-testid':'restore-active-name'},'当前使用：',runtime.key===runtime.originalKey?'原档案':'恢复副本'),
  h('p',null,'切换前请保存或导出正在编辑的草稿。刷新页面会回到原档案，恢复副本可以从列表重新打开。'),
  h('div',{className:'prism-actions'},
   button('读取本地档案列表',async token=>{if(valid(token)){refreshList();setMessage('档案列表已更新。请在下方选择要打开的档案。')}}),
   h('label',{className:'prism-restore-field'},'要打开的档案',
    h('select',{'data-testid':'restore-slot-select',value:chosen,disabled:busy,onChange:e=>setChosen(e.target.value),style:guided?undefined:secondary},
     h('option',{value:''},'请选择档案'),slots.map((s,index)=>h('option',{key:s.slotKey,value:s.slotKey},s.slotKey===runtime.originalKey?'原档案':'恢复副本 '+index)))),
   button('打开所选档案',async token=>{await onSwitch(chosen);if(valid(token))setMessage('已打开所选档案。')},!chosen||chosen===runtime.key)),
  message?h('p',{role:'status'},message):null,
  error?h('p',{role:'alert'},restoreError(error)):null,
  technical('档案格式与技术详情',
   h('p',{'data-testid':'active-slot'},'当前档案标识：',runtime.key),
   chosen?h('p',null,'所选档案标识：',chosen):null,
   error?h('p',null,'错误代码：',error):null,
   !locksAvailable?h('p',null,'没有 Web Locks，禁止提交恢复。'):null,
   h('p',null,'备份 v1 和裸 JSON 上限为 4,000,000 UTF-8 字节。v2 分块备份文件上限为 16,000,000 字节，重组后的档案限 4,000,000 UTF-16 单元和 12,000,000 UTF-8 字节。档案结构限 150,000 个结构节点和 20 层。分块不增加浏览器存储配额。'),
   h('p',null,'备份以纯文本读取，文件中的脚本与链接不会执行。导出包含已经验证的内存档案；保存结果不确定时，带版本的导出会被阻止，可按页面提示单独留存内存内容。档案标识仅用于区分本地记录；同源脚本仍能读取档案。Host 备份不包含这些记录。')));
}
