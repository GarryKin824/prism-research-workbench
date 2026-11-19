// Shared, presentation-only viewer. Never modifies/copies back into source records.
function ResearchContent({text, showRawToggle=true, ...wrapperProps}) {
 const source=typeof text==='string'?text:String(text??'');
 const [showRaw,setShowRaw]=React.useState(false);
 const [expandedSource,setExpandedSource]=React.useState(null);
 const result=React.useMemo(()=>richTextCore.parseResearchContent(source,{DOMParser:globalThis.DOMParser||globalThis.document?.defaultView?.DOMParser}),[source]);
 function render(n,key){return typeof n==='string'?n:h(n.tag,{...n.props,key},...n.children.map(render))}
 const rawMode=showRaw||result.mode==='raw';
 const large=source.length>richTextCore.RICH_TEXT_LIMITS.characters;
 return h('div',{...wrapperProps,className:['research-content',wrapperProps.className].filter(Boolean).join(' ')},
 showRawToggle?h('button',{type:'button','aria-pressed':showRaw,onClick:()=>setShowRaw(v=>!v)},showRaw?'查看排版':'查看原文'):null,
 result.reason?h('p',{role:'status'},result.reason):null,
 !rawMode&&result.mathFailures?h('p',{role:'status'},`${result.mathFailures} 个公式无法安全排版，已原样保留。`):null,
 rawMode?(large&&expandedSource!==source?h('button',{type:'button',onClick:()=>setExpandedSource(source)},`展开完整原文（${source.length} 字符，可能影响性能）`):h('pre',{'data-testid':'research-content-raw',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:600,overflow:'auto'}},source)):
 h('div',{'data-testid':'research-content-rendered',style:{overflowWrap:'anywhere',overflowX:'auto'}},...result.nodes.map(render)));
}
