import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { inspectRecovery, recoveryDataPath, recoveryFingerprint, recoveryLimit, recoveryStatusPath } from '../src/workspace-recovery-core.mjs';

export function createWorkspaceRecoveryHandler({ directory, namespace, admit }) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const respond = (status, value) => Response.json(value, { status, headers });
  const file = name => path.join(directory, name + '.json');
  let serial = Promise.resolve();
  const archiveNames = ['exp3-current', 'exp3-previous'];
  const metadataCache = new Map();

  async function read(name, metadataOnly = false) {
    try {
      const stat = await lstat(file(name));
      if (!stat.isFile() || stat.size > recoveryLimit) throw Error('RECOVERY_FILE');
      const key = [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
      if (metadataOnly && metadataCache.get(name)?.key === key) return metadataCache.get(name).metadata;
      const raw = await readFile(file(name), 'utf8');
      const { fingerprint, summary } = await inspectRecovery(raw, namespace);
      const metadata = { fingerprint, summary, savedAt: stat.mtime.toISOString() };
      metadataCache.set(name, { key, metadata });
      return metadataOnly ? metadata : { ...metadata, raw };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function write(name, raw) {
    const stage = file(randomUUID() + '.staged');
    try {
      const handle = await open(stage, 'wx', 0o600);
      try {
        await handle.writeFile(raw, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(stage, file(name));
      metadataCache.delete(name);
    } finally { await rm(stage, { force: true }); }
  }

  const meta = value => value && { fingerprint: value.fingerprint, savedAt: value.savedAt, summary: value.summary };
  async function status() {
    const [current, previous, ...legacy] = await Promise.all(['current', 'previous', ...archiveNames].map(name => read(name, true)));
    const seen = new Set([current?.fingerprint, previous?.fingerprint]);
    return { current: meta(current), previous: meta(previous), legacy: legacy.filter(value => {
      if (!value || seen.has(value.fingerprint)) return false;
      seen.add(value.fingerprint);
      return true;
    }).map(meta) };
  }
  async function serve(request, url) {
    if (request.method === 'GET' && url.pathname === recoveryStatusPath) {
      return respond(200, await status());
    }
    if (request.method === 'GET' && url.pathname === recoveryDataPath) {
      const fingerprint = url.searchParams.get('id');
      if (!recoveryFingerprint(fingerprint)) return respond(400, { code: 'RECOVERY_ID' });
      for (const name of ['current', 'previous', ...archiveNames]) {
        if ((await read(name, true))?.fingerprint !== fingerprint) continue;
        const result = await read(name);
        if (result?.fingerprint === fingerprint) {
          return new Response(result.raw, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
        }
      }
      return respond(404, { code: 'RECOVERY_VERSION_GONE' });
    }
    if (request.method !== 'POST' || url.pathname !== recoveryDataPath + '/write') return respond(405, { code: 'RECOVERY_METHOD' });
    const expected = request.headers.get('x-prism-recovery-base');
    if (expected !== 'none' && !recoveryFingerprint(expected)) return respond(400, { code: 'RECOVERY_ID' });
    if (request.headers.get('content-type') !== 'application/json' || !request.body) return respond(400, { code: 'RECOVERY_FORMAT' });
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > recoveryLimit) return respond(413, { code: 'RECOVERY_SIZE' });
      chunks.push(chunk);
    }
    let raw, fingerprint, summary;
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      ({ fingerprint, summary } = await inspectRecovery(raw, namespace));
    } catch (error) { return respond(400, { code: ['RECOVERY_TEXT_SIZE','RECOVERY_PDF'].includes(error.message) ? error.message : 'RECOVERY_FORMAT' }); }
    const operation = serial.then(async () => {
      if (request.signal.aborted || !admit(request)) return respond(403, { code: 'RECOVERY_OWNER_REQUIRED' });
      const current = await read('current');
      // A tab still running exp.3 can read the shared browser marker after upgrade.
      // Preserve the richer checkpoint even when that old tab supplies a valid base.
      if (current?.summary.version === 2 && summary.version === 1) {
        return respond(409, { code: 'RECOVERY_OLD_CLIENT' });
      }
      if (current?.fingerprint === fingerprint) return respond(200, await status());
      if ((current?.fingerprint ?? 'none') !== expected) return respond(409, { code: 'RECOVERY_CONFLICT' });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (summary.version === 2) {
        for (const [i,name] of ['current','previous'].entries()) {
          const old = await read(name,true);
          if (old?.summary.version !== 1 || await read(archiveNames[i],true)) continue;
          try { await copyFile(file(name), file(archiveNames[i]), constants.COPYFILE_EXCL); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          if ((await read(archiveNames[i],true))?.fingerprint !== old.fingerprint) throw Error('RECOVERY_READBACK');
        }
      }
      if (current) await write('previous', current.raw);
      await write('current', raw);
      const saved = await read('current');
      if (!saved || saved.fingerprint !== fingerprint) {
        throw Error('RECOVERY_READBACK');
      }
      return respond(200, await status());
    });
    serial = operation.catch(() => {});
    return operation;
  }

  return async request => {
    if (!admit(request)) return respond(403, { code: 'RECOVERY_OWNER_REQUIRED' });
    try { return await serve(request, new URL(request.url)); }
    catch (error) { return respond(503, { code: error.code === 'ENOSPC' ? 'RECOVERY_DISK_FULL' : 'RECOVERY_UNAVAILABLE' }); }
  };
}
