const ANNOTATION_DATABASE = 'prism-annotation-revisions-v1';
const ANNOTATION_RECORDS = 'revisions';

// One authoritative value per existing annotation key. A key with no record
// still reads the legacy bytes. Its first successful write preserves those bytes.
export function createAnnotationStorage({
  storage,
  getIndexedDB = () => globalThis.indexedDB,
  timeoutMs = 5000,
}) {
  let connection, opening;

  function connect() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const finish = (error, db) => {
        if (settled) {
          db?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(db);
      };
      const timer = setTimeout(() => finish(Error('ANNOTATION_STORAGE_OPEN_TIMEOUT')), timeoutMs);
      try {
        request = getIndexedDB()?.open(ANNOTATION_DATABASE, 1);
        if (!request) throw Error('ANNOTATION_STORAGE_UNAVAILABLE');
      } catch (error) {
        finish(Error('ANNOTATION_STORAGE_UNAVAILABLE', { cause: error }));
        return;
      }
      request.onerror = () => finish(Error('ANNOTATION_STORAGE_OPEN_FAILED', { cause: request.error }));
      request.onblocked = () => finish(Error('ANNOTATION_STORAGE_OPEN_BLOCKED'));
      request.onupgradeneeded = event => {
        if (settled || event.oldVersion !== 0) {
          request.transaction.abort();
          return;
        }
        try {
          request.result.createObjectStore(ANNOTATION_RECORDS);
        } catch (error) {
          try { request.transaction.abort(); } catch {}
          finish(Error('ANNOTATION_STORAGE_SCHEMA', { cause: error }));
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled || db.version !== 1 || db.objectStoreNames.length !== 1 ||
            !db.objectStoreNames.contains(ANNOTATION_RECORDS)) {
          db.close();
          finish(Error('ANNOTATION_STORAGE_SCHEMA'));
          return;
        }
        const forget = () => { if (connection === db) connection = undefined; };
        db.onclose = forget;
        db.onversionchange = () => { db.close(); forget(); };
        connection = db;
        finish(null, db);
      };
    }).finally(() => { opening = undefined; });
    return opening;
  }

  function transaction(db, key, update) {
    return new Promise((resolve, reject) => {
      let tx, result, error, admitted = false, settled = false;
      const finish = (failure, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve(value);
      };
      const failure = (code, outcome, cause) => Object.assign(Error(code, { cause }), { outcome });
      const timer = setTimeout(() => {
        finish(failure('ANNOTATION_STORAGE_TIMEOUT', admitted ? 'unknown' : 'not-saved'));
        try { tx?.abort(); } catch {}
      }, timeoutMs);
      const abort = cause => {
        error = cause;
        try { tx.abort(); } catch { finish(cause); }
      };

      try {
        tx = update ? db.transaction(ANNOTATION_RECORDS, 'readwrite', { durability: 'strict' })
          : db.transaction(ANNOTATION_RECORDS, 'readonly');
        tx.onabort = () => finish(error ?? failure(
          update ? 'ANNOTATION_STORAGE_WRITE_ABORTED' : 'ANNOTATION_STORAGE_READ_ABORTED',
          'not-saved', tx.error));
        tx.oncomplete = () => finish(error, result);
        const records = tx.objectStore(ANNOTATION_RECORDS);
        if (records.keyPath !== null || records.autoIncrement || records.indexNames.length !== 0) {
          abort(Error('ANNOTATION_STORAGE_SCHEMA'));
          return;
        }
        const request = records.get(key);
        request.onsuccess = () => {
          if (settled) return;
          try {
            const value = request.result === undefined ? storage.getItem(key) : request.result;
            if (typeof value !== 'string' && (request.result !== undefined || value !== null)) {
              throw Error('ANNOTATION_STORAGE_INVALID_RECORD');
            }
            result = update ? value === update.expected : value;
            if (update && result) {
              // No awaits between comparison and put. Abort rolls back this put.
              update.guard();
              records.put(update.next, key);
              admitted = true;
            }
          } catch (cause) {
            abort(cause);
          }
        };
      } catch (cause) {
        if (tx) abort(cause);
        else finish(cause);
      }
    });
  }

  async function workspaceRecords(namespace, operation, entries = [], guard = () => {}) {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ANNOTATION_RECORDS, operation === 'read' ? 'readonly' : 'readwrite', { durability: 'strict' });
      const records = tx.objectStore(ANNOTATION_RECORDS), found = [];
      const prefix = namespace + ':';
      let failure;
      const abort = error => { failure = error; tx.abort(); };
      const timer = setTimeout(() => abort(Error('RECOVERY_ANNOTATIONS_TIMEOUT')), timeoutMs);
      tx.onabort = () => { clearTimeout(timer); reject(failure ?? Error('RECOVERY_ANNOTATIONS_WRITE')); };
      tx.oncomplete = () => { clearTimeout(timer); resolve(found); };
      const request = records.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (cursor) {
            if (typeof cursor.value !== 'string') throw Error('RECOVERY_ANNOTATIONS');
            found.push([cursor.key, cursor.value]);
            cursor.continue();
            return;
          }
          if (operation === 'read') return;
          if (operation === 'restore') {
            guard();
            if (found.length) throw Error('RECOVERY_DESTINATION_OCCUPIED');
            for (const [key, raw] of entries) records.add(raw, key);
          } else {
            const snapshot = new Map(found);
            for (const [key, raw] of entries) if (snapshot.get(key) === raw) records.delete(key);
          }
        } catch (error) { abort(error); }
      };
    });
  }

  return {
    async read(key) { return transaction(await connect(), key); },
    async compareAndWrite(key, expected, next, guard) {
      return transaction(await connect(), key, { expected, next, guard });
    },
    workspaceRecords,
  };
}
