# Agent.md — 1688 智能助手（1688-helper）项目知识

> 后续接手本项目的 Agent 必须先读本文件。每次重要开发完成后更新。
> 需求基准：`taskbook.md`（如与代码冲突，先识别并报告，不得擅自删除已确认的业务规则）。

## 1. 项目目标

个人自用 Chrome 扩展（Manifest V3），三大模块：

- **模块 A（揽收超时自动理赔）**：扫描揽收超时订单 → 自动申请理赔。**当前无真实揽收超时订单**，真实页面适配全部预留，模拟环境与真实环境严格区分，严禁伪造真实理赔成功。
- **模块 B（SKU 变化监控）**：完整交付的核心功能。全量 SKU 新增/删除/规格/属性/库存/价格变化监控，快照 diff，桌面+Webhook 通知。
- **模块 C（HTML 采集）**：仅预留模块边界，不实现推送，不假设用户自建网站 API。

## 2. 核心业务规则（固化进代码）

1. SKU 首次扫描只建基准快照；第二次有效扫描起 diff 并通知；首次不打扰用户。
2. 扫描不完整（JSON 解析失败/SKU 数骤降/缺 `canBookCount`/风控拦截）→ 标记 invalid，不覆盖基准、不产生删除/归零变化，连续失败 +1。
3. 连续失败 3 次 → 自动暂停该商品 + 通知 + UI 显示暂停态；成功一次即清零计数。
4. 变化比较：同 `skuId` 优先识别为属性变化，避免误判为删+增；库存增/减/归零/恢复；价格变化仅记录。
5. 通知：每商品每轮一次汇总；无变化不发；通知去重键防重复；Webhook 失败不影响业务任务。
6. 理赔：申请提交状态与最终理赔结果分开记录；「提交结果未知」→ 先查平台状态，禁止盲目重复提交；`orderId` 唯一索引防重；`running` 租约防同一订单被多任务处理。
7. 风控/验证码/登录失效 → 立即暂停相关任务 + 桌面通知 + 保留标签页等人工处理；绝不自动绕过。
8. 后台标签机制：`chrome.tabs.create({active:false})` → 等 complete → 注入 `pages/inject/sku-collector.js` → 完成后关标签；风控/验证码保留标签。一次 tick 最多跑 1 个标签任务。
9. SW 不持有内存关键状态；一切任务状态持久化（IndexedDB）；alarm 每 0.5min 巡检；SW 启动时 `ensureAlarms()` + `recoverStaleTasks()`；浏览器重启/SW 回收后恢复任务。
10. 模块间故障隔离；重要操作有日志（不含 Cookie/Token/Webhook 密钥）。
11. 数据：IndexedDB（`idb` 封装，见 `src/common/db.ts`）；历史默认长期保留；支持 JSON 导出/导入（数据与备份页）。

## 3. 技术栈与结构

- TypeScript strict + Vite，零运行时框架；IndexedDB；chrome.alarms/tabs/scripting/notifications；`chrome.storage.local`（配置）。
- `src/background/`：`sw.ts`（入口）、`scheduler.ts`（tick/队列调度）、`tab-runner.ts`（后台标签）、`router.ts`（消息路由）。
- `src/modules/sku/`：采集（`skuModel.ts` 内联 JSON 解析）、`completeness.ts`（完整性校验）、`compare.ts`（diff）、`monitor.ts`（编排）、`products.ts`、`actions.ts`。
- `src/modules/claim/`：`source.ts`（订单发现；Simulation/Live）、`executor.ts`（申请执行器；Simulation/Live=needs_human 拒绝执行）、`stateMachine.ts`、`claim.ts`。
- `src/pages/`：`inject/sku-collector.ts`（自包含注入脚本，SW 侧解析）、`popup/`（加监控）、`manage/`（管理页：总览/理赔/SKU/任务/设置/日志/数据与备份）。
- `tests/`：Vitest + fake-indexeddb（46 用例全过）。

