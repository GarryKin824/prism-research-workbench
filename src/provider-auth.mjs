/** Deliberately no settings/account/credential RPC and no authentication URLs. */
export function providerAuthBoundary(){return Object.freeze({officialAuthAvailable:false,credentialInputAllowed:false,configuredMeansVerified:false,externalSendDefault:false,tools:0,cost:'unknown',reason:'官方安全认证桥接未接通；Models 页面可能自动 discover，不能作为无网络副作用的配置入口。PRISM 不接收密钥，不读取 credentials/settings 原文。'})}
