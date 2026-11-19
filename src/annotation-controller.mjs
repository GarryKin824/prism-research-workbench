import { sha256 } from './custom-core.mjs';

// A remount must not clear an uncertain write for the same storage object and key.
const annotationWriteRecovery = new WeakMap();

export function createAnnotationController({ store, storage, crypto, withLock }, table) {
  const { annotationStorage } = store;
  const namespace = store.getStorageKey();
  const key = namespace + table.keySuffix;
  const issued = new WeakSet();
  let baseline, state, initializing;
  const recovery = () => annotationWriteRecovery.get(storage)?.get(key) ?? null;
  const fail = suffix => { throw Error(`${table.code}_${suffix}`); };
  const readRaw = () => annotationStorage ? annotationStorage.read(key) : storage.getItem(key);

  function writeFailure(outcome, cause) {
    const suffix = outcome === 'unknown' ? 'WRITE_UNKNOWN_NO_RETRY' : 'NOT_SAVED_NEW_PREVIEW_REQUIRED';
    const code = `${table.code}_${suffix}`;
    const reason = outcome === 'not-saved' && typeof cause?.message === 'string'
      ? `: ${cause.message.slice(0, 160)}` : '';
    return Object.assign(new Error(code + reason, { cause }), { code, outcome });
  }

  function assertSettled() {
    if (recovery()) throw writeFailure('unknown');
  }

  function checkContext() {
    assertSettled();
    store.assertCurrentStorage();
    if (store.getStorageKey() !== namespace) fail('STORAGE_CONFLICT');
  }

  async function check() {
    checkContext();
    const expected = baseline;
    const raw = await readRaw();
    checkContext();
    if (raw !== expected || expected !== baseline) fail('STORAGE_CONFLICT');
  }

  async function loadState() {
    if (initializing) return initializing;
    initializing = (async () => {
      checkContext();
      const raw = await readRaw();
      const loaded = raw === null ? await table.create({ namespace }, crypto)
        : await table.load(raw, { namespace }, crypto);
      const reread = await readRaw();
      checkContext();
      if (reread !== raw) fail('STORAGE_CONFLICT');
      baseline = raw;
      state = loaded;
      return state;
    })();
    try {
      return await initializing;
    } finally {
      initializing = null;
    }
  }

  async function initialize() {
    assertSettled();
    if (initializing || !state) return loadState();
    await check();
    return state;
  }

  function refresh() {
    if (!annotationStorage) return initialize();
    return withLock ? withLock(namespace + table.lockSuffix, loadState) : loadState();
  }

  async function snapshotBinding() {
    assertSettled();
    if (!state) fail('NOT_READY');
    await check();
    const capturedState = state;
    const capturedBaseline = baseline;
    const papersRaw = JSON.stringify(store.getSnapshot().papers);
    const sources = [];
    for (const paper of JSON.parse(papersRaw)) {
      sources.push({ namespace, paperId: paper.id, title: paper.title, documentSha256: paper.document?.sha256 || null,
        snapshotSha256: await sha256(JSON.stringify(paper), crypto) });
    }
    function assertBound() {
      checkContext();
      if (capturedBaseline !== baseline || capturedState !== state) fail('STORAGE_CONFLICT');
      if (JSON.stringify(store.getSnapshot().papers) !== papersRaw) fail('SOURCE_CHANGED');
    }
    async function stable() {
      await check();
      assertBound();
    }
    await stable();
    return { state: capturedState, sources, rows: table.view(capturedState, { sources }), stable, assertBound };
  }

  async function snapshot() {
    const { assertBound, ...view } = await snapshotBinding();
    return view;
  }

  async function prepare(paperId, expectedSource, input, createPreview) {
    const captured = JSON.parse(JSON.stringify(input));
    const expected = JSON.stringify(expectedSource);
    const s = await snapshot();
    const source = s.sources.find(x => x.paperId === paperId);
    if (!source) fail('PAPER_MISSING');
    if (JSON.stringify(source) !== expected) fail('EDIT_SOURCE_CHANGED');
    const preview = await createPreview(s.state, { ...captured, source }, crypto);
    await s.stable();
    issued.add(preview);
    return preview;
  }

  function unknown(next, attemptedRaw, previousRaw, observedRaw, readbackSucceeded) {
    let byKey = annotationWriteRecovery.get(storage);
    if (!byKey) {
      byKey = new Map();
      annotationWriteRecovery.set(storage, byKey);
    }
    // Keep the exact attempted bytes. Bound any unexpected external readback.
    const observedLimit = 4_000_000;
    byKey.set(key, Object.freeze({ key, previousRaw, attemptedRaw,
      attemptedRevisionRaw: JSON.stringify(next.revisions.at(-1), null, 2),
      readbackSucceeded,
      observedRaw: typeof observedRaw === 'string' ? observedRaw.slice(0, observedLimit) : null,
      observedTruncated: typeof observedRaw === 'string' && observedRaw.length > observedLimit,
    }));
    throw writeFailure('unknown');
  }

  async function write(next, attemptedRaw, guard) {
    const previousRaw = baseline;
    let writeError;
    if (annotationStorage) {
      let changed;
      try {
        changed = await annotationStorage.compareAndWrite(key, previousRaw, attemptedRaw, guard);
      } catch (error) {
        if (error.outcome === 'unknown') unknown(next, attemptedRaw, previousRaw, null, false);
        if (error.outcome === 'not-saved') throw writeFailure('not-saved', error);
        throw error;
      }
      if (!changed) fail('STORAGE_CONFLICT');
    } else {
      guard();
      try { storage.setItem(key, attemptedRaw); }
      catch (error) { writeError = error; }
    }
    let observedRaw, readbackSucceeded = false;
    try {
      observedRaw = await readRaw();
      readbackSucceeded = true;
    } catch {
      // Without a readback, neither a return nor a throw establishes the outcome.
    }
    if (readbackSucceeded && observedRaw === attemptedRaw) {
      baseline = attemptedRaw;
      state = next;
      return state;
    }
    if (!annotationStorage && readbackSucceeded && observedRaw === previousRaw) {
      throw writeFailure('not-saved', writeError);
    }
    unknown(next, attemptedRaw, previousRaw, observedRaw, readbackSucceeded);
  }

  async function confirm(preview, { isCurrent = () => true } = {}) {
    if (!withLock) throw Error('WEB_LOCKS_REQUIRED');
    return withLock(namespace + table.lockSuffix, async () => {
      assertSettled();
      if (isCurrent() !== true || !issued.delete(preview)) fail('PREVIEW_EXPIRED');
      const s = await snapshotBinding();
      const bound = preview.observedSource || preview.source;
      const source = s.sources.find(x => x.paperId === bound.paperId);
      if (!source) fail('PAPER_MISSING');
      const next = await table.confirm(s.state, preview, { source }, crypto);
      const raw = await table.pack(next, crypto);
      await s.stable();
      return write(next, raw, () => {
        s.assertBound();
        if (isCurrent() !== true) fail('PREVIEW_EXPIRED');
      });
    });
  }

  async function exportData(format) {
    const s = await snapshot();
    const raw = format === 'csv' ? await table.exportCSV(s.state, { sources: s.sources }, crypto)
      : await table.pack(s.state, crypto);
    await s.stable();
    return raw;
  }

  return { initialize, refresh, snapshot, prepare, confirm, exportData, writeRecovery: recovery };
}
