function OutputRequirementsPresets({ library, text, disabled, onAppend }) {
  const core=flowOutputRequirementsCore;
  const builtIn=core.ANTI_DEFENSIVE_WRITING_PRESET;
  const [view,setView]=React.useState({raw:null,presets:[]});
  const [id,setId]=React.useState(builtIn.id);
  const [editing,setEditing]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState('');
  const [problem,setProblem]=React.useState('');
  const pending=React.useRef(false);
  const selected=view.presets.find(item=>item.id===id)??builtIn;
  const locked=disabled||busy;
  const alreadyAdded=core.hasOutputRequirementsPreset(text,selected.text);

  React.useEffect(()=>{
    function refresh(){
      try{setView(library.read())}
      catch{setProblem('无法读取我的预设。内置规则仍可使用，已保存的流程要求保留。')}
    }
    refresh();
    const changed=event=>{if(event.key===null||event.key===library.key)refresh()};
    globalThis.window?.addEventListener?.('storage',changed);
    return ()=>globalThis.window?.removeEventListener?.('storage',changed);
  },[library]);

  function append(){
    try{
      onAppend(core.appendOutputRequirementsPreset(text,selected.text));
      setProblem('');
      setMessage('已加入流程草稿。保存要求后生效。');
    }catch(error){setProblem(error.message==='OUTPUT_REQUIREMENTS_TOO_LONG'
      ?'加入后将超过 24,000 字节，请先缩短草稿。'
      :'草稿含无法发送的控制字符，请修改后再加入预设。')}
  }

  function edit(preset){
    setEditing({id:preset?.id,name:preset?.name??'',text:preset?.text??text,expectedRaw:view.raw});
    setProblem('');
    setMessage('');
  }

  async function save(event){
    event.preventDefault();
    if(!editing||locked||pending.current||!editing.name.trim()||!editing.text.trim())return;
    pending.current=true;
    setBusy(true);
    setProblem('');
    setMessage('');
    try{
      const next=await library.save(editing,editing.expectedRaw);
      setView(next);
      setId(next.id);
      setEditing(null);
      setMessage('预设已保存，可在其他项目的流程中选用。');
    }catch(error){
      if(error.message==='OUTPUT_PRESET_CHANGED')try{setView(library.read())}catch{}
      setProblem({
        OUTPUT_PRESET_CAPACITY:'预设已达到保存容量。可缩短文字或编辑现有预设。',
        OUTPUT_PRESET_DUPLICATE:'已有同名预设。请另取名称。',
        OUTPUT_PRESET_CHANGED:'另一标签更新了预设。请先复制你的编辑，再重新打开预设核对。',
        OUTPUT_PRESET_INVALID:'请核对名称和规则。预设必须有名称和正文。',
        OUTPUT_REQUIREMENTS_TOO_LONG:'规则超过 24,000 字节，请缩短。',
        OUTPUT_REQUIREMENTS_INVALID:'规则含无法发送的控制字符，请删除后保存。',
      }[error.message]??'预设保存未确认。你的编辑仍在，请先核对本机存储。');
    }finally{
      pending.current=false;
      setBusy(false);
    }
  }

  return h('details',{className:'prism-output-presets'},
    h('summary',null,'写作预设'),
    h('label',null,'选择预设',h('select',{value:selected.id,disabled:locked||!!editing,onChange:event=>{setId(event.target.value);setMessage('');setProblem('')}},
      h('option',{value:builtIn.id},builtIn.name),view.presets.map(item=>h('option',{key:item.id,value:item.id},item.name)))),
    h('details',null,h('summary',null,'查看所选预设的规则'),
      h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},selected.text)),
    h('div',{className:'prism-actions'},
      h('button',{type:'button',disabled:locked||alreadyAdded,onClick:append},'追加到流程草稿'),
      h('button',{type:'button',disabled:locked||!!editing||!library.writable||!text.trim(),onClick:()=>edit()},'将草稿另存为预设'),
      selected.id!==builtIn.id?h('button',{type:'button',disabled:locked||!!editing||!library.writable,onClick:()=>edit(selected)},'编辑我的预设'):null),
    editing?h('form',{className:'prism-form',onSubmit:save,'aria-label':'编辑写作预设'},
      h('label',null,'预设名称',h('input',{value:editing.name,maxLength:80,required:true,disabled:locked,onChange:event=>setEditing({...editing,name:event.target.value})})),
      h('label',null,'预设规则',h('textarea',{value:editing.text,rows:5,required:true,disabled:locked,onChange:event=>setEditing({...editing,text:event.target.value})})),
      h('div',{className:'prism-actions'},
        h('button',{type:'button',disabled:locked,onClick:()=>setEditing(null)},'取消编辑预设'),
        h('button',{type:'submit',disabled:locked||!editing.name.trim()||!editing.text.trim()},'保存预设'))):null,
    !library.writable?h('p',{className:'prism-muted'},'此环境只能查看和应用已有预设。'):null,
    h('p',{role:'status',hidden:!message},message),
    problem?h('p',{role:'alert'},problem):null);
}

