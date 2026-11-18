# Agent.md — 1688 智能助手（1688-helper）项目知识

> 后续接手本项目的 Agent 必须先读本文件。每次重要开发完成后更新。
> 需求基准：`taskbook.md`（如与代码冲突，先识别并报告，不得擅自删除已确认的业务规则）。

## 1. 项目目标

个人自用 Chrome 扩展（Manifest V3），三大模块：

- **模块 A（揽收超时自动理赔）**：扫描揽收超时订单 → 自动申请理赔。2026-11-15 真实订单已出现（本机 Edge 另一买家账号，见 `docs/1688_PAGES.md` §7）：live 发现/探测/结果回读已适配；本期真实提交一律不执行（LiveClaimExecutor 只读探测映射 `needs_human`）。端到端干跑已验证（2026-11-16）：发现 1 笔 → 去重入队 → 只读探测 `has_record` → `needs_human` → 结果回读 → `resultStatus=rejected`；重扫不重复入队。
- **模块 B（SKU 变化监控）**：完整交付的核心功能。全量 SKU 新增/删除/规格/属性/库存/价格变化监控，快照 diff，桌面+Webhook 通知。
- **模块 D（1688 商品导入工作台，2026-11-15 新增，v0.4.0）**：商品页一键采集 → 工作台预览（ingest）→ 确认卡片 → 入库（execute）。增量功能，不改动既有模块。**端到端已真实验证（2026-11-15，调试实例 127.0.0.1:8081，见 `docs/IMPORT_1688.md`「端到端验证」）**；v0.4.0 增加重复导入防护（by-offer 检查 + 卡片已存在横幅/更新-新建单选 + execute `mode`/`allow_duplicate`），工作台侧契约已交付，实现待升级（见 `docs/IMPORT_1688.md`「重复导入防护」）。
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
- `src/modules/claim/`：`source.ts`（订单发现；Simulation/Live=后台标签 + **两阶段注入**：Phase A 导航 `tradeStatus=CTMO`，Phase B 轮询提取）、`executor.ts`（申请执行器；Simulation/Live=只读探测，needs_human 拒绝执行）、`stateMachine.ts`、`claim.ts`、`discovery.ts`（采集结果映射，纯函数）、`resultMapping.ts`（理赔状态文本→resultStatus，纯函数）、`resultSync.ts`（「我申请的理赔」回读→resultStatus/金额补缺）。
- `src/modules/import1688/`（模块 D）：`payload.ts`（纯逻辑，可单测）、`settings.ts`（独立 storage key `import1688`）、`client.ts`（SW fetch + 错误映射）、`collect.ts`（MAIN world 读 window.context/outerHTML）、`service.ts`、`types.ts`。
- `src/pages/`：`inject/sku-collector.ts`（自包含注入脚本，SW 侧解析）、`inject/import-1688.ts`（模块 D content script，**classic script 必须自包含**）、`inject/claim-finder.ts`（模块 A Phase A：把列表 iframe 导航到 CTMO 视图，自包含）、`inject/claim-collector.ts`（模块 A Phase B：CTMO 视图订单提取，shadow DOM 穿透，自包含）、`inject/claim-apply-probe.ts`（模块 A 申请页只读探测，自包含）、`inject/claim-result-list.ts`（模块 A 结果回读，自包含）、`popup/`（加监控）、`manage/`（管理页：总览/理赔/SKU/任务/设置/日志/数据与备份）。
- 构建：`vite.config.ts`（主构建，`emptyOutDir`）+ `vite.content.config.ts`（模块 D content script 单独打包，**必须在主构建后运行**）。`tab-runner.ts` 导出 `runInBackgroundTab`（后台标签采集）、`injectIntoTab`/`waitForComplete`（两阶段注入复用；`allFrames` 注入后取「第一个非 null/undefined frame 结果」——跨进程传输下「无返回值」的 frame 序列化为 null，2026-11-16 修复）。
- `tests/`：Vitest + fake-indexeddb（94 用例全过）。

