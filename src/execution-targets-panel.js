const executionRoleLabels={plan:'规划建议',prompt:'步骤 Prompt 建议',work:'步骤执行',review:'辅助复核',revision:'返修'};
const platformLabel={dsh:'DSH',codex:'Codex',zcode:'Zcode'};

function ExecutionPreferencesPanel({preferences,history,node,disabled,onSave}){
 const [selection,setSelection]=React.useState('plan');
 const [busy,setBusy]=React.useState(false);
 const [notice,setNotice]=React.useState('');
 const saving=React.useRef(false);
 const header=React.useId();
 const advanceHint=React.useId();
 const roles=executionTargetsCore.EXECUTION_ROLES;
 const options=roles.map(role=>({key:role,role,nodeId:null,label:'全流程 · '+executionRoleLabels[role]}));
 if(node){
  const allowed=node.kind==='review'?['review']:['work','prompt','revision'];
  for(const role of allowed)options.push({key:'node-'+role,role,nodeId:node.id,label:'当前步骤 · '+executionRoleLabels[role]});
 }
 const option=options.find(item=>item.key===selection)??options[0];
 const saved=preferences.assignments.find(item=>item.role===option.role&&item.nodeId===option.nodeId)?.target;
 const key=JSON.stringify([option.key,option.nodeId,saved]);
 async function save(change,success,error){
  if(saving.current||disabled)return;
  saving.current=true;setBusy(true);setNotice('');
  try{
   await onSave({...change,expectedVersion:preferences.version});
   setNotice(success);
  }catch{setNotice(error)}
  finally{saving.current=false;setBusy(false)}
 }
 return h('details',{className:'prism-record prism-execution-config','data-testid':'execution-preferences'},
   h('summary',null,'执行端配置'),
   h('label',null,'步骤推进',h('select',{value:preferences.advanceMode??'manual',disabled:busy||disabled,
    'aria-describedby':advanceHint,onChange:event=>void save({advanceMode:event.target.value},
     '步骤推进方式已保存。','推进方式未保存，请重新核对当前流程。')},
    h('option',{value:'manual'},'手动继续'),
    h('option',{value:'auto'},'自动打开下一步'))),
   h('p',{id:advanceHint,className:'prism-muted'},'自动打开下一步需要先保存完整答复或通过人工复核。每次发送仍需确认。'),
   h('label',null,'配置范围',h('select',{'aria-label':'配置范围',value:option.key,disabled:busy||disabled,
    onChange:event=>{setNotice('');setSelection(event.target.value)}},options.map(item=>h('option',{key:item.key,value:item.key},item.label)))),
   h('p',{id:header,className:'prism-muted'},'当前使用 ',executionTargetsCore.executionChoiceLabel(executionTargetsCore.resolveExecutionChoice(preferences,option.role,option.nodeId))),
   h(ExecutionPreferenceEditor,{key,saved,disabled:disabled||busy,description:header,
    onSave:choice=>save({role:option.role,nodeId:option.nodeId,choice},
     '执行端配置已保存，适用于之后确认的新请求。','配置未保存。请核对平台、模型和当前研究流程。')}),
   notice?h('p',{role:'status'},notice):null,
   history?.length?h('details',null,h('summary',null,'执行端配置历史'),
    h('ul',null,history.slice(-10).toReversed().map(entry=>h('li',{key:entry.preferences.version},
     '第 '+entry.preferences.version+' 版 · '+(entry.savedUtc?new Date(entry.savedUtc).toLocaleString():'保留的初始配置'),
     entry.preferences.advanceMode==='auto'?' · 自动打开下一步':' · 手动继续',
     h('ul',null,entry.preferences.assignments.map(item=>h('li',{key:JSON.stringify([item.role,item.nodeId])},
      executionRoleLabels[item.role],item.nodeId?' · '+item.nodeId:' · 全流程',' · ',executionTargetsCore.executionChoiceLabel(item.target)))))))):null);
}

function ExecutionPreferenceEditor({saved,disabled,description,onSave}){
 const start=saved?(saved.channel==='host'?'dsh-host':saved.channel==='automatic'?'codex-automatic':saved.platform):'inherit';
 const [platform,setPlatform]=React.useState(start);
 const [provider,setProvider]=React.useState(saved?.provider??'');
 const [model,setModel]=React.useState(saved?.model??'');
 const automatic=platform==='codex-automatic';
 const custom=!['dsh-host','inherit'].includes(platform);
 const valid=!custom||Boolean((automatic||provider.trim())&&model.trim());
 const dirty=platform!==start || custom&&(!automatic&&provider.trim()!==saved?.provider||model.trim()!==saved?.model);
 return h('form',{'aria-describedby':description,className:'prism-form',onSubmit:event=>{
  event.preventDefault();
  if(disabled||!valid||!dirty)return;
  onSave(platform==='inherit'?null:platform==='dsh-host'?executionTargetsCore.DSH_TARGET:
   automatic?{platform:'codex',channel:'automatic',provider:'openai',model:model.trim()}:
    {platform,channel:'manual',provider:provider.trim(),model:model.trim()});
 }},
  h('label',null,'执行平台',h('select',{'aria-label':'执行平台',value:platform,disabled,onChange:event=>{
   const next=event.target.value;
   setPlatform(next);setProvider(next===saved?.platform?saved.provider:next==='codex'?'OpenAI':'');setModel(next===saved?.platform?saved.model:'');
  }},
   h('option',{value:'inherit'},'沿用默认执行端'),
   h('option',{value:'dsh-host'},'DSH · DeepSeek Flash 直连'),
   h('option',{value:'codex-automatic'},'Codex · App Server 自动执行'),
   ...Object.entries(platformLabel).map(([key,text])=>h('option',{key,value:key},text+' · 人工交接')))),
  custom?h('div',{className:'prism-execution-fields'},
   !automatic?h('label',null,'服务商',h('input',{value:provider,onChange:event=>setProvider(event.target.value),maxLength:120,required:true,disabled})):null,
   h('label',null,'模型名称或 ID',h('input',{value:model,onChange:event=>setModel(event.target.value),maxLength:120,required:true,disabled}))):null,
  h('button',{type:'submit',className:'prism-primary',disabled:disabled||!valid||!dirty},'保存执行端'));
}

