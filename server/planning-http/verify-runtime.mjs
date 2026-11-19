import {readFile, realpath, readdir} from 'node:fs/promises';
import {resolve, join, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const lock = JSON.parse(await readFile(new URL('./RUNTIME-LOCK.json', import.meta.url), 'utf8'));
export async function verifyRuntime(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || !isAbsolute(runtimeRoot)) throw new Error('EXPLICIT_TRUSTED_RUNTIME_REQUIRED');
  const root = await realpath(runtimeRoot);
  const actual = [];
  async function walk(path) {
    for (const item of await readdir(join(root, path), {withFileTypes:true})) {
      const relative = `${path}/${item.name}`;
      if (item.isSymbolicLink()) { if(path==='node_modules/.bin') continue; throw new Error('RUNTIME_SYMLINK_REFUSED'); }
      if (item.isDirectory()) await walk(relative);
      else if (/\.(js|mjs|cjs|json|node|wasm)$/.test(item.name)) actual.push(relative);
    }
  }
  await walk('node_modules');
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(lock.files).sort())) throw new Error('RUNTIME_FILE_SET_MISMATCH');
  for (const [path, expected] of Object.entries(lock.files)) {
    const bytes = await readFile(resolve(root, path));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('RUNTIME_HASH_MISMATCH');
  }
  return Object.freeze({root, version:lock.version, verifiedFiles:actual.length});
}
