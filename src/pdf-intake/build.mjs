import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';
import workerInput from './vendor/worker-input-source.mjs';
if(process.env.ESBUILD_BINARY_PATH)throw Error('GLOBAL_ESBUILD_BINARY_OVERRIDE_REFUSED');
const base=fileURLToPath(new URL('./',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
// Fixed sourcefile/working directory gives identical output in unrelated checkout paths.
const worker=await esbuild.build({absWorkingDir:base,stdin:{contents:workerInput,sourcefile:'locked-pdfjs-worker.mjs',resolveDir:base},bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,legalComments:'inline',minify:false});
const workerText=worker.outputFiles[0].text;
await writeFile(path.join(base,'vendor/worker-classic-source.mjs'),'// Derived via pinned esbuild from bundled, locked PDF.js worker input; not original upstream bytes.\nexport default '+JSON.stringify(workerText)+';\n');
await writeFile(path.join(base,'vendor/REBUILD.json'),JSON.stringify({esbuildVersion:esbuild.version,inputSha256:sha(workerInput),outputSha256:sha(workerText),warnings:worker.warnings.map(w=>({id:w.id,text:w.text})),note:'Bundled distribution input; PDF.js original authors/licenses retained in licenses. Network-disabled wrapper preexists in locked input.'},null,2)+'\n');
await esbuild.build({absWorkingDir:base,entryPoints:['child-entry.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'child-bundle.mjs',legalComments:'inline',minify:false});
const bundle=(await readFile(path.join(base,'child-bundle.mjs'),'utf8')).replace(/<\/script/gi,'<\\/script'),hash=createHash('sha256').update(bundle).digest('base64');
await writeFile(path.join(base,'child-source.mjs'),'export const scriptHash='+JSON.stringify(hash)+';\nexport default '+JSON.stringify(bundle)+';\n');
await esbuild.build({absWorkingDir:base,entryPoints:['controller.mjs'],bundle:true,format:'iife',globalName:'PrismPdfIntake',platform:'browser',target:'es2022',outfile:'runtime.iife.js',legalComments:'inline',minify:false});
