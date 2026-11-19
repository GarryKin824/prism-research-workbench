export function job(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw Error('任务编号只允许字母、数字、下划线和短横线');return {schema:'prism-offline-job-v1',actionId:id,mode:'offline',fixture:'synthetic-only',syntheticOnly:true};}
export function validateJob(value){if(JSON.stringify(value)!==JSON.stringify(job(value?.actionId)))throw Error('任务必须是完整、未经更改的离线合成任务');return value;}
export function report(value,expectedId){
 if(!value||Object.keys(value).sort().join(',')!=='actionId,eventCount,mode,output,platformConnected,researchAccepted,schema,state,syntheticOnly'||value.schema!=='prism-offline-report-v1'||value.actionId!==expectedId||value.mode!=='offline'||value.syntheticOnly!==true||value.platformConnected!==false||value.researchAccepted!==false||!['offline_turn_verified','unknown'].includes(value.state)||!Number.isInteger(value.eventCount)||value.eventCount<0||value.eventCount>256||(value.state==='offline_turn_verified'&&value.eventCount===0)||value.output!==(value.state==='offline_turn_verified'?'OFFLINE RESULT':''))throw Error('报告与当前任务不匹配，或包含未经支持的执行状态');
 return value;
}