## 4. 构建/安装/测试

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（94 用例）
npm run build       # tsc + vite build（主）+ vite -c vite.content.config.ts（模块 D content script，须最后跑）
npm run build:content  # 仅重打 content script（改 import-1688.ts 时够用，但它引用 payload.ts 变更需一起确认）
```

- 扩展解压加载于 `/home/jerry/workspace/1688-helper/dist`，扩展 ID：`bjnbhbmdnhdnplflhmdbinflhdkfcine`（ID 由 dist 路径哈希决定，换路径会变）。
- 加载/刷新扩展：chrome://extensions → 开发者模式已开 → 该扩展卡片可「重新加载」（改 dist 后未重载，但 `sku-collector.js` 每次注入时从磁盘读取，采集器改动即时生效；SW/页面代码需重载扩展）。
- 当前已加载的扩展使用的就是 dist 构建产物。

## 5. 已完成

- [x] **Popup 增加「📥 导入 1688」按钮 + 工具栏点击兜底注入（2026-11-17 晚）**：因 Edge 该扩展站点授权会被重置导致声明式 content_script 不注入，popup 打开时主动 `chrome.scripting.executeScript({files:['pages/inject/import-1688.js']})` 兜底（脚本自带防重 guard）；新增「📥 导入 1688」按钮：注入后程序化点击 FAB 直接打开导入确认卡，失败时显示明确报错（不再能让 FAB 永远静默缺失）。
- [x] **SKU 通知规则（2026-11-18）**：默认仅通知「上架/下架/售罄/补货/低库存预警（STOCK_LOW，跌破阈值且 >0，变成 0 仍归 STOCK_OUT；阈值默认 5 件）」，静音 库存增加/库存减少/规格变化/价格变化；规则 = 全局（系统设置「SKU 通知规则」卡片）⊕ 商品级覆盖（SKU 监控 → 详情 → 通知规则，「自定义」保存完整快照，「恢复跟随全局」清空），桌面与 Webhook 共用同一规则；静音变化照常写入 skuChanges（详情页历史可查）。v1→v2 设置迁移自动补默认。109/109 单测通过。
- [x] **Edge 商店自动发布流水线（2026-11-18）**：`.github/workflows/publish-edge.yml`（仅 tag `v*.*.*` 触发）+ `scripts/publish-edge.mjs`（Update REST API v1.1：upload→轮询 Succeeded→publish→轮询 Succeeded，支持 JSON/plain-text notes 双兜底，`--dry-run` 可本地校验）。依赖仓库 secrets：`EDGE_CLIENT_ID` / `EDGE_API_KEY` / `EDGE_PRODUCT_ID`（v1.1 用 ApiKey 头，v1 的 access-token 方式已废弃）。本机无 `zip` 命令，workflow 用 python3 zipfile 打包 dist/（根为 dist 内容）并校验 zip 内 manifest 版本 == tag。⚠️ 首次发布必须走 Partner Center 手动创建产品；API 只能更新已发布产品。版本号需同时递增 package.json 与 public/manifest.json（workflow 会校验 tag 一致性）。商店 v0.5.1 尚未提交（等打 tag v0.5.1 推送后由 Actions 完成）。
- [x] **Edge「授权」UI 三处显示不一致（2026-11-17 实测）**：详情页「自动允许在以下站点上访问」主开关显示 ON、工具栏拼图菜单站点级开关显示「允许在此网站上使用」——而详情页里那条记住的 `*://*.1688.com/*` 行是灰/关且不可点，此时扩展实际**无**站点授权（content script 不注入、FAB 不显示）。**只有详情页「记住的站点行」是可靠的授权信号；主开关和菜单开关都会显示「允许」。**修复：主开关 关→开 会重新应用记住的授权（实测恢复后 FAB 正常注入，a11y 快照 label 可见）。商店安装也不能保证安装即授权（本 profile 两个拷贝都落到零授权），原因无法溯源；商店版已被用户删除，仅剩解压版。**2026-11-17 晚再验证：扩展「重新加载」会重置该授权，重建 dist + reload 后 content script 在所有标签页都不注入（cache-bust 强刷也无效）——每次 reload 后都要重做 关→开 并重新强刷验证。**
- [x] **检查登录状态误报未登录（2026-11-17 修复）**：`router.ts checkLogin` 依赖 `changeInfo.url` 判 URL，但 `complete` 事件不带 `url`（`url` 只在 URL 变化的那次事件里有值），导致已登录时永远 resolve(true) 不了 → 15s 超时 → 显示「登录失效」。修复：以 `changeInfo.url → updatedTab.url` 为准 + complete 无 URL 时 `chrome.tabs.get` 读真实地址判定，超时 20s；已 `npm run typecheck`、`npm test`（94/94）、`npm run build`，解压版扩展已点「重新加载」。**Edge 商店版仍是旧代码**（商店只发 0.5.0，未包含本修复）；管理页「1688 登录状态」徽标读的是 IndexedDB 里的 `lastLoginStatus`，需在修复后再点一次「检查 1688 登录状态」才会从「登录失效」翻成「已登录」。
- [x] 基础框架：MV3 manifest、SW 调度（alarms）、持久任务队列（租约/重试/恢复）、后台标签管理、IndexedDB、日志、配置、双通道通知（桌面+Webhook+重试+去重）、数据导出/导入。
- [x] 管理界面（总览/理赔/SKU 监控/任务/设置/日志/数据与备份）与 popup。
- [x] SKU 模块：添加（popup/管理页）、列表/暂停/恢复/立即扫描/详情（SKU 当前状态、历史变化、历史快照）、基准规则、完整性校验、连续失败自动暂停并通知、通知聚合与去重。
- [x] 理赔模块（框架）：订单扫描框架、去重（orderId 唯一索引）、状态机（待申请→申请中→成功/失败/平台处理中/已完成/需要人工）、重试 ≤3 次、中断恢复、模拟执行器、批次汇总通知；`LiveOrderSource`/`LiveClaimExecutor` 明确返回空/needs_human，绝不伪造成功。
- [x] **模块 A 端到端干跑验证通过（2026-11-16，该 Edge + v0.5.0）**：两阶段注入修复了「揽收超时入口实为 hover tooltip（`q-tooltip-content.tabs-tooltip`）、点击后 iframe 整页导航到 `tradeStatus=CTMO`、原地轮询永远超时」的问题；并修复 `allFrames` 注入结果跨进程序列化后「空 frame 返回 null 而非 undefined」导致真实 CTMO 结果（ordersLen=1）被 `find(v !== undefined)` 跳过的问题。管理页「立即扫描」实测：发现 1 笔揽收超时订单 → 去重入队 → executor 只读探测 `has_record` → `needs_human`（平台提示该单已存在理赔记录，禁止重复申请）→ 结果回读（「我申请的理赔」15 条，其中该单「理赔失败」→ `resultStatus=rejected`，`checked:15, updated:1`）→ 列表显示「平台驳回」+ 桌面通知到达（发现 1 / 等待人工处理 1）；**再次扫描发现 0 笔、不重复入队**。全程未提交任何真实理赔。94/94 单测、typecheck 全绿。
- [x] **模块 A live 适配（2026-11-15，v0.5.0）**：本机 Edge 另一买家账号出现 1 笔揽收超时订单（「待收货」下拉 →「揽收超时」）。已实现并构建（dist v0.5.0）：live 发现（后台标签 + 全 frame 注入，点「待收货」→「揽收超时」，等刷新，shadow DOM 提取，与「共N条」交叉校验，防止把未过滤订单误读为揽收超时）、申请页只读探测（`has_record`/`not_yet`/`form_ready`/`blocked_unknown` → 一律 needs_human，**绝不提交**）、「我申请的理赔」结果回读（`resultSync.ts`，状态→resultStatus；金额只补缺不覆盖）；登录失效/风控桌面通知（`exception.login`/`exception.risk`，forceDesktop）。94/94 单测、typecheck 全绿；docs/1688_PAGES.md §7 已记录页面结构（无隐私）。**真实提交仍然禁止**；端到端（该 Edge 手动加载扩展后的发现→入队→needs_human→回读）待用户手动加载后验证。
- [x] **真实页面验证（2026-11-15）**：真实商品页实采（offerId 991485897552）成功：首次建基准（11 SKU，`matchedBy: skuId`），二次扫描 `changes: 0`；后台标签不抢焦点；连续失败计数成功清零；stale CSP 错误已清除。
- [x] 风控误判修复（见 §7 已知问题 #1）。
- [x] 通知双通道 e2e：Webhook 本地接收端收到扩展 SW 的 POST（payload 正确；发现 ambient Cookie 泄露，已修复 `credentials:'omit'` 并复测无 Cookie）；桌面通知在真实浏览器触发（notificationLog：`claim.found`/desktop/sent）。
- [x] 数据导出 e2e（32KB 备份全 store 齐全）；README、docs/TEST_REPORT.md 已写。
- [x] **模块 D 1688 商品导入（2026-11-15，v0.2.0）**：FAB 注入 + 点击→SW→Token 检查 toast 全链路实测（offerId 991485897552，用户 Chrome）；设置页工作台卡片渲染正确；typecheck 全绿（顺带修 backup.test.ts 两处既有报错）。详见 `docs/IMPORT_1688.md`。
- [x] **模块 D 真实链路端到端验证（2026-11-15，v0.3.0，调试实例 127.0.0.1:8081）**：后端 API 契约（health/401/400/422/502 回滚/媒体落盘鉴权/图片 sha256 去重）+ 扩展 UI 全链路（设置页保存→授权域名→连接测试→FAB→预览卡片→确认导入→/products/<id> 可见、图片本地化）均已实测。products id=4（API 构建，5 区块）、id=5/6（用户点按，4 区块，两次独立导入，用户已确认）入库成功。详见 `docs/IMPORT_1688.md`。
- [x] **模块 D 重复导入防护（扩展侧，v0.4.0，2026-11-15）**：by-offer SW 查询（失败降级不阻断）+ 预览卡片「工作台已有该商品」横幅（id/名称/更新时间）+「更新已有商品（默认）/ 仍然新建」单选 + 按钮文案联动；execute 请求显式带 `mode`/`allow_duplicate`（plan: create/update/create-anyway）；409 红色提示；toast 按 `action` 区分「已导入/已更新」；`isValidExecuteRequest` 兜底校验 mode/allow_duplicate。83/83 单测、typecheck 全绿、dist v0.4.0（manifest + package.json 同步为 0.4.0，顺带对齐此前 0.1.0 滞后的 package.json）。**UI 与 409/update 真实链路未验证（依赖工作台升版）。**