## 4. 构建/安装/测试

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（46 用例）
npm run build       # tsc + vite build → dist/
```

- 扩展解压加载于 `/home/jerry/workspace/1688-helper/dist`，扩展 ID：`bjnbhbmdnhdnplflhmdbinflhdkfcine`（ID 由 dist 路径哈希决定，换路径会变）。
- 加载/刷新扩展：chrome://extensions → 开发者模式已开 → 该扩展卡片可「重新加载」（改 dist 后未重载，但 `sku-collector.js` 每次注入时从磁盘读取，采集器改动即时生效；SW/页面代码需重载扩展）。
- 当前已加载的扩展使用的就是 dist 构建产物。

## 5. 已完成

- [x] 基础框架：MV3 manifest、SW 调度（alarms）、持久任务队列（租约/重试/恢复）、后台标签管理、IndexedDB、日志、配置、双通道通知（桌面+Webhook+重试+去重）、数据导出/导入。
- [x] 管理界面（总览/理赔/SKU 监控/任务/设置/日志/数据与备份）与 popup。
- [x] SKU 模块：添加（popup/管理页）、列表/暂停/恢复/立即扫描/详情（SKU 当前状态、历史变化、历史快照）、基准规则、完整性校验、连续失败自动暂停并通知、通知聚合与去重。
- [x] 理赔模块（框架）：订单扫描框架、去重（orderId 唯一索引）、状态机（待申请→申请中→成功/失败/平台处理中/已完成/需要人工）、重试 ≤3 次、中断恢复、模拟执行器、批次汇总通知；`LiveOrderSource`/`LiveClaimExecutor` 明确返回空/needs_human，绝不伪造成功。
- [x] **真实页面验证（2026-11-15）**：真实商品页实采（offerId 991485897552）成功：首次建基准（11 SKU，`matchedBy: skuId`），二次扫描 `changes: 0`；后台标签不抢焦点；连续失败计数成功清零；stale CSP 错误已清除。
- [x] 风控误判修复（见 §7 已知问题 #1）。
- [x] 通知双通道 e2e：Webhook 本地接收端收到扩展 SW 的 POST（payload 正确；发现 ambient Cookie 泄露，已修复 `credentials:'omit'` 并复测无 Cookie）；桌面通知在真实浏览器触发（notificationLog：`claim.found`/desktop/sent）。
- [x] 数据导出 e2e（32KB 备份全 store 齐全）；README、docs/TEST_REPORT.md 已写。

## 6. 未完成 / 待办

- [ ] 真实揽收超时订单适配（全部依赖真实订单，见 `docs/PLAN.md` §4、`docs/1688_PAGES.md` §6）：「待收货」下拉 →「揽收超时」筛选控件参数、「去申请理赔」按钮 DOM、提交成功识别、理赔结果回读。
- [ ] 真实 SKU 变化验证：目前真实对比仅跑到 `changes: 0`；真实库存/价格变化路径待线上变化发生时观察（比较逻辑已有 13+ 项单测覆盖）。
- [ ] 真实通知送达验证：Webhook/桌面双通道机制已通（本地接收端收到 SW POST；notificationLog 见 desktop/claim.found/sent），但未向用户自己的接收端送达过一条真实 SKU 变化通知。
- [ ] 浏览器重启恢复 / SW 回收恢复未实测（alarm 跨重启持久 + ensureAlarms + recoverStaleTasks，代码与单测支持；需用户协助重开 Chrome 确认）。
- [ ] 导入恢复已通过 DB 层单测（backup.test.ts：replace/merge/真实备份往返），⚠️ 浏览器文件选择 UI 未实测；全库重置未实测（危险操作，未做）。
- [ ] popup「添加监控」未在真实商品页上点按验证（代码已审、popup 可渲染）；最佳验证时机：用户自己在详情页点一次即可。
- [ ] 提交相关敏感文件清理：`~/Downloads/1688-helper-backup-2026-11-15.json`（含用户私有数据）建议用户决定保留/删除；用户 Chrome 已授予扩展对 `http://127.0.0.1:8765/` 的主机权限（Webhook 测试用），不需要可自行撤销。
- [ ] `dist/` 与 `node_modules/` 未纳入 git（`.gitignore` 已建）；全部源码尚未提交（初始 commit 仅 taskbook/LICENSE），提交时机待用户定。

## 7. 已知问题及解决办法

