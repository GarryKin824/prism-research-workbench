# Workbench composition contract (default off)

This increment connects the existing bounded fixture protocol to the actual generated workbench UI. It is **not a deployed or authenticated Host connection**. Normal manifest installation remains slots-only and never reads `ctx.connection`. No setting, imported project, browser global, pasted document UUID, URL or account can enable the bridge.

## Reviewed code seam, not a login API

The module's default plugin object additionally exposes:

```js
const configuredPlugin = defaultPlugin.createWithTrustedPlanningHost({resolveDocument});
```

This PRISM-owned composition factory accepts exactly one own data property, a callable `resolveDocument`. It returns a plugin requiring the official `slots` and `connection` services. Cordis waits for both before applying it. The ordinary plugin does not acquire that dependency. The configured plugin still starts disabled; creating or enabling it does not send a request, install a transport, authenticate, reconnect or resolve a document. Do not install both variants into the same slots.

The synchronous resolver receives a canonical request binding and returns exactly:

```js
{documentId, document, signal, isCurrent}
// document: {namespace, projectId, revisionSha256, templateVersion,
//            nodes: [{nodeId, promptVersion}, ...]}
```

The resolver must be supplied by reviewed deployment code with an authenticated, lifecycle-bound handoff from the Host-owned project registry. It must return the same live admission signal and document identity for the same admission and report revocation synchronously. `isCurrent()` must return `true` only while that admission remains current. A change/disposal must abort the signal; silent change-and-back cannot be detected by a client polling a resolver. Browser storage contents and SHA-256 values are not provenance or authorization. The resolver must not perform hidden network work. No production resolver, trusted project-source persistence adapter or secure descriptor delivery mechanism is included.

The existing Host registry independently validates the complete saved project history, derives document/node versions, and reconstructs the exact selected payload before passing it to the bridge. This is required even when the browser's matching checks pass. The bounded route uses official owner admission, not per-tab document authority. A UUID is only a selector.

## Four explicit steps

1. **Local full request review**. Available even without a configured provider; then document fields are null and sending remains impossible. With the trusted variant enabled, resolve and validate the current document, observe the existing official generation/reset/disposal, and show the complete selected payload plus document binding. No RPC occurs.
2. **Consent to disclose to Host**. Only the exact issued live preview plus explicit hash-bound consent can call the fixed `/api` / `prism-planning-fixture/exchange` endpoint. This sends plaintext to the Host to request the final HTTP fixture preview. It is not a local-only action.
3. **Separate HTTP consent**. Show the full returned URL, headers and body. Confirmation separately permits one fixture invocation and its bounded duplicate-prevention metadata. Existing bridge/session checks only accept the specified synthetic loopback contract and public fixture marker, not real credentials or real-model endpoints/results.
4. **Separate local adoption**. Consume the issued result once to fill an unsaved suggestion. No save, template/Prompt replacement, research acceptance, approval, project mutation or further send is authorized. Rendered Markdown/LaTeX does not change the raw result.

The switch is not consent for future requests. Switching it off, cancelling, changing UI scope, Host reset/generation/document expiry or disposal retires adoption rights. Unknown send/invoke outcomes are not retried and do not prove remote execution stopped. Recovery after an expired facade requires an explicit off then on and a new preview. Nothing resumes on refresh or from a backup. A facade accepts at most 100 local previews over its lifetime; reaching the cap requires recreating the workbench after preserving any unsaved drafts, not automatic reconnection.

## Deployment gates still closed

- Trusted Host-owned project source and monotone lifecycle adapter.
- Authenticated, scoped document descriptor delivery to the client.
- Official authenticated browser Host origin/cookie/security and lifecycle acceptance.
- Actual browser layout/visual acceptance in an environment that supports it.

No real model adapter is enabled by this seam. Tests use synthetic admission, fake in-memory Fetch and a synthetic in-memory model. These tests validate protocol and UI mechanics, not the gates above. No fallback to the older 300 MiB prebuffered dedicated RPC route, arbitrary URL, new login, proxy or cross-origin bypass exists.
