# 测试报告（1688 智能助手，截至 2026-11-16）

## 1. 环境

- 开发机：Debian 13 x86_64；用户 Chrome（已登录 1688 买家账号）；扩展解压加载于 `dist/`（扩展 ID `bjnbhbmdnhdnplflhmdbinflhdkfcine`）。
- 模拟逻辑：Vitest + fake-indexeddb（纯逻辑）；真实页面：用户 Chrome + 后台标签实采。

## 2. 自动化测试（全部通过）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（strict） |
| `npm test` | ✅ 94/94 通过（含模块 D import1688 用例；原 46 → 74 → 76 → 83 → 94 随模块 D 与重复导入防护递增） |

覆盖：内联 JSON 解析（skuModel→快照）、完整性校验（不完整不建基准、不覆盖基准）、变化对比（新增/删除/属性/库存增减/归零/恢复/价格，去重键）、连续失败 3 次自动暂停（monitor：暂停+通知+无效快照不参与比较+成功清零）、首次建基准不通知、重复扫描不重复通知同一变化、备份导出→导入往返（merge/replace/真实备份文件/拒绝非本扩展备份）、通知去重、理赔状态机、去重（orderId 唯一索引）、重试上限、验证码/登录失效暂停、任务中断恢复（recoverStaleTasks）、理赔批次汇总逻辑。

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
| SKU 监控连续失败 → 自动暂停（3 次） | ✅ 单测（monitor.test.ts 8 例：暂停+通知+无效快照不参与比较+成功清零+暂停后停止扫描+风控/登录失效路径） | 真实环境未自然触发（修复风控误判后每次都成功） |
| Popup 一键添加商品 | ⚠️ 未点按验证（代码审查+popup 可渲染） | |
| 扫描不完整不覆盖有效基准 | ✅ 单测 | completeness.test.ts |
| 通知：桌面通知 e2e | ✅ 通过（日志证据） | 备份中 notificationLog：`claim.found` channel=desktop status=sent（10:57，模拟模式发现 6 笔） |
| 通知：Webhook e2e | ✅ 通过 | 本地接收端收到 POST（payload 含 title/body/text，Content-Length 222）；此前发现 Webhook 请求会附带 ambient Cookie → 已修复 `credentials:'omit'` 并复测确认无 Cookie |
| Webhook 域名授权 | ✅ 通过 | chrome.permissions.request 弹窗，用户允许后「已授权该域名」 |
| 数据导出（JSON） | ✅ 通过 | 32KB 备份含 skuProducts/skuSnapshots(4)/claimOrders/claimBatches/tasks/logs/notificationLog/settings |
| 数据导入恢复 | ✅ DB 层单测（backup.test.ts：replace/merge/真实备份文件往返/拒绝非本扩展备份）；⚠️ 浏览器文件选择 UI 未实测 | UI 路径未验证 |
| 全库重置（重置扩展） | ⚠️ 未实测（会清空本机数据，隔离验证被用户关闭） | 未解决 |
| 理赔扫描→申请→重试→批次汇总（模拟） | ✅ 通过 | claim 单测 13 例 + 总览出现模拟记录（待处理 3 / 今日成功 2） |
| 理赔批次桌面通知 | ✅ 通过（同上，10:57 捕获） | |
| 理赔批次 Webhook 通知 | ✅ 机制与单测；⚠️ 真实触发未观察到（批次汇总通知只在 discovered>0 的批次触发，当前模拟数据已终态） | |
| 浏览器/电脑重启后恢复任务 | ✅ 2026-11-15 实测（电脑重启）：SW 自动启动（13:58），自动补建 alarm 并执行 SKU 扫描（最近扫描 13:59）与理赔扫描；监控商品/11 SKU/快照/52 条日志全部持久保留；用户标签页无干扰 | 重启验证通过 |
| SW 回收后恢复未完成任务 | ⚠️ 无法直接观察 SW 回收过程（单测 `recoverStaleTasks` 覆盖）；电脑/浏览器重启恢复已实测 ✅ | — |

## 4. 测试中发现并已修复的问题

