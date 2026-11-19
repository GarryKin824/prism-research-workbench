import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { WORKBENCH_MODEL_PATH, WORKBENCH_MODEL_STATUS_PATH, WORKBENCH_MODEL_RECEIPT_PATH,
  WORKBENCH_MODEL_ROUTE as route, WORKBENCH_MODEL_BODY_LIMIT, WORKBENCH_MODEL_OUTPUT_LIMIT, WORKBENCH_MODEL_USAGE_FIELDS,
  canonicalWorkbenchModelInput, canonicalWorkbenchReceiptSelector, workbenchModelHash } from '../src/workbench-model-contract.mjs';

const respond = (status, result) => Response.json(result, { status, headers: { 'cache-control': 'no-store' } });
const refusal = (status, code) => respond(status, { code });
const noTools = request => !request.tools?.length && !request.toolHistory;

async function readInput(request, signal) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > WORKBENCH_MODEL_BODY_LIMIT)) {
    throw Error('MODEL_BODY_LIMIT');
  }
  if (!request.body) throw Error('MODEL_INPUT_INVALID');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(WORKBENCH_MODEL_BODY_LIMIT);
  let length = 0;
  let chunks = 0;
  let stop;
  const deadline = new Promise((_, reject) => {
    stop = () => reject(Error('MODEL_READ_EXPIRED'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  try {
    const reading = (async () => {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
        if (++chunks > 256 || length + value.length > bytes.length) throw Error('MODEL_BODY_LIMIT');
        bytes.set(value, length);
        length += value.length;
      }
    })();
    return await Promise.race([reading, deadline]);
  } finally {
    signal.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}

async function consumeIntent(file, intent) {
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(intent) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

export function createWorkbenchModelHandler({ connection, account, llm, namespace, origin, journal, desktop = false }) {
  const resolveOrigin = typeof origin === 'function' ? origin : () => origin;
  if (!path.isAbsolute(journal) || connection.allowsRemoteAuthorities) {
    throw Error('MODEL_LOCAL_OWNER_REQUIRED');
  }
  let active = false;
  let activeRequest = null;
  const lifetime = new AbortController();
  function admit(request) {
    const { peer } = connection.admit(request);
    return peer && peer === connection.browserPeer && peer.principal.kind === 'owner' && !peer.signal.aborted;
  }

  function trustedTransport(request, expectedOrigin) {
    const fetchSite = request.headers.get('sec-fetch-site');
    const requestOrigin = request.headers.get('origin');
    if (desktop) {
      // The official dsh-app proxy validates its own Origin, strips these
      // browser markers, and supplies the Host's private owner credential.
      return fetchSite === null && requestOrigin === null;
    }
    return fetchSite === 'same-origin' && (request.method === 'GET' || requestOrigin === expectedOrigin);
  }

  async function journalEntry(selector, extension) {
    const raw = await readFile(path.join(journal, selector.requestId + '.' + extension + '.json'), 'utf8');
    if (raw.length > WORKBENCH_MODEL_BODY_LIMIT) throw Error('MODEL_RECEIPT_INVALID');
    const value = JSON.parse(raw);
    if (value.requestId !== selector.requestId || value.inputSha256 !== selector.inputSha256) throw Error('MODEL_RECEIPT_MISMATCH');
    return value;
  }

  async function checkReceipt(request) {
    if (request.method !== 'POST') return refusal(405, 'MODEL_METHOD');
    if (request.headers.get('content-type') !== 'application/json') return refusal(415, 'MODEL_INPUT_INVALID');
    let selector;
    try {
      selector = canonicalWorkbenchReceiptSelector(JSON.parse(await readInput(request,
        AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(4000)]))));
    } catch {
      return refusal(400, 'MODEL_RECEIPT_SELECTOR');
    }
    const reply = (status, body) => admit(request) && !lifetime.signal.aborted
      ? respond(status, body) : refusal(403, 'MODEL_OWNER_REQUIRED');
    try {
      const intent = await journalEntry(selector, 'intent');
      if (intent.target?.namespace !== 'prism-native-profile-v1:' + namespace) return refusal(404, 'MODEL_RECEIPT_MISSING');
      try {
        return reply(200, { state: 'returned', reply: await journalEntry(selector, 'reply') });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        const terminal = await journalEntry(selector, 'terminal');
        if (!['failed', 'cancelled', 'refused'].includes(terminal.state)) throw Error('MODEL_RECEIPT_INVALID');
        return reply(200, { state: terminal.state, code: terminal.code });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return reply(200, { state: activeRequest === selector.requestId ? 'pending' : 'unknown' });
    } catch (error) {
      if (error.code === 'ENOENT') return reply(200, { state: 'not-found' });
      if (error.message === 'MODEL_RECEIPT_MISMATCH') return refusal(404, 'MODEL_RECEIPT_MISSING');
      return refusal(503, 'MODEL_RECEIPT_UNAVAILABLE');
    }
  }

  async function fetch(request) {
    const url = new URL(request.url);
    const authority = new URL(resolveOrigin());
    // Connection constructs its Fetch Request with an internal URL base.
    if (authority.hostname !== '127.0.0.1' || request.headers.get('host') !== authority.host
        || ![WORKBENCH_MODEL_PATH, WORKBENCH_MODEL_STATUS_PATH, WORKBENCH_MODEL_RECEIPT_PATH].includes(url.pathname)
        || url.search) return refusal(404, 'MODEL_ROUTE');
    if (lifetime.signal.aborted || !admit(request)) return refusal(403, 'MODEL_OWNER_REQUIRED');
    if (!trustedTransport(request, authority.origin)) return refusal(403, 'MODEL_SAME_ORIGIN_REQUIRED');
    if (url.pathname === WORKBENCH_MODEL_RECEIPT_PATH) return checkReceipt(request);
    if (url.pathname === WORKBENCH_MODEL_STATUS_PATH) {
      if (request.method !== 'GET') return refusal(405, 'MODEL_METHOD');
      try {
        const state = await account.getState();
        if (!admit(request)) return refusal(403, 'MODEL_OWNER_REQUIRED');
        const registered = llm.listProviders().some(entry => entry.id === route.provider);
        const ready=state.status==='credential-stored'&&registered;
        return respond(200,{ready,route,state:!registered?'unconfigured':!ready?'signed-out':active?'busy':'available'});
      } catch {
        return refusal(503, 'MODEL_STATUS_UNAVAILABLE');
      }
    }
    if (request.method !== 'POST') return refusal(405, 'MODEL_METHOD');
    if (request.headers.get('content-type') !== 'application/json') return refusal(415, 'MODEL_INPUT_INVALID');
    if (active) return refusal(409, 'MODEL_BUSY');
    active = true;
    let intent, replyFile, journaled = false, dispatched = false;
    async function terminal(state, code, status) {
      if (journaled) await consumeIntent(path.join(journal, intent.requestId + '.terminal.json'), {
        requestId: intent.requestId, inputSha256: intent.inputSha256, state, code,
      });
      return refusal(status, code);
    }
    try {
      const peer = connection.browserPeer;
      const signal = AbortSignal.any([request.signal, peer.signal, lifetime.signal, AbortSignal.timeout(50000)]);
      let input;
      try {
        const raw = await readInput(request, AbortSignal.any([signal, AbortSignal.timeout(4000)]));
        input = canonicalWorkbenchModelInput(JSON.parse(raw), namespace);
        if (JSON.stringify(input) !== raw || await workbenchModelHash(input.text) !== input.promptSha256) {
          return refusal(400, 'MODEL_INPUT_INVALID');
        }
      } catch (error) {
        return refusal(error.message === 'MODEL_BODY_LIMIT' ? 413 : 400, 'MODEL_INPUT_INVALID');
      }
      if (input.execution&&input.execution.channel!=='host') return refusal(400,'MODEL_ROUTE_CHANGED');
      if (!admit(request)) return refusal(403, 'MODEL_OWNER_REQUIRED');
      if ((await account.getState()).status !== 'credential-stored') return refusal(409, 'MODEL_ACCOUNT_SIGN_IN_REQUIRED');
      await mkdir(journal, { recursive: true });
      const inputSha256 = await workbenchModelHash(JSON.stringify(input));
      const { text, ...binding } = input;
      intent = { ...binding, route, inputSha256, startedUtc: new Date().toISOString() };
      const intentFile = path.join(journal, input.requestId + '.intent.json');
      replyFile = path.join(journal, input.requestId + '.reply.json');
      if (!(await consumeIntent(intentFile, intent))) {
        try {
          const stored = JSON.parse(await readFile(replyFile, 'utf8'));
          if (stored.inputSha256 === inputSha256 && stored.requestId === input.requestId) return respond(200, stored);
        } catch {}
        return refusal(409, 'MODEL_ALREADY_ATTEMPTED_CHECK_HISTORY');
      }
      journaled = true;
      activeRequest = input.requestId;

      const prepared = await llm.prepareCall(route, signal);
      signal.throwIfAborted();
      if (!admit(request) || lifetime.signal.aborted) return await terminal('refused', 'MODEL_OWNER_REQUIRED', 403);
      if (prepared.config.provider !== route.provider || prepared.config.model !== route.model
          || prepared.config.maxTokens !== route.maxTokens || prepared.config.reasoningEffort !== route.reasoningEffort) {
        return await terminal('refused', 'MODEL_ROUTE_CHANGED', 409);
      }
      const call = {
        ...prepared.config,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        signal,
      };
      if (!noTools(call)) return await terminal('refused', 'MODEL_TOOLS_REFUSED', 409);
      dispatched = true;
      let answer = '', finish, usage, providerCode;
      for await (const event of prepared.stream(call)) {
        if (event.type === 'text-delta') {
          if (answer.length + event.text.length > WORKBENCH_MODEL_OUTPUT_LIMIT) throw Error('MODEL_OUTPUT_LIMIT');
          answer += event.text;
        }
        if (event.type === 'usage') {
          usage = Object.fromEntries(Object.entries(event.usage).filter(([key, count]) =>
            WORKBENCH_MODEL_USAGE_FIELDS.includes(key) && Number.isSafeInteger(count) && count >= 0));
        }
        if (event.type === 'finish') {
          finish = event.reason.kind;
          const code = event.reason.failure?.code;
          if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)) providerCode = code;
        }
      }
      if (!answer.trim() || !['stop', 'max-tokens'].includes(finish)) {
        if (['cancelled', 'aborted'].includes(finish)) return await terminal('cancelled', 'MODEL_PROVIDER_CANCELLED', 502);
        if (finish === 'error' || finish === 'failure') return await terminal('failed', providerCode ?? 'MODEL_PROVIDER_FAILED', 502);
        return refusal(502, providerCode ?? 'MODEL_NO_CONFIRMED_RESPONSE');
      }
      const result = { ...intent, answer, finish, usage, finishedUtc: new Date().toISOString() };
      if (!(await consumeIntent(replyFile, result))) return refusal(409, 'MODEL_ALREADY_ATTEMPTED_CHECK_HISTORY');
      if (!admit(request) || signal.aborted) return refusal(403, 'MODEL_OWNER_REQUIRED');
      return respond(200, result);
    } catch {
      if (journaled && !dispatched) {
        try { return await terminal('refused', 'MODEL_REQUEST_NOT_DISPATCHED', 409); } catch {}
      }
      return refusal(502, dispatched ? 'MODEL_NO_CONFIRMED_RESPONSE' : 'MODEL_REQUEST_UNAVAILABLE');
    } finally {
      activeRequest = null;
      active = false;
    }
  }
  return { fetch, close: () => lifetime.abort() };
}

export function installWorkbenchModelRoute(ctx, options) {
  if (!ctx.connection?.fetch || !ctx.deepseekAccount || !ctx.llm) throw Error('MODEL_HOST_SERVICES_UNAVAILABLE');
  const handler = createWorkbenchModelHandler({
    connection: ctx.connection, account: ctx.deepseekAccount, llm: ctx.llm, ...options,
  });
  ctx.connection.fetch.register({
    path: WORKBENCH_MODEL_STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: handler.fetch,
  });
  ctx.connection.fetch.register({
    path: WORKBENCH_MODEL_RECEIPT_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: handler.fetch,
  });
  ctx.connection.fetch.register({
    path: WORKBENCH_MODEL_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: handler.fetch,
  });
  ctx.effect(() => handler.close);
}
