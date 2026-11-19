import {validateDiscoveryCandidate} from './discovery-sources.mjs';
export const BIBTEX_IMPORT_MAX_BYTES=1048576;
export const BIBTEX_IMPORT_MAX_RECORDS=50;
const fail=code=>{throw Object.assign(Error(code),{code})};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const scalar=(s,n)=>typeof s==='string'&&s.length<=n&&!/[\x00-\x1f\x7f-\x9f]/.test(s);
const supportedTypes=new Set('article book inproceedings conference misc phdthesis mastersthesis techreport incollection inbook proceedings booklet manual unpublished'.split(' '));
function doiValue(value){let s=value.trim();try{if(/^https?:\/\//i.test(s)){const u=new URL(s);if(!['doi.org','dx.doi.org'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port)return null;s=u.pathname.slice(1)}else s=s.replace(/^doi:\s*/i,'');s=decodeURIComponent(s).toLowerCase()}catch{return null}return scalar(s,500)&&/^10\.\d{4,9}\/[^\s<>?#]+$/.test(s)?s:null}
function splitAuthors(s){const out=[];let depth=0,start=0;for(let i=0;i<s.length;i++){if(s[i]==='\\'){i++;continue}if(s[i]==='{')depth++;else if(s[i]==='}')depth--;else if(depth===0&&i>0&&/\s/.test(s[i-1])&&s.slice(i,i+3).toLowerCase()==='and'&&/\s/.test(s[i+3]??'')){out.push(s.slice(start,i).trim());i+=3;while(i+1<s.length&&/\s/.test(s[i+1]))i++;start=i+1}}out.push(s.slice(start).trim());return out}

/** Bounded BibTeX subset, never a TeX/macro interpreter. No I/O. */
export async function createBibtexImportPreview({bytes,filename,importedAt},crypto=globalThis.crypto){
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>BIBTEX_IMPORT_MAX_BYTES)fail('BIBTEX_FILE_SIZE');
 if(!scalar(filename,255)||!filename.trim()||typeof importedAt!=='string'||!Number.isFinite(Date.parse(importedAt))||new Date(importedAt).toISOString()!==importedAt)fail('BIBTEX_INPUT');
 const snapshot=new Uint8Array(bytes);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(snapshot)}catch{fail('BIBTEX_UTF8_REQUIRED')}
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text))fail('BIBTEX_INVALID_CONTROL');
 if(text.split(/\r\n|\n|\r/).length>20000)fail('BIBTEX_LINE_LIMIT');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot)),b=>b.toString(16).padStart(2,'0')).join('');
 let pos=0,totalFields=0;const records=[],lineStarts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n'||text[i]==='\r'){if(text[i]==='\r'&&text[i+1]==='\n')i++;lineStarts.push(i+1)}
 const lineAt=index=>{let lo=0,hi=lineStarts.length;while(lo+1<hi){const m=(lo+hi)>>1;if(lineStarts[m]<=index)lo=m;else hi=m}return lo+1};
 const skip=()=>{while(pos<text.length){if(/\s/.test(text[pos]))pos++;else if(text[pos]==='%'){while(pos<text.length&&!/[\r\n]/.test(text[pos]))pos++}else break}};
 // Returns text without the outer delimiter, preserving all inner groups/escapes.
 function grouped(open){const begin=++pos;let depth=1;const quote=open==='"';while(pos<text.length){const c=text[pos];if(c==='\\'){pos+=2;continue}if(c==='{'){depth++;if(depth>32)fail('BIBTEX_DEPTH_LIMIT')}else if(c==='}'){if(quote){if(depth===1)fail('BIBTEX_STRUCTURE');depth--}else if(--depth===0){const value=text.slice(begin,pos++);return value}}else if(quote&&c==='"'&&depth===1){const value=text.slice(begin,pos++);return value}pos++}fail('BIBTEX_STRUCTURE')}
 function atom(close){skip();if(text[pos]==='{'||text[pos]==='"')return {value:grouped(text[pos]),macro:false};const start=pos;while(pos<text.length&&!/[\s,#{}()"%]/.test(text[pos]))pos++;if(pos===start)fail('BIBTEX_STRUCTURE');const value=text.slice(start,pos);return {value,macro:!/^\d+$/.test(value)}}
 while(true){skip();if(pos===text.length)break;if(text[pos]!=='@')fail('BIBTEX_STRUCTURE');const start=pos++;const m=/^[A-Za-z]+/.exec(text.slice(pos));if(!m)fail('BIBTEX_STRUCTURE');const type=m[0].toLowerCase();pos+=m[0].length;skip();const open=text[pos],close=open==='{'?'}':open==='('?')':null;if(!close)fail('BIBTEX_STRUCTURE');if(records.length>=50)fail('BIBTEX_RECORD_LIMIT');pos++;
  const r={recordNo:records.length+1,type,key:'',raw:'',fields:[],status:'accepted',candidateId:null,diagnostics:[]};
  const note=(code,field,message,severity='warning')=>r.diagnostics.push({code,severity,field,message});
  if(['string','preamble','comment'].includes(type)){
   // Consume balanced directive syntax without evaluating or binding any value.
   let depth=1;while(pos<text.length&&depth){const c=text[pos];if(c==='\\'){pos+=2;continue}if(c==='"'){grouped('"');continue}if(c==='{'){grouped('{');continue}if(open==='('&&c==='('){depth++;if(depth>32)fail('BIBTEX_DEPTH_LIMIT');pos++;continue}if(c===close){depth--;pos++;continue}pos++}
   if(depth)fail('BIBTEX_STRUCTURE');note('BIBTEX_UNSUPPORTED_DIRECTIVE',null,'此指令不执行、不展开，不能导入为论文。','error');
  }else{
   const keyStart=pos;while(pos<text.length&&text[pos]!==','&&text[pos]!==close)pos++;if(text[pos]!==',')fail('BIBTEX_STRUCTURE');r.key=text.slice(keyStart,pos++).trim();if(!r.key||r.key.length>200||/[\s{}()"=%#]/.test(r.key))fail('BIBTEX_STRUCTURE');
   if(!supportedTypes.has(type))note('BIBTEX_UNSUPPORTED_TYPE',null,'此条目类型不在支持子集内。','error');
   const seen=new Set();
   while(true){skip();if(text[pos]===close){pos++;break}const line=lineAt(pos),field=/^[A-Za-z][A-Za-z0-9_-]*/.exec(text.slice(pos));if(!field)fail('BIBTEX_STRUCTURE');const tag=field[0].toLowerCase();pos+=field[0].length;skip();if(text[pos++]!=='=')fail('BIBTEX_STRUCTURE');if(r.fields.length>=200||++totalFields>5000)fail('BIBTEX_FIELD_COUNT_LIMIT');
    const first=atom(close);let value=first.value,macro=first.macro,concat=false;skip();while(text[pos]==='#'){concat=true;pos++;const next=atom(close);macro||=next.macro;value+=' # '+next.value;skip()}
    r.fields.push({tag,value,line});if(seen.has(tag))note('BIBTEX_DUPLICATE_FIELD',tag,'重复字段，拒绝该条目，避免静默选择。','error');seen.add(tag);
    if(macro)note('BIBTEX_UNSUPPORTED_MACRO',tag,'裸字符串宏未展开，拒绝该条目。','error');if(concat)note('BIBTEX_UNSUPPORTED_CONCAT',tag,'不支持 # 字符串拼接，拒绝该条目。','error');
    if(['crossref','xdata'].includes(tag))note('BIBTEX_UNSUPPORTED_INHERITANCE',tag,'不解析继承关系，拒绝该条目。','error');
    else if(!['title','author','doi','year','abstract','url'].includes(tag))note('BIBTEX_UNMAPPED_FIELD',tag,'仅在原文预览保留此字段，不写入论文元数据。');
    if(text[pos]===','){pos++;continue}if(text[pos]!==close)fail('BIBTEX_STRUCTURE');
   }
  }
  r.raw=text.slice(start,pos);records.push(r);
 }
 if(!records.length)fail('BIBTEX_STRUCTURE');
 const keys=new Map();for(const r of records)if(r.key){const normalizedKey=r.key.toLowerCase();if(!keys.has(normalizedKey))keys.set(normalizedKey,[]);keys.get(normalizedKey).push(r)}for(const group of keys.values())if(group.length>1)for(const r of group)r.diagnostics.push({code:'BIBTEX_DUPLICATE_KEY',severity:'error',field:null,message:'引用键重复或仅大小写不同，相关条目全部拒绝；此保守子集不猜测引用键兼容性。'});
 const candidates=[],byIdentity=new Map();let duplicateCount=0;
 for(const r of records){
  const note=(code,field,message,severity='warning')=>r.diagnostics.push({code,severity,field,message}),get=tag=>r.fields.find(f=>f.tag===tag)?.value??'';
  if(r.diagnostics.some(d=>d.severity==='error')){r.status='rejected';continue}
  let title=get('title').trim();if(/[\r\n\t]/.test(title)){title=title.replace(/[\r\n\t]+/g,' ');note('BIBTEX_TITLE_WHITESPACE','title','标题换行/制表转为空格，原始字段仍保留。')}
  const author=get('author');if(author.length>12000){note('BIBTEX_FIELD_LIMIT','author','作者字段超出解析上限，拒绝该条目。','error');r.status='rejected';continue}const authors=author?splitAuthors(author).map(a=>a.replace(/[\r\n\t]+/g,' ')):[],abstract=get('abstract'),yearRaw=get('year').trim(),doiRaw=get('doi').trim(),urlRaw=get('url').trim();let year=null;
  if(yearRaw){if(/^\d{4}$/.test(yearRaw)&&+yearRaw>=1000&&+yearRaw<=3000)year=+yearRaw;else note('BIBTEX_INVALID_YEAR','year','年份未识别，不写入年份。')}
  const doi=doiRaw?doiValue(doiRaw):null;if(doiRaw&&!doi)note('BIBTEX_INVALID_DOI','doi','无效 DOI，不将引用键当作 DOI。');const links=[];
  if(urlRaw){try{const u=new URL(urlRaw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)throw Error();links.push({url:u.href,type:'reference-url'})}catch{note('BIBTEX_UNSAFE_OR_INVALID_LINK','url','未保留不安全或无效链接；不访问链接。')}}
  if(!title)note('BIBTEX_TITLE_REQUIRED','title','缺少标题，拒绝该条目。','error');if(!scalar(title,500)||authors.length>20||authors.some(a=>!a||!scalar(a,300))||abstract.length>12000)note('BIBTEX_FIELD_LIMIT','metadata','字段超出支持范围，拒绝该条目，不截断。','error');
  if(/\\/.test([title,...authors,abstract].join('')))note('BIBTEX_TEX_LITERAL',null,'TeX 命令保留为字面文字，不展开、不转换为 Unicode。');
  if(r.diagnostics.some(d=>d.severity==='error')){r.status='rejected';continue}
  const provenance={sourceId:'bibtex-file',sourceLabel:'用户 BibTeX 文件 · 未验证引用',mode:'local-file',recordId:`sha256:${sha256}:${r.recordNo}`,retrievedAt:importedAt,query:'离线 BibTeX 文件导入（非联网检索）'},identity=doi?`local:doi:${doi}`:`local:record:bibtex-file:${provenance.recordId}`,old=byIdentity.get(identity);
  if(old){if(old.provenance.length>=10){note('BIBTEX_PROVENANCE_LIMIT','doi','同一 DOI 超过 10 条来源，拒绝该重复条目，原文仍保留。','error');r.status='rejected';continue}for(const [field,value]of Object.entries({title,authors,year,abstract,links}))if(JSON.stringify(old[field])!==JSON.stringify(value)&&!old.conflicts.includes(field))old.conflicts.push(field);old.provenance.push(provenance);r.candidateId=old.id;duplicateCount++;note('BIBTEX_DUPLICATE_DOI','doi','相同 DOI 合并候选，保留各条来源与冲突，首条字段为准。');continue}
  const c={schema:'prism-discovery-candidate/v2',id:`candidate-${candidates.length+1}`,identity,doi,title,authors,year,abstract,links,provenance:[provenance],simulation:false,conflicts:[],possibleDuplicateIds:[]};if(!validateDiscoveryCandidate(c))fail('BIBTEX_INTERNAL_CANDIDATE_INVALID');r.candidateId=c.id;candidates.push(c);byIdentity.set(identity,c);
 }
 const similar=c=>[c.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''),c.year,(c.authors[0]??'').toLowerCase()].join('|');for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(similar(candidates[i])===similar(candidates[j])){candidates[i].possibleDuplicateIds.push(candidates[j].id);candidates[j].possibleDuplicateIds.push(candidates[i].id)}
 const diagnostics=records.flatMap(r=>r.diagnostics.map(d=>({recordNo:r.recordNo,...d})));return freeze({schema:'prism-bibtex-import-preview/v1',file:{name:filename,byteLength:snapshot.byteLength,sha256},importedAt,candidates,records,diagnostics,summary:{recordCount:records.length,acceptedCount:records.filter(r=>r.status==='accepted').length,rejectedCount:records.filter(r=>r.status==='rejected').length,candidateCount:candidates.length,duplicateCount,warningCount:diagnostics.filter(d=>d.severity==='warning').length},authority:'none',networkAllowed:false,executionAllowed:false,fullTextRead:false});
}