1. **采集器误判风控（严重）**：1688 商品页始终内嵌 baxia 反爬脚本/隐藏验证码容器，原判定"HTML 含 baxia + 存在相关节点 = 风控"导致 100% 扫描失败。修复：仅当存在**可见**验证/拦截界面（有效尺寸且 display/visibility/opacity 非隐藏）、或 URL 为 punish/verify/captcha、或标题含「验证码/安全验证」时才判定。详见 `docs/1688_PAGES.md` §6。
2. **Webhook 泄露环境 Cookie**：SW 的 fetch 默认携带 ambient cookies，webhook 接收端可能看到用户对本机服务（如 127.0.0.1）的会话 Cookie。修复：`credentials: 'omit'`（两处：`sendNotification`、`testWebhook`），并复验请求无 Cookie。
3. **扩展卡片「错误」**：旧构建遗留的 CSP 违规错误（pages/admin/admin.html 内联事件），已在 chrome://extensions 清除；当前构建无内联事件处理器。
4. **stale 数据误导**：总览"理赔待处理 3 / 今日成功 2"为模拟数据，UI 已标注「模拟模式」。

## 5. 未解决问题 / 真实页面依赖项

1. ~~**真实揽收超时订单未适配**~~ → 已完成并端到端干跑验证（2026-11-16，见 §8）：发现 → 去重 → `needs_human` → 结果回读 `rejected`。真实提交成功识别仍未验证（平台当前不受理 + 该单已有理赔记录），任何启用需单独评审 + 用户明确授权。
2. **真实 SKU 变化未观察**：两次扫描 changes=0；真实变化路径靠单测覆盖。
3. **导入恢复（UI 路径）/ 全库重置**：见 §3 未实测项（导入的 DB 层已单测覆盖；重启恢复已实测通过）。
4. **连续失败 3 次自动暂停未在真实页面触发**（修复风控误判后真实扫描每次都成功；已由单测覆盖暂停/通知/计数清零全路径）。
5. **商品图 Broken image**：og:image 失效被 onerror 隐藏；未替换图源。
6. 用户浏览器「Custom New Tab」把新标签重定向至 `index.yq59.top`（用户已确认可信，保留）。
7. 用户授予了扩展对 `http://127.0.0.1:8765/` 的主机权限（Webhook 测试用）；如不使用本地 Webhook 可在 chrome://extensions 该扩展"详情→权限"中撤销。
8. 备份文件保留在 `~/Downloads/1688-helper-backup-2026-11-15.json`（含商品/快照/理赔记录/设置，属用户私有数据；用户自行决定保留或删除）。

## 6. 模块 D：1688 商品导入端到端验证（2026-11-15，调试实例 127.0.0.1:8081）

调试实例 `/tmp/opencode/ext-debug-compose.yaml`（`down -v` 可整体清空）。manage Token「ext-debug-import-test-2」；id=2 Token 已撤销用于 401 验证。完整记录见 `docs/IMPORT_1688.md`「端到端验证」。

| 用例 | 结果 | 证据 |
|---|---|---|
| ingest（context 策略，真实页面数据） | ✅ 200 | 预览 name/价格/13 属性/SKU 11 组合/12 主图/15 详情图/5 区块，warnings=[] |
| ingest（匿名 html） | ⚠️ 422 | 内嵌 JS 字面量无法被严格 JSON 解析；真实链路走 window.context，不受影响 |
| execute（API 构建，默认全选） | ✅ 200 | product id=4，5 区块，12 图，全部 `/api/media/N/raw` |
| execute（扩展 UI，用户取消「商品属性」区块） | ✅ 200 | product id=5/6（两次独立导入），4 区块，12 图，primary 已设 |
| 图片本地落盘 + sha256 去重 | ✅ 通过 | 多商品复用 media_asset_id；`/api/media/3/raw` 200 image/jpeg 408,483 B；无 Token 401 |
| 502 图片下载失败整体回滚 | ✅ 通过 | product 计数不变，无半成品 |
| 白名单外图片域名 | ✅ 400「图片域名不在白名单」 | 服务端强制 |
| offer_id 非法 | ✅ 422（pattern `^\d{6,15}$`） | |
| 401（撤销 Token / 无头） | ✅ 401「Token 无效或已撤销」/「未登录」 | |
| https 商品页 → http 回环工作台 | ✅ 导入成功 | 混合内容未拦截；局域网 http 未实测 |
| 重复导入同一 offer | ⚠️ 工作台不按 offer_id 去重 | products 2/4/5/6 均为 offer 991485897552；扩展有 `submitting` 防重锁，重复为用户两次操作 |
| 扩展 UI 全链路（popup「📥 导入 1688」→ 卡片→确认→/products 可见） | ✅ 通过 | 用户点按 + 后端核对（2026-11-19 起 FAB 已移除，入口为弹窗按钮） |
| 重复导入防护 v0.4.0（by-offer/409/update） | ✅ 工作台升版后 API 级全矩阵验证（2026-11-15） | 409 撞重复 / update 原地更新 id 不变 / upsert / 502 回滚 / 422 组合 / 并发 200 无新增；扩展 UI 点按未验证 |