function FlowOutputRequirements({snapshot, disabled, onSave, drafts, draftScope, presetLibrary}) {
  const [editing,setEditing]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const heading=React.useId(), description=React.useId(), field=React.useId();
  const started=React.useRef(false);
  const focusField=React.useCallback(element=>{
    // The browser chooses this target when showModal() opens the portal.
    if(element)element.setAttribute('autofocus','');
  },[]);
  const bytes=editing ? new TextEncoder().encode(editing.text).length : 0;
  const limit=flowOutputRequirementsCore.OUTPUT_REQUIREMENTS_LIMIT;
  const native=typeof globalThis.HTMLDialogElement?.prototype.showModal==='function';
  const base=JSON.stringify(snapshot);
  const persisted=drafts?.read('requirements',draftScope);

  function open(){
    setEditing(persisted?.base===base ? {...snapshot,text:persisted.text} : snapshot);
    setError('');
  }
  function change(text) {
    drafts?.write('requirements',draftScope,base,text===snapshot.text?null:text);
    setEditing({...editing,text});
  }
  const clearDraft=()=>{
    if(drafts?.read('requirements',draftScope)?.base===base) drafts.write('requirements',draftScope,base,null);
  };

  async function save(event){
    event.preventDefault();
    if(started.current||disabled||!editing||bytes>limit||editing.text===snapshot.text)return;
    const dialog=event.currentTarget.closest('dialog');
    started.current=true;
    setBusy(true);
    setError('');
    try{
      await onSave(editing.text,editing.version);
      clearDraft();
      if(dialog?.open)dialog.close();
      else setEditing(null);
    }catch(error){
      setError(error.message==='OUTPUT_REQUIREMENTS_INVALID'
        ?'要求中含无法发送的控制字符。请修改后再保存。'
        :'保存未确认。请保留这段内容，重新核对当前流程后再试。');
    }finally{
      started.current=false;
      setBusy(false);
    }
  }

  const content=editing?h(React.Fragment,null,
    h('h2',{id:heading},'流程级输出要求'),
    h('p',{id:description},'保存后应用于当前论文的这份流程，包括规划、步骤和返修。'),
    presetLibrary?h(OutputRequirementsPresets,{library:presetLibrary,text:editing.text,disabled:busy||disabled,onAppend:change}):null,
    h('form',{onSubmit:save},
      h('label',{htmlFor:field},'统一输出要求'),
      h('textarea',{id:field,ref:focusField,value:editing.text,rows:6,autoFocus:!native,disabled:busy,
        onChange:event=>change(event.target.value)}),
      persisted&&persisted.base!==base?h('details',null,h('summary',null,'查看旧版本要求草稿'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},persisted.text)):null,
      h('p',{className:'prism-muted'},'要求计入每次请求的长度。保存仅影响之后确认发送的请求。'),
      bytes>limit?h('p',{role:'status'},'文字超过 24,000 字节，请缩短后保存。'):null,
      error?h('p',{role:'alert'},error):null,
      h('div',{className:'prism-actions'},
        h('button',{type:'button',disabled:busy,onClick:event=>{
          clearDraft();
          const dialog=event.currentTarget.closest('dialog');
          if(dialog?.open)dialog.close();
          else setEditing(null);
        }},'取消'),
        h('button',{type:'submit',className:'prism-primary',disabled:disabled||busy||bytes>limit||editing.text===snapshot.text},
          busy?'正在保存…':'保存要求')),
      h('p',{className:'prism-muted'},'发送时附上完整规则文本。必需的输出结构、证据真实性和系统边界优先。'))):null;

  return h(React.Fragment,null,
    h('button',{type:'button',disabled,onClick:open,'aria-haspopup':native?'dialog':undefined},'流程级输出要求'),
    h('small',{className:'prism-muted'},snapshot.version?'第 '+snapshot.version+' 版'+(snapshot.text?'':' · 当前为空'):'未设置'),
    editing?(native?h(prismUi.AlertDialogContent,{className:'prism-dialog prism-output-requirements',
      'aria-labelledby':heading,'aria-describedby':description,onClose:()=>setEditing(null),
      onCancel:event=>{if(started.current)event.preventDefault();else clearDraft()}},content)
      :h('section',{className:'prism-record','aria-labelledby':heading},content)):null);
}
