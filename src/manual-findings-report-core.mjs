/** Pure local presentation of already validated journal projections. No originals,
 * storage, network, verification side effects, or persistent report schema. */
export const MANUAL_FINDINGS_REPORT_LIMIT=Object.freeze({rows:200,field:12000,authors:256,author:1000,outputBytes:16000000});
const L=MANUAL_FINDINGS_REPORT_LIMIT;
const fail=()=>{throw Error('FINDINGS_REPORT_INVALID')};
function text(value,limit=L.field){if(typeof value!=='string'||value.length>limit||/[\uD800-\uDFFF]/u.test(value))fail();return value}
function optional(value){return value==null?'':text(value)}
function scalar(value){return value==null?'':typeof value==='number'&&Number.isFinite(value)?String(value):text(value)}
function bibliography(value){
 if(value==null)return null;
 const authors=value.authors??[];if(!Array.isArray(authors)||authors.length>L.authors)fail();
 return Object.freeze({title:optional(value.title),authors:Object.freeze(authors.map(x=>text(x,L.author))),year:scalar(value.year),doi:optional(value.doi),source:optional(value.source)});
}
export function captureReportBibliography(paper){return paper==null?null:bibliography({title:paper.title,authors:paper.metadata?.authors,year:paper.metadata?.year,doi:paper.metadata?.doi,source:paper.source})}
// Keep every captured string in a CommonMark/GFM fenced code block. Unlike
// entity escaping, code blocks remain inert even when linkification is enabled.
// The fence is longer than every backtick run anywhere in its complete body.
function fenced(value){const body=String(value);let longest=2;for(const match of body.matchAll(/`+/g))longest=Math.max(longest,match[0].length);const fence='`'.repeat(longest+1);return fence+'\n'+body+'\n'+fence}
function csv(value){let s=String(value);if(/^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@]/u.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
const status={same:'与保存引用一致（不代表原件已核对）',changed:'当前来源已变化',unavailable:'当前来源不可用',inconsistent:'当前正文与其声明哈希不一致'};
const doc={same:'一致',changed:'已变化',missing:'正文缺失','paper-missing':'论文条目缺失',inconsistent:'正文与声明哈希不一致'};
const snap={same:'一致',changed:'已变化','paper-missing':'论文条目缺失'};
const fields=[['id','结论记录 ID'],['seq','保存序号'],['time','保存时间（记录元数据）'],['paperId','论文 ID'],['recordedTitle','保存引用中的论文标题'],['currentTitle','当前论文标题'],['projectId','原始项目 ID（空值为共享模式）'],['stepName','保存时步骤名称'],['stepOrigin','步骤来源'],['promptVersion','Prompt 版本'],['recordId','手动研究记录 ID'],['replyId','回复 ID'],['replySha256','保存的回复 SHA-256'],['preparationSha256','保存的准备材料 SHA-256'],['recordedDocumentSha256','保存的正文 SHA-256'],['recordedSnapshotSha256','保存的论文快照 SHA-256'],['recordedPromptSha256','保存的 Prompt SHA-256'],['recordSha256','结论记录 SHA-256'],['currentDocumentSha256','当前正文 SHA-256'],['currentSnapshotSha256','当前论文快照 SHA-256'],['originNamespace','来源工作区标识'],['documentOrigin','正文来源'],['stepIndex','步骤索引'],['nodeId','自定义节点 ID'],['graphVersion','图版本'],['graphSha256','图 SHA-256'],['replyByteLength','回复字节数'],['previousRecordSha256','上一结论记录 SHA-256']];
const limitations='全部结论为 ai_unverified，未经认证，不构成经核实的研究证据。原件：未随附 / 本报告未核对原件。未包含论文正文、Prompt、原始回复或草稿内容。曾经进行的临时原件检查不适用于本报告。哈希只供关联与变化比对，不证明真实性、正确性、执行完成或可信时间。当前来源状态仅比较本地当前条目与保存引用；书目信息为导出时当前条目的捕获值，并非历史原件书目。来源缺失时仍保留共享模式范围内的历史结论。';
const csvNotice='CSV 单元格首个非空白/控制字符为 =、+、-、@ 时，前置单引号以降低电子表格公式执行风险；原有文字保留。';
export function buildManualFindingsReport({rows,projectId,filter={},total,excludedScopeCount,format}={}){
 if(!Array.isArray(rows)||rows.length>L.rows||!['markdown','csv'].includes(format)||typeof projectId!=='string'||!Number.isSafeInteger(total)||total<rows.length||total>L.rows||!Number.isSafeInteger(excludedScopeCount)||excludedScopeCount<0||total+excludedScopeCount>L.rows)fail();
 text(projectId,300);if(!filter||typeof filter!=='object'||Array.isArray(filter))fail();
 const query=text(filter.query??'',200),paperId=text(filter.paperId??'',300),sourceStatus=filter.sourceStatus??'all';if(!['all',...Object.keys(status)].includes(sourceStatus))fail();
 const mode=projectId?'项目模式（原始项目匹配且论文仍在当前项目中）':'共享模式（全部共享工作区日志，含历史来源缺失项）';
 const common=[['范围',mode],['范围项目 ID',projectId],['本次筛选结果数',rows.length],['范围内总数',total],['范围外排除数',excludedScopeCount],['检索词',query],['筛选论文 ID',paperId],['筛选来源状态',sourceStatus],['限制与来源说明',limitations],['CSV 安全说明',csvNotice]];
 const ids=new Set();const records=rows.map(r=>{
  if(!r||r.status!=='ai_unverified'||r.authenticated!==false||r.originalsIncluded!==false||!Object.hasOwn(status,r.sourceStatus)||!Object.hasOwn(doc,r.documentStatus)||!Object.hasOwn(snap,r.snapshotStatus)||ids.has(r.id))fail();ids.add(r.id);
  const expected=['paper-missing','missing'].includes(r.documentStatus)?'unavailable':r.documentStatus==='inconsistent'?'inconsistent':r.documentStatus==='changed'||r.snapshotStatus==='changed'?'changed':'same';if(r.sourceStatus!==expected||projectId&&r.projectId!==projectId)fail();
  const b=bibliography(r.bibliography),authors=b?text(b.authors.join('; ')):'';
  return [['结论全文',text(r.conclusion)],['验证状态','ai_unverified'],['原件','未随附 / 本报告未核对原件'],...fields.map(([key,label])=>[label,['seq','promptVersion','stepIndex','graphVersion','replyByteLength'].includes(key)?scalar(r[key]):optional(r[key])]),['当前来源状态',r.sourceStatus+' / '+status[r.sourceStatus]],['当前正文状态',r.documentStatus+' / '+doc[r.documentStatus]],['当前论文快照状态',r.snapshotStatus+' / '+snap[r.snapshotStatus]],['当前书目信息',b?'导出时捕获，未核验':'不可用'],['书目标题',b?.title??''],['书目作者',authors],['书目年份',b?.year??''],['书目 DOI',b?.doi??''],['书目来源',b?.source??'']];
 });
 let output;
 if(format==='markdown'){
  const overview=new Set(['验证状态','原件','当前书目信息','书目标题','书目作者','书目年份','书目 DOI','书目来源','保存时步骤名称','保存时间（记录元数据）','当前来源状态','当前正文状态','当前论文快照状态']);
  // Continuation indentation keeps user newlines inside their labelled field.
  const line=([k,v])=>'- '+k+'：'+(v===''?'（未记录）':String(v).replace(/(\r\n|\r|\n)/g,'$1  '));
  output='# 已保存研究结论报告\n\n'+fenced(common.map(line).join('\n'))+'\n\n'+(records.length?records.map((entries,i)=>{
   const conclusion=entries[0][1];
   const main=entries.filter(([k])=>overview.has(k));
   const provenance=entries.filter(([k])=>k!=='结论全文'&&!overview.has(k));
   return '## 结论 '+(i+1)+'\n\n'+fenced(conclusion)+'\n\n'+fenced(main.map(line).join('\n'))+'\n\n### 引用与核对信息\n\n'+fenced(provenance.map(line).join('\n'))+'\n';
  }).join('\n'):'本次筛选没有结论。\n');
 }
 else {
  // Empty reports retain scope/limitations in a metadata-only row, explicitly
  // distinguished from findings. All rows have the same RFC 4180 column count.
  const labels=records[0]?.map(([k])=>k)??['结论全文','验证状态','原件',...fields.map(([,k])=>k),'当前来源状态','当前正文状态','当前论文快照状态','当前书目信息','书目标题','书目作者','书目年份','书目 DOI','书目来源'];
  const header=['行类型',...common.map(([k])=>k),...labels];
  const body=records.length?records.map(entries=>['结论',...common.map(([,v])=>v),...entries.map(([,v])=>v)]):[['范围说明（无结论）',...common.map(([,v])=>v),...labels.map(()=>'')]];
  output='\ufeff'+[header,...body].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
 }
 if(new TextEncoder().encode(output).length>L.outputBytes)throw Error('FINDINGS_REPORT_TOO_LARGE');
 return Object.freeze({text:output,filename:format==='markdown'?'manual-findings-report.md':'manual-findings-report.csv',mime:format==='markdown'?'text/markdown;charset=utf-8':'text/csv;charset=utf-8',format,summary:Object.freeze({count:rows.length,total,excludedScopeCount,projectId,mode:projectId?'project':'shared',scopeLabel:mode,sourceCounts:Object.freeze(Object.fromEntries(Object.keys(status).map(key=>[key,rows.filter(r=>r.sourceStatus===key).length]))),status:'ai_unverified',authenticated:false,originalsIncluded:false})});
}
