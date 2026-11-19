# Explicit project transfer and official JSON storage fixture

This is a default-off trusted Host operator composition, not a browser upload or authentication endpoint. The browser exports and reads an existing-format project-planning file locally. It cannot apply that file to the Host or overwrite its own projects.

## Existing format, limited scope

`inspectProjectTransfer(raw, {expectedNamespace?, crypto?})` validates the exact existing `exportProjects` format, preserving raw bytes. It checks UTF-8 size at 4,000,000 bytes, streams a bounded lexical scan (100,000 tokens, depth 64), rejects duplicate members including escaped equivalents, then uses native JSON parsing and the full existing project/history validators. Omitting expectedNamespace permits read-only inspection, not mapping authority.

The file covers saved project-planning state, including all projects and their version chains, discussions, templates and application records. Application records can embed source workflow snapshots with historical output/review content. It is not a complete paper/PDF/research/findings/audit backup; unsaved drafts and execution authority are not restored. Nothing is silently filtered or normalized. Browser UTF-8 decoding preserves a BOM so strict JSON parsing rejects it, rather than reporting a hash over silently changed bytes.

## Host coordinator

`createPlanningHostProjectImportCoordinator({enabled,source,namespace,targetLabel,...})` is disabled unless trusted code explicitly passes `enabled:true`. The disabled branch does not read source/configuration. An enabled coordinator binds an already initialized `DomainProjectSource`, a Host-selected namespace and a human-readable target label. It does not choose or open a backend, close the source, authenticate a user or register a document.

`prepare(raw)` reads and validates both the incoming archive and current source, captures epoch/sequence/hash, and returns a full immutable plaintext preview with exact namespace/project mapping, preserved/added history and source/target hashes. No write occurs. Only initial seeding or ordered append-only extension is permitted: every old project must remain in its original order and every old revision must remain the exact prefix. New projects/revisions can append; deletion, rewriting, forks, renaming namespaces, recomputing IDs/history, automatic merges and destructive replacement are not supported.

`confirm(preview,{explicit:true,previewSha256},isCurrent)` requires the exact issued object and single-operation consent. It calls `source.replace` once with captured CAS, verifies the result and live target, then reports saved without registration or model authority. JSON copies and hashes alone cannot grant permission. A later failure is conservatively “may be saved”; there is no rollback or automatic retry. Explicit close/reopen/inspection is required before deciding what to do next.

This coordinator intentionally uses the current DomainProjectSource's exact two-notification write contract: immediate attempt invalidation with old sequence/hash and pending zero, then post-durability invalidation with next sequence/hash and pending one. It tolerates those two owned events only; extra events/epoch changes cancel the active guard. Older or different source adapters must not be silently substituted. Independent validation covers another rejected write attempt invalidating an in-flight import, both before commit and after a possible commit.

At most four live preparations/previews and one active confirmation are admitted. Invalidated preparations retain their slots until asynchronous work settles, so repeated invalidation cannot bypass the bound. Lifetime preview attempts default to 32, at most 64. Cancel/close does not undo a write already begun. Default-off status and any preview/consent are never restored from files.

## Fixed official backend test composition

The official documentation names `@deepseek-ai/dsh-storage-json`. With authorization, exactly `0.2.2-rc.1` was obtained from official npm. Its 19 static files, MIT license, tarball and metadata are retained under `third-party/official-storage-json`; integrity matched the same registry's SHA-512/SHA-1 metadata. No independent signature verification is claimed. No npm install/lifecycle script ran and no existing lockfile/runtime file changed. Its required storage, Cordis and Schemastery versions already existed in the 1470-file locked runtime.

`verifyPlanningStorageJsonRuntime({runtimeRoot,packageRoot})` requires explicit absolute paths, verifies the unchanged base runtime and all 19 package files, rejects extra/symlinked package files, and verifies dependency resolution uses the locked runtime. It does not execute or enable the backend. The disk test imports the package only after verification and uses a fresh private cloud temporary directory.

The real official JSON backend and DomainFacility were tested with the actual source/coordinator: exact independent file readback, append-only update, fresh Node process reopen, malformed medium preservation, rename obstruction and close-before-write. Preview/absent consent causes no files; stale/removing imports do not overwrite the existing bytes.

## Boundaries that remain closed

The official backend uses same-directory exclusive temp file creation, file sync, atomic replacement and POSIX directory sync. It has no cross-process writer lock. Some failures after rename are ordinary errors even if disk changed, so generic write rejection is not evidence of an unchanged medium. The source's catch-all uncertain-state isolation remains necessary.

This test is real temporary filesystem I/O and normal process reopen, **not** power-loss/crash-durability, concurrent-writer, adversarial filesystem/path, production-root permissions or Windows acceptance. Production composition must use an explicitly selected, private, trusted root with one owner process and validated lifecycle. The delivered normal plugin does not select or install such a root/backend.

No browser-to-Host upload/promotion, namespace remapping, authenticated descriptor transport or per-project/tab access control was added. Owner-wide official admission remains owner-wide; UUIDs, names and hashes are not authentication. The Host model path remains disabled. No credentials, real models, user computer or publication were used.