## 6. 未完成 / 待办

- [x] ~~真实揽收超时订单适配~~ → 已完成并端到端干跑验证（2026-11-16，见 §5）：live 发现（两阶段 CTMO 注入）→ 去重 → needs_human（已有理赔记录）→ 结果回读 rejected；重扫不重复入队。真实提交成功识别本期不做（需平台可提交场景 + 用户授权 + 单独评审）。
- [ ] 真实 SKU 变化验证：目前真实对比仅跑到 `changes: 0`；真实库存/价格变化路径待线上变化发生时观察（比较逻辑已有 13+ 项单测覆盖）。
- [ ] 真实通知送达验证：Webhook/桌面双通道机制已通（本地接收端收到 SW POST；notificationLog 见 desktop/claim.found/sent），但未向用户自己的接收端送达过一条真实 SKU 变化通知。
- [x] 浏览器重启恢复已实测（2026-11-15 电脑重启）：SW 自动启动（13:58），alarm 补建，SKU 扫描（13:59）与理赔扫描自动执行，数据/日志（52 条）全部持久，用户标签无干扰。SW 回收恢复有单测覆盖，真实回收过程无法直接观察。
- [ ] 导入恢复已通过 DB 层单测（backup.test.ts：replace/merge/真实备份往返），⚠️ 浏览器文件选择 UI 未实测；全库重置未实测（危险操作，未做）。
- [ ] popup「添加监控」未在真实商品页上点按验证（代码已审、popup 可渲染）；最佳验证时机：用户自己在详情页点一次即可。
- [x] ~~工作台升级以支持重复导入防护~~ → 完成并验证（2026-11-15）：by-offer（exists/422/401）、execute 行为矩阵全格（409 撞重复 / allow_duplicate 新建 / update 原地更新 id 不变+内容替换 / upsert 新建 / 422 非法组合 / 502 更新整体回滚 / 并发两次 update 无新增）。API 级全部实测通过；扩展 UI 点按仍待用户重载 v0.4.0 后验证。
- [ ] 调试实例内测试商品 id=4/5/6（offer 991485897552，同一 offer 四件商品含 id=2）可在工作台删除，或 `docker compose -f /tmp/opencode/ext-debug-compose.yaml down -v` 整体清空。
- [ ] ~~**模块 D 真实链路待验收**~~ → 已完成（2026-11-15 端到端验证通过，见 §5；未验证项：503 磁盘不足、Token 撤销后 UI 引导、局域网 http 工作台、详情图导入、m.1688.com 移动端、既有能力未逐项回归）。
- [ ] 提交相关敏感文件清理：`~/Downloads/1688-helper-backup-2026-11-15.json`（含用户私有数据）建议用户决定保留/删除；用户 Chrome 已授予扩展对 `http://127.0.0.1:8765/` 的主机权限（Webhook 测试用），不需要可自行撤销。
- [ ] `dist/` 与 `node_modules/` 未纳入 git（`.gitignore` 已建）；全部源码尚未提交（初始 commit 仅 taskbook/LICENSE），提交时机待用户定。