function CodexReadinessPanel(){
 const [status,setStatus]=React.useState(null);
 const [busy,setBusy]=React.useState(false);
 const pending=React.useRef(null);
 React.useEffect(()=>()=>pending.current?.abort(),[]);
 async function check(){
  if(pending.current)return;
  const controller=new AbortController();
  pending.current=controller;setBusy(true);
  try{
   const response=await fetch(executionTargetsCore.CODEX_READINESS_PATH,{credentials:'same-origin',redirect:'error',
    cache:'no-store',headers:{'X-PRISM-Readiness':'read'},signal:controller.signal});
   const data=response.ok?await response.json():{state:'unconfigured'};
   if(!controller.signal.aborted)setStatus(data);
  }catch{if(!controller.signal.aborted)setStatus({state:'unavailable'})}
  finally{pending.current=null;if(!controller.signal.aborted)setBusy(false)}
 }
 return h('div',{className:'prism-codex-readiness'},
  h('button',{type:'button',disabled:busy,onClick:check},busy?'正在读取 Codex 状态…':'读取 Codex 账户与额度'),
  status?h('p',{role:'status'},({
   unconfigured:'此工作台未配置 Codex 只读状态接口。',busy:'已有一次状态查询在进行。',
   'signed-out':'Codex 未登录。请在 Codex 原生入口登录。',unavailable:'暂时无法读取 Codex 账户。',
   available:'Codex 账户已核对。此步骤使用人工交接。',
  })[status.state]??'Codex 状态暂不可用。'):null,
  status?.state==='available'?h(React.Fragment,null,
   h('p',{className:'prism-muted'},status.limits?.windows?.length?'可见用量 '+status.limits.windows.map(row=>
    (row.windowMinutes?row.windowMinutes+' 分钟窗口已用 ':'额度窗口已用 ')+row.usedPercent+'%').join('，')+'。':'当前未读到额度窗口。',
    ' 无法确认所选模型的单次费用。'),
   status.models?.length?h('details',null,h('summary',null,'Codex 可见模型'),h('p',null,status.models.join('、'))):null):null);
}

function WorkbenchManualHandoff({record,busy,onClose}){
 const [answer,setAnswer]=React.useState('');
 const [session,setSession]=React.useState('');
 const [tokens,setTokens]=React.useState('');
 const [partial,setPartial]=React.useState(false);
 const [confirm,setConfirm]=React.useState(false);
 const [closing,setClosing]=React.useState(false);
 const [copied,setCopied]=React.useState('');
 const {input}=record;
 async function copy(){
  try{await navigator.clipboard.writeText(input.text);setCopied('已复制预览文本。')}
  catch{setCopied('无法访问剪贴板。可从下方手动复制。')}
 }
 return h('section',{className:'prism-record prism-form','aria-label':'待交接请求'},
  h('p',null,executionTargetsCore.executionChoiceLabel(input.execution),' · 待登记外部答复'),
  h('p',{className:'prism-muted'},'请求号 '+input.requestId+'。如已在外部发送，请查回原会话。'),
  h('details',null,h('summary',null,'查看待交接输入'),h('pre',{className:'prism-execution-input'},input.text)),
  h('div',{className:'prism-actions'},h('button',{type:'button',disabled:busy,onClick:copy},'复制待交接输入')),
  copied?h('p',{role:'status'},copied):null,
  h('label',null,'外部答复',h('textarea',{value:answer,onChange:event=>{setAnswer(event.target.value);setConfirm(false)},maxLength:16000,rows:5,disabled:busy})),
  h('details',null,h('summary',null,'会话标识和用量（如可见）'),
   h('div',{className:'prism-execution-fields'},
    h('label',null,'外部会话 ID',h('input',{value:session,onChange:event=>setSession(event.target.value),maxLength:200,disabled:busy})),
    h('label',null,'总 token 数',h('input',{value:tokens,onChange:event=>setTokens(event.target.value),inputMode:'numeric',maxLength:9,disabled:busy})))),
  h('label',null,h('input',{type:'checkbox',checked:partial,onChange:event=>setPartial(event.target.checked),disabled:busy}),'外部答复不完整'),
  h('label',null,h('input',{type:'checkbox',checked:confirm,onChange:event=>setConfirm(event.target.checked),disabled:busy}),'已核对这份答复来自所选平台和模型，且对应本请求'),
  h('div',{className:'prism-actions'},
   h('button',{type:'button',className:'prism-primary',disabled:busy||!confirm||!answer.trim(),
    onClick:()=>onClose({answer,externalSessionId:session.trim(),totalTokens:tokens.trim(),partial})},'登记外部答复'),
   h('button',{type:'button',disabled:busy,onClick:()=>setClosing(!closing)},closing?'继续保留待交接请求':'结束交接')),
  closing?h('div',null,h('p',null,'请先到外部平台核对这一次的状态。结束仅关闭本机记录。'),
   h('button',{type:'button',disabled:busy,onClick:()=>onClose(null)},'已核对，结束本次交接')):null);
}
