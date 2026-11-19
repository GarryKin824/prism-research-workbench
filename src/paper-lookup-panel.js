// Local, read-only lookup. React text children intentionally never render HTML.
function LocalPaperLookupPanel({papers,selectedId,onSelect,scopeReady=true,guided=false}) {
 const [query,setQuery]=React.useState(''),[inputValue,setInputValue]=React.useState(''),[textFilter,setTextFilter]=React.useState('all');
 const composing=React.useRef(false),queryInput=React.useRef(null);
 const index=React.useMemo(()=>paperLookupCore.createPaperLookup(scopeReady?papers:[]),[papers,scopeReady]);
 const lookup=React.useMemo(()=>paperLookupCore.lookupPapers(index,{query,textFilter}),[index,query,textFilter]);
 const filteredSelection=selectedId&&!lookup.results.some(result=>result.id===selectedId);
 const inputId=React.useId(),filterId=React.useId();
 const empty=lookup.total?'当前条件没有匹配论文。可修改检索词或文本筛选。':'当前范围尚无已建档论文。';
 if(guided&&(!scopeReady||!lookup.total)){
  return h('section',{'data-testid':'local-paper-lookup','aria-label':'本地论文查找'},
   h('p',{className:'prism-muted','data-testid':'local-paper-empty'},scopeReady?empty:'正在核验当前项目论文关系。'));
 }
 const search=h(guided?PrismSearch:'div',{className:guided?'prism-library-search':undefined,'aria-label':guided?'查找本地论文':undefined},
  h('div',null,h('label',{htmlFor:inputId},guided?'查找论文':'查找本地标题、作者、年份、DOI、来源、摘要或已保存文本'),
   h('input',{id:inputId,ref:queryInput,'aria-label':guided?undefined:'本地论文检索词','data-testid':'local-paper-query',type:'search',
    value:inputValue,maxLength:paperLookupCore.PAPER_LOOKUP_LIMIT.query,style:guided?undefined:field,spellCheck:false,
    autoCapitalize:'none',autoCorrect:'off',
    onCompositionStart:()=>{composing.current=true},
    onCompositionEnd:e=>{composing.current=false;setInputValue(e.currentTarget.value);setQuery(e.currentTarget.value)},
    onChange:e=>{setInputValue(e.target.value);if(!composing.current&&!e.nativeEvent.isComposing)setQuery(e.target.value)}})),
  h('div',null,h('label',{htmlFor:filterId},guided?'正文状态':'文本保存情况'),
   h('select',{id:filterId,'aria-label':guided?undefined:'本地论文文本筛选',value:textFilter,style:guided?undefined:field,onChange:e=>setTextFilter(e.target.value)},
    h('option',{value:'all'},'全部档案'),h('option',{value:'saved-text'},'已有保存文本'),h('option',{value:'metadata-only'},'未保存正文'))));
 const rules=h('p',{style:{color:palette.muted,fontSize:12}},'在当前范围匹配标题、作者、年份、DOI、来源、摘要或已保存正文。空格分词须全部命中，最多 32 词、200 字符。不联网、不保存检索词。');
 return h('section',{'data-testid':'local-paper-lookup','aria-label':'本地论文查找'},
  !guided?h('h3',{style:{marginTop:0}},'查找已建档论文'):null,
  search,
  guided?guidedHelp('匹配规则',rules):h('p',{style:{color:palette.muted,fontSize:12}},'仅查当前范围，空格分隔的词须全部命中，可位于不同字段（最多 32 词、200 字符）。按字面忽略大小写匹配；不联网、不保存检索词、不更改档案。摘要属于元数据；已有保存文本不表示全文完整或已完成研究。流程 Prompt、合成产物和人工研究记录不在此检索范围。'),
  h('p',{'data-testid':'local-paper-match-count',role:'status',className:guided?'prism-muted':undefined,style:guided?undefined:{color:palette.muted}},
   '本地匹配 ',lookup.results.length,' / ',lookup.total),
  !scopeReady?h('p',{role:'status'},'正在核验当前项目论文关系，暂不显示结果；不会扩大到共享基础库。'):null,
  lookup.error?h('p',{role:'alert'},lookup.error==='TOO_MANY_TERMS'?'请将检索词减少到 32 个以内。':'检索条件无效，请清空后重试。'):null,
  scopeReady&&!lookup.error&&!lookup.results.length?h('p',{'data-testid':'local-paper-empty'},empty):null,
  filteredSelection&&scopeReady?h('p',{'data-testid':'local-paper-selection-retained',style:{color:palette.muted}},'当前论文不在查找结果中，仍保留当前选择；筛选不会自动换篇。'):null,
  (!guided||inputValue||textFilter!=='all')?h('div',{className:'prism-actions'},h('button',{type:'button',style:guided?undefined:secondary,
   disabled:!inputValue&&textFilter==='all',onClick:()=>{composing.current=false;setInputValue('');setQuery('');setTextFilter('all');if(guided)queryInput.current?.focus()}},'清空本地查找与筛选')):null,
  h('ul',{'data-testid':'local-paper-results',className:'prism-library-list',style:guided?undefined:{listStyle:'none',padding:0,margin:0}},lookup.results.map(result=>h('li',{key:result.id,'data-paper-id':result.id,
   style:guided?undefined:{borderTop:'1px solid '+palette.line,padding:'10px 0',overflowWrap:'anywhere'}},
   h('button',{type:'button','aria-current':selectedId===result.id?'true':undefined,onClick:()=>onSelect(result.id),style:guided?undefined:{...secondary,borderColor:selectedId===result.id?'#ededed':'#444',textAlign:'left',overflowWrap:'anywhere',maxWidth:'100%'}},
    guided?h(prismUi.FileText,{size:15,strokeWidth:1.65,'aria-hidden':true}):null,result.title),
   h('p',{'data-testid':'local-paper-text-status',className:guided?'prism-muted':undefined,style:guided?undefined:{margin:'6px 0',color:palette.muted}},
    result.hasSavedText?(guided?'已有保存正文':'已有保存文本（完整性与科学有效性仍须另行核验）')
     :result.recordKind==='metadata'?'元数据，未保存正文':'档案信息，未保存正文'),
   result.matchedFields.length?h('p',{'data-testid':'local-paper-matched-fields',style:{margin:'6px 0'}},'命中：',result.matchedFields.map(match=>match.label).join('、')):null,
   result.snippet?h('p',{'data-testid':'local-paper-snippet',style:{margin:'6px 0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13}},result.snippet.label,'片段：',result.snippet.text):null
  )))
 );
}
