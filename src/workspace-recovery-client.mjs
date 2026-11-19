import { emptyRecoveryDestination, inspectRecovery, recoveryBody, recoveryDataPath, recoveryEntries, recoveryStatusPath,
  restoreRecoveryEntries, workspaceEditorDraftKey } from './workspace-recovery-core.mjs';
export { createWorkspaceMaterials } from './workspace-recovery-materials.mjs';
export function createWorkspaceEditorDrafts(storage, namespace, volatileDrafts) {
  return {
    read(kind, ids) {
      const key = workspaceEditorDraftKey(namespace, kind, ids);
      try { return volatileDrafts.has(key) ? volatileDrafts.get(key).value : JSON.parse(storage.getItem(key)); }
      catch { return null; }
    },
    isSaved(kind, ids, text) {
      const key = workspaceEditorDraftKey(namespace, kind, ids);
      if (volatileDrafts.has(key)) return false;
      try { return JSON.parse(storage.getItem(key))?.text === text; }
      catch { return false; }
    },
    write(kind, ids, base, text) {
      const key = workspaceEditorDraftKey(namespace, kind, ids);
      const value = text === null ? null : { base, text };
      const raw = value === null ? null : JSON.stringify(value);
      try {
        if (raw === null) storage.removeItem(key);
        else storage.setItem(key, raw);
        if (storage.getItem(key) !== raw) throw Error('RECOVERY_DRAFT_NOT_STORED');
        volatileDrafts.delete(key);
        return true;
      } catch {
        volatileDrafts.set(key, { value, draft: true, volatile: true });
        return false;
      }
    },
  };
}

export function createWorkspaceRecovery({ storage, namespace, fetcher = globalThis.fetch, lock, validateBase, materials }) {
  const marker = namespace + ':workspace-recovery-v1';
  const restored = namespace + ':workspace-recovery-restored-base';
  const paused = namespace + ':workspace-recovery-paused';
  const timeout = () => AbortSignal.timeout(60000);
  let state = { phase: 'checking', current: null, previous: null, empty: false, paired: false, error: null };
  const listeners = new Set();
  function publish(change) {
    const next = { ...state, ...change };
    if (JSON.stringify(state) === JSON.stringify(next)) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function request(path, init = {}) {
    const response = await fetcher(path, {
      ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: timeout(),
    });
    if (!response.ok) {
      let code;
      try { code = (await response.json()).code; } catch {}
      throw Error(code ?? (response.status === 409 ? 'RECOVERY_CONFLICT' : 'RECOVERY_UNAVAILABLE'));
    }
    return response;
  }

  let savedSignature = null;
  const empty = async () => emptyRecoveryDestination(storage, namespace) && !(await materials?.occupied());
  async function inspect() {
    try {
      const metadata = await (await request(recoveryStatusPath)).json();
      const paired = storage.getItem(marker) !== null;
      const emptyLocal = emptyRecoveryDestination(storage, namespace);
      const occupiedMaterials = emptyLocal && Boolean(await materials?.occupied());
      publish({ ...metadata, paired, paused: storage.getItem(paused) !== null,
        empty: emptyLocal && !occupiedMaterials, occupiedMaterials, phase: 'ready', error: null });
    } catch (error) {
      publish({ phase: 'error', error: error.name === 'QuotaExceededError' ? error.name : error.message });
    }
  }

  let pending = false;
  const exclusive = async operation => {
    if (!lock) throw Error('RECOVERY_LOCK_UNAVAILABLE');
    return lock(namespace + ':workspace-recovery-write', operation);
  };

  async function save({ explicit = false, required = false } = {}) {
    // Background backup is opt-in. A required save can wait behind a browser backup.
    if (pending && !required || state.phase === 'error' && !explicit && !required) return;
    if (!explicit && (storage.getItem(marker) === null || storage.getItem(paused) !== null)) return;
    pending = true;
    try {
      await exclusive(async () => {
        if (explicit || required) publish({ phase: 'saving', error: null });
        const extras = await materials?.capture();
        const entries = recoveryEntries(storage, namespace);
        const signature = JSON.stringify([entries, extras?.annotations, extras?.pdfKey]);
        if (!explicit && signature === savedSignature) return;
        const raw = recoveryBody(namespace, entries, extras);
        const { fingerprint } = await inspectRecovery(raw, namespace);
        const expected = storage.getItem(marker) ?? storage.getItem(restored);
        publish({ phase: 'saving', error: null });
        const current = await (await request(recoveryStatusPath)).json();
        if (current.current && current.current.fingerprint !== expected && current.current.fingerprint !== fingerprint) {
          throw Error('RECOVERY_CONFLICT');
        }
        if (!current.current && expected !== null) throw Error('RECOVERY_CONFLICT');
        const result = current.current?.fingerprint === fingerprint ? current
          : await (await request(recoveryDataPath + '/write', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-prism-recovery-base': expected ?? 'none' }, body: raw,
          })).json();
        if (result.current?.fingerprint !== fingerprint) throw Error('RECOVERY_READBACK');
        storage.setItem(marker, fingerprint);
        storage.removeItem(restored);
        storage.removeItem(paused);
        savedSignature = signature;
        publish({ ...result, phase: 'ready', paired: true, paused: false, empty: false, error: null });
      });
    } catch (error) {
      publish({ phase: 'error', error: error.name === 'QuotaExceededError' ? error.name : error.message });
      if (required) throw error;
    } finally { pending = false; }
  }

  async function restore(fingerprint) {
    publish({ phase: 'restoring', error: null });
    let committed = false;
    try {
      await exclusive(async () => {
        if (!await empty()) throw Error('RECOVERY_DESTINATION_OCCUPIED');
        const guard = () => {
          if (!emptyRecoveryDestination(storage, namespace)) throw Error('RECOVERY_DESTINATION_OCCUPIED');
        };
        const response = await request(recoveryDataPath + '?id=' + encodeURIComponent(fingerprint));
        const raw = await response.text();
        const snapshot = await inspectRecovery(raw, namespace);
        if (snapshot.fingerprint !== fingerprint) throw Error('RECOVERY_READBACK');
        await validateBase(snapshot.entries);
        if (!await empty()) throw Error('RECOVERY_DESTINATION_OCCUPIED');
        const commit = () => restoreRecoveryEntries(storage, namespace, snapshot.entries);
        if (materials) await materials.install(snapshot, guard, commit);
        else if (snapshot.summary.version === 1) commit();
        else throw Error('RECOVERY_MATERIALS_UNAVAILABLE');
        try { storage.setItem(restored, fingerprint); } catch {}
        // Restored copies join automatic backup only if the user selects "启用" afterward.
        savedSignature = null;
        committed = true;
      });
    } catch (error) {
      publish({ phase: 'error', error: error.name === 'QuotaExceededError' ? error.name : error.message, empty: await empty().catch(() => false) });
    }
    return committed;
  }

  return {
    inspect, save, restore,
    async pause() {
      await exclusive(() => {
        storage.setItem(paused, '1');
        publish({ phase: 'ready', paused: true, error: null });
      }).catch(error => publish({ phase: 'error', error: error.message }));
    },
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    protectRequest: () => save({ required: true }),
  };
}
