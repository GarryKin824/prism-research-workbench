# 异步只读协调保护（默认关闭，尚未接生产）

createTrustedReadGuard 是受信 Host 内部组合点，未添加到package出口、patch或UI。依赖只包含绑定源、Peer、权限决策及只读函数；不存在submit、prompt、权限注册、模型或网络适配器。

冻结绑定精确含 generation/namespace/projectId/paperId/sourceSha256/nodeId/promptVersion/projectVersion/workspaceId/sessionId/provider/model/principalId/policyVersion。每次操作前、每个await后核对相同快照对象和Peer生命期；前置decide和返回结果前的后置decide都必须严格true，异常或拒绝永久关闭。源通知无条件撤销，不因值改回来重开；并发拒绝。所有注入函数必须来自受信Host，不能将外部JSON中的authorized/owner转成这些函数。

只读函数完成不立即放行：再次校验绑定/Peer→立即有界纯JSON复制并冻结→校验→重新决策→最后校验后才返回。不执行结果getter/toJSON；不保留上游可变对象引用。结果拒绝不是取消已发生的远端读取；不隐瞒已读取过、不自动重试。close和abort不能保证上游read实际停止，但迟到结果不能通过本协调器返回。

## 仍有边界

- 这不是官方权限能力生产者，也不证明项目/论文/会话/模型映射真实。测试依赖全合成；真实绑定、权限决策与通知必须由Host提供。
- 官方每次read仍应经过官方网关，后置检查不能替代网关鉴权。本文不对远端状态事务一致性作保证。
- 所有相关变更须同步通知并使用不复用generation/policyVersion/快照。若受信提供者隐瞒变更或做未通知ABA，工具无法从相同对象发现；不得声称防恶意Host。
- 最后检查与同步返回之间无await，但返回后新增撤权无法抹除已交付的数据。调用方展示/保存/采纳前仍须维护自己的生命周期和当前绑定，不能把返回值当持续授权。
- 仅本轮独立保护模块与合成测试，没有改动旧入口、本机或生产部署，没有真实模型请求。
