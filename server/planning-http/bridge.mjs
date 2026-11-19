/** Trusted Node fixture boundary, not a sandbox. Durable barriers do not grant permission. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {canonicalPlanningRequest} from '../../src/planning-model-adapter.mjs';
const PREFIX = '[本地HTTP合成样例，非真实模型答复；未验证]';
const PROTOCOL = 'prism-http-attempt-ledger/v1';
const hash = s => createHash('sha256').update(s).digest('hex');
const fail = code => { throw Error(code); };
const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Reflect.ownKeys(o).length === keys.length && keys.every(k => Object.getOwnPropertyDescriptor(o,k)?.value !== undefined);
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function validWire(w, payload, sessionId) {
  if (!exact(w,['endpoint','method','body','headers','bodySha256','headersSha256','model','sessionId','actualExecutor','realModelConnected']) ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/v1\/messages$/.test(w.endpoint) || Number(new URL(w.endpoint).port) > 65535 ||
      w.method !== 'POST' || w.model !== 'prism-synthetic' || w.sessionId !== sessionId ||
      w.actualExecutor !== 'official-deepseek-loopback-http-fixture' || w.realModelConnected !== false ||
      typeof w.body !== 'string' || Buffer.byteLength(w.body)>262144 || !Array.isArray(w.headers) || w.headers.length > 8) fail('HTTP_WIRE_INVALID');
  const expectedHeaders={'accept':'text/event-stream','content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':'fixture-not-a-user-credential','x-deepseek-harness-user-id':'prism-public-fixture','x-deepseek-harness-session-id':sessionId,'user-agent':'deepseek-harness/0.2.2-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)'};
  const names = new Set();
  for (const h of w.headers) {
    if (!exact(h,['name','value']) || names.has(h.name) || !Object.hasOwn(expectedHeaders,h.name) || h.value!==expectedHeaders[h.name]) fail('HTTP_WIRE_INVALID');
    names.add(h.name);
  }
  if (names.size !== Object.keys(expectedHeaders).length || w.bodySha256 !== hash(w.body) || w.headersSha256 !== hash(JSON.stringify(w.headers))) fail('HTTP_WIRE_INVALID');
  const b = JSON.parse(w.body);
  if (!exact(b,['model','stream','messages','max_tokens','thinking']) || b.model !== 'prism-synthetic' || b.max_tokens!==256 || b.stream!==true ||
      !exact(b.thinking,['type']) || b.thinking.type!=='disabled' ||
      !Array.isArray(b.messages) || b.messages.length !== 1 || !exact(b.messages[0],['role','content']) || b.messages[0].role !== 'user' ||
      !Array.isArray(b.messages[0].content) || b.messages[0].content.length!==1 || !exact(b.messages[0].content[0],['type','text']) || b.messages[0].content[0].type!=='text' || b.messages[0].content[0].text !== payload) fail('HTTP_WIRE_INVALID');
  return freeze(w);
}
export async function createPlanningHttpBridge({transport,ledgerDirectory,timeoutMs=5000}={}) {
  if (!transport || typeof transport.prepare !== 'function' || typeof transport.invoke !== 'function' || typeof ledgerDirectory !== 'string' || !path.isAbsolute(ledgerDirectory) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('HTTP_CONFIGURATION_INVALID');
  // Missing flags would be coerced to zero by the open calls below. Refuse before creating a ledger.
  if (!(Number.isInteger(constants.O_DIRECTORY) && constants.O_DIRECTORY > 0 &&
      Number.isInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW > 0)) {
    fail('HTTP_LEDGER_PLATFORM_UNSUPPORTED');
  }
  const dir = path.resolve(ledgerDirectory), previews = new WeakMap(), results = new WeakMap(), entries = new Set();
  const prepareWire = transport.prepare.bind(transport), invoke = transport.invoke.bind(transport);
  let closed = false;
  const safe = async fn => { try { return await fn(); } catch { fail('HTTP_LEDGER_UNAVAILABLE'); } };
  async function directory(check=()=>{}) {
    check(); const s = await fs.lstat(dir); check();
    if (!s.isDirectory() || s.isSymbolicLink()) fail('HTTP_LEDGER_UNAVAILABLE');
    const real = await fs.realpath(dir); check(); if (real !== dir) fail('HTTP_LEDGER_UNAVAILABLE');
  }
  async function read(name,check=()=>{}) {
    check(); const f = await fs.open(path.join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW); 
    try { check(); const stat = await f.stat(); check(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) fail('HTTP_LEDGER_UNAVAILABLE');
      const raw = await f.readFile('utf8'); check(); return JSON.parse(raw);
    } finally { await f.close(); }
  }
  async function write(name,value,check=()=>{}) {
    check(); const f = await fs.open(path.join(dir,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try { check(); await f.writeFile(JSON.stringify(value)); check(); await f.datasync(); check(); }
    finally { await f.close(); }
    check(); const actual = await read(name,check); check();
    if (JSON.stringify(actual)!==JSON.stringify(value)) fail('HTTP_LEDGER_UNAVAILABLE');
    const d = await fs.open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try { check(); await d.sync(); check(); } finally { await d.close(); }
    check();
  }
  function validAttempt(a,key) {
    return exact(a,['protocol','state','dedupeSha256','requestId','sessionId','purpose','binding','bodySha256','headersSha256','previewSha256','endpoint']) &&
      a.protocol===PROTOCOL && a.state==='attempted' && a.dedupeSha256===key && [a.bodySha256,a.headersSha256,a.previewSha256].every(hex) &&
      typeof a.requestId==='string' && /^[a-f0-9-]{36}$/.test(a.requestId) && typeof a.sessionId==='string' && /^[a-f0-9-]{36}$/.test(a.sessionId) &&
      ['project-planning','node-prompt-discussion'].includes(a.purpose) &&
      JSON.stringify(canonicalPlanningRequest({purpose:a.purpose,binding:a.binding,payload:'validation'}).binding)===JSON.stringify(a.binding) &&
      /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/v1\/messages$/.test(a.endpoint) && Number(new URL(a.endpoint).port)<=65535;
  }
  async function scan(check=()=>{}) {
    await directory(check); check(); const p = await read('protocol.json',check); check();
    if (!exact(p,['protocol']) || p.protocol!==PROTOCOL) fail('HTTP_LEDGER_UNAVAILABLE');
    const files = await fs.readdir(dir); check(); if (files.length>202) fail('HTTP_LEDGER_UNAVAILABLE');
    const claims = new Map(), receipts=[];
    for (const name of files) {
      if (name==='protocol.json') continue;
      if (name==='claim.lock') { const s=await fs.lstat(path.join(dir,name)); check(); if (!s.isFile() || s.isSymbolicLink()) fail('HTTP_LEDGER_UNAVAILABLE'); continue; }
      const m=/^([a-f0-9]{64})\.(attempt|receipt)\.json$/.exec(name); if (!m) fail('HTTP_LEDGER_UNAVAILABLE');
      const record=await read(name,check); check();
      if (m[2]==='attempt') { if (!validAttempt(record,m[1])) fail('HTTP_LEDGER_UNAVAILABLE'); claims.set(m[1],record); }
      else receipts.push([m[1],record]);
    }
    if (claims.size>100) fail('HTTP_LEDGER_UNAVAILABLE');
    for (const [key,r] of receipts) if (!exact(r,['protocol','state','dedupeSha256','requestId','responseSha256']) || r.protocol!==PROTOCOL || r.state!=='completed' || r.dedupeSha256!==key || r.requestId!==claims.get(key)?.requestId || !hex(r.responseSha256)) fail('HTTP_LEDGER_UNAVAILABLE');
    return {claims,completed:receipts.length};
  }
  await safe(async()=>{
    await fs.mkdir(dir,{recursive:false,mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await directory();
    try { await write('protocol.json',{protocol:PROTOCOL}); } catch(e) { if(e.code!=='EEXIST') throw e; }
    await scan();
  });
  function current(e,check=()=>true) {
    try {
      if (closed || e.cancelled || typeof check!=='function') fail('HTTP_CONTEXT_EXPIRED');
      e.stable(); if (check()!==true) fail('HTTP_CONTEXT_EXPIRED'); e.stable();
      if (closed || e.cancelled) fail('HTTP_CONTEXT_EXPIRED');
    } catch { fail('HTTP_CONTEXT_EXPIRED'); }
  }
  async function prepare(input,assertStable=()=>{}) {
    try {
      if (closed || typeof assertStable!=='function') fail('HTTP_CONTEXT_EXPIRED'); assertStable();
      const q=freeze(canonicalPlanningRequest(input)), canonical=JSON.stringify(q), requestId=randomUUID(),sessionId=randomUUID();
      const stable=()=>{assertStable(); if(JSON.stringify(canonicalPlanningRequest(input))!==canonical) fail('HTTP_CONTEXT_EXPIRED');};
      const e={q,stable,cancelled:false,used:false}; current(e);
      const wire=validWire(await prepareWire({payload:q.payload,sessionId}),q.payload,sessionId); current(e);
      const fields={kind:'planning-http-preview',purpose:q.purpose,binding:q.binding,requestId,sessionId,...wire,fixtureOnly:true,authority:'none'};
      const preview=freeze({...fields,previewSha256:hash(JSON.stringify(fields))});
      Object.assign(e,{wire,preview,dedupeSha256:hash(canonical)}); previews.set(preview,e); entries.add(e); return preview;
    } catch { fail('HTTP_PREVIEW_INVALID'); }
  }
  async function confirm(preview,{explicit,previewSha256}={},isCurrent=()=>true) {
    const e=previews.get(preview);
    if (!e || e.used || explicit!==true || previewSha256!==preview.previewSha256) fail('HTTP_CONFIRMATION_REQUIRED');
    current(e,isCurrent); e.used=true;
    const abort=new AbortController(); let timer,rejectStop;
    const stopped=new Promise((_,reject)=>{rejectStop=reject;});
    e.stop=()=>{e.cancelled=true;abort.abort();rejectStop(Error('HTTP_OUTCOME_UNKNOWN'));};
    const check=()=>current(e,isCurrent);
    // The race wraps all persistence too; late persistence can only leave barriers, never dispatch.
    const operation=(async()=>{
      check(); await directory(check); check();
      const lock=await fs.open(path.join(dir,'claim.lock'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      const lockIdentity=await lock.stat();
      try {
        check(); const {claims}=await scan(check); check();
        if (claims.has(e.dedupeSha256)) fail('HTTP_DUPLICATE_ATTEMPT');
        if (claims.size>=100) fail('HTTP_ATTEMPT_LIMIT');
        const a={protocol:PROTOCOL,state:'attempted',dedupeSha256:e.dedupeSha256,requestId:preview.requestId,sessionId:preview.sessionId,purpose:e.q.purpose,binding:e.q.binding,bodySha256:preview.bodySha256,headersSha256:preview.headersSha256,previewSha256:preview.previewSha256,endpoint:preview.endpoint};
        await write(`${e.dedupeSha256}.attempt.json`,a,check); check();
      } finally {
        await lock.close();
        const owned=await fs.lstat(path.join(dir,'claim.lock'));
        if (!owned.isFile() || owned.isSymbolicLink() || owned.dev!==lockIdentity.dev || owned.ino!==lockIdentity.ino || owned.nlink!==1) fail('HTTP_LEDGER_UNAVAILABLE');
        await fs.unlink(path.join(dir,'claim.lock'));
      }
      check();
      const response=await invoke(e.wire,{requestId:preview.requestId,signal:abort.signal}); check();
      if (!exact(response,['text','usage','realModelConnected','actualExecutor']) || response.realModelConnected!==false || response.actualExecutor!=='official-deepseek-loopback-http-fixture' || !exact(response.usage,['inputTokens','outputTokens','totalTokens']) || !Object.values(response.usage).every(n=>Number.isSafeInteger(n)&&n>=0) || response.usage.inputTokens>4096 || response.usage.outputTokens>256 || response.usage.totalTokens!==response.usage.inputTokens+response.usage.outputTokens || typeof response.text!=='string' || !response.text.trim() || response.text.length+PREFIX.length+1>16000 || Buffer.byteLength(response.text)>65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(response.text) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(response.text)) fail('HTTP_RESPONSE_INVALID');
      await write(`${e.dedupeSha256}.receipt.json`,{protocol:PROTOCOL,state:'completed',dedupeSha256:e.dedupeSha256,requestId:preview.requestId,responseSha256:hash(response.text)},check); check();
      const result=freeze({kind:'planning-http-result',requestId:preview.requestId,purpose:e.q.purpose,binding:{...e.q.binding},text:`${PREFIX}\n${response.text}`,fixtureOnly:true,actualExecutor:preview.actualExecutor,realModelConnected:false,authority:'none',verified:false});
      results.set(result,{e,consumed:false}); return result;
    })();
    timer=setTimeout(e.stop,timeoutMs);
    try { return await Promise.race([operation,stopped]); }
    catch { e.cancelled=true; abort.abort(); fail('HTTP_OUTCOME_UNKNOWN'); }
    finally { clearTimeout(timer); delete e.stop; }
  }
  function consumeResult(result,isCurrent=()=>true) { const r=results.get(result); if(!r || r.consumed)fail('HTTP_RESULT_EXPIRED'); current(r.e,isCurrent);r.consumed=true;return result.text; }
  function cancel(token) { const e=previews.get(token)??results.get(token)?.e;if(e){e.cancelled=true;e.stop?.();} }
  function close() { closed=true;for(const e of entries){e.cancelled=true;e.stop?.();}entries.clear(); }
  async function inspect() { return safe(async()=>{const s=await scan();return freeze({protocol:PROTOCOL,attempted:s.claims.size,completed:s.completed,remaining:100-s.claims.size});}); }
  return {prepare,confirm,consumeResult,cancel,close,inspect};
}
