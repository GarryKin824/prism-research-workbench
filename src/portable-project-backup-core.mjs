import {inspectInstanceResearchAnnex} from './instance-research-annex-core.mjs';
// Separate portable envelopes. Existing project, journal and audit bytes are never rewritten.
// Integrity is not authentication, and opening a backup never grants live authority.
import {parseBibliographyNotes} from './bibliography-notes-core.mjs';
import * as projectArchiveCore from './project-archive-core.mjs';
import * as manualJournal from './manual-reply-journal.mjs';
import * as manualReviewCore from './manual-review-core.mjs';
import * as manualHandoffLedgerCore from './manual-handoff-ledger-core.mjs';
import * as terminalReviewCore from './terminal-review-core.mjs';
import * as findingEvidenceCore from './finding-evidence-core.mjs';
import {sha256} from './custom-core.mjs';
import {deriveValidatedPortableBackupCoverage} from './portable-backup-coverage-core.mjs';

// Keep the public v1 constant and two-field create call backward compatible.
export const PORTABLE_PROJECT_BACKUP_SCHEMA = 'prism-portable-project-backup/v1';
export const PORTABLE_PROJECT_BACKUP_V2_SCHEMA = 'prism-portable-project-backup/v2';
export const PORTABLE_PROJECT_BACKUP_V6_SCHEMA = 'prism-portable-project-backup/v6';
export const PORTABLE_PROJECT_BACKUP_V5_SCHEMA = 'prism-portable-project-backup/v5';
export const PORTABLE_PROJECT_BACKUP_V4_SCHEMA = 'prism-portable-project-backup/v4';
export const PORTABLE_PROJECT_BACKUP_V3_SCHEMA = 'prism-portable-project-backup/v3';
// Shared total bound, including escaped component strings. Reject, never truncate.
export const PORTABLE_PROJECT_BACKUP_LIMIT = 80000000;
export const PORTABLE_MANUAL_REVIEW_LIMIT = 800000;
export const PORTABLE_MANUAL_HANDOFF_LIMIT = 200000;

const bytes = value => new TextEncoder().encode(value).length;
const fail = code => { throw Error(code); };
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

function validateComponents(projectArchiveRaw, manualReplyJournalRaw) {
  if (typeof projectArchiveRaw !== 'string'
      || !(manualReplyJournalRaw === null || typeof manualReplyJournalRaw === 'string')) {
    fail('PORTABLE_BACKUP_INVALID_COMPONENTS');
  }
  if (bytes(projectArchiveRaw) > projectArchiveCore.PROJECT_LIMIT) fail('PROJECT_TOO_LARGE');
  if (manualReplyJournalRaw !== null && bytes(manualReplyJournalRaw) > manualJournal.MANUAL_JOURNAL_LIMIT) {
    fail('MANUAL_JOURNAL_TOO_LARGE');
  }
}

function validateHumanAudit(humanAudit) {
  if (!keys(humanAudit, 'manualReviewDecisionsRaw,manualHandoffLedgerRaw')) fail('PORTABLE_BACKUP_INVALID_HUMAN_AUDIT');
  for (const [field, limit] of [['manualReviewDecisionsRaw', PORTABLE_MANUAL_REVIEW_LIMIT],
    ['manualHandoffLedgerRaw', PORTABLE_MANUAL_HANDOFF_LIMIT]]) {
    if (!(humanAudit[field] === null || typeof humanAudit[field] === 'string')) fail('PORTABLE_BACKUP_INVALID_HUMAN_AUDIT');
    if (humanAudit[field] !== null && bytes(humanAudit[field]) > limit) fail('PORTABLE_BACKUP_HUMAN_AUDIT_TOO_LARGE');
  }
}

function validateFindingEvidence(raw) {
  if (!(raw === null || typeof raw === 'string')) fail('PORTABLE_BACKUP_INVALID_FINDING_EVIDENCE');
  if (raw !== null && bytes(raw) > findingEvidenceCore.FINDING_EVIDENCE_LIMIT) {
    fail('PORTABLE_BACKUP_FINDING_EVIDENCE_TOO_LARGE');
  }
}

function validateTerminal(raw){if(!(raw===null||typeof raw==='string'&&bytes(raw)<=800000))fail('PORTABLE_BACKUP_INVALID_TERMINAL_REVIEW');}

