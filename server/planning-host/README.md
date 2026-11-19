# Opt-in planning fixture Host carrier

`carrier.mjs` is an unbundled official-Connection adapter, not a replacement for authentication. It creates no listener, transport, credentials, model client, bridge, filesystem state or browser bootstrap. Nothing in the delivered default Host/browser entrypoints imports it.

## Trusted composition example

```js
import {createPlanningHostCatalog,createPlanningHostPlugin}
  from './server/planning-host/carrier.mjs';

// Only trusted Host code may supply these, never an RPC payload or browser config.
const catalog = createPlanningHostCatalog();
const registration = catalog.registerDocument({document: hostOwnedDocument, bridge: fixtureBridge});
const plugin = createPlanningHostPlugin(catalog);
const fiber = ctx.plugin(plugin, {enabled: true}); // omitted / false registers nothing
// Pass registration.documentId to an owner UI through a separately reviewed bootstrap.
// On a document revision change, retire before registering a replacement:
registration.retire();
// On shutdown dispose the plugin; the creator must also close its fixtureBridge.
await fiber.dispose();
```

Document shape: `{namespace,projectId,revisionSha256,templateVersion,nodes:[{nodeId,promptVersion}]}`. Registration validates it through the unchanged fixture session broker, retains a deep-frozen snapshot, and rejects overlapping namespace/project registration. Registration and retirement are private in-process methods, not RPC endpoints. Host composition must ensure its document actually reflects Host-owned state and retire it when that state changes. A browser assertion of currentness is not sufficient. The module does not import browser storage or grant uploaded documents authority.

`connection.rpc.handle('/prism-planning-fixture', callback)` is the actual official extension point. RPC endpoint `exchange` takes a **canonical JSON string** `JSON.stringify({documentId,raw})`, where `raw` is the existing planning-session protocol string. The outer response is an official RPC result; a success value is the existing broker response string. No `/api` interceptor, custom fetch, authentication bypass or permissive CORS is installed.

## Authorization and lifetime

- Admitted official `peer.principal.kind === 'owner'` is the authority. Document IDs, namespaces, projects and lease IDs are selectors, never authentication. All admitted owner peers can use every catalog document; this is deliberately **Host-owner-wide**, with no per-tab or per-document user isolation claim.
- Request/peer abort prevents that invocation's result adoption. Shared browser Peer revocation is not tab-disconnect detection. A new owner peer can address the same still-current document, but cannot replay broker requests or reuse consumed leases. Reconnect does not automatically retire all documents or create fresh authority.
- Private retirement, catalog/plugin disposal and the maximum five-minute registration lifetime revoke scopes and pending broker work. This is local revocation, not a claim that any already-started remote work stopped. Underlying bridges remain caller-owned.
- At most 16 registrations over a catalog lifetime by default, configurable from 1 to 64. Retiring does not replenish this count. Each broker retains its existing 100-prepare / 400-request / once-use lease limits. Restart requires a fresh trusted catalog, and the bridge's durable ledger must remain unchanged.
- Active dispatches are bounded to 8 by default (`maxActiveDispatches`, 1–16), before application parsing. Excess requests fail closed without consuming broker state. This does not limit upstream buffering.
- A plugin instance activates at most once; repeated activation fails. Disposal is idempotent. If registering cleanup fails after route registration, installation returns a rejected promise only after attempting route disposal and closing the catalog.
- Outer string cap is 2 MiB; inner raw cap is 1 MiB. These checks occur **after official RPC buffering**. In rc.1 the dedicated channel may buffer up to the official 300 MiB upstream bound and does not inherit `/api` `maxRequestBodyBytes` controls. This is a production hardening gap, not an application-level resident-memory guarantee.
- Fixed errors contain no caught exception text. Unknown outcomes are not retried. The unchanged broker only admits synthetic fixture output and forbids real-model claims.

## Evidence limits

`node tests-local/planning-host-carrier.mjs` uses synthetic peers and stub bridges, no network. A separate official-registry test is needed to validate registration/disposal paths. Neither is authenticated browser QA, production-readiness evidence, or real-model execution. Do not enable production UI until reviewed Host state import/bootstrap, upstream body-size hardening, actual authentication/browser cancellation and appropriate data-transmission consent are implemented and verified.