## 7. 结论

- 安装可用、SKU 实采端到端通过、Webhook/桌面通知经本地双通道验证、模拟理赔链路通过。
- 首次交付标注：**真实验证** = 安装/实采/基准/对比/通知双通道/备份导出；**模拟验证** = 理赔全链路/变化对比矩阵/状态机/队列恢复；**待真实订单** = 理赔真实提交；**待用户增量任务书** = 模块 C（HTML 采集推送）。
- 「浏览器重启后恢复任务」已于 2026-11-15 电脑重启后实测通过。建议：确认一次 Webhook 通知实际送达自己的接收端（例如企业微信机器人）。
- 模块 D（1688 商品导入）已于 2026-11-15 在本地调试工作台完成端到端验证（见 §6）：采集→预览→入库→图片本地化全链路可用；未验证项：503 磁盘不足、Token 撤销后的 UI 引导、局域网 http 工作台、既有能力未逐项回归。

## 8. 模块 A（揽收超时自动理赔）live 适配与端到端干跑（2026-11-15 适配 → 2026-11-16 验证，v0.5.0）

本机 Edge 另一买家账号出现 1 笔揽收超时订单。本期完成**只读 dry-run 适配**，真实提交未执行、也未放开：

| 项 | 结果 |
|---|---|
| 「揽收超时」入口控件实测（2026-11-16 复核） | ✅ hover tooltip（`q-tooltip-content.tabs-tooltip`，常驻 DOM `display:none`）中的 `.tooltip-tab`（`data-tracker` 尾缀 `_CTMO`）；点击后订单列表 iframe **整页导航**到 `buyer-order-list.html?…&tradeStatus=CTMO&page=1` |
| 发现（LiveOrderSource，两阶段注入） | ✅ 后台标签 → settle 12s → Phase A（`claim-finder.js` 置 `tradeStatus=CTMO` 触发导航）→ Phase B（`claim-collector.js` 轮询 ~18s 读 CTMO 视图）。实测注入结果 frame 返回 `ordersLen: 1`、`ok: true, frame: "list"` |
| allFrames 序列化坑（2026-11-16 修复） | ✅ 非目标 frame 无返回值，跨进程传输为 `null`（非 `undefined`）；旧 `find(v !== undefined)` 选中 null 导致真实结果被跳过（"未采集到任何 frame 结果"）。修复：取第一个 `v != null`，诊断日志区分 null/undefined |
| 防误读校验 | ✅ CTMO 视图即过滤结果；页脚「共 N 条」与解析条数一致性校验，不一致拒绝产出 |
| 申请页只读探测（LiveClaimExecutor） | ✅ `has_record`（已有理赔记录）→ 一律 `needs_human`，**绝不点击提交**；失败原因写入「平台提示该订单已存在理赔记录…禁止重复申请」 |
| 结果回读（resultSync，「我申请的理赔」表格） | ✅ 状态→`resultStatus`（成功→paid/失败→rejected/处理中→processing/未识别→unknown）；订单金额只补缺 |
| 登录失效/风控通知 | ✅ `exception.login` / `exception.risk`（forceDesktop，保留标签页） |
| 单测 | ✅ 94/94（新增 claim-discovery / claim-result-mapping 纯函数用例） |
| 端到端干跑（2026-11-16，该 Edge 手动加载 v0.5.0） | ✅ 管理页「立即扫描」：发现该笔揽收超时订单 → 去重入队（`claim.apply`，`kind:"needs_human"`）→ executor 只读探测 → 结果回读 `checked:15, updated:1`（该单「理赔失败」→ `resultStatus=rejected`，列表显示「平台驳回」）→ 桌面通知到达（发现 1 / 待人工 1）→ **再次扫描发现 0 笔、不重复入队** |
| 真实提交 | ⛔ 不在本期范围；平台当前不受理（页面明示），且该单已有理赔记录（理赔失败，客服介入） |

详见 `docs/1688_PAGES.md` §7。
