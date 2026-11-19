# Browser project import: identity boundary remains closed

## Correct official API finding

The fixed official rc.1 Connection API exposes `connection.admit(request)`.
An exact Fetch callback receives only a Request, but trusted code **can pass that
original Request to the official admission method** to obtain the admitted Peer.
It must not parse authentication cookies, fabricate a Peer, copy a browser Peer
into a new scope, or substitute a document hash/UUID for authentication.

Evidence in `@deepseek-ai/dsh-client-connection`:

- `lib/types/rpc.d.ts:186–195`: public `admit` and separate in-process Peer factory.
- `lib/index.js:240–268`: Host/Origin/Fetch-Metadata checks.
- `lib/index.js:347–349`: HttpOnly, SameSite and Secure cookie attributes.
- `lib/index.js:559–568`: signature, authority and expiration checks.
- `lib/index.js:669–682`: official Peer disposal signal.
- `lib/index.js:695–748`: ordinary browser requests share `browserPeer`.
- `lib/index.js:758–775`: independent API Peer release and removal.
- `lib/index.js:821–834`: exact Fetch owner admission.

The verified implementation SHA-256 is
`0ebcca7583e082716f79b0b55bc1749d48269cc8db2989b043b321b57abd3684`.
This corrects the overbroad inference that the Request-only callback makes Peer
retrieval impossible. It does **not** establish browser-session isolation.

## Why ordinary browser import is not opened

All normal authenticated browser requests map to the same owner Peer. That Peer
does not identify a tab, browser credential, project owner or login generation.
Credential expiration is checked when admitting a request; it does not abort a
distinct browser-session signal. No public per-browser-cookie revocation event
was found in the reviewed version.

Re-admitting a retained Request checks the credential that request carried. It
does not prove a browser still possesses the cookie after deleting it or logging
out. A client generation/reset is useful for revoking local adoption, but cannot
replace server authentication or a server-side revocation signal.

Owner-wide access can be a valid different product policy. It is not silently
substituted for this task's reliable identity-isolation requirement. The new
handler therefore rejects the actual `connection.browserPeer` even when official
owner admission succeeds. There is no option to relax that rejection. The main
plugin, workbench, patch and existing model route are not connected to this code.

## Limited engineering path

The separate optional handler can be tested with independently admitted,
revocable official **API** owner Peers. This is not the normal browser path. It
does not create credentials or API Peers in production, register a route, listen
on a socket, connect a model or choose a storage root. It must be explicitly
composed with a caller-owned, initialized project operator and an official
Connection instance. The cumulative package supplies no production adapter.

Each prepare/confirm request is officially re-admitted. A preview belongs to the
same Peer object and live signal, with a short lifetime and the exact target
version/hash. Confirmation re-admits the original confirm Request at write
guards, checks currentness and consumes the issued confirmation once. A preview
selector is only a lookup key. An unrelated authenticated Peer cannot use it.

The client state machine separates:

1. Complete local plaintext/file validation without a transport call.
2. Explicit consent to send that exact plaintext to a previously trusted target.
3. Validation and review of the Host's complete save preview, namespace, source
   sequence/hash/epoch and append-only mapping.
4. A separate explicit confirmation to save once.

No confirmation, identity, lease or activation is restored from a project file.
Missing or revoked transport identity, stale source, malformed response, context
change, cancellation and unknown outcomes fail closed. A lost response or loss
of identity after a write begins cannot establish rollback: preserve the local
raw text and report the possibly saved result, without automatic retry.

## Capacity and transport shape

The old planning fixture transport has a 2 MiB whole-envelope limit and cannot
carry every 4,000,000-byte project archive. The new protocol is separate and uses
one JSON envelope, not nested RPC JSON strings. Its fixed path is a protocol
constant, not an installed route. The archive limit and envelope/response limits
are checked separately, including JSON escaping expansion.

Streaming limits bound this adapter's retained buffers, tasks and leases. They
are not a claim that OS socket queues, upstream chunks, JSON allocations or total
process memory fit inside the same byte limit. Timed-out background operations
must retain their capacity until settled; a timeout must not permit unlimited
new work while old work remains alive. Closing owns only this handler's previews,
not the shared operator, backend or catalog.

## Evidence scope

Official tests use actual public Connection admission, Peer lifecycle and Fetch
registry methods with an explicitly synthetic authentication provider, together
with actual official project plugins and JSON disk. They do not instantiate or
inspect real account authentication, signed cookies, launch tokens or secrets.
Synthetic acceptance is not login acceptance. The current normal browser route
remains unsupported and disabled even if every synthetic test passes.

Before ordinary browser import can be opened, a reviewed official mechanism
must supply the required browser identity and revocation semantics, or the user
must explicitly choose a different access policy. That is separate from code
correctness, user-facing transfer/save confirmation and real browser security
acceptance. No bypass, custom cookie parsing or cross-origin relaxation is an
acceptable substitute.