## 7. 已知问题及解决办法

1. **采集器误判风控（已修复 2026-11-15）**：原「HTML 含 baxia 字样 + 存在 baxia DOM 节点」= 风控 → 100% 误判（1688 商品页始终嵌入 baxia 反爬脚本与隐藏验证码容器）。修复为只认**可见**的验证/拦截界面（有效尺寸且非 display:none/visibility:hidden/opacity:0）或 punish/verify/captcha URL 或标题含「验证码/安全验证」。详见 `docs/1688_PAGES.md` §6。**教训：风控必须以「可见的拦截界面」为准。**
2. **扩展「错误」按钮**：显示上一版构建遗留的 CSP 违规错误（旧 `pages/admin/admin.html` + 内联事件处理器），已在 chrome://extensions 全部清除；当前构建无内联事件处理器，管理页 CSP 正常。
3. **监控列表商品图标显示「裂图」**：`og:image` 记录的图片地址疑似防盗链/已失效，`onerror` 已优雅隐藏；待验证可用 URL（如 cbu01.alicdn.com 带 referer 的图）后再修。
4. **Chrome 自动化限制**：computer-use 鼠标坐标点击无效（auto 走 AT-SPI accessibility，无元素索引时不落点）；xdotool（XTest 真实事件，DISPLAY=:0）鼠标点击有效；键盘 Tab/Enter 与 scrot 截图可用。注意 computer-use 超时后改走 xdotool 最稳。
5. 浏览器的「Custom New Tab」（v1.11）把新标签页重定向到 `index.yq59.top`——**用户已确认可信**（2026-11-15 用户确认）。
6. ~~1688 订单列表「揽收超时」无真实订单~~（2026-11-15 已出现 1 笔，本机 Edge 另一账号）：live 路径已适配并**端到端干跑验证通过**（2026-11-16，见 §5）。
7. Service Worker 回收恢复机制仅有单测（`recoverStaleTasks`），未在真实浏览器观察到 SW 回收过程。
8. **Webhook 泄露 ambient Cookie（已修复）**：SW 的 `fetch` 默认携带环境 Cookie（实测接收端看到 `oc_ui_session_...`）。修复：`sendNotification`/`testWebhook` 均加 `credentials:'omit'`，复测请求无 Cookie。教训：webhook 不该带任何 ambient 凭证。
9. 桌面通知 e2e 真实触发：notificationLog 捕获 `claim.found`（desktop/sent，10:57 模拟模式发现 6 笔揽收超时），证明桌面通道在真实浏览器可用。
10. 临时隔离实例验证（2026-11-15）：Google Chrome 生产版**忽略** `--load-extension`（日志 `--load-extension is not allowed in Google Chrome`），只能走 GUI「加载未打包」；临时实例两次被用户关闭，已删除（`/tmp/opencode/e2e-profile*`，各 153MB）。
11. **MV3 content_scripts 是 classic script**：不能引用 vite 代码分割的 ESM chunk（Chrome SyntaxError）。模块 D 的 content script 用 `vite.content.config.ts` 单独打包为自包含文件，且必须在主构建（`emptyOutDir`）之后执行；曾把 import 留在 content script 里，产物直接不可用。
12. **chrome://extensions 的 ↻ 重新加载按钮坐标别靠猜**（1920×1080 下 ≈ (732, 537)，以卡片「详情/移除」同一行为准）；连续两次点空（y 偏高）导致「SW 似乎没更新」的误判——实际是扩展从未被重载。验证加载的是否新版本：看卡片版本号（0.1.0→0.2.0 只在重载后变化）。Edge 列表页搜索框（`edge://extensions/?q=1688`）能同时列出多个同名实例；解压版卡片有「重新加载」按钮。Edge 详情页「站点访问权限」的灰/关行**不可点**，只能靠「自动允许在以下站点上访问」主开关 关→开 重新应用授权（2026-11-17 实测：恢复后新开标签 FAB 注入正常）。
13. ~~揽收超时下拉是 toggle 语义~~（2026-11-16 实证推翻）：「揽收超时」是「待收货」Tab 的 **hover tooltip**（`q-tooltip-content.tabs-tooltip` 常驻 DOM、`display:none`、quark 渲染）里的 `.tooltip-tab`（`data-tracker` 尾缀 `_CTMO`，计数 1）。**点击后订单列表 iframe 整页导航到 `buyer-order-list.html?…&tradeStatus=CTMO&page=1`**，注入脚本上下文销毁——原地轮询必然超时（11-15/16 多轮「未采集到任何 frame 结果」即因此）。修复：两阶段注入（Phase A `location.assign` 改写 `tradeStatus`/`page` 触发导航；Phase B 轮询读 CTMO 视图，`「共 N 条」` 交叉校验保留）。
14. **AI 订单巡检横幅「N 笔揽收超时」与筛选 CTMO 结果数不一致**（曾见 3 笔 vs 1 笔），原因未确认；不以此数据做任何自动化决策。
21. **allFrames 注入结果序列化坑（2026-11-16 修复）**：`scripting.executeScript` 的 allFrames 结果中，「无返回值」的 frame 传回 SW 后是 `null`（不是 `undefined`）。`find(v => v !== undefined)` 会选中 null（顶层 frame），CTMO 真实结果（ordersLen=1）被当作「没有 frame 输出」。修复：`injectIntoTab` 取第一个 `v != null`；诊断日志 `type` 区分 null/undefined。**教训：跨进程序列化不保留 undefined，判空一律 `v != null`。**
15. **订单行内无订单总额**（仅单价/数量）；订单金额只能从「我申请的理赔」列表回读补缺（`resultSync`，只补缺不覆盖）。
16. **两次 browse 驱动的额外标签页被用户关闭**（订单详情/理赔申请页/理赔列表），且会话默认页被替换为 about:blank——用户在该 Edge 里主动清理标签页；Agent 自行打开的标签页用完即关，勿依赖其存活。
17. **真实订单已有理赔记录且平台暂不受理手动申请**（理赔申请页显示「未到承诺发货时间，暂不支持理赔」+「当前订单存在已申请的理赔记录」）。LiveClaimExecutor 因此只读探测并一律返回 needs_human；**不存在可自动提交的真实场景，提交成功识别未经验证，任何版本不得擅自启用自动提交。**
18. **2026-11-15 用户 Chrome 两次自行消失**（14:23、14:31，均在我 GUI 自动化期间；原因未知，可能是用户介入或 Chrome 崩溃）。教训：不要无人值守 GUI 自动化用户正在用的浏览器；交付可实测步骤让用户自己点，或事先获得明确许可。另：每次全新启动 Chrome 都会弹「要恢复页面吗？」，不替用户点「恢复」。**2026-11-17 补：不要把用户借出的标签页导航到别的地址**（为查扩展状态把商品标签页导航到 edge://extensions，用户随后自行关闭了多个标签页）；查浏览器内部页面时只开新标签页，并在用完后恢复/关闭。
19. **工作台不按 offer_id 去重（实测 2026-11-15）**：同一 offer 重复导入会创建重复商品（调试实例内 offer 991485897552 共 4 件：id 2/4/5/6）。扩展「确认导入」有 `submitting` 防重锁，id 5/6 为用户两次独立操作所致，非扩展 bug。若需要去重，应由工作台侧实现（扩展侧不做干预）；使用前确认预期行为。
20. **匿名 `{html}` ingest 422（实测）**：工作台 ingest 的 html 路径无法解析 1688 内嵌 JS 字面量（含未加引号数字键），返回 422。扩展真实链路走 `window.context` + JSON.stringify，不受影响；不要为「HTML 兜底」路径做额外适配，除非工作台侧增强解析。

