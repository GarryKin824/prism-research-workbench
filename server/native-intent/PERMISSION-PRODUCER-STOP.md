# 受信能力生产者：停用结论及最短补齐条件

本轮没有增加返回 authorized:true 的伪生产者，没有打开上一版只读入口。原因是已锁定官方分发包并不包含 gateway 所依赖的 `@deepseek-ai/dsh-api-remote-access` 实现；不能核验它的真实权限策略、撤销订阅、生命周期及原子性。独立工厂的 JavaScript 注入点不是官方身份凭证。

## 可证实的官方边界

`dsh-api-gateway/lib/types/index.js` 的 prepareInvocation 在lookup前：检查peer存活、严格参数、解析session资源，再对非owner调用remoteAccess.decide。拒绝发生在service lookup之前。owner分支略过决策，故绝不能从普通JSON创建owner。Peer的principal必须来自Host正式认证入口。

`dsh-api-gateway/lib/types/access.js` 的 callResources 使用官方注册resource resolver。session/state以顶层sessionId、session/events以address解析。资源解析失败不能降级为global或允许。不能用另一项目可读session的权限给当前项目登记映射。

上述接点不能证明：真实登录；project拥有哪一session；workspace归属；模型锁定；isSeeded；权限变更通知完整性。state不含这些信息；events也不含session header。principalOf的undefined同时可能表示owner或缺少invocation，不能用其作为已认证owner证据。

## 等待真实官方能力之前的状态

上一版 `createReadonlyNodeCoordinator` 是默认关闭、无发送方法的受信代码组合点。本轮不为它连接真实能力。已保存的合成scope、bool、hash、epoch都不是生产授权令牌；不能据此授予浏览器或其他项目任何权限。离线gateway方法测试只验证合成条件下拒绝顺序，不模拟登录成功。

## 未来绑定注册所需的事实

1. 由宿主认证产生且可撤销的Peer，明确principal及连接generation；断线、销毁、权限变化同步撤销绑定，任何await后重新检查。
2. 完整官方remoteAccess实现/可审计接口，针对具体session与具体read action决策；每次调用必须仍经官方网关，不能长期缓存allow。
3. 宿主服务证实workspace/session/model/seeded事实；绑定来源及版本。Project/paper/node/source/Prompt范围从已登记项目源读取，不从浏览器自报。
4. 明确一项目的一论文节点到session的映射；重绑须撤销旧generation、旧预览及未消费批准，避免跨项目共享或重启恢复旧权限。
5. 即使全部读权限成立也不增加prompt权限。提交需单独准确正文/目标/工具/费用确认、持久intent与一次发送策略。

目前不需要用户提供凭据或开启本机。需要先获得完整可信官方部署环境和相应权限接口，再决定集中现场登录与授权验收。没有此环境前继续制造模拟授权按钮不会推进真实接入。

## 后续生产者接口验收表（未实现）

|事实|必须由谁提供|不能接受的替代|失效时行为|
|---|---|---|---|
|principal/Peer|正式认证后的Host invocation/Peer|browser传入owner、principalOf(undefined)|销毁绑定，不重新模拟owner|
|project/node/source版本|已登记项目源、稳定版本|浏览器上传scope标签|冻结并撤销旧预览|
|paper与正文|项目内论文库及源引用|另项目同DOI自动借用|重新明确选择材料|
|session/workspace|官方可信session元数据及创建归属|当前浏览器标签/显示名|撤销，不静默切会话|
|provider/model|官方可信配置及配置变化代际|UI下拉框字符串|重做准确预览|
|read action权限|官方网关逐调用决策|保存一次allow或自造bool|拒绝并丢弃晚到结果|
|权限撤销|完整官方权限生命周期|只有连接正常或ping成功|未知即不可用|
|发送权限|独立prompt决策+用户准确批准|只读可访问/导入成功|不能提交|

Host持久化只能保存非授权性质的用户映射意图与版本。重启后不能从磁盘恢复authenticated/authorized状态；必须重新通过真实Host认证、官方资源读取与权限检查。暂停/重启/撤销后不自动扩展scope或启动请求。

## 实测参数细节

官方 strictCodec 拒绝嵌套伪principal，但实际 prepareInvocation 使用参数codec，嵌套未知principal会被剥除后再进入权限决策，而不是一概报输入错误。决定身份仍来自Peer；顶层伪principal被参数集合校验拒绝。测试分别覆盖这两种情况，不能把严格codec测试等同完整网关输入路径。
