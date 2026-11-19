# 从离线核心到真实单节点：最小受信部署条件

## 当前判断

不能直接把已有fixture开关改为true来宣称真实接通。锁定DSH 0.2.2-rc.1中确有prompt/events/state/cancel和严格请求schema；但目前模块缺少部署包装、受信项目映射、目标Session授权、真实UI入口与结果存储。Codex/zcode真实连接的官方接口与身份语义本轮未核验，不能套用DSH契约。

本轮仅新增可重跑的**只读部署探针**，不新建模拟按钮、不启用服务，不访问真实模型、凭据、网络或本机。它读取源码和锁定runtime，判断的是代码声明，不是当前在线宿主的事实。

## 可复用与必须分开的边界

- 官方client注入remote.session/workspaces/connection/uiWorkspace可以复用；当前只watch session/create、promptEnabled:false，不能推论可发送。
- 官方网关按sessionId解析Session资源并授权，principal来自服务端invocation。调用官方原型的离线测试不能证明网关授权；不要绕开网关从后台直接调用controller来模拟用户身份。
- Host项目导入/登记/撤销设施可复用，但其routeInstalled/browserAccessGranted当前为false。导入档案不自动授予browser执行权。
- 原始合成HTTP planning fixture与native Remote协议不同，保持分离。合成Remote品牌限制不得删除后直接接真实对象。
- UI result draft内存留存不等于长期研究结果、人工审核或可继续执行的批准。

## 最小架构（建议先只接DSH）

用户在现有论文节点入口操作 → 受信Host单节点协调器 → 官方网关Remote → 官方完整事件读取 → 明确结果采纳 → 独立研究结果存储。

协调器持有真实项目/论文/source/Prompt版本、workspace/session/model映射及持久intent。浏览器只持opaque预览/会话ID，不能自报principal、authorized、任意URL、磁盘路径、provider凭据或绑定事实。任何权限/源/模型/连接代际变化均撤销旧预览和未使用批准，不自动重建。

第一平台跑通一篇一节点后再接第二平台。每个平台明确submit/read/cancel/session-reuse/tools/attachments能力；不支持者显示不可用，不静默退回其他平台。Codex审核+DSH工作+zcode工作是最终目标，不是现有平台标签已经实现的能力。

## 阶段一：下一块应做的实质工程，不发模型

1. 新的默认关闭Host单节点协调器，复用可信项目设施读取实际已登记项目，而不是创建新示例项目。
2. 包装明确的独立Node export/files/build产物；`npm pack --dry-run`与离线解包确认真实可达，默认patch继续disabled。不要对安装者暗中打开新权限。
3. 在已授权宿主中只读获取目标Session资源权限、模型路由、非seeded/空闲状态、源版本；缺项不可预览。无论如何提交入口仍关闭。
4. 使用受信私有存储持久保存预览intent。预览展示准确用户可见正文、上下文选择范围、目标、模式、工具权限和费用限制，不能把Session Prompt冒称最终provider HTTP messages。
5. 验收插件加载/卸载、依赖撤销、连接重置、进程重启、旧预览过期、存储失败/锁冲突。不调用prompt。

这里当前仍缺实际Host映射与部署级存储设计，所以本轮不制造一个返回“已授权”的替身后宣称完成该阶段。

## 阶段二：单次真实提交（必须后续现场授权）

- 通过正式官方网关提交，绑定准确session/requestId与用户明确批准过的全文摘要；保存sending后只提交一次。
- 若入队前后模型配置检查不能原子保证，就应补Host admission约束或明确停在不可发送，不能声称已锁定模型。
- accepted只表示接收；超时、取消、断线都可能已入队，转unknown，不自动重试或用新ID绕过。
- 日志必须固定throughSeq并完整分页，关联rpcId、正文、turn/step、模型和结束原因。不能过滤额外runtime-context、工具、request/context或历史替换后假装支持。
- 用户复核结果后另行采纳到研究节点，保留原始事件、请求、来源及版本。采纳不是审核通过，不自动开始下一节点/下一论文。

## 用户之后需要确认什么

现在不需要用户提供密钥，也不要求启动本机；本机暂停继续遵守。

到真实现场试运行前，一次集中确认：
1. 具体DSH宿主/版本和要使用的账号、workspace及新Session；必要时通过官方安全登录入口完成登录，不在聊天中索取或抄录凭据。
2. 一个具体模型、允许的工具/附件范围及费用或token上限。若宿主无法执行硬上限必须说明，不能假承诺。
3. 单次测试的精确正文/选择的项目材料及接收平台；建议首轮用不含私密信息的固定测试文本，只授权一次，不扩展到后续自动研究。
4. 若安装插件、持久权限或安全设置发生变更，按实际内容单独确认，不以既往“继续开发”替代。

以上是待完成的准入条件，不是本文件已经获得的批准；授权过期/变化后不自动续用。

## 现场验收清单

- 真实官方鉴权和目标资源权限拒绝/撤销测试，不能仅owner fixture。
- 请求预览与实际发送一致、持久requestId一次提交、拒绝跨项目/来源/模型变化。
- 一次正常文本返回、超时unknown后只读恢复、不重发；取消并不假称从未执行。
- 完整原始事件、结果错误归属、用户另行采纳、重启后可查。
- 当前仍缺完整事件覆盖；遇未支持正常事件应保留原文并停在未知，不为了通过验收丢日志。
- 第二平台必须独立核验其官方接口和权限语义，不能复用DSH accepted/messageId假设。

## 只读探针

`node server/native-intent/deployment-audit.mjs /absolute/path/to/locked-runtime`

仅列出已保存官方契约及当前源码装配观察，不枚举环境变量/凭据、构造service、调用RPC或启动网络。输出productionReady固定false，因为它不具备核查生产授权和现场能力的权限/信息；不能拿输出作为开启真实发送的凭证。源码字符串观察也不是完整静态分析，最终装包/现场加载仍必须验证。