## 8. 用户环境事实

- Debian 13，用户 Chrome（已登录 1688 买家账号①），1688 买家工作台：`https://work.1688.com/home/buyer.htm?_path_=buyer2017Base/2017buyerbase_trade/buyList`
- 本机 Edge（MiWiFi-RA72-srv；browse 扩展已连接，账号②，与 Chrome 账号不同，2026-11-15）：该账号工作台「待收货」下拉 →「揽收超时」有 1 笔订单（48h 发货承诺、卖家约定；订单已含平台理赔记录，申请页「未到承诺发货时间，暂不支持理赔」）。**该 Edge 已加载 1688-helper 扩展（v0.5.0）**，且**有两份同名拷贝**：解压版（ID `bjnbhbmdnhdnplflhmdbinflhdkfcine`，跑 dist，卡片带黄 ! 徽标、有「重新加载」按钮）与商店版（ID `endbhiafkoagbkhodplohhinabejagje`，「来源 Microsoft Edge 扩展应用商店」）；两者均启用，站点访问权限需各自授权（商店版 0.5.0 不含 2026-11-17 登录检查修复）。
- 本地调试工作台（模块 D 验证用，**一次性**）：Base URL `http://127.0.0.1:8081`；启动 `docker compose -f /tmp/opencode/ext-debug-compose.yaml up -d`；清空 `... down -v`；数据目录 `/tmp/opencode/ext-debug-data`（不入库）；连接信息 `/tmp/opencode/ext-debug.json`（含 manage Token「ext-debug-import-test-2」，**勿入库/勿粘贴到聊天**）。AI 服务商未配置，`/api/health` 常态 `degraded` 属正常。
- ~~真实揽收超时订单：无~~ → 已有 1 笔（账号②，Edge），见上。
- 「揽收超时」入口（2026-11-15 截图确认）：订单列表 →「待收货」下拉 →「正常待收 N / 揽收超时 M」。
- 商品页结构见 `docs/1688_PAGES.md`；内联 JSON（`window.contextPath` 脚本）是首选解析源，DOM 行兜底。

