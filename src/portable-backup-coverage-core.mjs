// Projection helper, not a validator. Called only inside the portable reader after
// full envelope/component validation and read-only project construction. No IO.
export const PORTABLE_COVERAGE_ROW_LIMIT = 40;
export const PORTABLE_COVERAGE_JSON_LIMIT = 200000;
// Reserve room for the UI's fixed-size physical-file hash/BOM binding.
const FILE_BINDING_RESERVE = 2048;
const bytes = value => new TextEncoder().encode(value).length;
const short = (value, limit = 160) => {
  if (typeof value !== 'string') return '';
  let end = Math.min(value.length, limit);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end-1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
  return value.slice(0,end);
};
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inventory = [
  ['workflowArchiveRaw', '论文正文、步骤、工作流与队列', 'papers', '篇论文'],
  ['inboxRaw', '外部材料收件箱', 'inboxRecords', '条记录'],
  ['reviewRaw', '材料审核队列', 'reviewRecords', '条记录'],
  ['attentionRaw', '关注事项历史', 'attentionEvents', '个事件'],
  ['comparisonRaw', '论文对比', 'comparisonRevisions', '个版本'],
  ['dictionaryRaw', '变量字典', 'dictionaryRevisions', '个版本'],
  ['feasibilityRaw', '可行性评估', 'feasibilityEvents', '个事件'],
  ['platformPlanRaw', '平台规划历史', 'platformPlans', '个计划'],
  ['evidenceMapRaw', '证据表 v1 完整历史', 'evidenceMapRevisions', '个版本'],
  ['multiEvidenceRaw', '多论点证据表 v2', 'multiEvidenceRevisions', '次修订'],
  ['nodeReviewRaw', '自定义节点审核历史', 'nodeReviewRecords', '条记录'],
  ['planningRaw', '已保存规划草稿', 'planningDrafts', '条记录'],
  ['projectsRaw', '研究项目与模板历史', 'researchProjects', '个项目'],
  ['membershipRaw', '项目论文成员历史', 'membershipProjects', '个项目'],
  ['projectQueuesRaw', '项目队列规划历史', 'projectQueues', '个项目队列'],
  ['ownershipRaw', '执行归属历史', 'archivedExecutions', '条历史记录'],
  ['instancesRaw', '研究实例与实例队列', 'researchInstances', '个实例'],
  ['instanceReviewsRaw', '研究实例人工备注', 'instanceReviewRecords', '条记录'],
  ['manualReplyJournalRaw', '人工答复关联与已保存结论', 'manualReplyJournalRecords', '条关联'],
  ['manualReviewDecisionsRaw', '人工审核决定历史', 'manualReviewEvents', '个事件'],
  ['manualHandoffLedgerRaw', '人工交接账本历史', 'manualHandoffRecords', '条记录'],
  ['findingEvidenceRaw', '已保存结论的引文证据历史', 'findingEvidenceRevisions', '次修订'],
];
const nestedFields = {2:'projectRaw',3:'projectRaw',4:'projectRaw',5:'projectRaw',6:'projectRaw',7:'projectRaw',8:'entitiesRaw',9:'membershipArchiveRaw',10:'ownershipArchiveRaw',11:'instancesArchiveRaw'};
function componentInventory(raw) {
  let cursor = JSON.parse(raw);
  const schema = cursor.schema, components = {};
  for (let depth = 0; depth < 12; depth++) {
    for (const [key] of inventory.slice(0, 18)) if (has(cursor, key)) components[key] = cursor[key];
    if (cursor.sidecars) for (const [key, value] of Object.entries(cursor.sidecars)) components[key] = value;
    const version = Number(cursor.schema.split('/v')[1]);
    if (version === 1 || version === 12) return {schema, components};
    cursor = JSON.parse(cursor[nestedFields[version]]);
  }
  throw Error('PORTABLE_COVERAGE_INVENTORY');
}
const exclusions = [
  {id:'original-pdf-binaries', label:'PDF 原始二进制文件', status:'unsupported', detail:'本备份格式不保存 PDF 原件；来源文字、文件名或哈希声明均不能证明原件已包含。'},
  {id:'manual-original-files', label:'人工研究原文件、准备包和答复全文', status:'excluded', detail:'关联记录只含引用和已保存结论，不包含所引用的完整原件；需另行保管人工研究 JSON。'},
  {id:'instance-review-decisions', label:'独立实例人工审核决定', status:'excluded', detail:'该独立追加账本不包含在此便携备份；请在实例审核决定面板单独导出保存，或在项目/论文成果页另存独立实例组合附录。只读历史不是执行权限，不能恢复为可用批准。'},
  {id:'instance-write-intents', label:'实例人工账本写入意图元数据', status:'excluded', detail:'跨刷新写入意图不作为可恢复权限纳入旧备份；请在人工结果或审核面板单独核验并保存意图摘要。恢复历史不清除未知状态，也不授权重试。'},
  {id:'instance-manual-results', label:'独立实例人工执行结果', status:'excluded', detail:'该独立账本不包含在此便携备份；在实例节点的人工结果面板按实例导出，并用同一面板只读重开；也可在项目/论文成果页另存独立实例组合附录。不是执行权限或完整项目恢复。'},
  {id:'unsaved-forms', label:'未保存表单、答复草稿和内存中的人工记录', status:'excluded', detail:'未保存内容不在持久组件中，无法从所选文件推断数量。'},
  {id:'derivative-workspaces', label:'另存的派生草稿、受限工作区和发现偏好', status:'excluded', detail:'这些独立模块不在本备份清单；如需保留，应使用各自导出入口。'},
  {id:'readonly-slots', label:'已有只读归档槽', status:'excluded', detail:'不会递归备份已导入的只读文件槽；需单独保留其归档文件。'},
  {id:'external-and-secret-data', label:'外部会话、凭据和未列入清单的存储', status:'excluded', detail:'未扫描或收集；不会根据备份文件推断其存在与否。'},
];
function pdfDeclaration(source) {
  const prefix = '机器生成 PDF 提取来源（未审核，非独立真实性证据）：';
  if (typeof source !== 'string' || !source.startsWith(prefix)) return null;
  let value;
  try { value = JSON.parse(source.slice(prefix.length)); } catch { value = null; }
  const fields = {};
  // Whitelist bounded scalar declarations. Never echo originalPDFBackedUp or treat
  // valid-looking hashes/text matches as proof of the original intake or PDF bytes.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.filename === 'string') { fields.filename = short(value.filename, 256); fields.filenameTruncated = fields.filename.length < value.filename.length; }
    for (const key of ['pdfSHA256','textSHA256']) if (hash(value[key])) fields[key] = value[key];
    for (const key of ['pdfBytes','pages','pagesRead']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) fields[key] = value[key];
    if (typeof value.truncated === 'boolean') fields.truncated = value.truncated;
  }
  return {status:'untrusted-declaration', parsed:value !== null, verifiedPdfSource:false, originalIncluded:false, fields};
}
function bounded(rows) {
  return {total:rows.length, shown:Math.min(rows.length, PORTABLE_COVERAGE_ROW_LIMIT),
    omitted:Math.max(0, rows.length - PORTABLE_COVERAGE_ROW_LIMIT), limit:PORTABLE_COVERAGE_ROW_LIMIT,
    items:rows.slice(0, PORTABLE_COVERAGE_ROW_LIMIT)};
}
function attachmentPdfDeclaration(paper) {
  const p=paper.documentAttachment?.provenance;
  if(p?.kind!=='pdf-extraction')return pdfDeclaration(paper.source);
  return {status:'untrusted-declaration',parsed:true,verifiedPdfSource:false,originalIncluded:false,fields:{filename:short(p.filename,256),filenameTruncated:p.filename.length>256,pdfBytes:p.byteLength,pdfSHA256:p.pdfSha256,textSHA256:p.textSha256,pages:p.pages,pagesRead:p.pagesRead,truncated:p.truncated}};
}
export function deriveValidatedPortableBackupCoverage({envelope, summary, byteSha256, fingerprint, journal, instanceResearch}, project) {
  const {schema:projectSchema, components} = componentInventory(envelope.projectArchiveRaw);
  components.manualReplyJournalRaw = envelope.manualReplyJournalRaw;
  if (envelope.humanAudit) Object.assign(components, envelope.humanAudit);
  if (has(envelope, 'findingEvidenceRaw')) components.findingEvidenceRaw = envelope.findingEvidenceRaw;
  if(has(envelope,'terminalReviewDecisionsRaw'))components.terminalReviewDecisionsRaw=envelope.terminalReviewDecisionsRaw;
  if(has(envelope,'bibliographyNotesRaw'))components.bibliographyNotesRaw=envelope.bibliographyNotesRaw;
  const counts = {...summary.counts, papers:summary.papers, platformPlans:summary.platformPlanning?.plans};
  const terminalInventory=has(envelope,'terminalReviewDecisionsRaw')?[...inventory,['terminalReviewDecisionsRaw','独立终审决定 · 未核验历史','terminalReviewEvents','个事件']]:inventory;
  const rows = (has(envelope,'bibliographyNotesRaw')?[...terminalInventory,['bibliographyNotesRaw','人工书目修正与标签历史','bibliographyNoteRecords','个范围记录']]:terminalInventory).map(([id, label, countKey, unit]) => {
    const status = !has(components, id) ? 'not-represented' : components[id] === null ? 'absent' : 'included';
    const nullPayload = status === 'included' && ['inboxRaw','reviewRaw'].includes(id) && JSON.parse(components[id]) === null;
    const count = status === 'included' && !nullPayload && Number.isSafeInteger(counts[countKey]) ? counts[countKey] : null;
    const details = id === 'workflowArchiveRaw' ? [
      ['已保存正文', summary.documents], ['工作流', summary.workflows], ['队列', summary.queues],
      ['工作流运行历史', summary.workflowRuns], ['队列事件', summary.queueEvents],
    ] : id === 'instancesRaw' ? [['实例版本', counts.instanceVersions], ['实例队列', counts.instanceQueues]]
      : id === 'projectsRaw' ? [['项目修订', counts.projectRevisions]] : [];
    return {id, label, status, count, countKey, unit, payloadRepresentation:nullPayload?'json-null':'standard',
      countUnknownReason:nullPayload?'legacy-null-payload':count===null?status:null,
      details:status === 'included' ? details.filter(([, n]) => Number.isSafeInteger(n)).map(([label, count]) => ({label, count})) : [],
      byteLength:status === 'included' ? bytes(components[id]) : null};
  });
  const researchRows=[['resultsRaw','instanceManualResultsRaw','独立实例人工结果'],['reviewsRaw','instanceReviewDecisionsRaw','独立实例人工审核决定'],['findingsRaw','instanceFindingsRaw','独立实例结论与引文附件']].map(([field,id,label])=>{const represented=has(envelope,'instanceResearchEntries'),entries=represented?envelope.instanceResearchEntries:[],present=entries.filter(e=>e[field]!==null),count=represented?present.reduce((n,e)=>n+JSON.parse(e[field]).records.length,0):null;return {id,label,status:!represented?'not-represented':present.length?'included':'absent',count:present.length?count:null,countKey:id,unit:'条记录',payloadRepresentation:'per-project-raw-strings',byteLength:present.reduce((n,e)=>n+bytes(e[field]),0),details:[],projects:entries.map(e=>({projectId:e.projectId,status:e[field]===null?'absent':'included',count:e[field]===null?null:JSON.parse(e[field]).records.length}))}});
  if(has(envelope,'instanceResearchEntries'))rows.push(...researchRows);
  const papers = project.papers.filter(row => row.paper !== null).map(row => row.paper);
  const documents = papers.filter(paper => paper.document).map(paper => ({
    paperId:paper.id, title:short(paper.title), filename:short(paper.document.filename, 256),
    titleTruncated:short(paper.title).length < paper.title.length, filenameTruncated:short(paper.document.filename,256).length < paper.document.filename.length,
    storedTextByteLength:paper.document.byteLength, storedTextSha256:paper.document.sha256,
    storedTextIntegrityChecked:true, originalFilePresence:'unknown', originalFileAuthenticated:false,
    pdfSourceDeclaration:attachmentPdfDeclaration(paper),
  }));
  const attachments=papers.filter(paper=>paper.documentAttachment).map(paper=>{
    const a=paper.documentAttachment;
    return {paperId:paper.id,title:short(paper.title),attachmentId:a.id,time:a.time,recordedNamespace:a.namespace,oldPaperSha256:a.oldPaperSha256,oldWorkflowSha256:a.oldWorkflowSha256,documentSha256:a.documentSha256,oldPaperIncluded:true,oldWorkflowIncluded:a.oldWorkflowRaw!==null,originalPdfIncluded:false,authority:'none'};
  });
  const referenceGroups = new Map();
  for (const record of journal?.records ?? []) {
    const ref = record.reference;
    const identity = JSON.stringify([ref.origin.namespace, ref.origin.projectId, ref.origin.paperId,
      ref.recordId, ref.reply.id, ref.reply.sha256, ref.reply.byteLength, ref.preparation.integritySha256,
      ref.preparation.documentSha256, ref.preparation.promptSha256, ref.targetSource.snapshotSha256]);
    const existing = referenceGroups.get(identity);
    if (existing) { existing.relatedJournalRecordCount++; continue; }
    referenceGroups.set(identity, {
    relatedJournalRecordCount:1,
    journalRecordId:record.id, recordId:record.reference.recordId,
    paperId:record.reference.targetSource.paperId, paperTitle:short(record.reference.targetSource.title), paperTitleTruncated:short(record.reference.targetSource.title).length < record.reference.targetSource.title.length,
    sourceNamespace:ref.origin.namespace, sourceProjectId:ref.origin.projectId,
    targetSnapshotSha256:ref.targetSource.snapshotSha256,
    replyId:record.reference.reply.id, declaredReplyByteLength:record.reference.reply.byteLength,
    declaredReplySha256:record.reference.reply.sha256,
    declaredPreparationSha256:record.reference.preparation.integritySha256,
    declaredDocumentSha256:record.reference.preparation.documentSha256,
    declaredPromptSha256:record.reference.preparation.promptSha256,
    originalsIncluded:false, externalOriginalAvailability:'unknown', originalContentsReverified:false,
    });
  }
  const references = [...referenceGroups.values()];
  const result = {
    schema:'prism-portable-backup-coverage/v1',
    file:{schema:envelope.schema, projectSchema, workflowSchema:JSON.parse(components.workflowArchiveRaw).schema,
      byteLength:summary.byteLength, byteSha256, contentFingerprint:fingerprint, binding:'validated-json-text-utf8'},
    namespace:summary.namespace, scope:'exact-inspected-portable-file-only',
    readOnly:true, authority:'none', authenticated:false, currentLiveStateChecked:false,
    instanceResearchCoverage:researchRows, components:rows, componentTotals:{expected:rows.length, included:rows.filter(r => r.status === 'included').length,
      absent:rows.filter(r => r.status === 'absent').length, notRepresented:rows.filter(r => r.status === 'not-represented').length},
    storedText:{...bounded(documents), paperCount:papers.length, papersWithoutStoredText:papers.length-documents.length,
      scope:'saved-paper-document-text-only; not historical embedded snapshots',
      notice:'保存的 UTF-8 正文已通过归档字节数与哈希校验，可重建已保存文本；这不是原文件身份、来源真实性或 PDF 原件证明。'},
    documentAttachmentHistory:{...bounded(attachments),scope:'base-paper-first-document-checkpoints',notice:'首次挂接正文前的论文与可用流程原文完整保存在基础论文检查点中；这里仅列校验元数据，不继承旧批准、执行或身份认证。PDF 原件不包含；只读归档不自动激活旧流程。'},
    manualOriginalReferences:{...bounded(references), status:journal === null ? 'journal-absent' : 'journal-included',
      total:journal === null ? null : references.length, journalRecordCount:journal?.records.length ?? null,
      notice:'每项按来源、记录和答复身份去重，是关联记录所需的外部准备包与答复全文线索，不是原件文件清单；可能指向同一文件，不能推断你已持有原件。'},
    excluded:exclusions.filter(row=>!has(envelope,'instanceResearchEntries')||!['instance-review-decisions','instance-manual-results'].includes(row.id)).map(row => ({...row, count:null})),
    truncation:{rowLimit:PORTABLE_COVERAGE_ROW_LIMIT, sizeLimitBytes:PORTABLE_COVERAGE_JSON_LIMIT, fileBindingReserveBytes:FILE_BINDING_RESERVE, sizeBoundApplied:false, displayNamesMayBeShortened:true},
    notices:[
      '清单仅适用于此处 SHA-256 绑定的已核验 JSON；通过文件选择打开时另列所选文件字节绑定与 BOM 处理，不表示当前项目的最新状态。内容指纹不能替代精确字节绑定。',
      '哈希只核验一致性，不认证作者、来源或结论；不恢复审核权限、执行权限或防重复限制。',
      '引文证据按所选文件保留完整修订与撤回历史；不会据此重新确认当前结论关联、项目成员或正文来源，也不证明引文支持结论。',
      '已包含且数量为 0 表示空组件；缺少组件或旧格式未表示该组件时，数量未知，不等于没有历史记录。',
      '主备份恢复只覆盖基础工作档案；项目整合归档及便携备份只读查看，不能一键恢复完整可编辑项目。',
      '正文、首次正文检查点与外部原件线索各最多列出 40 项；总数和省略数单独显示。名称可能缩短，完整历史和内容仍在原备份文件中。',
    ],
  };
  // Optional display metadata must never make a valid backup unreadable. Even
  // maximally escaped legal IDs are bounded by reducing visible rows, not inputs.
  while (bytes(JSON.stringify(result, null, 2)) > PORTABLE_COVERAGE_JSON_LIMIT - FILE_BINDING_RESERVE) {
    const list = result.manualOriginalReferences.items.length ? result.manualOriginalReferences : result.documentAttachmentHistory.items.length ? result.documentAttachmentHistory : result.storedText;
    if (!list.items.length) break; // Fixed inventory alone is below the limit.
    list.items.pop();list.shown=list.items.length;list.omitted=list.total-list.shown;
    result.truncation.sizeBoundApplied=true;
  }
  return result;
}
