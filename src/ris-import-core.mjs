import {validateDiscoveryCandidate} from './discovery-sources.mjs';
export const RIS_IMPORT_MAX_BYTES=1048576;
export const RIS_IMPORT_MAX_RECORDS=50;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const fail=code=>{throw Object.assign(Error(code),{code})};
const badText=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const scalar=(x,max)=>typeof x==='string'&&x.length<=max&&!/[\x00-\x1f\x7f-\x9f]/.test(x);
const supported=new Set(['TY','ER','TI','T1','AU','A1','PY','Y1','DO','AB','N2','UR']);
function normalizeDoi(value){
 let s=value.trim();try{if(/^https?:\/\//i.test(s)){const u=new URL(s);if(!['doi.org','dx.doi.org'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port)return null;s=u.pathname.slice(1)}else s=s.replace(/^doi:\s*/i,'');s=decodeURIComponent(s).toLowerCase()}catch{return null}
 return scalar(s,500)&&/^10\.\d{4,9}\/[^\s<>?#]+$/.test(s)?s:null;
}
// No I/O. Snapshot bytes before hashing; returned raw fields are untrusted plaintext.
export async function createRisImportPreview({bytes,filename,importedAt},crypto=globalThis.crypto){
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>RIS_IMPORT_MAX_BYTES)fail('RIS_FILE_SIZE');
 if(!scalar(filename,255)||!filename.trim()||typeof importedAt!=='string'||!Number.isFinite(Date.parse(importedAt))||new Date(importedAt).toISOString()!==importedAt)fail('RIS_INPUT');
 const snapshot=new Uint8Array(bytes);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(snapshot)}catch{fail('RIS_UTF8_REQUIRED')}
 if(badText.test(text))fail('RIS_INVALID_CONTROL');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot)),b=>b.toString(16).padStart(2,'0')).join('');
 const segments=text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean),lines=segments.map(s=>s.replace(/(?:\r\n|\r|\n)$/,'')),records=[];let current=null,start=0,totalFields=0;
 if(lines.length>20000)fail('RIS_LINE_LIMIT');
 for(let i=0;i<lines.length;i++){
  const line=lines[i],m=/^([A-Z0-9]{2})  -(?: (.*))?$/.exec(line);
  if(m){const tag=m[1],value=m[2]??'';
   if(tag==='TY'){if(current||!value.trim())fail('RIS_STRUCTURE');if(records.length>=RIS_IMPORT_MAX_RECORDS)fail('RIS_RECORD_LIMIT');current={recordNo:records.length+1,type:value,raw:'',fields:[],status:'accepted',candidateId:null,diagnostics:[]};start=i}
   if(!current)fail('RIS_STRUCTURE');if(current.fields.length>=200||++totalFields>5000)fail('RIS_FIELD_COUNT_LIMIT');current.fields.push({tag,value,line:i+1});
   if(tag==='ER'){if(value.trim())fail('RIS_STRUCTURE');current.raw=segments.slice(start,i+1).join('');records.push(current);current=null}
  }else if(!line.trim()){continue}
  else if(current&&/^ {6}/.test(line)&&current.fields.length){if(['TY','ER'].includes(current.fields.at(-1).tag))fail('RIS_STRUCTURE');current.fields.at(-1).value+='\n'+line.slice(6)}
  else fail('RIS_STRUCTURE');
 }
 if(current||!records.length)fail('RIS_STRUCTURE');
 const candidates=[],byIdentity=new Map();let duplicateCount=0;
 for(const r of records){
  const diagnostic=(code,field,message,severity='warning')=>r.diagnostics.push({code,severity,field,message});
  for(const f of r.fields)if(!supported.has(f.tag))diagnostic('RIS_UNMAPPED_FIELD',f.tag,'此字段仅在原文预览保留，不写入论文元数据。');
  const fields=tags=>r.fields.filter(f=>tags.includes(f.tag));
  const first=(tags,name)=>{const found=fields(tags).map(f=>f.value);if(new Set(found).size>1)diagnostic('RIS_CONFLICTING_VALUES',name,'多个值或别名不一致，仅使用原文件中第一个值；请人工核查。');return found[0]??''};
  let title=first(['TI','T1'],'title').trim();if(title.includes('\n')){title=title.replace(/\n/g,' ');diagnostic('RIS_TITLE_CONTINUATION','title','标题续行转为空格；原始字段仍可预览。')}
  const authors=fields(['AU','A1']).map(f=>f.value.trim()),abstract=first(['AB','N2'],'abstract'),yearRaw=first(['PY','Y1'],'year').trim(),doiRaw=first(['DO'],'doi').trim();
  let year=null;if(yearRaw){const match=/^(\d{4})(?:[\/\-]|$)/.exec(yearRaw);if(match&&+match[1]>=1000&&+match[1]<=3000)year=+match[1];else diagnostic('RIS_INVALID_YEAR','year','年份未识别，不写入年份。')}
  const doi=doiRaw?normalizeDoi(doiRaw):null;if(doiRaw&&!doi)diagnostic('RIS_INVALID_DOI','doi','DOI 无效，保留为无 DOI 候选。');
  const links=[];for(const f of fields(['UR'])){try{const u=new URL(f.value.trim());if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)throw Error();if(!links.some(l=>l.url===u.href))links.push({url:u.href,type:'reference-url'})}catch{diagnostic('RIS_UNSAFE_OR_INVALID_LINK','UR','未保留不安全或无效链接；不会打开链接或读取附件。')}}
  if(!title)diagnostic('RIS_TITLE_REQUIRED','title','缺少标题，拒绝此记录。','error');
  if(!scalar(title,500)||authors.length>20||authors.some(a=>!a||!scalar(a,300))||abstract.length>12000||links.length>10)diagnostic('RIS_FIELD_LIMIT','metadata','字段超出支持范围，拒绝此记录，不截断。','error');
  if(r.diagnostics.some(d=>d.severity==='error')){r.status='rejected';continue}
  const provenance={sourceId:'ris-file',sourceLabel:'用户 RIS 文件 · 未验证引用',mode:'local-file',recordId:`sha256:${sha256}:${r.recordNo}`,retrievedAt:importedAt,query:'离线 RIS 文件导入（非联网检索）'};
  const identity=doi?`local:doi:${doi}`:`local:record:ris-file:${provenance.recordId}`,old=byIdentity.get(identity);
  if(old){if(old.provenance.length>=10){diagnostic('RIS_PROVENANCE_LIMIT','doi','同一 DOI 超过 10 条来源，此重复记录不纳入候选；原文仍保留。','error');r.status='rejected';continue}
   for(const [field,value] of Object.entries({title,authors,year,abstract,links}))if(JSON.stringify(old[field])!==JSON.stringify(value)&&!old.conflicts.includes(field))old.conflicts.push(field);
   old.provenance.push(provenance);r.candidateId=old.id;duplicateCount++;diagnostic('RIS_DUPLICATE_DOI','doi','相同 DOI 已合并候选，保留各条来源；不同字段以首条为准并标记冲突。');continue}
  const c={schema:'prism-discovery-candidate/v2',id:`candidate-${candidates.length+1}`,identity,doi,title,authors,year,abstract,links,provenance:[provenance],simulation:false,conflicts:[],possibleDuplicateIds:[]};
  if(!validateDiscoveryCandidate(c))fail('RIS_INTERNAL_CANDIDATE_INVALID');r.candidateId=c.id;candidates.push(c);byIdentity.set(identity,c);
 }
 const key=c=>[c.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''),c.year,(c.authors[0]??'').toLowerCase()].join('|');
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(key(candidates[i])===key(candidates[j])){candidates[i].possibleDuplicateIds.push(candidates[j].id);candidates[j].possibleDuplicateIds.push(candidates[i].id)}
 const diagnostics=records.flatMap(r=>r.diagnostics.map(d=>({recordNo:r.recordNo,...d})));
 return freeze({schema:'prism-ris-import-preview/v1',file:{name:filename,byteLength:snapshot.byteLength,sha256},importedAt,candidates,records,diagnostics,summary:{recordCount:records.length,acceptedCount:records.filter(r=>r.status==='accepted').length,rejectedCount:records.filter(r=>r.status==='rejected').length,candidateCount:candidates.length,duplicateCount,warningCount:diagnostics.filter(d=>d.severity==='warning').length},authority:'none',networkAllowed:false,executionAllowed:false,fullTextRead:false});
}
