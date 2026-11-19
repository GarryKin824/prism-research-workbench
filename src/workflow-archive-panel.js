// Local read-only workflow archive UI. No activation, authorization restoration or Host calls.
function WorkflowArchivePanel({store}){
 const withLock=typeof globalThis.navigator?.locks?.request==='function'?(name,fn)=>globalThis.navigator.locks.request(name,{mode:'exclusive'},fn):undefined;
 const controller=React.useMemo(()=>createWorkflowArchiveController({store,storage:globalThis.localStorage,crypto:globalThis.crypto,withLock}),[store]);
 const [busy,setBusy]=React.useState(false),[phase,setPhase]=React.useState(''),[preview,setPreview]=React.useState(null),[confirmed,setConfirmed]=React.useState(false),[slots,setSlots]=React.useState([]),[chosen,setChosen]=React.useState(''),[opened,setOpened]=React.useState(null),[message,setMessage]=React.useState('');
 const alive=React.useRef(true),generation=React.useRef(0),operation=React.useRef(null);
 React.useEffect(()=>{alive.current=true;generation.current++;operation.current=null;setBusy(false);setPhase('');setPreview(null);setConfirmed(false);setSlots([]);setChosen('');setOpened(null);setMessage('');return()=>{alive.current=false;generation.current++;operation.current=null}},[controller]);
 function archiveError(error){const code=error.code||error.message||'WORKFLOW_ARCHIVE_FAILED';if(code.startsWith('STORE_CHUNK_'))return '分片归档不完整、已损坏或超出有界容量；未恢复任何内容。请重新选择完整原文件，不要手工拆分或拼接。('+code+')';if(['ARCHIVE_TOO_LARGE','WORKFLOW_ARCHIVE_FILE_SIZE','STORE_NATIVE_CAPACITY_EXCEEDED'].includes(code))return '归档超过支持的容量；不会截断论文或历史。文件总限16,000,000 UTF-8字节；分片论文库仍受4,000,000 UTF-16单位原生存储上限约束。('+code+')';return code}
 const valid=t=>alive.current&&generation.current===t&&operation.current?.token===t;
 async function run(kind,fn){if(operation.current)return;const token=++generation.current;operation.current={token,kind};setBusy(true);setPhase(kind);setMessage('');try{await fn(token)}catch(e){if(valid(token)){setPreview(null);setConfirmed(false);setMessage(archiveError(e))}}finally{if(valid(token)){operation.current=null;setBusy(false);setPhase('')}}}
 function cancelPreview(){if(operation.current&&operation.current.kind!=='prepare')return;generation.current++;operation.current=null;setBusy(false);setPhase('');setPreview(null);setConfirmed(false);setMessage('已取消预览；未执行归档恢复。')}
 function download(raw,name,token){if(!valid(token))return;const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');try{a.href=url;a.download=name;a.click()}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}}
 async function chooseFile(e){const file=e.target.files?.[0];e.target.value='';if(operation.current)return;setPreview(null);setConfirmed(false);if(!file)return;await run('prepare',async token=>{
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>16000000)throw Error('WORKFLOW_ARCHIVE_FILE_SIZE');
  const bytes=new Uint8Array(await file.arrayBuffer());if(!valid(token))return;if(bytes.byteLength!==file.size)throw Error('WORKFLOW_ARCHIVE_FILE_CHANGED');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const prepared=await controller.prepare(raw);if(!valid(token))return;setPreview(prepared);setMessage('已核验文件并生成预览，尚未写入。')
 })}
 const button=(label,fn,disabled=false)=>h('button',{type:'button',style:secondary,disabled:busy||disabled,onClick:fn},label);
 const pre=value=>h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflow:'auto'}},JSON.stringify(value,null,2));
 return h('section',{'data-testid':'workflow-archive-panel',style:{...box,marginBottom:20}},h('h2',null,'论文与流程归档 · 只读恢复'),
  h('p',null,'导出当前档案的论文历史、自定义 workflow 与跨论文 queue。恢复仅新增独立只读 slot，不覆盖、不激活、不继续运行，也不恢复任何授权。'),
  h('p',null,'这不是完整项目恢复：不含外部 Host、会话、凭据、收件箱、人工审核、待办、对照表、变量词典、可行性试验等其他独立模块。请使用各模块自己的导出入口。哈希只证明内容一致性，不证明来源真实或研究有效。'),
  h('p',null,'小论文库仍导出 v1；超出旧4 MB组件限制时自动使用有界分片 v2，本版本可读取两种格式。v2保留完整字段、论文文本和历史，按紧凑JSON编码，不保留旧缩进排版的字节。每片最多1,000,000 UTF-8字节，总论文库最多4,000,000 UTF-16单位和12,000,000 UTF-8字节；不会扩大原生存储容量，也不包含PDF原文件。'),
  h('p',null,'文件限 16,000,000 UTF-8 bytes；导入仅作纯文本校验。历史运行状态只是归档记录，不表示当前任务已执行或获准继续。'),
  !controller.canRestore?h('p',{role:'alert'},'当前环境没有所需的浏览器独占锁，不能写入恢复 slot；仍可导出、预览与查看。'):null,
  button('导出论文与流程归档',()=>run('export',async token=>download(await controller.exportCurrent(),'PRISM-paper-workflow-archive.json',token))),
  h('label',null,'选择论文与流程归档 JSON',h('input',{'data-testid':'workflow-archive-file',type:'file',accept:'.json,application/json',disabled:busy,onChange:chooseFile,style:field})),
  phase==='prepare'?h('p',{role:'status'},'正在读取与核验；取消不会恢复文件。'):null,
  preview?h('div',{'data-testid':'workflow-archive-preview'},h('h3',null,'恢复前核验摘要'),pre(preview),h('label',null,h('input',{'data-testid':'workflow-archive-ack',type:'checkbox',checked:confirmed,disabled:busy,onChange:e=>setConfirmed(e.target.checked)}),' 我已核对摘要，仅创建全新只读归档，不覆盖或激活任何工作档案'),
   button('确认创建只读流程归档',()=>run('restore',async token=>{const result=await controller.restore(preview,{explicitConfirmation:true,isCurrent:()=>valid(token)});if(!valid(token))return;setPreview(null);setConfirmed(false);setChosen('');setOpened(null);setMessage('已新增只读归档 '+result.id+'；当前工作档案和授权均未改变。');const list=await controller.list();if(valid(token))setSlots(list)}),!confirmed||!controller.canRestore)):null,
  preview||phase==='prepare'?h('button',{type:'button',style:secondary,disabled:busy&&phase!=='prepare',onClick:cancelPreview},'取消流程归档预览'):null,
  h('hr',{style:{border:0,borderTop:'1px solid #333',margin:'18px 0'}}),
  button('核验并刷新只读归档列表',()=>run('list',async token=>{const list=await controller.list();if(valid(token)){setSlots(list);setChosen('');setOpened(null)}})),
  h('select',{'data-testid':'workflow-archive-select',value:chosen,disabled:busy,style:field,onChange:e=>{setChosen(e.target.value);setOpened(null)}},h('option',{value:''},'选择只读归档（不会激活）'),slots.map(slot=>h('option',{key:slot.id,value:slot.id},slot.id))),
  button('核验并查看所选只读归档',()=>run('open',async token=>{const id=chosen,result=await controller.open(id);if(valid(token))setOpened({id,...result})}),!chosen),
  opened?h('div',{'data-testid':'workflow-archive-opened'},h('h3',null,'只读归档摘要（未激活）'),pre({id:opened.id,summary:opened.summary,byteSha256:opened.byteSha256,fingerprint:opened.fingerprint}),button('重新核验并导出所选归档',()=>run('reexport',async token=>{const result=await controller.open(opened.id);download(result.raw,'PRISM-readonly-workflow-archive.json',token)}))):null,
  message?h('p',{role:'status'},message):null);
}
