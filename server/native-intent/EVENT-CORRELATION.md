# 官方异步事件关联：离线只读核心

本模块 `event-correlation.mjs` 与意图发送适配器分离，不注册官方 Remote，不调用模型、不修改任何意图账本。`accepted` 不输入本模块，因其不证明结果。所有输出均 `fixtureOnly:true, authority:none, intentMutationAllowed:false`。

## 受信输入

建立观察器需Host提供固定 sessionId、requestId、intentSha256、精确正文、发送前已核验空闲cursor(afterSeq)、provider/model，以及 isSeeded:false。它们必须来自受信项目/会话/意图映射，不能以浏览器表单或回填JSON自报代替。模块检查一致性，不实施登录或证明这些事实。

输入是官方 `SessionHistoryRecord` 的 `{type:'event',event:{type,seq,time,data,...}}` 形式。官方 user/message 的data直接是UserMessage；assistant/message的data才含turn/step/message/stream。turn/start先于用户输入。session.events页records正序；本模块允许调用方离线汇总乱序页，但要求从afterSeq+1到结束的每个seq连续且无冲突。上层仍需固定官方throughSeq并遍历hasMore，确保所选完整区间，不可用wait.output或live chunk代替完整durable records。

## 接受的保守子集

- 非seeded普通会话、单一turn、单一目标user/message（rpcId及全文完全匹配）。批量入队或额外user一律未知，不能将同turn输出分给某一条。
- 单step、单个文本assistant，provider/model匹配；显式step/end、turn/end.completed，完整连续序列。
- 完整重复事件幂等；同seq不同内容永久冲突。未到齐是gap，不输出完成结果。
- surface必须append；sourceEventSeqs、replacement、工具、attempt、interrupted assistant及未知扩展事件不支持，拒绝认定完成。
- request/header及system/message当前保留原文但拒绝认定完成：尚未实现它们的完整schema/归属校验。正常官方日志也可能包含这些事件，因此本轮是可独立测试的安全子集核心，不是完整生产事件阅读器。后续须加入官方解析器与完整上下文验收，而非删掉日志来让测试通过。
- error/aborted/blocked/max-tokens/interrupted/forked结束只给candidate-incomplete及原因，不输出可采用结果。错turn/step/模型/会话未知。目标turn之后还带有其他事件也保守拒绝，调用方应固定精确目标结束切片。

`feed`用于增量补齐。`interrupt('disconnect'|'timeout')`令观察状态unknown；普通feed不取消这一标记。`readback`必须含所有已见事件的完全一致前缀才能再次报告候选。即使回读拿到candidate-completed，interruption历史仍保留，**意图账本的unknown保持不变，不允许重新提交或恢复批准**。

## 恢复与限制

`snapshot()` 导出原始事件与固定上下文；用相同expected context重建时重新校验，跨范围拒绝。无自动写盘/导入授权，文件应由Host受信存储管理。快照不是签名，恶意编辑或回滚无法靠数据结构检查认证；不要把导入文件直接当生产可信日志。恢复不保存“已完成”派生结论，而是重新归约事件。

最多2000事件、约2MB、32层。拒绝getter/toJSON、稀疏数组、原型键等非纯JSON对象。乱序缓冲不是网络重连实现；超时/断线由调用者明确通知，内部没有真实网络或计时器。fake source由内部工厂创建，不能注入任意真实read函数。

本轮没有调用官方服务；只从先前锁定SDK声明核对形状并用合成事件测试。不能声称兼容全部官方事件或真实认证已通过。官方声明文件指纹单列记录，不等同网络重新认证。

## 运行与合并

运行 tests-engineering/native-event-correlation.mjs 和 native-event-independent.mjs。新增模块/测试/说明，不修改既有发送适配器、Host路由、UI或本地未合并改动。既有基线测试结果不冒称本轮全量回归。
