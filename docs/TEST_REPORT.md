# 测试报告（1688 智能助手，截至 2026-11-15）

## 1. 环境

- 开发机：Debian 13 x86_64；用户 Chrome（已登录 1688 买家账号 tb714536_66）；扩展解压加载于 `dist/`（扩展 ID `bjnbhbmdnhdnplflhmdbinflhdkfcine`）。
- 模拟逻辑：Vitest + fake-indexeddb（纯逻辑）；真实页面：用户 Chrome + 后台标签实采。

## 2. 自动化测试（全部通过）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（strict） |
| `npm test` | ✅ 34/34 通过（sku-model 13、completeness 8、claim 13） |

覆盖：内联 JSON 解析（skuModel→快照）、完整性校验（不完整不建基准、不覆盖基准）、变化对比（新增/删除/属性/库存增减/归零/恢复/价格，去重键）、连续失败 3 次自动暂停、通知去重、理赔状态机、去重（orderId 唯一索引）、重试上限、验证码/登录失效暂停、任务中断恢复（recoverStaleTasks）、理赔批次汇总逻辑。

## 3. 真实页面验证（2026-11-15，真实 1688 登录态）

商品：`https://detail.1688.com/offer/991485897552.html`（强磁塑胶引磁片，11 SKU）

| 用例 | 结果 | 证据 |
|---|---|---|
| 后台标签机制（不抢焦点、用完关闭） | ✅ 通过 | 扫描时后台打开标签页，用户工作台不受影响 |
| 内联 JSON 采集（matchedBy: skuId） | ✅ 通过 | 日志「商品基准快照已建立 / skuCount: 11」 |
| 首次扫描只建基准、不发通知 | ✅ 通过 | 10:56 首次，无通知 |
| 第二次扫描对比（changes=0） | ✅ 通过 | 10:58 日志「商品扫描完成 / changes: 0」 |
| 连续失败计数成功后清零 | ✅ 通过 | 修复前 2 次失败 → 修复后扫描成功，连续失败归 0，监控列表显示 0 |
| 风控误判修复（baxia 误报） | ✅ 已修复并验证 | 修复前所有扫描误判风控；修复为"仅可见验证界面才算风控"后扫描成功 |
| SKU 监控连续失败 → 自动暂停（3 次） | ✅ 代码+单测；⚠️ 未真实触发（当前环境不会连续失败 3 次） | |
| Popup 一键添加商品 | ⚠️ 未点按验证（代码审查+popup 可渲染） | |
| 扫描不完整不覆盖有效基准 | ✅ 单测 | completeness.test.ts |
| 通知：桌面通知 e2e | ✅ 通过（日志证据） | 备份中 notificationLog：`claim.found` channel=desktop status=sent（10:57，模拟模式发现 6 笔） |
| 通知：Webhook e2e | ✅ 通过 | 本地接收端收到 POST（payload 含 title/body/text，Content-Length 222）；此前发现 Webhook 请求会附带 ambient Cookie → 已修复 `credentials:'omit'` 并复测确认无 Cookie |
| Webhook 域名授权 | ✅ 通过 | chrome.permissions.request 弹窗，用户允许后「已授权该域名」 |
| 数据导出（JSON） | ✅ 通过 | 32KB 备份含 skuProducts/skuSnapshots(4)/claimOrders/claimBatches/tasks/logs/notificationLog/settings |
| 数据导入恢复 | ⚠️ 未跑通（临时隔离实例被用户关闭；merge 路径与导出同为同一代码，导出已验证） | 未解决 |
| 全库重置（重置扩展） | ⚠️ 未实测（会清空本机数据，隔离验证被用户关闭） | 未解决 |
| 理赔扫描→申请→重试→批次汇总（模拟） | ✅ 通过 | claim 单测 13 例 + 总览出现模拟记录（待处理 3 / 今日成功 2） |
| 理赔批次桌面通知 | ✅ 通过（同上，10:57 捕获） | |
| 理赔批次 Webhook 通知 | ✅ 机制与单测；⚠️ 真实触发未观察到（批次汇总通知只在 discovered>0 的批次触发，当前模拟数据已终态） | |
| 浏览器重启恢复任务 / SW 回收恢复 | ⚠️ 未实测 | 需用户协助关闭并重开 Chrome 后确认（alarm 跨重启持久 + 启动 ensureAlarms + recoverStaleTasks） |
| SW 回收后恢复未完成任务 | ⚠️ 未实测 | 同上 |

## 4. 测试中发现并已修复的问题

1. **采集器误判风控（严重）**：1688 商品页始终内嵌 baxia 反爬脚本/隐藏验证码容器，原判定"HTML 含 baxia + 存在相关节点 = 风控"导致 100% 扫描失败。修复：仅当存在**可见**验证/拦截界面（有效尺寸且 display/visibility/opacity 非隐藏）、或 URL 为 punish/verify/captcha、或标题含「验证码/安全验证」时才判定。详见 `docs/1688_PAGES.md` §6。
2. **Webhook 泄露环境 Cookie**：SW 的 fetch 默认携带 ambient cookies，webhook 接收端可能看到用户对本机服务（如 127.0.0.1）的会话 Cookie。修复：`credentials: 'omit'`（两处：`sendNotification`、`testWebhook`），并复验请求无 Cookie。
3. **扩展卡片「错误」**：旧构建遗留的 CSP 违规错误（pages/admin/admin.html 内联事件），已在 chrome://extensions 清除；当前构建无内联事件处理器。
4. **stale 数据误导**：总览"理赔待处理 3 / 今日成功 2"为模拟数据，UI 已标注「模拟模式」。

## 5. 未解决问题 / 真实页面依赖项

1. **真实揽收超时订单未适配**（模块 A 真实链路）：筛选入口已确认（订单列表「待收货」下拉 →「揽收超时」），但控件参数、「去申请理赔」DOM、成功识别、理赔结果回读全部待真实订单出现后适配。`LiveOrderSource`/`LiveClaimExecutor` 明确返回空/needs_human。
2. **真实 SKU 变化未观察**：两次扫描 changes=0；真实变化路径靠单测覆盖。
3. **导入恢复 / 重置扩展 / 浏览器重启恢复**：见 §3 未实测项。
4. **连续失败 3 次自动暂停未真实触发**（修复风控误判后当前每次都成功）。
5. **商品图 Broken image**：og:image 失效被 onerror 隐藏；未替换图源。
6. 用户浏览器「Custom New Tab」把新标签重定向至 `index.yq59.top`（用户已确认可信，保留）。
7. 用户授予了扩展对 `http://127.0.0.1:8765/` 的主机权限（Webhook 测试用）；如不使用本地 Webhook 可在 chrome://extensions 该扩展"详情→权限"中撤销。
8. 备份文件保留在 `~/Downloads/1688-helper-backup-2026-11-15.json`（含商品/快照/理赔记录/设置，属用户私有数据；用户自行决定保留或删除）。

## 6. 结论

- 安装可用、SKU 实采端到端通过、Webhook/桌面通知经本地双通道验证、模拟理赔链路通过。
- 首次交付标注：**真实验证** = 安装/实采/基准/对比/通知双通道/备份导出；**模拟验证** = 理赔全链路/变化对比矩阵/状态机/队列恢复；**待真实订单** = 理赔真实提交；**待用户增量任务书** = 模块 C（HTML 采集推送）。
- 交付前建议：用户协助重启一次 Chrome 确认「浏览器重启后恢复任务」，并确认一次 Webhook 通知实际送达自己的接收端（例如企业微信机器人）。
