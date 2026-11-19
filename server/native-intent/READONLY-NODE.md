# 默认关闭 Host 单节点只读协调器

入口 `prism-local-workbench/host-readonly-node`，命名导出 `createReadonlyNodeCoordinator` 和 `projectOfficialReadonlyState`。正常 patch、UI、原项目包入口不启用它；无任何 submit/prompt 方法，不能用预览授权发送。

## 已闭环的独立环节

受信 Host 可传入已有项目源（与 planning-host 域源相同 getSnapshot/subscribe 协议），按 namespace/projectId/nodeId 从最新已校验项目版本取出节点和 Prompt。不是另造示例项目，也不相信浏览器自带 Prompt。source 快照必须冻结、身份稳定、变更同步通知；任意通知永久撤销当前协调器，重新注册必须新建。

同时传入 Host 私有 capability，包含 getSnapshot/subscribe/readState。快照精确绑定 generation、namespace、projectId、nodeId、sessionId、workspaceId、provider、model、principalId、readStateAllowed:true、isSeeded:false。generation 必须每次连接/权限/目标变化后更新且不复用。没有权限、错误项目/节点、缺失身份、seeded 或不稳定快照拒绝工作。readState 仅收到固定 sessionId，浏览器不得指定身份或能力。

`preview()` 校验源→读取已保存项目→只读 state→再次校验源和能力；异步时撤销、换源、并发读取均拒绝。返回冻结的完整 Prompt、源版本及目标，明确仅项目模板节点、没有论文正文、持久 intent、模型结果、执行或审批权。没有 cache、自动重试、持久化或后台任务。close 永久撤销。

`projectOfficialReadonlyState` 是独立纯函数：只接受官方 session/state 五字段(cursor/active/running/queue/pendingInput)，且必须 active（有live Agent）、not running、明确空数组队列和无 pendingInput；queue:null 不是空队列。允许 cursor=-1 空历史。它附加由 Host 提供的目标映射而不是从 state 猜出身份。

## 重要信任边界

这是**可装包的受信代码组合点，不是已经接通的官方 Host 插件服务**。工厂不能证明注入的 JavaScript 函数真实来自官方网关。不得把 browser JSON 的 `readStateAllowed:true`、`principalId` 或本测试假能力视为鉴权；这些字段不是新官方协议。生产宿主必须在官方网关权限检查后构造并私有持有能力，在失权时同步撤销。不得把 factory/能力传入普通共享 browser Peer，也不得从调用者选择 URL、凭据、目录或 principal。

官方 `remote.session.state({sessionId})` 与 `events({address:{kind:'session',sessionId},…})` 的资源由网关解析检查；调用controller原型不是鉴权。state 无 sessionId、workspace、模型、isSeeded。当前没有实现可以信任的这些映射，因此未提供真实 transport 或自动适配，也未把两个读操作说成原子事务。合成测试验证拒绝/隔离逻辑，不验证真实账户权限。

## 仍缺的部署项

1. 在正式 Host 生命周期中接入官方授权后的 session 资源能力；隔离真实 principal、workspace、session、model、generation，并处理权限/连接变化。先只读，仍不赋予 prompt 权限。
2. 与真实论文执行数据关联；本轮只读取项目模板节点，不能替代 paper/source 版本绑定。
3. 持久 intent 与 UI 预览/采纳流程、权限撤销回读、官方完整事件支持、结果保存。当前预览重启即失效，不是执行意图，也不允许发送。
4. 真实现场认证、单次准确目标/内容/模型/工具/费用授权，以及账户资源拒绝/撤销验收。现在无需用户登录或提供密钥。

本轮无真实网络/模型请求、凭据、本机操作或发布。包的独立出口可离线加载不等于官方插件现场加载成功；旧全量402项结果为历史，本轮仅工程合成和装包验证。
