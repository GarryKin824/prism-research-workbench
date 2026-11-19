/** Read-only local lookup. The caller supplies the already-authorized project scope.
 * Never reads storage, fetches a URL, executes markup, or indexes research outputs.
 */
export const PAPER_LOOKUP_LIMIT = Object.freeze({query:200,terms:32,snippet:180});
const FIELD_LABELS = Object.freeze({title:'标题',authors:'作者',year:'年份',doi:'DOI',source:'来源',abstract:'摘要（元数据）',text:'已保存文本'});
const displayText = value => typeof value==='string' ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,' ').replace(/\s+/gu,' ').trim() : '';
const folded = value => value.toLowerCase().replace(/ς/g,'σ');
const scalarText = value => typeof value==='string' ? value : typeof value==='number'&&Number.isFinite(value) ? String(value) : '';

/** An ephemeral index of only bibliographic fields and saved document text.
 * No source references are returned, and changes require a fresh index.
 */
export function createPaperLookup(papers) {
 if(!Array.isArray(papers))return [];
 return papers.filter(p=>p&&typeof p.id==='string'&&p.id&&typeof p.title==='string').map(p=>{
  const metadata=p.metadata&&typeof p.metadata==='object'?p.metadata:{};
  const savedText=typeof p.document?.text==='string'?p.document.text:'';
  const values={title:p.title,authors:Array.isArray(metadata.authors)?metadata.authors.filter(a=>typeof a==='string').join(', '):'',year:scalarText(metadata.year),doi:metadata.doi,source:p.source,abstract:metadata.abstract,text:savedText};
  return {id:p.id,title:displayText(p.title),hasSavedText:!!savedText.trim(),recordKind:p.metadata?'metadata':'record',fields:Object.entries(values).map(([id,value])=>{const text=displayText(value);return {id,text,folded:folded(text)}}).filter(field=>field.text)};
 });
}

function shortSnippet(field,terms) {
 const limit=PAPER_LOOKUP_LIMIT.snippet;
 const position=terms.reduce((best,term)=>{const pos=field.folded.indexOf(term);return pos<0?best:Math.min(best,pos)},Infinity);
 // Ordinary case folding preserves UTF-16 offsets. Only expanding folds (e.g.
 // İ) need a scan; never convert the whole document into a code-point array.
 let at=Number.isFinite(position)?position:0;
 if(field.folded.length!==field.text.length){
  let original=0,lower=0;
  for(const point of field.text){if(lower>=at)break;original+=point.length;lower+=folded(point).length}
  at=original;
 }
 let start=Math.max(0,at-45),end=Math.min(field.text.length,start+limit-2);
 if(end===field.text.length)start=Math.max(0,end-(limit-2));
 // Keep UTF-16 surrogate pairs intact at both ends of the bounded window.
 const low=code=>code>=0xdc00&&code<=0xdfff;
 if(start&&low(field.text.charCodeAt(start)))start++;
 if(end<field.text.length&&low(field.text.charCodeAt(end)))end--;
 return (start?'…':'')+field.text.slice(start,end)+(end<field.text.length?'…':'');
}

/** Space-separated literal terms use AND across the supported fields. No regex,
 * fuzzy, semantic or remote search. Input order and current selection are kept.
 */
export function lookupPapers(index,{query='',textFilter='all'}={}) {
 const fail=error=>({results:[],total:Array.isArray(index)?index.length:0,error});
 if(typeof query!=='string'||query.length>PAPER_LOOKUP_LIMIT.query)return fail('INVALID_QUERY');
 if(!['all','saved-text','metadata-only'].includes(textFilter))return fail('INVALID_FILTER');
 const normalized=displayText(query),terms=[...new Set(folded(normalized).split(' ').filter(Boolean))];
 if(terms.length>PAPER_LOOKUP_LIMIT.terms)return fail('TOO_MANY_TERMS');
 if(!Array.isArray(index))return fail('INVALID_INDEX');
 const results=[];
 for(const paper of index){
  if(textFilter==='saved-text'&&!paper.hasSavedText||textFilter==='metadata-only'&&paper.hasSavedText)continue;
  if(!terms.every(term=>paper.fields.some(field=>field.folded.includes(term))))continue;
  const matched=terms.length?paper.fields.filter(field=>terms.some(term=>field.folded.includes(term))):[];
  const snippetField=matched.find(field=>field.id==='text')||matched.find(field=>field.id==='abstract')||matched[0];
  results.push({id:paper.id,title:paper.title,hasSavedText:paper.hasSavedText,recordKind:paper.recordKind,matchedFields:matched.map(field=>({id:field.id,label:FIELD_LABELS[field.id]})),snippet:snippetField?{field:snippetField.id,label:FIELD_LABELS[snippetField.id],text:shortSnippet(snippetField,terms)}:null});
 }
 return {results,total:index.length,error:null};
}
