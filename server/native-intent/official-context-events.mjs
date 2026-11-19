/** Offline, lock-verified official validation plus strict PRISM subset. No services/transport. */
import {loadPinnedContextValidator} from './context-event-validator.mjs';
import {createEventCorrelation} from './event-correlation.mjs';
export async function createPinnedOfficialEventCorrelation(runtimeRoot,expected,options={}){
 const contextValidator=await loadPinnedContextValidator(runtimeRoot);
 return createEventCorrelation(expected,{checkpoint:options.checkpoint??null,contextValidator});
}
