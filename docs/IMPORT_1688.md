# 1688 商品一键导入（模块 D，v0.4.0）

> 契约来源：`xhs-workstation/docs/extension-1688-import.md`（需求）与 `xhs-workstation/docs/api-reference.md`（API）。
> 工作台侧实现已交付并对应 `docs/import-1688.md` D-13。扩展侧本文件记录实现与验证状态。
> **2026-11-15 状态：端到端真实验证通过（调试实例 127.0.0.1:8081，可 `docker compose -f /tmp/opencode/ext-debug-compose.yaml down -v` 整体清空）。后端 API 契约（health/401/400/422/502 回滚/媒体落盘与鉴权）与扩展 UI 全链路（设置页 → 授权域名 → FAB → 预览卡片 → 确认导入 → /products/<id> 图片本地化）均已实测。详见下文「端到端验证」与「未验证 / 待办」。**

## 模块划分

- `src/modules/import1688/`
  - `types.ts`：预览 JSON / Execute 请求（与 API 契约一致）。
  - `payload.ts`：纯逻辑，可单测——Base URL 归一化、`maskToken`、图片域名白名单（https + `*.alicdn.com` / `*.tmall.com` / `*.taobao.com`）、预览 → 卡片状态、`buildExecuteRequest`（客户端校验：name≤120、blocks≤20、content≤20000、images≤24）、`isValidExecuteRequest`（SW 兜底）。
  - `settings.ts`：独立 storage key `import1688`（`{ baseUrl, token? }`），不进 AppSettings schema。
  - `client.ts`：SW 侧 fetch——`ingest`/`executeImport`/`checkHealth`；`credentials:'omit'`；错误映射（400/401/403/413/422→detail 直显/502→整体回滚提示/503）；错误信息绝不含 Token；401/403 标记 `authRequired`。
  - `collect.ts`：SW 中 `chrome.scripting.executeScript({ world: 'MAIN' })` 读 `window.context`（优先，JSON ≤8MB）→ 退回 `document.documentElement.outerHTML`；`offer_id` 从 href 正则提取。
  - `service.ts`：编排 `previewImport`（采集→ingest→预览）与 `executeImportRequest`（校验→execute）。
- `src/pages/inject/import-1688.ts`：content script（隔离世界），**classic script、自包含**（见下）。Shadow DOM 内：📥 悬浮按钮 + 预览确认卡片（名称可编辑、只读信息行、资料区块勾选/编辑/删除/全选/全不选/恢复默认、主图网格默认全选、详情图网格默认不选、图片失败占位不阻塞导入）+ toast（401/403 给「打开扩展设置页」按钮；成功后给「打开工作台」按钮 → `import1688.openProduct` → `/products/<id>`）。所有动态内容走 textContent/DOM API（防 XSS）。
- `src/background/router.ts`：消息 `import1688.preview|execute|testConnection|openProduct|openSettings|openDoc`（`openDoc` 打开工作台仓库 docs/import-1688.md）。
- `src/pages/manage/views/settings.ts`：工作台卡片（Base URL、Token password 型、只显未 4 位、清除按钮、授权工作台域名、连接测试 → `GET /api/health`；混合内容/https 帮助文案）。
- manifest：新增 `content_scripts`（`*://detail.1688.com/offer/*.html`、`*://m.1688.com/offer/*.html`，document_idle）；`permissions` 不变（storage/alarms/scripting/notifications）；新增 host 权限走 `optional_host_permissions` + 设置页点击授权（`chrome.permissions.request`，与 Webhook 域名授权同模式）。

## 关键构建细节

MV3 content_scripts 是 classic script，不能引用 vite 代码分割的 ESM chunk。`vite.content.config.ts` 单独打包 `import-1688.ts`（`inlineDynamicImports`，全部内联），**必须在主构建（`emptyOutDir`）之后运行**：`npm run build` = `tsc --noEmit && vite build && vite build -c vite.content.config.ts`。改 content script 只跑主构建会得到引用 chunk 的不可用文件（Chrome 直接 SyntaxError）。

## 验证记录（2026-11-15）

- `npm test`：74/74 → 当日晚间复测 76/76 → **v0.4.0 复测 83/83**（新增 execute 意图/mode 校验/checkByOffer 用例）。
- `npm run typecheck`：全绿（顺带修复 tests/backup.test.ts 两处 pre-existing `noUncheckedIndexedAccess` 报错）。
- 真实页面（用户 Chrome，dist 加载，扩展 ID bjnbhbmdnhdnplflhmdbinflhdkfcine）：offer 页 991485897552 悬浮按钮注入可见、tooltip 正常；未配 Token 点击 → toast「尚未配置 API Token，请先在「管理页 → 系统设置 → 工作台」中设置」；设置页工作台卡片渲染正确（v0.2.0 实测）。

## 端到端验证（2026-11-15，调试实例 127.0.0.1:8081）