1. **采集器误判风控（已修复 2026-11-15）**：原「HTML 含 baxia 字样 + 存在 baxia DOM 节点」= 风控 → 100% 误判（1688 商品页始终嵌入 baxia 反爬脚本与隐藏验证码容器）。修复为只认**可见**的验证/拦截界面（有效尺寸且非 display:none/visibility:hidden/opacity:0）或 punish/verify/captcha URL 或标题含「验证码/安全验证」。详见 `docs/1688_PAGES.md` §6。**教训：风控必须以「可见的拦截界面」为准。**
2. **扩展「错误」按钮**：显示上一版构建遗留的 CSP 违规错误（旧 `pages/admin/admin.html` + 内联事件处理器），已在 chrome://extensions 全部清除；当前构建无内联事件处理器，管理页 CSP 正常。
3. **监控列表商品图标显示「裂图」**：`og:image` 记录的图片地址疑似防盗链/已失效，`onerror` 已优雅隐藏；待验证可用 URL（如 cbu01.alicdn.com 带 referer 的图）后再修。
4. **Chrome 自动化限制**：computer-use 鼠标坐标点击无效（auto 走 AT-SPI accessibility，无元素索引时不落点）；xdotool（XTest 真实事件，DISPLAY=:0）鼠标点击有效；键盘 Tab/Enter 与 scrot 截图可用。注意 computer-use 超时后改走 xdotool 最稳。
5. 浏览器的「Custom New Tab」（v1.11）把新标签页重定向到 `index.yq59.top`——**用户已确认可信**（2026-11-15 用户确认）。
6. 1688 订单列表「揽收超时」无真实订单，live claim 全部路径未实测。
7. Service Worker 回收恢复机制仅有单测（`recoverStaleTasks`），未在真实浏览器观察到 SW 回收过程。
8. **Webhook 泄露 ambient Cookie（已修复）**：SW 的 `fetch` 默认携带环境 Cookie（实测接收端看到 `oc_ui_session_...`）。修复：`sendNotification`/`testWebhook` 均加 `credentials:'omit'`，复测请求无 Cookie。教训：webhook 不该带任何 ambient 凭证。
9. 桌面通知 e2e 真实触发：notificationLog 捕获 `claim.found`（desktop/sent，10:57 模拟模式发现 6 笔揽收超时），证明桌面通道在真实浏览器可用。
10. 临时隔离实例验证（2026-11-15）：Google Chrome 生产版**忽略** `--load-extension`（日志 `--load-extension is not allowed in Google Chrome`），只能走 GUI「加载未打包」；临时实例两次被用户关闭，已删除（`/tmp/opencode/e2e-profile*`，各 153MB）。

## 8. 用户环境事实

- Debian 13，用户 Chrome（已登录 1688 买家账号 tb714536_66），1688 买家工作台：`https://work.1688.com/home/buyer.htm?_path_=buyer2017Base/2017buyerbase_trade/buyList`
- 真实揽收超时订单：**无**（2026-11-15，「待收货」下拉中「揽收超时」为空）。
- 「揽收超时」入口（2026-11-15 截图确认）：订单列表 →「待收货」下拉 →「正常待收 127 / 揽收超时」。
- 商品页结构见 `docs/1688_PAGES.md`；内联 JSON（`window.contextPath` 脚本）是首选解析源，DOM 行兜底。

## 9. 测试记录

- 单测：`npm test` → 46/46 通过（compare/完整性/状态机/队列/去重/理赔流程/连续失败暂停/备份往返均已覆盖）。
- 真实实采：见 §5 及 `docs/1688_PAGES.md` §6（首次建基准 → 二次对比 `changes: 0`）。
- 通知 e2e：Webhook（本地接收端收到 POST，payload 正确；修复 credentials 后无 Cookie）；桌面（notificationLog: claim.found/desktop/sent）。
- 备份导出：32KB JSON，全 store 齐全、可用（见 `docs/TEST_REPORT.md`）。
- 理赔：仅模拟模式（`claimMode: simulation`）跑通扫描→去重→申请→重试→通知；**无任何真实理赔被执行或伪造**。
- 完整报告：`docs/TEST_REPORT.md`

## 10. 后续开发提示

- 改 `sku-collector.ts` 后直接 `npm run build` 即可生效（注入时从磁盘读）；改 SW/页面代码后需在 chrome://extensions 重载扩展。
- 接真实揽收超时订单时：先 `scrot` 截图存证结构 → 更新 `docs/1688_PAGES.md` → 改 `LiveOrderSource`/`LiveClaimExecutor` → 保留「needs_human」兜底，绝不提交未经验证的真实理赔。
- 任何「页面结构变化」一律报告适配问题，不得静默产生错误数据（taskbook §十三）。