function parse(raw) {
  if (typeof raw !== 'string' || bytes(raw) > PORTABLE_PROJECT_BACKUP_LIMIT) fail('PORTABLE_BACKUP_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('PORTABLE_BACKUP_INVALID_JSON'); }
  const v6 = parsed?.schema === PORTABLE_PROJECT_BACKUP_V6_SCHEMA;
  const v5 = parsed?.schema === PORTABLE_PROJECT_BACKUP_V5_SCHEMA;
  const v4 = parsed?.schema === PORTABLE_PROJECT_BACKUP_V4_SCHEMA;
  const v2 = parsed?.schema === PORTABLE_PROJECT_BACKUP_V2_SCHEMA;
  const v3 = parsed?.schema === PORTABLE_PROJECT_BACKUP_V3_SCHEMA;
  if (!keys(parsed, v6 ? 'schema,projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw,terminalReviewDecisionsRaw,instanceResearchEntries,sha256' : v5 ? 'schema,projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw,terminalReviewDecisionsRaw,sha256' : v4 ? 'schema,projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw,sha256' : v3 ? 'schema,projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,sha256'
    : v2 ? 'schema,projectArchiveRaw,manualReplyJournalRaw,humanAudit,sha256'
    : 'schema,projectArchiveRaw,manualReplyJournalRaw,sha256')
      || (!v2 && !v3 && !v4 && !v5 && !v6 && parsed.schema !== PORTABLE_PROJECT_BACKUP_SCHEMA) || !isHash(parsed.sha256)) {
    fail('PORTABLE_BACKUP_INVALID_SCHEMA');
  }
  validateComponents(parsed.projectArchiveRaw, parsed.manualReplyJournalRaw);
  if (v2 || v3 || v4 || v5 || v6) validateHumanAudit(parsed.humanAudit);
  if (v3 || v4 || v5 || v6) validateFindingEvidence(parsed.findingEvidenceRaw);
  if((v4||v5||v6)&&!(parsed.bibliographyNotesRaw===null||typeof parsed.bibliographyNotesRaw==='string'&&bytes(parsed.bibliographyNotesRaw)<=2097152))fail('PORTABLE_BACKUP_INVALID_BIBLIOGRAPHY');
  if(v5||v6)validateTerminal(parsed.terminalReviewDecisionsRaw);
  return parsed;
}

async function checked(raw, crypto) {
  const envelope = parse(raw);
  const {sha256: digest, ...body} = envelope;
  if (digest !== await sha256(JSON.stringify(body), crypto)) fail('PORTABLE_BACKUP_HASH_MISMATCH');
  const project = await projectArchiveCore.inspectProjectArchive(envelope.projectArchiveRaw, crypto);
  const namespace = project.summary.namespace;
  const journal = envelope.manualReplyJournalRaw === null ? null
    : await manualJournal.loadManualJournal(envelope.manualReplyJournalRaw, namespace, crypto);
  const annex = envelope.humanAudit;
  const reviews = annex?.manualReviewDecisionsRaw == null ? null
    : await manualReviewCore.loadManualReviews(annex.manualReviewDecisionsRaw, namespace, crypto);
  const ledger = annex?.manualHandoffLedgerRaw == null ? null
    : await manualHandoffLedgerCore.loadManualHandoffLedger(annex.manualHandoffLedgerRaw, namespace, crypto);
  const findingEvidenceRepresented = Object.hasOwn(envelope, 'findingEvidenceRaw');
  const findingEvidence = envelope.findingEvidenceRaw == null ? null
    : await findingEvidenceCore.loadFindingEvidence(envelope.findingEvidenceRaw, namespace, crypto);
  const bibliographyNotesRepresented=Object.hasOwn(envelope,'bibliographyNotesRaw');
  const bibliographyNotes=envelope.bibliographyNotesRaw==null?null:parseBibliographyNotes(envelope.bibliographyNotesRaw,namespace);
  const terminalReviewRepresented=Object.hasOwn(envelope,'terminalReviewDecisionsRaw');
  const terminalReviews=envelope.terminalReviewDecisionsRaw==null?null:await terminalReviewCore.loadManualReviews(envelope.terminalReviewDecisionsRaw,namespace,crypto);
  const instanceResearchRepresented=Object.hasOwn(envelope,'instanceResearchEntries');
  const instanceResearch=instanceResearchRepresented?await inspectInstanceResearchAnnex(envelope.instanceResearchEntries,await projectArchiveCore.readOnlyProjectView(envelope.projectArchiveRaw,crypto),namespace,crypto):null;
  const warnings = [
    {code:instanceResearchRepresented?'INSTANCE_RESEARCH_UNVERIFIED_HISTORY_NO_APPROVAL_OR_INTENT_RESTORE':'INSTANCE_RESEARCH_NOT_REPRESENTED'},
    {code:terminalReviewRepresented?'TERMINAL_REVIEW_UNVERIFIED_HISTORY_ONLY_NO_APPROVAL_RESTORE':'TERMINAL_REVIEW_NOT_REPRESENTED_IN_PORTABLE_V1_V2_V3_V4'},
    {code:bibliographyNotesRepresented?'BIBLIOGRAPHY_UNVERIFIED_HISTORY_ONLY_NO_RESTORE':'BIBLIOGRAPHY_NOT_REPRESENTED_IN_PORTABLE_V1_V2_V3'},
    ...project.summary.warnings,
    {code: 'PORTABLE_BACKUP_PLAINTEXT_NOT_ENCRYPTED'},
    {code: 'PORTABLE_BACKUP_HASHES_NOT_AUTHENTICATION'},
    {code: 'PORTABLE_BACKUP_READ_ONLY_NO_ACTIVATION'},
    ...(journal === null ? [{code: 'MANUAL_REPLY_JOURNAL_NOT_PRESENT'}] : [
      {code: 'MANUAL_REPLY_JOURNAL_UNVERIFIED_HISTORY_ONLY'},
      {code: 'MANUAL_REPLY_ORIGINALS_NOT_INCLUDED_BY_JOURNAL'},
    ]),
    ...(annex ? [
      {code: 'HUMAN_AUDIT_UNAUTHENTICATED_HISTORY_ONLY_NO_APPROVAL_OR_SUPPRESSION_RESTORE'},
      ...(reviews === null ? [{code: 'MANUAL_REVIEW_DECISIONS_NOT_PRESENT'}] : []),
      ...(ledger === null ? [{code: 'MANUAL_HANDOFF_LEDGER_NOT_PRESENT'}] : [
        {code: 'MANUAL_HANDOFF_COPIED_IS_NOT_SENT'},
        ...(ledger.records.some(record => record.clipboard !== 'copied')
          ? [{code: 'MANUAL_HANDOFF_PENDING_OR_UNKNOWN_REQUIRES_MANUAL_CHECK'}] : []),
      ]),
    ] : [{code: 'HUMAN_AUDIT_NOT_INCLUDED_IN_PORTABLE_V1'}]),
    ...(findingEvidenceRepresented
      ? [{code: findingEvidence === null ? 'FINDING_EVIDENCE_NOT_PRESENT'
        : 'FINDING_EVIDENCE_UNVERIFIED_HISTORY_ONLY_NO_LIVE_SOURCE_CHECK'}]
      : [{code: 'FINDING_EVIDENCE_NOT_REPRESENTED_IN_PORTABLE_V1_V2'}]),
  ];
  const summary = {
    ...project.summary,
    schema: envelope.schema,
    namespace,
    byteLength: bytes(raw),
    projectArchiveByteLength: bytes(envelope.projectArchiveRaw),
    manualReplyJournalByteLength: envelope.manualReplyJournalRaw === null ? 0 : bytes(envelope.manualReplyJournalRaw),
    manualReviewDecisionsByteLength: reviews === null ? 0 : bytes(annex.manualReviewDecisionsRaw),
    manualHandoffLedgerByteLength: ledger === null ? 0 : bytes(annex.manualHandoffLedgerRaw),
    findingEvidenceByteLength: findingEvidence === null ? 0 : bytes(envelope.findingEvidenceRaw),
    terminalReviewDecisionsByteLength:terminalReviews===null?0:bytes(envelope.terminalReviewDecisionsRaw),
    presence: {...project.summary.presence, instanceResearchRepresented, terminalReviewRepresented,terminalReviewDecisionsRaw:terminalReviews!==null, manualReplyJournalRaw: journal !== null,
      humanAudit: !!annex, manualReviewDecisionsRaw: reviews !== null, manualHandoffLedgerRaw: ledger !== null,
      bibliographyNotesRepresented,bibliographyNotesRaw:bibliographyNotes!==null,findingEvidenceRepresented, findingEvidenceRaw: findingEvidence !== null},
    counts: {...project.summary.counts, instanceExecutionReceipts:instanceResearch?.entries.reduce((n,e)=>n+(e.executions?.records.length??0),0)??null, instanceManualResultRecords:instanceResearch?.entries.reduce((n,e)=>n+(e.results?.records.length??0),0)??null,instanceReviewDecisionRecords:instanceResearch?.entries.reduce((n,e)=>n+(e.reviews?.records.length??0),0)??null,instanceFindingRecords:instanceResearch?.entries.reduce((n,e)=>n+(e.findings?.records.length??0),0)??null, terminalReviewEvents:terminalReviews?.events.length??null, manualReplyJournalRecords: journal?.records.length ?? 0,
      manualReviewEvents: reviews?.events.length ?? 0, manualHandoffRecords: ledger?.records.length ?? 0,
      bibliographyNoteRecords:bibliographyNotes?.records.length??null,bibliographyNoteRevisions:bibliographyNotes?.records.reduce((n,r)=>n+r.revisions.length,0)??null,findingEvidenceRevisions: findingEvidence?.records.length ?? null},
    warnings,
    excluded: [...new Set([...project.summary.excluded, 'manual-research-source-files', 'manual-reply-originals',
      ...(!instanceResearchRepresented?['instance-review-decisions-v1','instance-manual-results-v1','instance-finding-evidence-v1']:[]), 'unsaved-forms-and-reply-drafts', 'discovery-preferences', 'saved-derived-drafts',
      'restricted-workspaces', 'saved-read-only-archive-slots',
      ...(!terminalReviewRepresented?['terminal-review-decisions-v1']:[]),
      ...(!bibliographyNotesRepresented?['bibliography-notes-v1']:[]),
      ...(!findingEvidenceRepresented ? ['finding-evidence-v1'] : []),
      ...(!annex ? ['manual-review-decisions-v1', 'manual-handoff-ledger-v1'] : [])])],
    scope: instanceResearchRepresented ? 'project-archive-and-instance-research-read-only-history' : findingEvidenceRepresented ? 'project-archive-manual-reply-journal-human-audit-and-finding-evidence-history'
      : annex ? 'project-archive-manual-reply-journal-and-historical-human-audit' : 'project-archive-and-manual-reply-journal',
    authority: 'none',
    readOnly: true,
    authenticated: false,
  };
  if(instanceResearchRepresented)summary.excluded=summary.excluded.filter(x=>!['instance-review-decisions-v1','instance-manual-results-v1','instance-finding-evidence-v1'].includes(x));
  // Preserve v1 content fingerprints exactly. V2 distinguishes omitted audit from absent/empty records.
  const content = {project: project.fingerprint, manualReplyJournal: journal};
  if (annex) content.humanAudit = {manualReviewDecisions: reviews, manualHandoffLedger: ledger};
  if (findingEvidenceRepresented) content.findingEvidence = findingEvidence;
  if(terminalReviewRepresented)content.terminalReviews=terminalReviews;
  if(bibliographyNotesRepresented)content.bibliographyNotes=bibliographyNotes;
  if(instanceResearchRepresented)content.instanceResearch=instanceResearch;
  return {
    instanceResearch,terminalReviews,bibliographyNotes,envelope, journal, reviews, ledger, findingEvidence,
    byteSha256: await sha256(raw, crypto),
    fingerprint: await sha256(canonical(content), crypto),
    summary,
  };
}

export async function createPortableProjectBackup(input, crypto = globalThis.crypto) {
  // Copy all caller-controlled scalar values before the first asynchronous operation.
  const v6 = keys(input,'projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw,terminalReviewDecisionsRaw,instanceResearchEntries');
  const v5 = keys(input,'projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw,terminalReviewDecisionsRaw');
  const v4 = keys(input,'projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw,bibliographyNotesRaw');
  const v3 = keys(input, 'projectArchiveRaw,manualReplyJournalRaw,humanAudit,findingEvidenceRaw');
  const v2 = keys(input, 'projectArchiveRaw,manualReplyJournalRaw,humanAudit');
  if (!v6 && !v5 && !v4 && !v3 && !v2 && !keys(input, 'projectArchiveRaw,manualReplyJournalRaw')) fail('PORTABLE_BACKUP_INVALID_INPUT');
  const {projectArchiveRaw, manualReplyJournalRaw} = input;
  validateComponents(projectArchiveRaw, manualReplyJournalRaw);
  const body = {schema: v6 ? PORTABLE_PROJECT_BACKUP_V6_SCHEMA : v5 ? PORTABLE_PROJECT_BACKUP_V5_SCHEMA : v4 ? PORTABLE_PROJECT_BACKUP_V4_SCHEMA : v3 ? PORTABLE_PROJECT_BACKUP_V3_SCHEMA : v2 ? PORTABLE_PROJECT_BACKUP_V2_SCHEMA : PORTABLE_PROJECT_BACKUP_SCHEMA, projectArchiveRaw, manualReplyJournalRaw};
  if (v2 || v3 || v4 || v5 || v6) {
    validateHumanAudit(input.humanAudit);
    body.humanAudit = {manualReviewDecisionsRaw: input.humanAudit.manualReviewDecisionsRaw,
      manualHandoffLedgerRaw: input.humanAudit.manualHandoffLedgerRaw};
  }
  if (v3 || v4 || v5 || v6) { validateFindingEvidence(input.findingEvidenceRaw); body.findingEvidenceRaw = input.findingEvidenceRaw; }
  if(v4||v5||v6){if(!(input.bibliographyNotesRaw===null||typeof input.bibliographyNotesRaw==='string'&&bytes(input.bibliographyNotesRaw)<=2097152))fail('PORTABLE_BACKUP_INVALID_BIBLIOGRAPHY');body.bibliographyNotesRaw=input.bibliographyNotesRaw;}
  if(v5||v6){validateTerminal(input.terminalReviewDecisionsRaw);body.terminalReviewDecisionsRaw=input.terminalReviewDecisionsRaw;}
  if(v6){body.instanceResearchEntries=JSON.parse(JSON.stringify(input.instanceResearchEntries));}
  if (bytes(JSON.stringify({...body, sha256: '0'.repeat(64)})) > PORTABLE_PROJECT_BACKUP_LIMIT) {
    fail('PORTABLE_BACKUP_TOO_LARGE');
  }
  const raw = JSON.stringify({...body, sha256: await sha256(JSON.stringify(body), crypto)});
  await checked(raw, crypto);
  return raw;
}

function exposed(result, raw) {
  return {
    raw,
    instanceResearchEntries:result.envelope.instanceResearchEntries??null,
    projectArchiveRaw: result.envelope.projectArchiveRaw,
    manualReplyJournalRaw: result.envelope.manualReplyJournalRaw,
    manualReviewDecisionsRaw: result.envelope.humanAudit?.manualReviewDecisionsRaw ?? null,
    manualHandoffLedgerRaw: result.envelope.humanAudit?.manualHandoffLedgerRaw ?? null,
    terminalReviewDecisionsRaw:result.envelope.terminalReviewDecisionsRaw??null,
    bibliographyNotesRaw:result.envelope.bibliographyNotesRaw??null,
    findingEvidenceRaw: result.envelope.findingEvidenceRaw ?? null,
    byteSha256: result.byteSha256,
    fingerprint: result.fingerprint,
    summary: result.summary,
    authority: 'none',
    readOnly: true,
    historyOnly: true,
    authenticated: false,
  };
}

export async function inspectPortableProjectBackup(raw, crypto = globalThis.crypto) {
  return freeze(exposed(await checked(raw, crypto), raw));
}

export async function readOnlyPortableProjectBackupView(raw, crypto = globalThis.crypto) {
  const result = await checked(raw, crypto);
  const project = await projectArchiveCore.readOnlyProjectView(result.envelope.projectArchiveRaw, crypto);
  const historical = (raw, state) => ({raw, state, authority: 'none', readOnly: true,
    historyOnly: true, originalsIncluded: false, authenticated: false});
  const journal = result.journal === null ? null
    : historical(result.envelope.manualReplyJournalRaw, result.journal);
  const humanAudit = result.envelope.humanAudit ? {
    authority: 'none', readOnly: true, historyOnly: true, authenticated: false,
    restoresApprovals: false, restoresDuplicateSuppression: false, originalsIncluded: false,
    manualReviewDecisions: result.reviews === null ? null
      : historical(result.envelope.humanAudit.manualReviewDecisionsRaw, result.reviews),
    manualHandoffLedger: result.ledger === null ? null : {
      ...historical(result.envelope.humanAudit.manualHandoffLedgerRaw, result.ledger),
      display: manualHandoffLedgerCore.manualHandoffLedgerView(result.ledger),
    },
  } : null;
  const coverage = deriveValidatedPortableBackupCoverage(result, project);
  const findingEvidence = result.findingEvidence === null ? null : {
    ...historical(result.envelope.findingEvidenceRaw, result.findingEvidence),
    supportEstablished: false, currentSourceChecked: false, findingReferencesReverified: false,
  };
  return freeze({...exposed(result, raw), coverage, view: {instanceResearch:result.instanceResearch,terminalReviews:result.terminalReviews===null?null:{...historical(result.envelope.terminalReviewDecisionsRaw,result.terminalReviews),restoresApprovals:false,currentSourceChecked:false,currentAuthority:false},project, manualReplyJournal: journal, humanAudit, findingEvidence,bibliographyNotes:result.bibliographyNotes===null?null:historical(result.envelope.bibliographyNotesRaw,result.bibliographyNotes)}});
}
