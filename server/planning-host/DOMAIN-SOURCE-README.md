# Official Domain-backed project source: trusted composition only

This optional Node-side source is a PRISM-owned adapter around the public official `DomainFacility`. It is not a browser import API, a login mechanism, an authenticated descriptor endpoint, a production storage backend or an automatic connection to the workbench. The normal plugin/manifest remains unchanged and disabled.

## What this closes

The existing project registry required a trusted source exposing stable frozen `{epoch, raw}` snapshots with immediate invalidation. Previously only test sources supplied that contract. This adapter owns one dedicated official domain handle, validates the complete PRISM project archive, serializes explicit owner writes, compares expected sequence and hash, and supplies that source contract to the existing registry.

The official domain emits a change event only after successful durability and memory replacement. It emits **no event for an `unknown-state` write failure**. Therefore an event-only cache is unsafe. The adapter rechecks the domain's authoritative memory/readability on every `getSnapshot`, invalidates admissions before attempted writes, and quarantines failures. Official close also does not immediately make reads fail, so the adapter invalidates synchronously before draining close.

## Trusted setup

Supply the already configured official `DomainFacility`, `defineDomain`, official `zod`, the Host context and a Host-chosen namespace/domain name to `createPlanningHostDomainProjectSource`. Without `enabled: true`, it does not consult the context, facility, schema, namespace or crypto options. Do not choose a backend implicitly. Only reviewed Host composition may create/enable the source; browser data cannot choose its trusted ownership or storage destination.

Call `initialize()` to open/read. An empty medium produces an explicit non-null sequence-zero sentinel in memory and remains **not ready** for project registration. Initialization never writes that sentinel. Explicit `replace(raw, {expectedSeq, expectedSha256, isCurrent})` is the sole write operation. For a first seed the expected values are `0` and `null`. The raw input must be a complete validated `exportProjects` archive for the configured namespace, within 4,000,000 UTF-8 bytes. SHA-256 and sequence values are integrity/concurrency checks, not authority.

After a successful explicit seed/update, pass the source facade itself as `source` to the existing `createPlanningHostProjectRegistry().registerProject`. The registry still independently verifies full history and reconstructs exact request payloads before admitting a fixture operation. Opening/reading/registering does not authorize a model request.

Only the facade may write its private domain. Do not expose the domain handle or reuse its name with another component. Official in-memory reads cannot detect arbitrary external file edits or another process changing the medium; cross-process ownership/watch/recovery is not supplied here.

## Failure and recovery

- Stored record schema, namespace, raw archive, hash-chain or digest failure rejects initialization. No record is skipped, deleted, migrated, replaced with empty data or automatically backed up.
- Every replacement attempt retires old source admissions, including same bytes and rejected attempts. New registration is explicit; old leases never become current again.
- Queue/version/currentness checks happen before the sole write. A backend rejection, readback discrepancy, unexpected domain change or failed source read makes trust unavailable. There is no retry or rollback that could overwrite an ambiguous durable result.
- The successful write's readback is **memory consistency verification**, not an independent disk reread. Actual durability/atomicity is the configured official backend's responsibility.
- Closing immediately retires the source, then waits for outstanding work and closes the owned domain. A late write may have reached storage but cannot republish trust. Explicitly reopen and inspect before choosing another write; no automatic resume or reseed.
- Operation count, pending queue, archive size, listeners and lifetime are bounded. The lifetime cap is five minutes for this fixture-stage foundation; a long-running production lifecycle is not claimed. Preserve unsaved work before closing/reopening.

## What is not proven

The pinned local runtime includes storage/domain interfaces but no verified installed persistent backend. Tests use the real official domain implementation and an explicitly synthetic memory backend. Reopening that retained synthetic medium is not a disk crash, fsync, multi-process or production durability test.

Official bounded exact Fetch routes are admitted owner-wide and supply only `Request`, not `Peer`. Browser tabs share the official browser peer. A future descriptor route can mean “an admitted owner may retrieve an admitted Host document”; it cannot by itself prove that a browser-local archive owns that document or establish per-tab/project authorization. This increment adds no route, cookie, token, credential handling, homemade identity or fallback to the unbounded channel.

Before production enablement, define an explicit authorized Host project import/edit and namespace mapping flow, select and validate the persistent backend, design authenticated descriptor freshness/revocation under the actual owner-wide scope, and test the real authenticated browser lifecycle. Those actions have not been attempted here. Default disabling is preserved.
