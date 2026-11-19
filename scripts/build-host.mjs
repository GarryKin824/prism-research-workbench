import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
await mkdir(new URL('../lib/',import.meta.url),{recursive:true});
// Without the local operator's account-model config, mount only the namespace bootstrap.
await build({entryPoints:[fileURLToPath(new URL('../src/local-host.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../lib/index.js',import.meta.url)),bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'inline'});
// Separately imported trusted-code seam. Bundle PRISM source only; the caller owns
// the official schema/facility providers, backend selection and lifecycle.
await build({entryPoints:[fileURLToPath(new URL('../server/planning-host/project-plugin.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../lib/host-projects.mjs',import.meta.url)),bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'inline'});
// Separate non-mounted import handler. It refuses ordinary shared browser Peers.
await build({entryPoints:[fileURLToPath(new URL('../server/planning-host/project-import-endpoint.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../lib/host-project-import.mjs',import.meta.url)),bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'inline'});
// Portable state machine only. No production transport, UI activation or globals.
await build({entryPoints:[fileURLToPath(new URL('../src/project-import-client.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../lib/project-import-client.mjs',import.meta.url)),bundle:true,platform:'browser',format:'esm',target:'es2022',legalComments:'inline'});

// Default-off read-only Host composition seam; no automatic patch activation.
await build({entryPoints:[fileURLToPath(new URL('../server/native-intent/readonly-node.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../lib/host-readonly-node.mjs',import.meta.url)),bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'inline'});
