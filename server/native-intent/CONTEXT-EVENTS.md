# system/message 与 request/header：锁定官方校验器的离线扩展

此增量补充 EVENT-CORRELATION.md。普通 createEventCorrelation 默认仍不支持这两类事件；显式使用 createPinnedOfficialEventCorrelation(runtimeRoot,context,{checkpoint?}) 才启用。工厂核对已保存 runtime 0.2.2-rc.1 的1470个可执行/配置文件，只导入官方 snapshotSessionEvent，不创建Session/Agent、不调用网络或模型。校验令牌由模块私有WeakMap签发，任意callback或伪造对象不能启用支持。

## 官方校验器并非完整schema

snapshotSessionEvent/adoptSessionEvent只检查部分event-local data、surface及message形状；没有完整envelope、历史归属、system turn/step/content块或完整header配置检查。因此本模块继续先做有界纯JSON复制、精确字段校验和状态机，不能以官方snapshot返回成功作为通过标准。没有将afterSeq片段重新编号并冒充完整Session seed验证。

真实loop常规顺序为 turn/start→step/start→可选system/message→user/message→request/header→assistant/message→step/end→turn/end。新fixture按此顺序测试。可能出现额外runtime-context用户消息，当前仍拒绝，绝不删掉它再声称单用户对应。

## 本轮已支持

- system：活动turn/step与data.turn/step一致；在目标用户消息前，最多一次；source.kind必须system-prompt；message有唯一ID、role=system、仅text块（允许合法空系统内容）；surface append，无来源引用或重写。
- header：在活动step内、目标用户消息之后、assistant之前，最多一次；没有显式turn字段时通过这个唯一活动步骤范围关联，范围不明确拒绝。
- header精确reason四值与startsSeries=true可选字段；header.config的provider/model必须匹配固定Host上下文，允许reasoningEffort/temperature/maxTokens/stop的严格类型子集；adapterDefaults只允许true且必须有对应config值。
- tools必须缺省；官方校验器要求空tools也省略。任何工具声明、retired system、未知字段、错误类型均拒绝。
- system/user/assistant消息ID不得重复。原文始终保留在snapshot，无日志过滤或序号改写。
- 重启恢复重新加载锁定校验器并重新校验原始事件；普通回读不能改变意图账本unknown或批准。

## 仍未支持

工具/attempt、多个用户或多个step、非文本assistant、surface替换/citations、seeded/fork/subagent历史、额外request/context等未知事件、无法明确活动turn/step的系统或header记录。部分正常官方日志仍会拒绝；本轮不是全事件schema实现，也不是完整生产连接验收。

只允许受信Host提供会话/请求/model/非seeded事实及发送前cursor。事件、快照、provider名称和哈希本身均不能证明身份；不处理真实认证、费用上限或工具授权。结果仅candidate，authority:none且intentMutationAllowed:false。

## 合并与测试

仅修改独立event-correlation核心，新增锁定校验器工厂与离线tests-engineering；无UI/路由/发送模块改动，本地未合并代码不覆盖。保留原基线与失败证据。测试需要显式已有runtime路径，不下载依赖。

node tests-engineering/native-context-events-official.mjs /absolute/path/to/runtime
node tests-engineering/native-context-events-independent.mjs /absolute/path/to/runtime

默认旧事件核心及意图测试也需保留。旧402项是此前基线结果，本轮不声称重新完成全量产品回归。
