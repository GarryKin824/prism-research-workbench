// Independent, explicitly opted-in PDF byte vault. This never reads or mutates
// papers, project records, extracted-text provenance, or portable archives.
function PdfOriginalVaultPanel({store,guided=false}){
 let namespace=null;try{namespace=store.getStorageKey()}catch{}
 const scope=React.useMemo(()=>({store,namespace,controller:null,alive:true,enabled:false,consent:false,downloadConsent:false,epoch:0,flight:null}),[store,namespace]);
 const currentScope=React.useRef(scope);currentScope.current=scope;
 const initial=()=>({scope,enabled:false,consent:false,busy:false,preview:null,confirmed:false,consumed:false,listing:null,outcome:null,message:'',uncertain:false,downloadConsent:false});
 const [state,setState]=React.useState(initial),view=state.scope===scope?state:initial();
 const update=patch=>setState(old=>({...((old.scope===scope)?old:initial()),...patch}));
 function sameScope(){try{return scope.alive&&currentScope.current===scope&&scope.store.getStorageKey()===scope.namespace}catch{return false}}
 function current(token){return sameScope()&&scope.enabled&&scope.consent&&scope.epoch===token.epoch&&scope.flight===token&&(token.kind!=='export'||scope.downloadConsent)}
 React.useLayoutEffect(()=>{
  scope.alive=true;setState(initial());
  // A synchronous flight ref also protects the gap before React renders busy.
  const leave=event=>{if(event.detail?.namespace===scope.namespace&&event.detail?.kind==='slot'&&scope.flight){event.preventDefault();if(sameScope())update({message:'PDF 原件操作尚未结束，暂不切换档案槽；等待实际结果后再切换。'})}};
  if(typeof document!=='undefined')document.addEventListener?.('prism-planning-leave',leave);
  return()=>{scope.alive=false;scope.epoch++;scope.controller?.close();if(typeof document!=='undefined')document.removeEventListener?.('prism-planning-leave',leave)};
 },[scope]);
 function controller(){
  if(!sameScope()||!scope.enabled||!scope.consent)throw Error('CONSENT_REQUIRED');
  if(!scope.controller){
   // Do not even inspect IDB/crypto/Blob until an explicitly consented action.
   let indexedDB,crypto,BlobType;try{indexedDB=globalThis.indexedDB}catch{}try{crypto=globalThis.crypto}catch{}try{BlobType=globalThis.Blob}catch{}
   scope.controller=createPdfOriginalVaultController({namespace:scope.namespace,indexedDB,crypto,Blob:BlobType});
  }
  return scope.controller;
 }
 function toggleEnabled(value){
  scope.enabled=value;scope.epoch++;
  if(!value){scope.consent=false;scope.downloadConsent=false;update({enabled:false,consent:false,preview:null,confirmed:false,consumed:false,downloadConsent:false,message:scope.flight?.kind==='commit'?'入口已关闭，但已经启动的保存事务可能仍会完成；关闭不是回滚。等待实际结果，重新启用后主动刷新核对。':'入口已关闭；未删除已存原件，未修改外部文件。'})}
  else update({enabled:true,message:'尚未读取文件或打开原件库。请先阅读并确认隐私边界，再主动操作。'});
 }
 function toggleConsent(value){scope.consent=value;scope.downloadConsent=false;scope.epoch++;update({consent:value,preview:null,confirmed:false,consumed:false,downloadConsent:false,message:!value&&scope.flight?.kind==='commit'?'已撤回后续操作同意；已启动事务可能仍会完成，不能承诺撤销。':''})}
 function begin(kind){if(!sameScope()||!scope.enabled||!scope.consent||scope.flight)return null;const token={kind,epoch:++scope.epoch};scope.flight=token;update({busy:true,message:''});return token}
 function finish(token){if(scope.flight!==token)return;scope.flight=null;if(sameScope())update({busy:false});else if(scope.alive&&currentScope.current===scope)update({busy:false,preview:null,listing:null,outcome:null,message:'档案槽已变化；旧操作结果不会展示到新档案。'})}
 const errorText=code=>{
  const messages={
   UNSUPPORTED:'当前浏览器缺少 IndexedDB、SHA-256 或 Blob 支持，不能使用原件库；未启用替代存储。',
   INVALID_NAMESPACE:'当前档案槽的完整命名空间无效，已停止操作；未读取其他档案。',
   INVALID_FILE:'请选择名称合法、非空且不含路径的 PDF 文件，最多 32 MiB；未读取不符合要求的文件。',
   TOO_LARGE:'这份文件超过 32 MiB 上限，未读取或保存；请保留外部原件。',
   NOT_PDF_HEADER:'文件开头不是受支持的 PDF 标记，未保存；即使有标记也不代表有效或安全。',
   INPUT_CHANGED:'所选文件大小、名称或内容读取长度已变化，未保存；请核对外部原件。',
   FULL:'原件库容量已满或这次新增将超过 32 份 / 256 MiB；未新增，只可核验和逐份导出已有原件。',
   VERIFY_FAILED:'已存 PDF 字节的大小、SHA-256 或元数据核验失败，已拒绝导出；请保留外部原件，不覆盖旧记录。',
   CORRUPT_RECORD:'原件库记录格式或字节信息异常，不能把当前数量当作零，也不能导出未核验字节；请保留外部原件。',
   INCOMPATIBLE_SCHEMA:'此原件库结构不受支持，未迁移、覆盖或删除；请保留原有浏览器数据和外部原件。',
   OPEN_BLOCKED:'原件库打开被其他页面或浏览器阻止，未自动重试；核对相关页面后可主动刷新。',
   OPEN_FAILED:'浏览器拒绝打开原件库，可能是权限、隐私模式或配额限制；请保留外部原件，未改用其他存储。',
   OPEN_TIMEOUT:'原件库打开超时；未自动重试，不代表数据不存在，请保留外部原件。',
   READ_FAILED:'文件或已存原件读取失败，未确认内容可用；请保留外部原件，稍后主动核对。',
   READ_TIMEOUT:'读取原件库超时，未确认内容可用；未自动重试。',
   FILE_TIMEOUT:'所选文件读取超时，未保存；请保留外部原件。',
   HASH_FAILED:'SHA-256 计算失败，不能确认字节一致；未声明保存成功或提供未核验下载。',
   HASH_TIMEOUT:'SHA-256 核验超时，不能确认字节一致；未自动重试。',
   WRITE_ABORTED:'保存事务已中止，未新增原件；可能是浏览器配额或存储限制。请保留外部文件，未自动重试。',
   WRITE_UNCERTAIN:'保存结果不确定；禁止再次添加。请保留外部原件，主动刷新核对，不自动重试。',
   REFRESH_REQUIRED:'此前写入结果仍不确定；请先主动刷新核对，不要再次添加。',
   INVALID_PREVIEW:'这份预览已失效或已使用；未再次提交。请核对已有结果后再选择外部文件。',
   NOT_FOUND:'此原件当前未找到，未请求下载；请主动刷新核对，保留外部原件。',
   CANCELLED:'操作上下文已变化，未开始新的写入或下载；不代表已启动的事务已撤销。',
   CLOSED:'此原件库入口已关闭，未开始新的操作；关闭不代表已启动的事务回滚。',
   BUSY:'已有原件操作尚未结束，请等待实际结果；未重复提交。',
   CONFIRMATION_REQUIRED:'尚未明确确认这份预览，未保存。',
   INVALID_ID:'原件标识无效，已停止读取或下载。',
   CONSENT_REQUIRED:'请先启用入口并确认明文隐私边界，未打开原件库。'
  };
  return (messages[code]||'操作未完成，未自动重试；请保留外部原件。')+'（'+(code||'UNKNOWN_ERROR')+'）';
 };
 async function choose(event){
  const files=Array.from(event.target.files||[]);event.target.value='';
  if(!scope.enabled||!scope.consent||scope.flight||view.uncertain)return;
  update({preview:null,confirmed:false,consumed:false,outcome:null});if(!files.length)return;
  if(files.length!==1){update({message:'每次请选择一份 PDF 原件。'});return}
  const token=begin('prepare');if(!token)return;
  try{const result=await controller().prepare(files[0],{isCurrent:()=>current(token)});if(!current(token))return;
   if(result.ok)update({preview:result.preview,message:'仅完成本地字节与哈希预览，尚未保存。PDF 头标记不证明文件有效、安全或来源真实。'});
   else update({message:errorText(result.code)});
  }catch(error){if(current(token))update({message:errorText(error.message)})}finally{finish(token)}
 }
 async function commit(){
  if(!view.preview||!view.confirmed||view.consumed||view.uncertain)return;const preview=view.preview,token=begin('commit');if(!token)return;
  update({consumed:true,confirmed:false});
  try{const result=await controller().commit(preview,{explicitConfirmation:true,isCurrent:()=>current(token)});
   // Once a write starts, a checkbox change is not proof of cancellation. Only
   // show its actual outcome in the same still-mounted namespace, never a new one.
   if(!sameScope())return;
   const uncertain=result.code==='WRITE_UNCERTAIN'||result.outcome==='unknown'||result.outcome==='committed_unverified'||!!scope.controller.getStatus().uncertain;
   const verified=result.ok&&result.code==='STORED',duplicate=result.code==='DUPLICATE'&&result.outcome==='already_present_verified';
   update({outcome:{...result,verified,duplicate},uncertain,listing:null,message:verified?'本次 PDF 字节已写入浏览器原件库，并完成保存后回读与 SHA-256 核验；这不保证永久保存。':duplicate?'相同字节原件已存在且重新核验通过，未重复添加、改名或覆盖。':errorText(result.code)});
  }catch(error){if(sameScope())update({uncertain:true,outcome:{ok:false,code:error.message||'WRITE_UNCERTAIN',outcome:'unknown'},message:'未能确认保存结果；不能声明取消或未写入。禁止再次添加，请保留外部原件并主动刷新核对。'})}finally{finish(token)}
 }
 async function refresh(){
  const token=begin('refresh');if(!token)return;
  try{const result=await controller().refresh({isCurrent:()=>current(token)});if(!current(token))return;
   const uncertain=!!scope.controller.getStatus().uncertain;
   if(result.ok){const reconciliation=result.reconciliation;const outcome=reconciliation?{ok:reconciliation.state==='present_verified',code:'RECONCILED',outcome:reconciliation.state,verified:reconciliation.state==='present_verified',record:result.records.find(record=>record.id===reconciliation.id)}:view.outcome;update({listing:{records:result.records,totalBytes:result.totalBytes},uncertain,outcome,message:uncertain?'已读取原件库，但此前写入仍无法确定；保持只读，仅可逐份核验导出。':reconciliation?.state==='present_verified'?'此前不确定的原件现已从存储中读取并核验；没有重试写入。':reconciliation?.state==='not_present'?'此次只读核对未发现此前不确定的原件；没有重试写入。请保留外部文件。':'已主动读取并核验此档案槽的原件库；没有自动添加、删除或重试保存。'})}
   else update({listing:null,uncertain,message:errorText(result.code)+' 当前数量未知，不能按零份处理。'});
  }catch(error){if(current(token))update({listing:null,message:errorText(error.message)+' 当前数量未知。'})}finally{finish(token)}
 }
 async function download(id){
  if(!scope.downloadConsent)return;const token=begin('export');if(!token)return;let url;
  try{const result=await controller().exportOriginal(id,{isCurrent:()=>current(token)});if(!current(token))return;if(!result.ok){update({message:errorText(result.code)});return}
   // Recheck after URL creation and immediately before click, including the live
   // store key: a late hash or download cannot escape into a new namespace.
   if(!/^[a-f0-9]{64}$/.test(result.sha256))throw Error('INVALID_ID');const downloadName='PRISM-original-'+result.sha256+'.pdf';url=URL.createObjectURL(result.blob);if(!current(token)){URL.revokeObjectURL(url);url=null;return}
   const anchor=document.createElement('a');anchor.href=url;anchor.download=downloadName;if(!current(token)){URL.revokeObjectURL(url);url=null;return}anchor.click();
   const released=url;url=null;setTimeout(()=>URL.revokeObjectURL(released),1000);
   if(current(token))update({message:'已重新核验已存 PDF 字节，并请求下载 '+downloadName+'；浏览器接受下载不证明磁盘已保存。下载名使用哈希，原文件名仅供展示；请自行打开并核对文件，保留外部原件。'});
  }catch(error){if(url)URL.revokeObjectURL(url);if(current(token))update({message:'下载未确认完成：'+(error.message||'DOWNLOAD_FAILED')+'。没有自动重试，请核对浏览器。'})}finally{finish(token)}
 }
 const operational=view.enabled&&view.consent,full=!!view.listing&&(view.listing.records.length>=32||view.listing.totalBytes>=256*1024*1024);
 const recordView=(record,key)=>h('li',{key,style:{overflowWrap:'anywhere'}},h('strong',null,record.name),h('p',null,record.size+' 字节 · SHA-256 '+record.sha256),h('button',{type:'button',style:secondary,'data-testid':'pdf-vault-export',disabled:!operational||view.busy||!view.downloadConsent,onClick:()=>download(record.id)},'核验并下载此原件'));
 return h('section',{'data-testid':'pdf-original-vault-panel',style:{...box,marginTop:16}},
  h('h2',null,guided?'PDF 原件库':'可选 PDF 原件库 · 独立保存与逐份导出'),
  guided?h(React.Fragment,null,h('p',{className:'prism-muted'},'本机明文保存 · 单份 32 MiB · 共 32 份 / 256 MiB'),guidedHelp('保存与隐私',h(React.Fragment,null,h('p',null,'默认关闭。每份最多 32 MiB，每个完整档案槽最多 32 份 / 合计 256 MiB；只新增，不删除、覆盖或迁移。容量满后保留只读核验与导出。始终保留外部原始 PDF，失败不会修改你选择的外部文件。'),
  h('p',{'data-testid':'pdf-vault-privacy'},'原件以明文字节保存在本浏览器 IndexedDB，同源脚本可读取；命名空间只是逻辑隔离，不是账号权限或加密。浏览器配额、隐私模式、数据清理或自动驱逐可能导致失败或丢失。不会自动申请持久存储权限，也不联网。真实 Host / 浏览器支持尚未验收；不支持或不能核验时停止，不改用其他存储。请勿保存秘密或敏感材料。'),
  h('p',{'data-testid':'pdf-vault-backup-boundary'},'项目便携备份仍不包含 PDF 二进制原件。本库不自动关联论文或项目，不更改既有机器生成的 PDF 来源声明，也不认证出处。逐份导出的 PDF 可重新选择、预览并确认加入独立原件库，但不能恢复主档案、项目或研究状态；这不是完整备份或批量恢复。下载名使用完整 SHA-256，不会恢复原始文件名或外部文件历史。')))):h(React.Fragment,null,h('p',null,'默认关闭。每份最多 32 MiB，每个完整档案槽最多 32 份 / 合计 256 MiB；只新增，不删除、覆盖或迁移。容量满后保留只读核验与导出。始终保留外部原始 PDF，失败不会修改你选择的外部文件。'),
  h('p',{'data-testid':'pdf-vault-privacy'},'原件以明文字节保存在本浏览器 IndexedDB，同源脚本可读取；命名空间只是逻辑隔离，不是账号权限或加密。浏览器配额、隐私模式、数据清理或自动驱逐可能导致失败或丢失。不会自动申请持久存储权限，也不联网。真实 Host / 浏览器支持尚未验收；不支持或不能核验时停止，不改用其他存储。请勿保存秘密或敏感材料。'),
  h('p',{'data-testid':'pdf-vault-backup-boundary'},'项目便携备份仍不包含 PDF 二进制原件。本库不自动关联论文或项目，不更改既有机器生成的 PDF 来源声明，也不认证出处。逐份导出的 PDF 可重新选择、预览并确认加入独立原件库，但不能恢复主档案、项目或研究状态；这不是完整备份或批量恢复。下载名使用完整 SHA-256，不会恢复原始文件名或外部文件历史。')),
  h('label',null,h('input',{type:'checkbox','data-testid':'pdf-vault-enable',checked:view.enabled,onChange:event=>toggleEnabled(event.target.checked)}),guided?'启用原件库':' 启用此页的独立 PDF 原件库入口（默认关闭）'),
  view.enabled?h(React.Fragment,null,
   h('label',{style:{display:'block'}},h('input',{type:'checkbox','data-testid':'pdf-vault-consent',checked:view.consent,onChange:event=>toggleConsent(event.target.checked)}),' 我了解明文、同源脚本与丢失风险，同意主动读取及保存所选 PDF，并会保留外部原件'),
   h('p',{style:{overflowWrap:'anywhere'}},'当前完整档案槽：',String(namespace||'无有效命名空间')),
   h('button',{type:'button',style:secondary,'data-testid':'pdf-vault-refresh',disabled:!operational||view.busy,onClick:refresh},'主动刷新并核对原件库'),
   h('p',{'data-testid':'pdf-vault-capacity'},view.listing?'已核验 '+view.listing.records.length+' / 32 份，'+view.listing.totalBytes+' / 268435456 字节。':'尚未读取或核验当前原件库，数量与占用未知。'),
   full?h('p',{role:'alert'},'容量已满，只读保留；请逐份导出并自行核对磁盘文件。不删除或覆盖旧原件。'):null,
   view.uncertain?h('p',{'data-testid':'pdf-vault-uncertain',role:'alert'},'此前写入结果不确定；添加已锁定。只可主动刷新核对或逐份核验导出，不会自动重试。'):null,
   h('label',null,'选择一份原始 PDF（≤32 MiB；仅字节保存，不解析）',h('input',{type:'file',accept:'.pdf,application/pdf','data-testid':'pdf-vault-file',style:field,disabled:!operational||view.busy||view.uncertain||full,onChange:choose})),
   view.preview?h('div',{'data-testid':'pdf-vault-preview',style:{overflowWrap:'anywhere'}},h('p',null,'待核对文件：'+view.preview.name+' · '+view.preview.size+' 字节'),h('p',null,'SHA-256：'+view.preview.sha256),h('p',null,'哈希仅检查这些字节是否一致，不证明 PDF 有效、安全、作者身份或研究结论。'),h('label',null,h('input',{type:'checkbox','data-testid':'pdf-vault-confirmation',checked:view.confirmed,disabled:!operational||view.busy||view.consumed||view.uncertain,onChange:event=>update({confirmed:event.target.checked})}),' 我已核对这份原件，同意新增保存这些明文字节'),h('button',{type:'button',style:secondary,'data-testid':'pdf-vault-commit',disabled:!operational||view.busy||view.consumed||view.uncertain||!view.confirmed,onClick:commit},'确认新增这份原件'),view.consumed?h('p',null,'此次确认已使用，不会重复提交。失败时请保留原文件；核对结果后如需另一次操作，必须重新选择并明确确认。'):null):null,
   h('label',{style:{display:'block'}},h('input',{type:'checkbox','data-testid':'pdf-vault-download-consent',checked:view.downloadConsent,disabled:!operational,onChange:event=>{scope.downloadConsent=event.target.checked;if(!scope.downloadConsent&&scope.flight?.kind==='export')scope.epoch++;update({downloadConsent:event.target.checked})}}),' 我同意在逐份核验后下载明文 PDF，并会自行确认磁盘保存'),
   view.listing?h('ul',{'data-testid':'pdf-vault-list'},view.listing.records.map(record=>recordView(record,record.id))):null,
   !view.listing&&view.outcome?.record&&(view.outcome.verified||view.outcome.duplicate)?h('ul',null,recordView(view.outcome.record,'latest')):null):null,
  view.busy?h('p',{role:'status'},scope.flight?.kind==='commit'?'正在等待保存事务及回读核验；关闭入口不等于取消或回滚。':'正在读取或核验，请等待；没有自动重试。'):null,
  view.outcome?h('p',{'data-testid':'pdf-vault-outcome','data-outcome':view.outcome.outcome||'failed'},view.outcome.verified?'已保存并回读核验。':view.outcome.duplicate?'已存在并重新核验；未新增。':['unknown','committed_unverified'].includes(view.outcome.outcome)?'保存结果未知，未声明成功。':view.outcome.outcome==='not_present'?'只读核对未发现这份原件。':'此次操作未保存新原件。'):null,
  view.message?h('p',{'data-testid':'pdf-vault-message',role:'status'},view.message):null);
}
