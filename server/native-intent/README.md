# 离线 Remote 单节点意图适配器

这是独立 Node 工程模块，默认关闭，**没有接入 UI、Host RPC、SDK 或真实模型**。只能接受本模块 `createSyntheticRemote` 创建的固定合成 Remote，任意外部 remote 被拒绝。不要移除品牌检查后直接上线。

## 使用与状态

`createFileJournal(absoluteTrustedDirectory)` 建立 fixture 账本，`createNativeIntentAdapter({enabled:true,remote,journal,resolve})` 固定建立时的完整范围。resolve 是受信 Host 代码，返回 `{binding,text,authorized}`；binding 包括 namespace/project/paper/source/node/Prompt/project版本、workspace/session/provider/model/generation。所有值为有界字符串。不是浏览器 JSON 的信任入口。

1. `prepare()` 从 resolver 取得正文，生成唯一 requestId，写入 prepared 后返回完整明文预览和摘要；不发送。
2. `confirm(preview,{explicit:true,sha256})` 必须使用此实例签发的预览。重新核对来源和批准，先持久写 sending 再调用合成 Remote 一次。重复确认不重发。
3. accepted 只表示合成接收，不包含研究结果。中途撤销/关闭/错误进入 unknown，写入含糊则整个实例停止写入和发送。
4. `recover()` 仅处理创建实例固定范围：prepared→revoked，sending→unknown；不会恢复批准或重发。accepted/unknown 可读回。
5. `reconcile(requestId)` 仅接受合成观察的精确 requestId/session/请求摘要/完成标志/事件 ID，并重新核对正文和权限。完成仅是合成状态，不是科学验证或人工审核；authority 始终 none。

同 session 存在 prepared/sending/accepted/unknown 时，不能再生成新请求 ID 绕过未决状态，即使重连改变 generation 或源版本。旧代际未决只能保留核查，当前尚无跨代际恢复提交功能；需后续受信维护流程解决，不自动解锁。completed/revoked 后可明确重新准备。不同范围共用账本时只显示/恢复自己范围，文件总体结构与摘要损坏仍整本拒绝，绝不覆盖修补。

## 信任与恢复边界

- resolver/journal 是受信进程内依赖，不是认证机制。绑定摘要不是身份认证；浏览器不能自称 authorized。
- `generation` 必须是受信宿主永不复用的来源/权限生命周期版本。宿主应在撤销、源替换、权限变化时关闭实例并推进代际。当前模块仅检查调用边界，不声称自动订阅官方事件；若宿主隐瞒 A→B→A，不可能凭两次快照发现。
- 模块不管理模型配置、工具权限、费用、附件、用户凭据或事件分页。真实 Remote 观察不能直接用测试中的 complete=true；必须另行构建官方事件关联验证。
- CAS 文件存储写临时文件+fsync+rename+目录fsync，独占 write.lock；锁冲突/任何写异常均停止。崩溃残锁不自动删除，要由受信维护流程核对实际账本后处理。未知持久化不能证明未写入，必须新实例读取。
- 存储是云端 Linux 合成文件验收，不宣称 Windows 文件系统、断电硬件持久性、多主机数据库或恶意本地进程隔离。目录及祖先路径所有权由 Host 保证；不要放到不可信共享目录。
- 摘要仅检查请求/绑定一致性，不认证文件，也不保护status/result免于恶意编辑或整本回滚；受信目录是前提。
- 账本保留完整明文，最多100条/4MB；没有自动删除、裁剪或迁移。请求正文最多262144字符且最终账本有字节限制。v1严格解析，无自动兼容猜测。
- 关闭时不能保证撤销已经入队的操作；unknown 不自动重试。当前没有自动超时计时器，合成defer通过release或关闭后回执触发结算，不是生产超时实现。

## 验证与合并

运行 `node tests-engineering/native-intent-fixture.mjs` 及独立测试。仅新增 server/native-intent 和 tests-engineering 文件，不修改既有生产模块、构建、路由、原生promptEnabled或本地未合并功能。旧402项生产回归是此前基线结果；本轮测试单独记录，不伪称已经接通真实AI。

下一步：在保持真实发送关闭的前提下，用官方事件格式构建结果关联器、持久状态恢复和真正受信项目/会话映射；然后做Host权限集成。真实调用必须另有明确授权和有限请求范围。
