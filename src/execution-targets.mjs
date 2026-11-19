export const EXECUTION_ROLES=Object.freeze(['plan','prompt','work','review','revision']);
export const DSH_TARGET=Object.freeze({platform:'dsh',channel:'host',provider:'deepseek-account',model:'deepseek-flash'});
export const CODEX_READINESS_PATH='/api/prism-codex-readiness';
export const AUTOMATIC_EXECUTION_STATUS_PATH='/api/prism-automatic-model-status';
export const AUTOMATIC_EXECUTION_PATH='/api/prism-automatic-model';
const name=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9 ._:@+()/-]{0,119}$/.test(value)&&value===value.trim();
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  && Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const executionSessionId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value);

export function canonicalExecutionTarget(value) {
  if (!exact(value,['platform','channel','provider','model'])
      || !['dsh','codex','zcode'].includes(value.platform) || !name(value.provider) || !name(value.model)) {
    throw Error('EXECUTION_TARGET_INVALID');
  }
  const {platform,channel,provider,model}=value;
  if (channel==='host' && platform===DSH_TARGET.platform && provider===DSH_TARGET.provider && model===DSH_TARGET.model) return {...DSH_TARGET};
  if (channel==='manual') return {platform,channel,provider,model};
  if (channel==='automatic'&&platform==='codex'&&provider==='openai'&&/^[a-z0-9][a-z0-9._-]{0,119}$/.test(model)) return {platform,channel,provider,model};
  throw Error('EXECUTION_TARGET_INVALID');
}

export function canonicalExecutionChoice(value) {
  if (!exact(value,['role','selectionVersion','platform','channel','provider','model'])
      || !EXECUTION_ROLES.includes(value.role) || !Number.isSafeInteger(value.selectionVersion) || value.selectionVersion<0) {
    throw Error('EXECUTION_TARGET_INVALID');
  }
  const {role,selectionVersion,...target}=value;
  return {...canonicalExecutionTarget(target),role,selectionVersion};
}

export function currentExecutionPreferences(instance) {
  return instance?.executionPreferences??{version:0,assignments:[]};
}

export function canonicalExecutionPreferences(value) {
  const hasAdvanceMode=Object.hasOwn(value??{},'advanceMode');
  if (!exact(value,hasAdvanceMode?['version','assignments','advanceMode']:['version','assignments'])
      || !Number.isSafeInteger(value.version) || value.version<0
      || !Array.isArray(value.assignments) || value.assignments.length>95
      || hasAdvanceMode&&!['manual','auto'].includes(value.advanceMode)
      || value.version===0&&(value.assignments.length||hasAdvanceMode)) {
    throw Error('EXECUTION_PREFERENCES_INVALID');
  }
  const keys=new Set();
  const assignments=value.assignments.map(item=>{
    if (!exact(item,['role','nodeId','target']) || !EXECUTION_ROLES.includes(item.role)
        || item.nodeId!==null && (!executionSessionId(item.nodeId)||item.role==='plan')) throw Error('EXECUTION_PREFERENCES_INVALID');
    const key=JSON.stringify([item.role,item.nodeId]);
    if (keys.has(key)) throw Error('EXECUTION_PREFERENCES_INVALID');
    keys.add(key);
    return {role:item.role,nodeId:item.nodeId,target:canonicalExecutionTarget(item.target)};
  });
  return {version:value.version,assignments,...(hasAdvanceMode?{advanceMode:value.advanceMode}:{})};
}

export function validateExecutionPreferenceHistory(history,current) {
  if (!Array.isArray(history)||history.length<2) throw Error('EXECUTION_PREFERENCES_HISTORY');
  let last=null;
  for(const entry of history){
    if(!exact(entry,['savedUtc','preferences']) || entry.savedUtc===null&&last!==null
        || entry.savedUtc!==null&&(typeof entry.savedUtc!=='string'||!Number.isFinite(Date.parse(entry.savedUtc))
          || new Date(entry.savedUtc).toISOString()!==entry.savedUtc)) throw Error('EXECUTION_PREFERENCES_HISTORY');
    const value=canonicalExecutionPreferences(entry.preferences);
    if(last&&value.version!==last.version+1)throw Error('EXECUTION_PREFERENCES_HISTORY');
    last=value;
  }
  if(JSON.stringify(last)!==JSON.stringify(canonicalExecutionPreferences(current)))throw Error('EXECUTION_PREFERENCES_HISTORY');
}

export function resolveExecutionChoice(preferences,role,nodeId=null) {
  const assignments=preferences.assignments;
  const assigned=(r,n)=>assignments.find(value=>value.role===r&&value.nodeId===n)?.target;
  const target=(nodeId===null?null:assigned(role,nodeId))??assigned(role,null)
    ??(role==='revision'?(assigned('work',nodeId)??assigned('work',null)):role==='prompt'?assigned('plan',null):null)??DSH_TARGET;
  return {...target,role,selectionVersion:preferences.version};
}

export function executionChoiceLabel(value=DSH_TARGET) {
  return ({dsh:'DSH',codex:'Codex',zcode:'Zcode'})[value.platform]+' · '+value.provider+' / '+value.model;
}
