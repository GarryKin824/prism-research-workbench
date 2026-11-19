/** Fixture-only trusted directory. Fail-closed exclusive lock, no stale-lock removal.
 * Directory ownership, parent symlink safety and multi-host exclusion are Host duties.
 */
import {mkdir,readFile,open,rename,unlink,lstat} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function createFileJournal(directory){
 if(typeof directory!=='string'||!isAbsolute(directory))throw Error('ABSOLUTE_DIRECTORY_REQUIRED');
 await mkdir(directory,{recursive:true,mode:0o700});const st=await lstat(directory);if(!st.isDirectory()||st.isSymbolicLink())throw Error('JOURNAL_DIRECTORY_INVALID');
 const file=join(directory,'intents.json'),lock=join(directory,'write.lock');
 async function read(){try{const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4000000)throw Error('JOURNAL_FILE_INVALID');return await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}}
 return Object.freeze({read,async compareAndSwap(expected,next){if(typeof next!=='string'||Buffer.byteLength(next)>4000000)throw Error('JOURNAL_SIZE');const lease=await open(lock,'wx',0o600);let temp;
 try{if(await read()!==expected)return false;temp=join(directory,`intent-${randomUUID()}.tmp`);const f=await open(temp,'wx',0o600);try{await f.writeFile(next);await f.sync()}finally{await f.close()}await rename(temp,file);temp=undefined;const d=await open(directory,'r');try{await d.sync()}finally{await d.close()}return true}
 finally{if(temp)await unlink(temp).catch(()=>{});await lease.close();await unlink(lock)}
 }})
}
