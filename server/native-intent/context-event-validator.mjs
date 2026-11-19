/** Only validators minted after checking the retained runtime lock are accepted. */
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {verifyRuntime} from '../planning-http/verify-runtime.mjs';
const validators=new WeakMap();
export async function loadPinnedContextValidator(runtimeRoot){
 const runtime=await verifyRuntime(runtimeRoot);
 const {snapshotSessionEvent}=await import(pathToFileURL(join(runtime.root,'node_modules/@deepseek-ai/dsh-session/lib/index.js')).href);
 const token=Object.freeze({runtimeVersion:runtime.version,fixtureOnly:true});validators.set(token,snapshotSessionEvent);return token;
}
export function validatePinnedContextEvent(token,event){const validate=validators.get(token);if(!validate)throw Error('PINNED_CONTEXT_VALIDATOR_REQUIRED');validate(event)}