调试实例：`/tmp/opencode/ext-debug-compose.yaml`（含 APP_PASSWORD；数据目录 `/tmp/opencode/ext-debug-data`；`docker compose -f /tmp/opencode/ext-debug-compose.yaml down -v` 可整体清掉）。manage 权限 Token「ext-debug-import-test-2」（token id=3；id=2「ext-debug-import-test」已于 15:44 撤销，用于 401 验证；id=1 为用户自己的，未触碰）。连接信息见 `/tmp/opencode/ext-debug.json`（不入库）。

### 后端 API 级（curl，不经过浏览器）

| 用例 | 结果 |
|---|---|
| `GET /api/health` | 200，`degraded`（ai 无服务商，属正常） |
| 撤销 Token 调 ingest | 401「Token 无效或已撤销」 |
| 无 Authorization 调 ingest | 401「未登录」 |
| ingest 空 context | 400「无法从页面数据识别 offerId。请在 ingest 请求中显式提供 offer_id。」 |
| ingest 稀疏 context（仅 offer_id + 空 consign） | 422「页面数据中缺少商品内容（result.data）。」 |
| ingest 真实页面数据（`context` 策略；由 detail.1688.com 页面内嵌 `window.context` 重建为合法 JSON，104 KB） | 200 预览：商品名 / 价格 1.15–7.50 / 13 属性 / SKU 11 组合 / 供应商+销量 / 12 主图 / 15 详情图 / 5 资料区块，warnings=[] |
| ingest 匿名 `{html}`（curl 直抓页面） | 422「商品数据 JSON 解析失败……」——内嵌字面量含未加引号的数字键，严格 JSON 解析器无法直提；真实链路走浏览器 `window.context` + `JSON.stringify`，不受影响 |
| execute `offer_id` 非法（`"abc"`） | 422（offer_id pattern `^\d{6,15}$`） |
| execute 图片域名不在白名单（evil.example.com） | 400「图片域名不在白名单：evil.example.com」 |
| execute 白名单内但 404 的图片 | **502「图片下载失败（HTTP 404）」，product 计数未变（整体回滚），无半成品残留** |
| 媒体落盘与鉴权 | `GET /api/media/3/raw` → 200 image/jpeg，408,483 B，sha256 已记录；无 Token → 401 |
| 图片去重 | 多次导入复用同一 `media_asset_id`（同 sha256 不重复下载/存储） |

### 浏览器 UI 级（用户点按 + 后端核对）

- 设置页：Base URL `http://127.0.0.1:8081` + manage Token「ext-debug-import-test-2」→「保存工作台设置」→「授权工作台域名」→「连接测试」（链路由导入成功反证：未授权域名 / Token 错误都会 401/422，导入必失败）。
- 1688 offer `991485897552` 页「📥 导入工作台」→ 预览卡片（名称 / 价格 1.15–7.50 / 主图 12 张默认全选 / 5 资料区块默认全选 / 详情图 15 张默认不选；用户取消勾选了「商品属性」区块）→「确认导入」→ 成功 toast + 「打开工作台」按钮。
- 后端核对（`/api/products`、`/api/products/{id}`）：**product id=5 与 id=6** 均为 offer 991485897552，4 个区块（用户取消勾选后）、12 张图，全部为本地 `/api/media/N/raw`（首图 `is_primary`）。API 侧按默认全选构建的请求入库为 **product id=4**（5 个区块）。
- https 商品页 → http://127.0.0.1:8081 工作台：**导入成功**（回环地址未被混合内容拦截；局域网 http 私有地址仍未实测）。
- 两份一致商品（id 5/6）为**用户两次独立导入**（间隔约 21 秒，用户已确认）。扩展「确认导入」有 `submitting` 防重锁，单次点击不可能发两次请求；**工作台不按 offer_id 去重**，同一 offer 可重复入库——重复导入会产生重复商品（本实例内 id 2/4/5/6 均为同一 offer）。

### 构建与单测

- `npm test` → **76/76**；`npm run typecheck` 全绿；`dist/` 为 v0.3.0（manifest 与 content script 独立打包产物一致）。

## 重复导入防护（v0.4.0，2026-11-15，扩展侧已完成 / 工作台侧待实现）

**契约（扩展已按此实现，工作台升版需对齐）**：

- 新增 `GET /api/products/import/1688/by-offer/{offer_id}`（manage 鉴权）→ 200 `{ "exists": false }` 或 200 `{ "exists": true, "product": { "id", "name?", "updated_at?", "created_at?", "block_count?", "image_count?" } }`。404/网络错误时扩展降级：不阻断导入，卡片显示「未能检查」提示。
- `POST .../execute` 请求体新增字段：`mode: "create" | "update"`（扩展总是显式发送）与 `allow_duplicate?: boolean`（用户明确「仍然新建」）。
  - `mode=create`：工作台已存在同 offer_id → **409 Conflict**，响应 `{ "detail": "…", "existing": { "id", … } }`；除非 `allow_duplicate=true` 则新建。
  - `mode=update`：已存在 → 更新该商品（语义见下，工作台决定）；不存在 → 创建（upsert）。
  - `allow_duplicate=true` 仅允许与 `mode=create` 组合。
