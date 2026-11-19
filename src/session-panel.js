// Real-session preparation only. No prompt submission or imported-paper transmission.
function NativeSessions({controller}){
 const React=require('react'),h=React.createElement;
 if(!controller)return h('section',{style:{border:'1px solid #444',padding:18,borderRadius:14,marginBottom:20}},h('h2',null,'真实 DSH 会话 · 未启用'),h('p',null,'正式接口或连接身份尚未验证，保持关闭。下方研究流程仍为本地模拟。'));
 return h(ConnectedNativeSessions,{controller});
}
function ConnectedNativeSessions({controller}){
 const React=require('react'),h=React.createElement,s=React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const [message,setMessage]=React.useState('');
 const style={background:'#121212',color:'#ededed',border:'1px solid #444',borderRadius:9,padding:'9px 12px',font:'inherit'};
 async function act(name,...args){setMessage('');try{await controller[name](...args)}catch{setMessage('操作未完成，请查看连接状态。不会自动重试或发送消息。')}}
 const button=(label,name,args=[],disabled=false)=>h('button',{type:'button',style,onClick:()=>act(name,...args),disabled:(s.busy&&!['disconnect','cancel'].includes(name))||disabled},label);
 return h('section',{style:{border:'1px solid #555',padding:18,borderRadius:14,marginBottom:20}},
  h('h2',{style:{fontSize:18}},'真实 DSH 会话 · 仅准备，不发送'),
  h('p',null,'本区通过官方 DSH 接口创建独立空白会话，并读取其真实运行状态；不是模拟。没有发送 Prompt 的功能，不读取已有对话、不上传论文正文、不调用模型。'),
  h('p',{style:{color:'#b8b8b8'}},'项目内记录只保留在本次连接中，不是持久备份。断线、重载或断开后不接管旧会话；已创建的空白会话可能留在 DSH，可在那里查看。断开后需重载插件才能新建控制代际，不会接管旧会话。下方论文档案和模拟流程仍使用原浏览器存储，不因此获得账号级隔离。'),
  h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},button('读取官方项目列表','loadWorkspaces'),button('断开本区控制','disconnect')),
  h('label',{style:{display:'block',margin:'12px 0'}},'选择已注册项目 ',h('select',{style,value:s.selectedId||'',onChange:e=>act('selectWorkspace',e.target.value),disabled:s.busy},h('option',{value:''},'请选择'),(s.workspaces||[]).map(w=>h('option',{key:w.id,value:w.id},w.title||w.path||w.id)))),
  h('div',{style:{display:'flex',gap:8}},button('创建受控空白会话','prepare',[],!s.prepareAllowed)),
  s.error?h('p',{role:'alert',style:{color:'#f1c98e'}},'会话控制状态：',s.error,'。未自动重试，未发送 Prompt。'):null,
  message?h('p',{role:'alert'},message):null,
  (s.records||[]).filter(r=>r.workspaceId===s.selectedId).map(r=>h('article',{key:r.id,style:{padding:'12px 0',borderTop:'1px solid #333',marginTop:12}},h('p',{style:{overflowWrap:'anywhere'}},'真实会话：',r.sessionId||'创建结果尚未确认'),h('p',null,'状态：',r.status,'；运行：',String(r.running??'未知'),'；排队：',r.queueCount??'未知','；待输入：',r.pendingInputCount??'未知'),h('p',{style:{fontSize:12,color:'#aaa'}},'项目 ',r.workspaceId),h('div',{style:{display:'flex',gap:8}},button('刷新真实状态','refresh',[r.id],!s.enabled||r.controlAllowed===false),button('请求取消会话活动','cancel',[r.id],!s.enabled||r.controlAllowed===false)))),
  h('p',{style:{fontSize:12,color:'#b8b8b8'}},'取消仅表示请求；运行、队列或输入状态不明时，不能宣称已停止。创建空白会话不代表研究已开始或完成。'));
}
