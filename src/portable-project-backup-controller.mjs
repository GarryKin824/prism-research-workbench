import {loadProjects} from './project-planning-core.mjs';
import {createInstanceManualResultsController} from './instance-manual-results.mjs';
import {createInstanceReviewDecisionsController} from './instance-review-decisions.mjs';
import {createInstanceFindingsController} from './instance-findings.mjs';
import {createProjectArchiveController} from './project-archive-controller.mjs';
import {WORKBENCH_EXECUTION_STORE} from './workbench-model-execution.mjs';
import * as portableProjectBackupCore from './portable-project-backup-core.mjs';

// File export and read-only file reopening only. No slot, restore, migration or merge API.
export function createPortableProjectBackupController({store, storage, crypto = globalThis.crypto, withLock}) {
  const namespace = store.getStorageKey();
  const planningKey=namespace+':project-planning-v1';
  const instanceTypes=['instance-manual-results-v1','instance-review-decisions-v1','instance-finding-evidence-v1',WORKBENCH_EXECUTION_STORE];
  const terminalKey=namespace+':terminal-review-decisions-v1';
  const notesKey=namespace+':bibliography-notes-v1';
  const journalKey = namespace + ':manual-reply-journal-v1';
  const reviewKey = namespace + ':manual-review-decisions-v1';
  const ledgerKey = namespace + ':manual-handoff-ledger-v1';
  const findingKey = namespace + ':finding-evidence-v1';
  const projectArchive = createProjectArchiveController({store, storage, crypto, withLock});
  // Match the project export allowlist, plus independently stored historical metadata.
  // Never read arbitrary namespace keys (which may include credentials or unrelated data).
  const sourceSuffixes = [
    'library-queue-v1', 'external-inbox-v1', 'review-queue-v1', 'attention-journal-v1',
    'paper-comparison-v1', 'variable-dictionary-v1', 'feasibility-v1', 'platform-plan-v1',
    'evidence-map-v1', 'evidence-map-v2', 'node-review-v1', 'planning-drafts-v1',
    'project-planning-v1', 'project-library-v1', 'project-queues-v1',
    'project-execution-owner-v1', 'research-instances-v1', 'instance-reviews-v1',
    'manual-reply-journal-v1', 'manual-review-decisions-v1', 'manual-handoff-ledger-v1',
    'finding-evidence-v1','bibliography-notes-v1','terminal-review-decisions-v1',
  ];
  const knownKeys = new Set(sourceSuffixes.map(suffix => namespace + ':' + suffix));
  const isSourceKey = (key,instanceKeys) => instanceKeys.has(key)||knownKeys.has(key) || key.startsWith(namespace + ':custom-workflow-v1:');
  function guardContext() {
    if (store.getStorageKey() !== namespace) throw Error('PORTABLE_BACKUP_PROFILE_CHANGED');
  }
  function guard() {
    store.assertCurrentStorage();
    guardContext();
  }
  function scan(instanceKeys) {
    guard();
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10000) {
      throw Error('PORTABLE_BACKUP_STORAGE_SCAN_LIMIT');
    }
    const rows = [], seen = new Set();
    for (let i = 0; i < length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string' || seen.has(key)) throw Error('PORTABLE_BACKUP_STORAGE_CHANGED');
      seen.add(key);
      if(instanceTypes.some(t=>key.startsWith(namespace+':'+t+':'))&&!instanceKeys.has(key))throw Error('PORTABLE_BACKUP_UNLISTED_INSTANCE_PROJECT');
      if (isSourceKey(key,instanceKeys)) {
        const raw = storage.getItem(key);
        if (typeof raw !== 'string') throw Error('PORTABLE_BACKUP_STORAGE_CHANGED');
        rows.push([key, raw]);
      }
    }
    if (storage.length !== length) throw Error('PORTABLE_BACKUP_STORAGE_CHANGED');
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    return rows;
  }
  async function exportCurrent() {
    if (typeof withLock !== 'function') throw Error('WEB_LOCKS_REQUIRED_FOR_COMPLETE_SNAPSHOT');
    guard();
    const planningRaw=storage.getItem(planningKey);
    const projectIds=planningRaw===null?[]:(await loadProjects(planningRaw,namespace,crypto)).projects.map(p=>p.id).sort();
    guard();if(storage.getItem(planningKey)!==planningRaw)throw Error('PORTABLE_BACKUP_PROJECT_LIST_CHANGED');
    const ledgerKeys=projectIds.flatMap(id=>instanceTypes.map(t=>namespace+':'+t+':'+JSON.stringify(id))).sort();
    const instanceKeys=new Set(ledgerKeys.flatMap(k=>[k,k+':intent-v1']));
    const lockInstances=(i,fn)=>i===ledgerKeys.length?fn():withLock(ledgerKeys[i]+':write',()=>lockInstances(i+1,fn));
    // Global order: journal → handoff → finding evidence → bibliography notes → ordered project locks.
    // Finding writers take only their own write lock; no reverse acquisition.
    // Do not reacquire project locks here (Web Locks are not reentrant).
    const withNotesLock=fn=>{guard();return storage.getItem(notesKey)===null?fn():withLock(notesKey,fn)};
    return withLock(journalKey + ':write', () => withLock(ledgerKey + ':copy', () => withLock(findingKey + ':write',()=>withNotesLock(()=>lockInstances(0,async () => {
      guard();
      if(storage.getItem(planningKey)!==planningRaw)throw Error('PORTABLE_BACKUP_PROJECT_LIST_CHANGED');
      const storeRaw = store.exportJSON(), rows = scan(instanceKeys), rowsRaw = JSON.stringify(rows);
      const annotationKeys = [namespace + ':paper-comparison-v1', namespace + ':variable-dictionary-v1'];
      const readAnnotations = () => Promise.all(annotationKeys.map(key => store.annotationStorage.read(key)));
      const annotations = store.annotationStorage ? await readAnnotations() : null;
      const values = new Map(rows), manualReplyJournalRaw = values.get(journalKey) ?? null;
      const humanAudit = {manualReviewDecisionsRaw: values.get(reviewKey) ?? null,
        manualHandoffLedgerRaw: values.get(ledgerKey) ?? null};
      // An absent new sidecar keeps the exact v2 generation contract. Present-but-empty is v3.
      const bibliography=values.has(notesKey)?{bibliographyNotesRaw:values.get(notesKey),findingEvidenceRaw:values.get(findingKey)??null}:{};
      const findingEvidence = values.has(findingKey) ? {findingEvidenceRaw: values.get(findingKey)} : {};
      const terminal=values.has(terminalKey)?{terminalReviewDecisionsRaw:values.get(terminalKey),bibliographyNotesRaw:values.get(notesKey)??null,findingEvidenceRaw:values.get(findingKey)??null}:{};
      function unchanged() {
        guard();
        if (store.exportJSON() !== storeRaw || JSON.stringify(scan(instanceKeys)) !== rowsRaw) {
          throw Error('PORTABLE_BACKUP_SOURCE_CHANGED');
        }
      }
      const instanceResearchEntries=projectIds.map(projectId=>{
        const [resultsRaw,reviewsRaw,findingsRaw,executionsRaw]=instanceTypes.map(type=>values.get(namespace+':'+type+':'+JSON.stringify(projectId))??null);
        return {projectId,resultsRaw,reviewsRaw,findingsRaw,...(executionsRaw===null?{}:{executionsRaw})};
      });
      const hasInstanceHistory=ledgerKeys.some(k=>values.has(k)||values.has(k+':intent-v1'));
      for(const projectId of projectIds){for(const factory of [createInstanceManualResultsController,createInstanceReviewDecisionsController,createInstanceFindingsController]){
        const c=factory({store,storage,projectId,crypto,withLock});
        if(c.recovery?.())throw Error('PORTABLE_BACKUP_INSTANCE_WRITE_UNKNOWN');
        const evidence=await c.inspectIntent({explicitReadConsent:true,isCurrent:()=>{try{unchanged();return true}catch{return false}}});
        unchanged();evidence.stable?.();if(evidence.blocked||c.recovery?.())throw Error('PORTABLE_BACKUP_INSTANCE_INTENT_UNRESOLVED');
      }}
      const projectArchiveRaw = await projectArchive.exportCurrent();
      unchanged();
      const raw = await portableProjectBackupCore.createPortableProjectBackup({projectArchiveRaw, manualReplyJournalRaw, humanAudit, ...findingEvidence,...bibliography,...terminal,...(hasInstanceHistory?{instanceResearchEntries,terminalReviewDecisionsRaw:values.get(terminalKey)??null,bibliographyNotesRaw:values.get(notesKey)??null,findingEvidenceRaw:values.get(findingKey)??null}:{})}, crypto);
      // Covers the entire wrapper validation after the legacy export releases its locks,
      // including newly appeared/deleted sidecars and non-cooperating writers.
      if (annotations && (await readAnnotations()).some((raw, index) => raw !== annotations[index])) {
        throw Error('PORTABLE_BACKUP_SOURCE_CHANGED');
      }
      unchanged();
      return raw;
    })))));
  }
  async function inspectRaw(raw) {
    // A damaged live store must not block reading a separate historical file.
    // Only pin the supplied context; validate components against the archive's own namespace.
    guardContext();
    const contents = await portableProjectBackupCore.readOnlyPortableProjectBackupView(raw, crypto);
    guardContext();
    return contents;
  }
  return {exportCurrent, inspectRaw, canExport: typeof withLock === 'function'};
}
