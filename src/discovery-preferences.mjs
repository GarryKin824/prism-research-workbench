/** Local selection convenience only. A saved mode grants no search, network,
 * intake, project, queue, model or execution authority. Never write on load.
 */
export const DISCOVERY_PREFERENCE_SCHEMA = 'prism-discovery-preferences/v1';
export const DISCOVERY_PREFERENCE_SUFFIX = ':discovery-preferences-v1';
export const DISCOVERY_FIRST_N_MAX = 30;
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const validChoice = value => exact(value, ['mode', 'firstN']) && ['manual', 'first-n'].includes(value.mode) &&
  Number.isInteger(value.firstN) && value.firstN >= 1 && value.firstN <= DISCOVERY_FIRST_N_MAX;
const fail = code => { throw Object.assign(new Error(code), {code}); };
export function parseDiscoveryPreferences(raw) {
  if (typeof raw !== 'string' || raw.length > 512) fail('DISCOVERY_PREFERENCE_INVALID');
  let packet;
  try { packet = JSON.parse(raw); } catch { fail('DISCOVERY_PREFERENCE_INVALID'); }
  if (!exact(packet, ['schema', 'mode', 'firstN']) || packet.schema !== DISCOVERY_PREFERENCE_SCHEMA ||
      !validChoice({mode: packet.mode, firstN: packet.firstN})) fail('DISCOVERY_PREFERENCE_INVALID');
  return Object.freeze({mode: packet.mode, firstN: packet.firstN});
}
export function createDiscoveryPreferences({store, getStorage = () => globalThis.localStorage, withLock} = {}) {
  if (!store || typeof store.getStorageKey !== 'function' || typeof store.assertCurrentStorage !== 'function' ||
      typeof getStorage !== 'function') fail('DISCOVERY_PREFERENCE_CONFIGURATION');
  const namespace = store.getStorageKey();
  if (typeof namespace !== 'string' || !namespace.trim() || namespace.length > 300)
    fail('DISCOVERY_PREFERENCE_CONFIGURATION');
  const key = namespace + DISCOVERY_PREFERENCE_SUFFIX;
  let boundStorage, baseline, loaded = false, busy = false, closed = false, epoch = 0;
  let state = Object.freeze({mode: 'manual', firstN: 3, status: 'default', error: null, canSave: false});
  function fallback(status, error) {
    loaded = false; baseline = undefined;
    state = Object.freeze({mode: 'manual', firstN: 3, status, error, canSave: false});
    return state;
  }
  function current(guard = () => true) {
    if (closed || store.getStorageKey() !== namespace || guard() !== true)
      fail('DISCOVERY_PREFERENCE_EXPIRED');
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') fail('DISCOVERY_PREFERENCE_STORAGE_UNAVAILABLE');
    if (boundStorage && storage !== boundStorage) fail('DISCOVERY_PREFERENCE_STORAGE_CHANGED');
    store.assertCurrentStorage();
    return storage;
  }
  function load() {
    if (busy) return state;
    epoch++;
    try {
      const storage = current();
      boundStorage = storage;
      const raw = storage.getItem(key);
      const choice = raw === null ? {mode: 'manual', firstN: 3} : parseDiscoveryPreferences(raw);
      baseline = raw; loaded = true;
      state = Object.freeze({...choice, status: raw === null ? 'default' : 'loaded', error: null,
        canSave: typeof withLock === 'function' && typeof storage.setItem === 'function'});
      return state;
    } catch (error) {
      return fallback(error.code === 'DISCOVERY_PREFERENCE_INVALID' ? 'invalid' : 'unavailable',
        error.code || 'DISCOVERY_PREFERENCE_STORAGE_UNAVAILABLE');
    }
  }
  async function save(choice, approval = {}, guard = () => true) {
    // Capture/validate before taking a lock. Repeated clicks must not queue writes.
    if (busy) fail('DISCOVERY_PREFERENCE_BUSY');
    if (approval.explicit !== true) fail('DISCOVERY_PREFERENCE_CONFIRMATION_REQUIRED');
    if (!validChoice(choice)) fail('DISCOVERY_PREFERENCE_INVALID');
    if (!loaded || !state.canSave) fail(typeof withLock !== 'function' ?
      'DISCOVERY_PREFERENCE_WEB_LOCKS_REQUIRED' : 'DISCOVERY_PREFERENCE_RELOAD_REQUIRED');
    const raw = JSON.stringify({schema: DISCOVERY_PREFERENCE_SCHEMA, mode: choice.mode, firstN: choice.firstN});
    const capturedEpoch = epoch, capturedBaseline = baseline;
    let attempted = false, entered = false, complete = false;
    busy = true;
    try {
      const storage = current(guard), storeRaw = storage.getItem(namespace);
      const check = () => {
        if (epoch !== capturedEpoch) fail('DISCOVERY_PREFERENCE_STALE');
        current(guard);
        if (storage.getItem(namespace) !== storeRaw) fail('DISCOVERY_PREFERENCE_STORAGE_CHANGED');
      };
      await withLock(key, () => {
        if (entered) fail('DISCOVERY_PREFERENCE_LOCK_INVALID');
        entered = true;
        check();
        if (storage.getItem(key) !== capturedBaseline) fail('DISCOVERY_PREFERENCE_CONFLICT');
        // The synchronous write/readback stays entirely inside the exclusive lock.
        attempted = true;
        storage.setItem(key, raw);
        if (storage.getItem(key) !== raw) fail('DISCOVERY_PREFERENCE_READBACK_FAILED');
        check();
        complete = true;
      });
      if (!complete) fail('DISCOVERY_PREFERENCE_LOCK_INVALID');
      check();
      // Also detect an intervening write after lock release before reporting success.
      if (storage.getItem(key) !== raw) fail('DISCOVERY_PREFERENCE_READBACK_FAILED');
      baseline = raw;
      state = Object.freeze({...parseDiscoveryPreferences(raw), status: 'saved', error: null, canSave: true});
      return state;
    } catch (error) {
      const code = attempted ? 'DISCOVERY_PREFERENCE_OUTCOME_UNKNOWN' :
        (error.code || 'DISCOVERY_PREFERENCE_STORAGE_UNAVAILABLE');
      fallback(attempted ? 'unknown' : code === 'DISCOVERY_PREFERENCE_CONFLICT' ? 'conflict' : 'unavailable', code);
      fail(code);
    } finally { busy = false; }
  }
  return {key, load, save, getSnapshot: () => state,
    invalidate() { epoch++; return fallback('conflict', 'DISCOVERY_PREFERENCE_STORAGE_CHANGED'); },
    close() { closed = true; epoch++; }};
}