## 9. 测试记录

- 单测：`npm test` → 94/94 通过（原有 compare/完整性/状态机/队列/去重/理赔流程/连续失败暂停/备份往返 + import1688 模块用例 + 新增 claim-discovery/claim-result-mapping 纯函数用例）。
- 真实实采：见 §5 及 `docs/1688_PAGES.md` §6（首次建基准 → 二次对比 `changes: 0`）。
- 模块 D e2e（2026-11-15）：ingest 200（context，104 KB 真实页面数据）→ preview 字段齐全；execute 200（API 构建 product id=4；扩展 UI 用户点按 product id=5/6，12 图本地 `/api/media/N/raw`，sha256 去重）；502 图片 404 整体回滚（product 计数不变）；400 白名单 / 422 offer_id pattern / 401 撤销 Token / 媒体无 Token 401 均复测；https 商品页 → http 回环工作台导入成功。详见 `docs/IMPORT_1688.md` 与 `docs/TEST_REPORT.md` §6。
- 通知 e2e：Webhook（本地接收端收到 POST，payload 正确；修复 credentials 后无 Cookie）；桌面（notificationLog: claim.found/desktop/sent）。
- 备份导出：32KB JSON，全 store 齐全、可用（见 `docs/TEST_REPORT.md`）。
- 理赔：模拟模式跑通扫描→去重→申请→重试→通知；**live 模式端到端干跑验证通过（2026-11-16，该 Edge）**：发现 1 笔 → 去重入队 → 只读探测 `has_record` → `needs_human`（平台：该单已存在理赔记录，禁止重复申请）→ 结果回读 `rejected`（checked:15, updated:1，列表显示「平台驳回」）→ 重扫 0 发现不重复入队 → 桌面通知到达（发现 1/待人工 1）。**无任何真实理赔被执行或伪造**。
- 完整报告：`docs/TEST_REPORT.md`

