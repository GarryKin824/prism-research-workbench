# Optional packaged Host project plugin

This is a trusted **in-process operator** integration, not a browser import endpoint,
login flow, model connector or production deployment. The normal package entry and
disabled Cordis patch are unchanged.

## The gap this fixes

Previously the cumulative source contained the Domain project source, import
coordinator and registry, but `package.json` did not export or include them and the
Host build only copied the namespace bootstrap. Installing that package could not
consume those helpers. The separate export is now:

```js
import { createPlanningHostProjectsPlugin }
  from 'prism-local-workbench/host-projects';
```

`lib/host-projects.mjs` bundles the required PRISM code and only imports Node
built-ins. It does not bundle, acquire or activate official services. The disabled
factory has no injected dependencies and reads no configuration other than the
`enabled` gate. The default package export remains the local namespace bootstrap.

The official deployment must separately choose and mount Storage, the JSON
backend and Domain plugin using an explicitly trusted private root and backend
route. No root is inferred from browser data, the archive, a namespace or the
current directory. The project plugin requests only `storageDomain`, not
`connection`. Its enabled factory receives trusted `defineDomain`, `z`,
`namespace`, `targetLabel`, `onReady`, and optionally `crypto`. Importing a JSON
file does not configure the plugin or create this authority.

## Operator lifecycle

`createPlanningHostProjectsPlugin({enabled:true, ...trustedOptions})` produces a
one-shot Cordis plugin. After the injected official facility has opened and
validated the dedicated `prism_host_projects` domain, `onReady(operator)` receives
a frozen capability. It has:

- `prepareImport(raw)` for the exact complete plaintext preview and append-only
  mapping, without a write.
- `confirmImport(preview, {explicit:true, previewSha256}, isCurrent?)` for one
  approved, still-current write using the same issued preview object.
- `cancelImport(preview)` to invalidate a preparation; this does not undo a write.
- `registerProject({projectId, bridge, catalog})` for a separate, explicit
  registration against the current source. Catalog and bridge come from trusted
  code, not the archive. Saving does not register a project.
- `retireProject(handle)`, `inspect()`, and idempotent asynchronous `close()`.

The caller must present the full preview, target, namespace, preserved and added
history, hashes and scope to the person, obtain their action-specific confirmation,
and pass consent only while that context remains current. **A callback, boolean,
hash, test fixture or UUID is not proof of a real person's consent.** This plugin
does not provide that browser/terminal interaction or an authenticated transport.
The tests explicitly supply synthetic operator consent only.

The plugin owns its source, importer and registries, not the shared Domain
facility, backend, catalogs or bridges. Source changes and disposal retire its
admissions. Closing revokes capabilities before draining outstanding work. A
dependency coming back cannot silently reactivate the old factory; a trusted
operator must create a new plugin and inspect the preserved state. No pending
preview, registration, approval or send is restored. No rollback or automatic
retry is made after a possibly committed write.

Existing fixed resource bounds remain: 4,000,000-byte archive, 100,000 lexical
tokens, depth 64, four importer preparations/previews, one confirmation, and
bounded lifetime attempts. The source has a maximum five-minute lifetime and
100 write attempts; this is a bounded engineering integration, not an unattended
production daemon. The wrapper additionally bounds catalogs and registrations.

## What remains deliberately unavailable

- No browser upload, Host transfer consent UI, authenticated descriptor handoff,
  namespace remapping, per-tab identity, or project-specific access control.
- No Connection dependency, route registration, HTTP listener or model factory.
- No automatic install of a backend or choice of a production data directory.
- No deletion, rewrite or merge of prior project history. Same-namespace initial
  seed or ordered append-only history only.
- No complete paper/PDF/research backup. See `PROJECT-IMPORT-README.md` for the
  project-planning archive coverage and application-snapshot caveat.
- No hardware/power-loss durability, hostile-path, production-permission or
  multiple-writer safety claim. The official JSON backend has no process lock.

The optional registry only connects trusted in-process state. Its document ID is
a selector, not a credential, and a successful registration is not a browser
access grant. Future browser wiring must validate real official authentication,
origin/CSRF policy, request bounds, lifecycle and user-facing transfer/save
confirmation separately. Do not enable a broad owner route merely because the
synthetic plugin test passed.

## Tests

`planning-host-project-plugin.mjs` covers synthetic plugin boundaries and races.
`planning-host-project-package.mjs` performs actual offline `npm pack`, extracts
to a fresh consumer without repository sources or node_modules, and imports the
new export with the feature disabled. It runs no install/lifecycle scripts.

`tests-engineering/planning-host-project-plugin-official.mjs` uses the already
verified fixed official packages and real `ctx.plugin(...)` dependency injection,
not a manually constructed DomainFacility. It validates synthetic confirmation,
real private cloud temporary disk, append revocation, dependency disposal and
explicit recreation. It does not test authentication, browser access or models.

Historical release artifacts are not this build. The latest verification report
identifies which checks were run against the final code and their exact hashes.
