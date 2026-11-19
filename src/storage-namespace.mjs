/** Logical localStorage separation only; not an account/security boundary. */
export function resolveProfileConfig(raw,bootstrap){
 const input=raw??{};
 if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='storageNamespace'))throw Error('INVALID_PROFILE_STORAGE_CONFIG');
 if(bootstrap!==undefined&&(typeof bootstrap!=='object'||Array.isArray(bootstrap)||Object.keys(bootstrap).sort().join(',')!=='required,storageNamespace'||bootstrap.required!==true))throw Error('INVALID_PROFILE_BOOTSTRAP');
 if(input.storageNamespace!==undefined&&bootstrap?.storageNamespace!==undefined&&input.storageNamespace!==bootstrap.storageNamespace)throw Error('PROFILE_NAMESPACE_CONFLICT');
 const id=input.storageNamespace??bootstrap?.storageNamespace;
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw Error('PROFILE_NAMESPACE_REQUIRED');
 return Object.freeze({storageNamespace:id});
}
export function profileStorageKey(config){return 'prism-native-profile-v1:'+resolveProfileConfig(config).storageNamespace;}
