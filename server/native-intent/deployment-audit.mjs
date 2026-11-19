/** Read-only source/runtime contract probe, NOT a deployment readiness attestation.
 * No service construction, discovery, credentials, environment enumeration or RPC.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {verifyRuntime} from '../planning-http/verify-runtime.mjs';
export async function auditNativeDeployment(runtimeRoot){
 const runtime=await verifyRuntime(runtimeRoot);
 const {TYPERT}=await import(pathToFileURL(join(runtime.root,'node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js')).href);
 const methods=Array.isArray(TYPERT.invocations)?Object.fromEntries(TYPERT.invocations.map(x=>[x.namespace+'/'+x.method,x])):TYPERT.invocations,required=['session/prompt','session/events','session/state','session/cancel'];
 const available=required.filter(k=>Object.hasOwn(methods,k));
 if(available.length!==required.length)throw Error('OFFICIAL_REMOTE_CONTRACT_MISSING');
 const prompt=methods['session/prompt'],schema=prompt.parameters[0].strictCodec.create();
 const good={requestId:'offline-audit-only',sessionId:'offline-audit-only',mode:'queue',content:[{type:'text',text:'Never submitted'}]};
 if(!schema.safeParse(good).success||schema.safeParse({sessionId:good.sessionId,contentBlocks:good.content}).success||schema.safeParse({...good,principal:{kind:'owner'}}).success)throw Error('OFFICIAL_REMOTE_CONTRACT_DRIFT');
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 const source=await readFile(join(root,'src/native-sessions.mjs'),'utf8');
 const wiring=await readFile(join(root,'src/native-session-wiring.mjs'),'utf8');
 const browser=await readFile(join(root,'scripts/build-client.mjs'),'utf8');
 const hostBuild=await readFile(join(root,'scripts/build-host.mjs'),'utf8');
 return {
 schema:'prism-native-deployment-source-audit/v1',runtimeVersion:runtime.version,verifiedRuntimeFiles:runtime.verifiedFiles,
 officialMethods:available,promptContract:{requestFields:['requestId','sessionId','mode','content'],acknowledgement:'accepted-only-not-completed',strictCodecChecked:true,requestSent:false},
 sourceObservations:{nativePromptDisabled:source.includes('promptEnabled:false'),onlyCreateWatcherObserved:wiring.includes("'session/create'")&&!wiring.includes("'session/prompt'"),reviewUiSessionInBrowserBundle:browser.includes('review-ui-session'),nativeIntentInHostBuild:hostBuild.includes('native-intent'),nativeIntentPackageExport:Object.keys(pkg.exports??{}).some(k=>k.includes('native-intent'))},
 productionReady:false,liveConnectionVerified:false,authorizationVerified:false,modelVerified:false,
 blockers:[
 'No authenticated review UI Host route or browser panel is composed',
 'No production Remote transport; fixed synthetic factories intentionally reject arbitrary Remote objects',
 'No authoritative project-to-workspace/session/model mapping plus permission lifetime has been verified',
 'No production-grade durable intent store or cross-generation unknown reconciliation has been validated',
 'Result event subset still rejects unsupported normal/complex logs; full operational coverage unverified',
 'No explicit live request destination/content/model/budget/allowed-tools approval or现场验收 is recorded by this probe'
 ],
 constraints:{serviceConstructed:false,credentialsRead:false,rpcCalled:false,networkUsed:false,userComputerAccessed:false},
 limitation:'Static source observations and pinned schema checks only. These flags are not authentication evidence, live capability discovery, or permission to enable sending.'
 };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])console.log(JSON.stringify(await auditNativeDeployment(process.argv[2]),null,2));
