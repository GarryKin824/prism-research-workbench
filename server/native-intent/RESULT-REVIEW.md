# 显式结果复核桥：意图 × 原始事件 × 人工采纳

`createResultReview({adapter,observer})` 是独立Node离线工程API，不是产品UI。只接受本模块签发的执行适配器和事件观察器，不相信外部自报candidate/accepted对象。

## 操作

1. 通过既有adapter.prepare/confirm创建合成accepted意图。
2. 通过事件观察器补齐完整事件，核对单turn/step输出；支持官方上下文事件时使用锁定官方工厂。
3. `preview(requestId)` 再读取账本，要求当前scope、源码正文和授权有效，且意图只能是accepted。prepared/sending/unknown/completed/revoked都不接受。观察器必须candidate-completed，且无断线/超时历史。
4. 完整预览包含意图绑定、原始事件快照、输出、通过的结束序号和摘要，深冻结；不截断正文。
5. 用户明确确认 `adopt(preview,{explicit:true,digest})` 后再次检查全部原文一致，产生 `user-accepted-as-unverified-result` 留存。
6. `exportReceipt(receipt)` 再次校验来源/授权/事件未变，导出JSON；调用者须主动保存。关闭/重启不恢复批准、预览或留存能力；无导入授权通道。

## 保证及边界

- 从preview到adopt/export，重复事件、冲突、来源或授权变化均需重新核查。一次预览仅可采纳一次。
- requestId/sessionId/intentSha256/精确输入正文/provider/model全部匹配。意图摘要包含完整project/paper/source/Prompt/route绑定，不能把其他项目结果套进来。
- 执行适配器内部独占只读hook在读取后、同步复核后检查当前来源；不把异步callback当成已锁定的提交事务。
- **不会写意图账本、触发模型、重新发送、推进下一篇或变更批准。** 即使事件回读完成，unknown意图和有中断历史的观察器均拒绝采纳；需要后续独立人工处置，不用新ID绕过。
- 留存只代表用户愿意保留该合成/未核验结果，不代表科学结论可信、导师审核通过、真实模型执行成功或新的发送权限。authority:none、scientificallyVerified:false、intentMutationAllowed:false。
- 当前只在内存保存复核token，显式导出明文原始证据；不自动永久存储、创建论文结果记录或覆盖现有研究发现。这是可测试接线，不宣称完整产品交互已上线。
- Host resolver/journal/checkpoint仍是受信输入。摘要不是认证或签名；恶意修改/回滚底层文件不能靠该模块证明不存在。外部导入JSON不能恢复token。
- 底层观察器仅支持安全事件子集，复杂工具、多用户、多step、重写/来源引用继续未知。

## 合并

新增result-review.mjs；adapter.mjs和event-correlation.mjs只新增私有签发身份与受保护只读入口，不改发送/恢复策略或已有状态格式。无新存储schema迁移，无UI/路由变更，不覆盖Windows本地未合并功能。运行tests-engineering/result-review-fixture.mjs及result-review-independent.mjs，并回归已有意图/事件测试。真实transport、UI接线、长期结果存储及有权限的unknown处置仍未完成。
