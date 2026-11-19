# 工作台 UI 接线评估与默认关闭的复核会话接口

## 本轮不是页面功能交付

现有工作台是浏览器bundle；复核桥依赖Node crypto、私有签发对象及受保护意图读取入口。当前没有完成受信的浏览器→Host结果复核路由。将任意JSON作为已核验结果塞进页面会绕开这些保护；把Node文件系统/SDK套到浏览器或添加网络桥也超出此次离线边界。

因此本轮没有新增可点的工作台面板，也未声称UI已接通。先完成可复用 `createFixtureReviewUiSession` 接口，实际复用已有合成adapter、事件关联与显式复核桥，不是手写一个“success:true”样例。

## 固定合成闭环

默认disabled，无方法执行，不读取用户数据。显式enabled后也只有固定合成项目/论文/正文，scope始终fixed-synthetic-not-current-user-project。

- preview：首次才初始化固定fake Remote意图和事件，调用真实离线review.preview，返回完整证据及一次性preview token。刷新预览不重复合成提交，旧token失效。
- adopt：必须explicit=true及当前token，调用review.adopt，采纳为独立可编辑草稿，不写论文或执行账本。
- editDraft：要求expectedRevision，与原始输出分离；Markdown/LaTeX原字符串保留，不执行或渲染HTML。
- exportDraft：要求当前版本，复核原始receipt后导出原文证据+编辑草稿、版本和已编辑标记；原始输出不被覆盖。
- close：草稿存在须明确discardDraft；只有严格布尔true才代表放弃；字符串等truthy值拒绝。关闭不能恢复预览、批准、草稿或token，导出后由调用者保管。

所有状态只在内存。没有自动保存、上传、下载、剪贴板、模型、网络或凭据读取。inspectFixture仅报告固定fixture计数与能力标记，不声称实际生产安全监控。合成发送仅初始化一次，意图仍accepted，复核不解锁或推进执行。

## 未来 UI 契约与缺口

真正面板可复用返回数据但必须先完成以下工程：
1. 用受信Host路由持有会话实例，绑定调用者/连接代际；浏览器只拿opaque ID，不能自供adapter、observer、scope或批准对象。
2. 默认关闭入口、清晰固定合成标签；先完整展示scope/原文/事件/状态，再明确采纳。展示markdown/latex使用既有受限渲染器。
3. busy时禁用重复操作；关闭/导航保留或明确放弃草稿；草稿必须显示尚未永久保存。
4. 接受返回状态时核验请求代际，A→B→A不能应用旧回执；导出由既有用户手势下载路径处理。
5. UI直接接入实际项目、长期保存与真实模型不是本接口的现成能力，需要单独授权/设计/验收，不能仅取消fixture标记。

测试为Node离线接口验收，非浏览器视觉/交互验收；未改lib/client.js、UI代码、Host RPC、生产路由、本地分支或已有账本schema。旧402项是历史产品基线，不冒称此次重跑。
