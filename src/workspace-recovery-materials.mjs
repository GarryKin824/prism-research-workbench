import { createPdfOriginalVaultController } from './pdf-original-vault-controller.mjs';
import { createPdfOriginalBundle, extractPdfOriginalBundle } from './pdf-original-bundle-core.mjs';
import { recoveryAnnotationKey, recoveryPdfLimit, recoveryTabDraftKey } from './workspace-recovery-core.mjs';

export function createWorkspaceMaterials({ storage, namespace, annotations, volatileDrafts, getSession = () => globalThis.sessionStorage }) {
  let pdfCache = { key: '', packet: null };
  const ordered = values => [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

  async function readVault(metadataOnly) {
    const vault = createPdfOriginalVaultController({ namespace, timeoutMs: 20000 });
    try {
      const value = await vault.snapshotOriginals({ metadataOnly });
      if (value.code === 'VAULT_ABSENT') return { namespace, records: [], totalBytes: 0 };
      if (!value.ok) throw Error('RECOVERY_PDF_READ', { cause: value.code });
      return value;
    } finally { vault.close(); }
  }

  function migrateDrafts() {
    if (volatileDrafts && [...volatileDrafts.entries()].some(([key, entry]) => key.startsWith(namespace + ':') && entry.volatile)) {
      throw Error('RECOVERY_DRAFT_NOT_STORED');
    }
    const session = getSession();
    const keys = Array.from({ length: session.length }, (_, i) => session.key(i)).filter(Boolean);
    for (const key of keys.filter(key => recoveryTabDraftKey(namespace, key))) {
      const value = session.getItem(key);
      if (value === null) continue;
      const existing = storage.getItem(key);
      if (existing !== null && existing !== value) throw Error('RECOVERY_DRAFT_CONFLICT');
      if (existing === null) storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw Error('RECOVERY_DRAFT_NOT_STORED');
      session.removeItem(key);
    }
  }

  async function annotationRows() {
    const rows = await annotations.workspaceRecords(namespace, 'read');
    const values = new Map(rows.filter(([key]) => recoveryAnnotationKey(namespace, key)));
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && recoveryAnnotationKey(namespace, key) && !values.has(key)) values.set(key, storage.getItem(key));
    }
    return ordered(values);
  }

  async function capture() {
    migrateDrafts();
    const [rows, inventory] = await Promise.all([annotationRows(), readVault(true)]);
    if (inventory.totalBytes > recoveryPdfLimit) throw Error('RECOVERY_PDF_LIMIT');
    const pdfKey = JSON.stringify(inventory.records);
    if (pdfCache.key !== pdfKey) {
      if (!inventory.records.length) pdfCache = { key: pdfKey, packet: null };
      else {
        const originals = await readVault(false);
        const bundle = await createPdfOriginalBundle(originals);
        if (!bundle.ok) throw Error(bundle.code === 'LIMIT_EXCEEDED' ? 'RECOVERY_PDF_LIMIT' : 'RECOVERY_PDF_READ');
        const verifiedKey = JSON.stringify(bundle.summary.files);
        if (verifiedKey !== pdfKey) throw Error('RECOVERY_CHANGED');
        pdfCache = { key: pdfKey, packet: bundle.text };
      }
      const [freshRows, freshPdf] = await Promise.all([annotationRows(), readVault(true)]);
      if (JSON.stringify(freshRows) !== JSON.stringify(rows) || JSON.stringify(freshPdf.records) !== pdfKey) throw Error('RECOVERY_CHANGED');
    }
    return { annotations: rows, pdfBundle: pdfCache.packet, pdfKey };
  }

  async function occupied() {
    const [rows, originals] = await Promise.all([annotations.workspaceRecords(namespace, 'read'), readVault(true)]);
    return rows.length > 0 || originals.records.length > 0;
  }

  async function install(snapshot, guard, commitStorage) {
    const rows = snapshot.originals ? snapshot.originals.summary.files.map(row => {
      const result = extractPdfOriginalBundle(snapshot.originals.inspection, row.id);
      if (!result.ok) throw Error('RECOVERY_PDF');
      return result;
    }) : [];
    const vault = createPdfOriginalVaultController({ namespace, timeoutMs: 20000 });
    let pdfApplied = false, annotationsApplied = false;
    try {
      guard();
      await vault.restoreOriginals(rows, { guard });
      pdfApplied = rows.length > 0;
      if (snapshot.annotations.length) {
        await annotations.workspaceRecords(namespace, 'restore', snapshot.annotations, guard);
        annotationsApplied = true;
      }
      guard();
      commitStorage();
    } catch (error) {
      const rolledBack = await Promise.allSettled([
        annotationsApplied && annotations.workspaceRecords(namespace, 'rollback', snapshot.annotations),
        pdfApplied && vault.restoreOriginals(rows, { rollback: true }),
      ]);
      if (rolledBack.some(result => result.status === 'rejected')) throw Error('RECOVERY_ROLLBACK_UNCONFIRMED');
      throw error;
    } finally { vault.close(); }
  }

  return { occupied, capture, install };
}
