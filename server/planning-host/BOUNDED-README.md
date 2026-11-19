# Bounded authenticated fixture ingress

This is a separate, **default-off**, synthetic-fixture-only carrier. It does not install a listener, create credentials, connect a model, patch official code, register an `/api` interceptor, or activate the old dedicated RPC route. Do not activate both planning carriers for the same catalog. The existing dedicated carrier remains available for compatibility, but its transport still pre-buffers against the official 300 MiB default.

Trusted composition imports `clientRequestSchema` and `serverResponseSchema` from the locked official `@deepseek-ai/dsh-client-connection` package and supplies them to:

```js
const plugin = createPlanningBoundedHostPlugin(catalog, {
  clientRequestSchema,
  serverResponseSchema,
});
// Install explicitly through the established Host Context with { enabled: true }.
```

Protocol parsers, catalog, documents and bridge implementations are trusted in-process dependencies, never settings or request input. Enabled activation requires both parser ports. This package does not silently substitute permissive validators when the official package is unavailable. An omitted config is off; the only accepted config property is boolean `enabled`.

## Official transport and authorization boundary

The plugin owns exactly `POST /api/prism-planning-fixture/exchange` via `connection.fetch.register`, with `requestBody: 'streaming'`. The official `/api` carrier applies its existing Host/Origin and authentication admission before dispatch; its shared Fetch handler additionally refuses non-owner principals. Exact routes take priority over the one shared RPC interceptor, so this contribution coexists with the official Gateway. Other HTTP methods are not registered by this plugin and follow normal shared-channel dispatch; their global buffering behavior is not changed.

The registered callback receives a `Request`, **not the admitted Peer**. It calls the catalog's explicitly trusted in-process `dispatchAdmittedOwnerRequest(payload, signal)` seam. This is not a new authentication mechanism, and that callable must never be exposed directly to untrusted callers. No fake Peer, substitute browser Peer, or new principal is created. The original `dispatch(endpoint,payload,signal,peer)` still checks owner admission and Peer lifetime before calling shared catalog logic.

All admitted owners can address every current catalog document. Document IDs, revision metadata and leases are selectors, not authentication. The streaming seam has request, plugin and document revocation, **not per-Peer revocation**. Peer disposal that does not abort the HTTP request is not observable through this callback. Shared browser admission also does not imply tab-disconnect detection.

## Wire compatibility and bounds

Official client call: `connection.rpc.call('/api', 'prism-planning-fixture/exchange', canonicalPayloadString, signal)`. The outer request remains `{type:'client-request',rpcId,method,payload}` and the response `{type:'server-response',rpcId,result}`. The existing planning broker protocol string remains inside `payload`; there is no alternate path or fallback. The official client owns correlation generation/checking and response parsing.

The whole UTF-8 request envelope is capped at **2,097,152 bytes before JSON parsing**, not just its nested payload. Defaults: eight active ingress/dispatch slots, ten-second body deadline, and 8,192 chunks per request. Trusted factory options `maxBodyBytes`, `maxActiveReaders`, `readTimeoutMs`, `maxReadChunks` may only lower these maxima. Chunk count includes empty chunks, avoiding unlimited immediately resolved reads that could starve timers. Catalog and broker have their own independent operation/time/lifetime limits.

A slot is acquired before reading. A single deadline race covers the entire read loop, with monotonic deadline checks before and after each read even when ready-stream microtasks starve timers. Each admitted reader owns one fixed-size accumulator, not an array of retained chunks. Actual bytes are counted regardless of Content-Length. An oversized transport chunk is refused without copying it. Declared oversized lengths are refused before acquiring a reader; invalid lengths are refused. These are bounds on this adapter's retained ingress data, **not on total OS, socket, stream-queue, JSON-object or process resident memory**. Upstream may already have allocated a chunk, UTF-8 decoding/JSON parsing allocate representations, and transient concurrent requests can exist outside the adapter.

Fatal UTF-8 decoding is used; BOMs, whitespace variations and noncanonical serialization are refused. The parsed envelope must have exactly the four official fields, a string RPC ID of 1–128 code units, matching fixed method, and pass the official schema. Equality with `JSON.stringify(parsed)` refuses duplicate fields, including escaped duplicates. This deliberately supports the official client's ordinary serialization rather than every equivalent JSON spelling. The inner catalog independently requires canonical JSON and bounded raw broker strings.

All responses declare `Cache-Control: no-store`. Successful responses preserve the exact admitted correlation ID and official result shape. Invalid ingress uses fixed-text HTTP errors: 400 malformed, 413 bytes/chunk budget exceeded, 415 media type, 408 read timeout/abort, 503 capacity/disposal. No unvalidated attacker-provided ID is reflected in error bodies. A valid request's catalog refusal remains an HTTP-200 correlated RPC failure. Unexpected catalog errors become a fixed failure without caught exception text.

## Unread body and cancellation policy

The reader lock is released on all exits, including a pending read after timeout or abort. The handler deliberately does **not** call `reader.cancel()`: cancellation of the official `Readable.toWeb(nodeRequest)` stream can destroy the request socket before the carrier writes the rejection response. The locked official bridge detects unread streaming ingress, writes `Connection: close`, completes the response and destroys the request. This is the cleanup contract this adapter relies on; invoking its callback directly with an arbitrary stream does not install that bridge. Deadline rejection means the handler stops awaiting body data, not that an arbitrary producer's background work has been cancelled. A client already disconnected cannot be guaranteed a delivered error response.

Plugin disposal aborts in-flight requests and closes catalog registrations even if route disposal fails; cleanup is idempotent and disposal failures are sanitized. Route registration and cleanup-registration failure unwind the catalog and any installed route. A plugin instance cannot reactivate. Replacing it requires an explicitly new catalog and composition, with the durable fixture ledger left unchanged.

`registerDocument({document,bridge,assertCurrent})` optionally accepts a trusted synchronous currentness guard. Its returned handle also exposes the registration AbortSignal as `signal`, allowing trusted registry cleanup on expiry or close. The catalog combines it with its own registration lifetime and checks it before broker dispatch and after awaiting the result. The broker receives the same guard for its own checks. Exceptions and non-true returns fail closed. The project-binding registry additionally retires documents on source-change notifications; stale callbacks alone do not promise cancellation of already-started external work.

## Locked official evidence

Under `@deepseek-ai/dsh-client-connection`:

- `lib/index.js:30–117`: 300 MiB default bridge; streaming body/backpressure, request abort and post-response unread destruction.
- `lib/index.js:631–644`: public RPC request and response schemas.
- `lib/index.js:821–852`: exact route precedence, owner-only admission, Request-only callback and fiber-scoped registry/disposer.
- `lib/index.js:854–871`: dedicated `rpc.handle` bridge omits configured body cap.
- `lib/index.js:1037–1056`: authenticated `/api` bridge receives configured cap, unlike dedicated channels.
- `lib/types/rpc.d.ts:119–143`: public exact Fetch API and streaming contract.
- `lib/client.node.js:307–346,396–434`: generic official RPC serialization, correlation and response validation.

Changing Connection's `maxRequestBodyBytes` alone therefore does not cap the old dedicated channel; this implementation uses the documented streaming extension instead of patching upstream.

Local checks: `node tests-local/planning-host-bounded-carrier.mjs`, plus existing carrier and project-binding suites. Isolated unit tests use explicitly synthetic protocol parser ports; the separate official integration suite must supply the actual locked public parsers and registry. None of these checks constitute a live authenticated deployment or real-model integration.