## 10. 后续开发提示

- 改 `sku-collector.ts` 后直接 `npm run build` 即可生效（注入时从磁盘读）；改 SW/页面代码后需在 chrome://extensions 重载扩展。
- 接真实揽收超时订单时：先 `scrot` 截图存证结构 → 更新 `docs/1688_PAGES.md` → 改 `LiveOrderSource`/`LiveClaimExecutor` → 保留「needs_human」兜底。**本期的安全基线：LiveClaimExecutor 只读探测，不提交真实理赔；提交成功识别未经验证，启用前必须单独评审 + 用户明确授权 + 平台确有可提交场景。**
- 模块 A 端到端干跑步骤（已验证，2026-11-16）：管理页 → 理赔 → 「立即扫描」→ 观察 发现 1 笔 → 入队 → 执行后「需要人工处理」(已有理赔记录) → 结果回读把 `resultStatus` 同步为 已驳回（该单已理赔失败）→ 再扫描验证不重复入队。登录失效应触发桌面通知 `exception.login`。**注意：发现链为两阶段 CTMO 注入（`claim-finder` 改写 URL 导航 → `claim-collector` 在 CTMO 视图提取），不要改回「点击 + 原地轮询」**。
- 任何「页面结构变化」一律报告适配问题，不得静默产生错误数据（taskbook §十三）。
