/** Read-only projection of already validated, captured research sources. No drafts,
 * original model replies, PDF bytes, source writes or execution authority. */
import {sha256} from './custom-core.mjs';
import {FIELDS} from './evidence-map-core.mjs';
import {fixedDrift,fixedSourceSnapshotDrift} from './linked-evidence-core.mjs';
import {freezeProgress,progressSourceStatus} from './research-progress-core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=code=>{throw Error(code);};
export const PAPER_RESULTS_REPORT_LIMIT=16*1024*1024;
const bytes=s=>new TextEncoder().encode(s).length;
export function createPaperResultsDetail({namespace,projectId,paper,row,source,persistence,findings,claims,legacy,notes,referenceContext,approvals,copies,findingEvidence,documentSourceHistory,terminalReviews}){
 function claim(r,origin){
  if(!r)return null;
  const fields=Object.fromEntries(FIELDS.map(field=>[field,{status:r.fields[field].status,text:r.fields[field].text,evidence:r.fields[field].evidence.map(e=>{
   const out={sourceLabel:e.sourceLabel,locator:e.locator,quote:e.quote};
   if(e.fixedSnapshot){const {raw,...metadata}=e.fixedSnapshot;out.fixedSnapshot={...metadata,rawBytes:bytes(raw),rawIncluded:false,sourceSnapshotDrift:fixedSourceSnapshotDrift(e.fixedSnapshot,r.source),sourceSnapshotWarning:fixedSourceSnapshotDrift(e.fixedSnapshot,r.source)?'历史迁移快照，与证据绑定论文快照不同；这是来源漂移提示，不代表该历史证据无效。':null,sourceStatus:!referenceContext.workflowAvailable||metadata.kind==='manual-review'&&!referenceContext.reviewAvailable?'unavailable':fixedDrift(e.fixedSnapshot,{...referenceContext,source:r.source})?'changed':'same'};}
   return out;
  })}]));
  const fixed=Object.values(fields).flatMap(v=>v.evidence).filter(e=>e.fixedSnapshot).map(e=>e.fixedSnapshot);
  const fixedReferenceStatus=fixed.some(x=>x.sourceStatus==='unavailable')?'unavailable':fixed.some(x=>x.sourceStatus==='changed')?'changed':fixed.length?'same':'none';
  return {fixedReferenceStatus,origin,claimId:origin==='multi'?r.claimId:null,revisionSha256:r.revisionSha256,revisionCount:r.revisionCount??null,originSha256:r.originSha256??null,source:clone(r.source),sourceStatus:progressSourceStatus(source,r.source),fields,scope:'shared-paper',authority:'none'};
 }
 const detail={kind:'paper-results-detail',namespace,projectId,paperId:paper.id,title:paper.title,scope:projectId?'project':'shared-paper',source:clone(source),persistence:clone(persistence),sources:clone(row.sources),issues:clone(row.issues),workflows:clone(row.workflows),plan:clone(row.plan),
  terminalReviews:clone(terminalReviews??{status:'unavailable',count:null,items:[],authority:'none',currentApprovalEstablished:false,coverage:'终审历史未重新验证，不代表当前许可。'}),
  copies:clone(copies??{status:'unavailable',schema:null,count:null,items:[],authority:'none',originalsIncluded:false,sendEstablished:false,modelExecutionEstablished:false,currentApprovalEstablished:false,coverage:{meaning:'未取得已验证复制元数据；复制≠发送≠模型执行≠批准。'}}),
  approvals:clone(approvals??{status:'unavailable',schema:null,count:null,headsCount:null,items:[],authority:'none',executionApproval:'not_assessed',currentApprovalEstablished:false,originalsIncluded:false,coverage:{assessment:'没有已验证的账本投影；未建立当前批准。'}}),
  documentSourceHistory:clone(documentSourceHistory??{status:'missing',authority:'none',rawIncluded:false}),
  findingEvidence:clone(findingEvidence??{status:'unavailable',schema:null,count:null,items:[],authority:'none',supportEstablished:false}),
  findings:{status:row.findings.status,count:row.findings.status==='unavailable'?null:findings.length,items:clone(findings)},
  reviews:{status:row.reviews.status,count:row.reviews.status==='unavailable'?null:notes.length,items:clone(notes)},
  evidence:{scope:'shared-paper',status:row.evidence.status,count:row.evidence.status==='unavailable'?null:claims.length,claims:claims.map(r=>claim(r,'multi')),legacy:{status:row.evidence.legacy.status,present:row.evidence.legacy.present,countedWithMulti:false,item:claim(legacy,'legacy')}},
  coverage:{documentSourceHistory:'First-document attachment checkpoint metadata; complete prior paper/workflow raw bytes remain in base backups, not this report. No original PDF or authority restoration.',findingEvidence:'Exact project/paper finding-to-quote evidence ledger, complete versions and withdrawals; literal text and hashes do not establish scientific support or approval.',manualFindings:'All saved findings for this exact paper and selected project origin; no 1000-character/list truncation.',evidence:'Latest six-field revision per saved multi claim. Legacy latest paper revision is separate and not counted again.',reviews:'节点送审/返工说明和项目实例审核备注完整保留；批准/退回/撤销账本已独立单列（只读无授权），不表示后续步骤当前已获批准；复制状态已独立单列，只读且不表示已发送或已执行。',fixedReferences:'All fixed reference metadata retained; original fixed snapshot raw archives omitted.',excluded:['original AI reply bodies (not present in findings journal)','paper/PDF full text','unsaved drafts','original fixed snapshot raw archives','node-review attached material bodies and legacy handoff raw records','批准决策账本的原件/材料选择/恢复隔离及当前执行授权判断未检查（仅单列已验证账本元数据）','当前剪贴板内容及实际发送/模型执行验证未包含（仅单列 manual-handoff-ledger 已保存元数据）'],verification:'Recorded text and hashes are not provenance, model authentication, correctness or support evidence.'},authority:'none',realExecutionConnected:false};
 return freezeProgress(detail);
}
export function formatPaperResultsReport(detail){
 const parts=[];let size=0;const add=s=>{size+=bytes(s);if(size>PAPER_RESULTS_REPORT_LIMIT)fail('PAPER_RESULTS_REPORT_TOO_LARGE');parts.push(s);};
 const literal=(label,value)=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2);let max=2;for(const m of text.matchAll(/`+/g))max=Math.max(max,m[0].length);const fence='`'.repeat(max+1);add(`\n### ${label}\n\n${fence}\n${text}\n${fence}\n`);};
 add('# 已保存论文结果报告\n\n只读快照；未验证，不代表真实 AI 结果、论文支持证明或执行授权。\n');
 literal('论文与范围',{namespace:detail.namespace,projectId:detail.projectId,paperId:detail.paperId,title:detail.title,scope:detail.scope,source:detail.source,persistence:detail.persistence});
 literal('覆盖范围与明确排除',detail.coverage);if(detail.documentSourceHistory)literal('首次正文挂接与历史来源（仅元数据，非身份认证）',detail.documentSourceHistory);literal('来源状态（不可用不等于零）',{sources:detail.sources,issues:detail.issues});
 literal('工作流进度摘要（合成运行不是论文发现）',{plan:detail.plan,workflows:detail.workflows});
 add('\n## 已保存人工摘录 / 未验证 AI 结论\n');literal('摘录来源状态',{status:detail.findings.status,count:detail.findings.count});
 for(const r of detail.findings.items){const {conclusion,...metadata}=r;literal('摘录元数据',metadata);literal('完整已保存结论',conclusion);}
 if(detail.findingEvidence){
  add('\n## 人工结论关联原文证据（独立范围、全部版本，不证明支持关系）\n');
  const {items,...metadata}=detail.findingEvidence;literal('结论证据来源与覆盖',metadata);
  for(const item of items)literal('完整已保存结论证据版本（withdrawn 为撤回，不删除历史）',item);
 }
 function evidence(c){literal('主张与来源',{origin:c.origin,claimId:c.claimId,revisionSha256:c.revisionSha256,revisionCount:c.revisionCount,originSha256:c.originSha256,source:c.source,sourceStatus:c.sourceStatus,fixedReferenceStatus:c.fixedReferenceStatus,scope:c.scope});for(const field of FIELDS){const v=c.fields[field];literal(`${field} · ${v.status}`,v.text);for(const e of v.evidence){literal('记录定位（不是 PDF 页码认证）',{sourceLabel:e.sourceLabel,locator:e.locator});literal('完整已保存逐字引用',e.quote);if(e.fixedSnapshot)literal('固定引用元数据（原始备份未导出）',e.fixedSnapshot);}}}
 add('\n## 共享论文：多主张证据注释\n');literal('证据来源状态',{status:detail.evidence.status,count:detail.evidence.count});for(const c of detail.evidence.claims)evidence(c);
 add('\n## 旧版证据（单列，不重复计入多主张）\n');literal('旧版来源状态',{status:detail.evidence.legacy.status,present:detail.evidence.legacy.present,countedWithMulti:false});if(detail.evidence.legacy.item)evidence(detail.evidence.legacy.item);
 add('\n## 已保存节点送审 / 返工说明及项目实例审核备注\n');literal('节点送审 / 实例备注来源状态',{status:detail.reviews.status,count:detail.reviews.count});
 for(const r of detail.reviews.items){const {note,summary,instruction,excerpt,...metadata}=r;literal('审核元数据',metadata);literal('完整审核笔记',note);if(summary!==null&&summary!==undefined)literal('完整送审摘要',summary);if(instruction!==null&&instruction!==undefined)literal('完整返工说明',instruction);if(excerpt!==null&&excerpt!==undefined)literal('已保存合成产物摘录（非论文事实）',excerpt);}
 if(detail.copies){
  add('\n## 人工交接复制账本（只读；复制≠发送≠模型执行≠批准）\n');
  const {items,...metadata}=detail.copies;literal('复制元数据范围与边界',metadata);
  for(const item of items)literal('已保存复制记录',item);
 }
 if(detail.terminalReviews){
  add('\n## 终审决定历史（未重新验证，不表示当前批准或研究完成）\n');
  const {items,...metadata}=detail.terminalReviews;literal('终审范围与验证边界',metadata);for(const event of items)literal('终审历史版本与原件关联',event);
 }
 if(detail.approvals){
  add('\n## 人工交接批准 / 退回 / 撤销账本（独立只读，不授予执行权限）\n');
  const {items,...metadata}=detail.approvals;literal('账本范围、来源与评估边界',metadata);
  for(const event of items)literal('完整已保存决策元数据（head 不等于当前可执行）',event);
 }
 add('\n报告未包含原始模型回复、完整正文、PDF、未保存草稿或固定引用原始备份。审核内容仅含节点送审/返工说明和项目实例审核备注；人工交接批准/退回/撤销账本已单列为只读元数据，未核对原件、恢复隔离或当前材料选择，不表示后续步骤当前已获批准。人工交接复制状态账本已单列为只读元数据；复制≠发送≠模型执行≠批准，不读取当前剪贴板或原件。定位/哈希匹配不证明来源真实或结论成立。\n');return {markdown:parts.join(''),bytes:size};
}
export function createPaperResultsView({detail,documentText,stable,checkCurrent=stable,crypto=globalThis.crypto}){
 if(typeof stable!=='function'||typeof checkCurrent!=='function')fail('PAPER_RESULTS_CONFIGURATION_INVALID');
 let invalid=false,reportEpoch=0,pending=false,issued=null,attempts=0;
 function current(check=()=>true){try{if(invalid||typeof check!=='function')throw Error();stable();checkCurrent();if(check()!==true)throw Error();stable();if(invalid)throw Error();}catch{invalid=true;reportEpoch++;issued=null;fail('PAPER_RESULTS_CONTEXT_CHANGED');}}
 async function checkedHash(text){current();try{const result=await sha256(text,crypto);current();return result;}catch(error){invalid=true;reportEpoch++;issued=null;throw Error('PAPER_RESULTS_CONTEXT_CHANGED',{cause:error});}}
 async function findQuote(input){
  current();const q=clone(input);if(Object.keys(q).sort().join(',')!=='claimId,evidenceIndex,field,origin,paperId,revisionSha256'||q.paperId!==detail.paperId||!['multi','legacy'].includes(q.origin)||!FIELDS.includes(q.field)||!Number.isSafeInteger(q.evidenceIndex)||q.evidenceIndex<0)fail('PAPER_RESULTS_QUOTE_INVALID');
  const c=q.origin==='multi'?detail.evidence.claims.find(c=>c.claimId===q.claimId):q.claimId===null?detail.evidence.legacy.item:null;
  if(!c||c.revisionSha256!==q.revisionSha256)fail('PAPER_RESULTS_CLAIM_CHANGED');const e=c.fields[q.field].evidence[q.evidenceIndex];if(!e||typeof e.quote!=='string'||!e.quote.trim())fail('PAPER_RESULTS_QUOTE_INVALID');
  if(typeof documentText!=='string'||detail.source.documentStatus!=='same'||!c.source.documentSha256)fail('PAPER_RESULTS_DOCUMENT_UNAVAILABLE_OR_CHANGED');
  const actual=await checkedHash(documentText);current();
  if(actual!==detail.source.documentSha256||actual!==detail.source.declaredDocumentSha256||actual!==c.source.documentSha256)fail('PAPER_RESULTS_DOCUMENT_UNAVAILABLE_OR_CHANGED');
  const matches=[];let from=0,moreMatches=false;
  while(from<=documentText.length){const start=documentText.indexOf(e.quote,from);if(start<0)break;if(matches.length===20){moreMatches=true;break;}const end=start+e.quote.length;matches.push({start,end,before:documentText.slice(Math.max(0,start-120),start),after:documentText.slice(end,end+120)});from=start+1;}
  current();const snapshotChanged=c.source.snapshotSha256!==detail.source.snapshotSha256;
  return freezeProgress({quote:e.quote,matches,moreMatches,documentSha256:actual,snapshotChanged,warnings:[...(snapshotChanged?['论文快照已变化；仅当前正文逐字匹配，不验证历史快照。']:[]),'字符定位不是 PDF 页码，也不证明引用支持结论。'],verified:false,locationKind:'document-text-character-offset',offsetUnit:'UTF-16 code units'});
 }
 async function findFindingQuote(input){
  current();const q=clone(input);if(Object.keys(q).sort().join(',')!=='paperId,recordId,recordSha256'||q.paperId!==detail.paperId)fail('PAPER_RESULTS_QUOTE_INVALID');
  const r=detail.findingEvidence?.items.find(r=>r.id===q.recordId&&r.sha256===q.recordSha256);
  if(detail.findingEvidence?.status!=='available'||!r||r.findingStatus!=='same'||typeof r.quote!=='string'||!r.quote.trim())fail('PAPER_RESULTS_CLAIM_CHANGED');
  if(typeof documentText!=='string'||detail.source.documentStatus!=='same')fail('PAPER_RESULTS_DOCUMENT_UNAVAILABLE_OR_CHANGED');
  const actual=await checkedHash(documentText);current();if(actual!==detail.source.documentSha256||actual!==detail.source.declaredDocumentSha256||actual!==r.documentSha256)fail('PAPER_RESULTS_DOCUMENT_UNAVAILABLE_OR_CHANGED');
  const matches=[];let from=0,moreMatches=false;while(from<=documentText.length){const start=documentText.indexOf(r.quote,from);if(start<0)break;if(matches.length===20){moreMatches=true;break;}const end=start+r.quote.length;matches.push({start,end,before:documentText.slice(Math.max(0,start-120),start),after:documentText.slice(end,end+120)});from=start+1;}
  current();return freezeProgress({quote:r.quote,matches,moreMatches,documentSha256:actual,recordId:r.id,recordSha256:r.sha256,isHead:r.isHead,status:r.status,snapshotChanged:r.paperSnapshotSha256!==detail.source.snapshotSha256,warnings:['历史版本及撤回状态保留；逐字匹配不会激活记录或恢复批准。','字符定位不是 PDF 页码，也不证明引用支持结论。'],verified:false,locationKind:'document-text-character-offset',offsetUnit:'UTF-16 code units'});
 }
 async function prepareReport(){
  current();if(pending)fail('PAPER_RESULTS_REPORT_BUSY');if(attempts>=16)fail('PAPER_RESULTS_REPORT_LIMIT');attempts++;pending=true;issued=null;const epoch=++reportEpoch;
  try{const body=formatPaperResultsReport(detail);current();const digest=await checkedHash(body.markdown);current();if(epoch!==reportEpoch)fail('PAPER_RESULTS_REPORT_EXPIRED');const preview=freezeProgress({kind:'paper-results-report',namespace:detail.namespace,projectId:detail.projectId,paperId:detail.paperId,markdown:body.markdown,bytes:body.bytes,sha256:digest});issued={preview,epoch,used:false};return preview;}finally{pending=false;}
 }
 async function validateReport(preview,approval={},isCurrent=()=>true){
  const token=issued;if(!token||token.preview!==preview||token.used||token.epoch!==reportEpoch||approval.explicit!==true||approval.sha256!==preview.sha256)fail('PAPER_RESULTS_REPORT_CONFIRMATION_REQUIRED');current(isCurrent);token.used=true;
  const digest=await checkedHash(preview.markdown);current(isCurrent);if(issued!==token||token.epoch!==reportEpoch||digest!==preview.sha256||bytes(preview.markdown)!==preview.bytes||preview.bytes>PAPER_RESULTS_REPORT_LIMIT)fail('PAPER_RESULTS_REPORT_EXPIRED');return preview.markdown;
 }
 function invalidateReport(preview){if(preview===undefined||issued?.preview===preview){issued=null;reportEpoch++;}}
 current();return Object.freeze({detail,stable:()=>current(),checkCurrent:()=>current(),findQuote,findFindingQuote,prepareReport,validateReport,invalidateReport});
}