- `execute` 响应新增 `action?: "created" | "updated"`（扩展据此提示「已导入/已更新」）。
- 工作台须为 `products` 增加 `offer_id` 列并建唯一索引（允许多个 NULL）；历史已导入商品可从「1688 来源链接」区块文本（`offerId：<数字>`）回填，回填不上的留 NULL。

**扩展侧行为（已实现，未在真实页面点按验证）**：

- FAB 点开（预览成功后）SW 顺带调 by-offer：已存在 → 卡片顶部蓝色「工作台已有该商品 id=N · 更新于…」横幅 + 两个单选「更新已有商品（默认，推荐）/ 仍然新建」；按钮文案随选项为「确认更新 / 确认导入」。
- 未存在 → 横幅隐藏，按钮「确认导入」，请求 `mode=create`。
- 检查失败 → 横幅显示「未能检查…（原因）」，不阻断，请求仍为 `mode=create`（由工作台 409 兜底）。
- 确认后工作台返回 409 → 顶部红色提示 + 「关闭窗口重开后选择『更新已有商品』即可」。
- 成功横幅 toast 依据 `action` 显示「已导入 / 已更新商品：name」。
- 防重仍有 `submitting` 锁；重复保护权威在工作台（409），扩展侧为 UX 层。

**双重保证**：扩展请求前 UI 提示 + 工作台 execute 端 409/upsert 强制。扩展层失效（旧工作台无 by-offer → 404 降级；或检查被绕过）时，只要工作台升版实现了 409/update，重复仍不会静默产生。

**验证状态（2026-11-15 工作台升版后补测，调试实例 127.0.0.1:8081）**：

- ✅ by-offer：200 exists:true（命中 id=2）/ 200 exists:false / 422 pattern / 401 未登录。403（非 manage Token）未测（实例内无只读 Token）。
- ✅ execute 行为矩阵：create 撞重复 → 409（含 existing 摘要，product 计数不变）；create+allow_duplicate → 200 `action=created`（新 id=8，by-offer 仍指向 id=2）；update 已存在 → 200 `action=updated`、id 不变、内容确实被替换、图片 media_asset 按 sha256 复用（不重复下载）；update 不存在 → upsert 创建（id=7）；allow_duplicate+update → 422；502（图片 404）update 失败 → product 字节级回滚（Marker/updated_at 均不变）；并发两次 update → 两次 200、id 一致、无新增商品（唯一索引兜底）。
- ✅ 测试后删除 id=7/8，实例恢复（6 个商品；by-offer 新 offer 已回到 exists:false）。
- ⚠️ 扩展 UI（横幅默认「更新」、仍然新建、409 红色提示）真实点按未验证——需用户重载扩展至 v0.4.0 后点按。

## 未验证 / 待办（2026-11-15 更新）

1. 503 磁盘不足路径（需磁盘压力场景，未复现）。
2. Token 撤销后 401 → 扩展内「打开扩展设置页」引导 toast 的真实点按演练（后端 401 与扩展错误映射已就绪，前端未点按验证）。
3. 局域网 http 工作台（如 `http://192.0.2.10:8080`）：混合内容 / 私有网络访问策略未实测（127.0.0.1 回环已通）。
4. `m.1688.com` 移动端 offer 页注入未实测（content_scripts 已匹配该 pattern）。
5. 详情图（默认不选）导入路径未实测。
6. 既有能力回归：SKU 扫描 / 理赔模拟 / 通知 / popup「添加监控」自 v0.2.0 起未逐项重跑。
7. 测试商品 id 4/5/6（offer 991485897552）保留在调试实例内；用户可在工作台删除，或用 compose `down -v` 整体清空。
8. ~~工作台未运行导致无法端到端验证~~ → 已解决（见上文）。
9. ~~502 回滚、图片落盘、`/products/<id>` 可见~~ → 已验证。
10. ~~重复导入防护（v0.4.0）by-offer/409/update/action~~ → 已验证（2026-11-15 工作台升版后 API 级全矩阵通过，含 502 更新回滚、并发唯一性、allow_duplicate 组合校验）；**扩展 UI 真实点按仍未验证**（需重载扩展至 v0.4.0 后点按：横幅默认「更新」、id 不变；选「仍然新建」得新 id；409 红色提示）。

## 运维注意

- 扩展「重新加载」按钮在 chrome://extensions 卡片右下（≈ (732, 537)，1920×1080）；版本号升到 0.2.0 后卡片显示 0.2.0 即为更新成功。**点按刷新/关闭浏览器等操作影响用户窗口，未经用户允许不要 GUI 自动化其 Chrome**（2026-11-15 用户浏览器两次自行消失，疑似用户介入或 Chrome 崩溃；改用文档引导用户自测）。
- 日志：`import1688` 模块，不含 Token；响应体仅取 status 与 detail 文本用于界面展示。
