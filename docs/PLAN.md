# 技术方案与实施计划（第一步：项目分析产出）

## 1. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 运行形态 | Chrome 扩展，Manifest V3 | 任务书强制；MV2 已禁用 |
| 语言 | TypeScript（strict），构建 Vite | MV3 官方推荐；AI 辅助开发友好；产物静态、无后端 |
| UI | 原生 TS + Web Components-free 模板字符串 + 单一 CSS（admin 页） | 个人自用、避免过度工程化；零运行时框架依赖 |
| 本地数据库 | IndexedDB（`idb` 封装，ISC，Jake Archibald 维护） | SW 中唯一结构化大存储；扩展无服务器 |
| 配置 | chrome.storage.local（设置）+ IndexedDB（业务数据）+ storage.session（临时） | 按容量与语义分区 |
| 定时 | chrome.alarms（≥30s 节奏，启动时 ensure 重建） | MV3 唯一正道 |
| 通知 | chrome.notifications + Webhook（SW fetch，重试≤3，密钥不入日志） | 双通道可开关 |
| 测试 | Vitest（纯逻辑：比较/状态机/队列/去重/完整性）+ Chrome 实装冒烟 | SW 环境难以单测 DOM，逻辑与 DOM 分离 |
| 质量 | eslint（可选）+ `tsc --noEmit`；不引入多余依赖 | 任务书：维护活跃、简单成熟优先 |

**明确不引入**：React/Vue 等框架、无 IndexedDB 之外的数据库服务、无外部服务器、无独立浏览器。

## 2. 总体架构

```
background (service worker, 无状态)
  ├─ scheduler.ts     alarms 巡检：到期任务 → 入队执行；SW 启动时 ensure alarms + 恢复中断任务
  ├─ queue.ts         持久任务队列（IDB）：pending/running( lease )/done/failed/needs_human
  ├─ tab-runner.ts    后台标签管理：创建 → 等 complete → 注入采集器 → 回传 → 按状态关标签/留标签
  ├─ notify.ts        双通道通知 + 失败重试 + 记录；Webhook 密钥绝不进日志
  ├─ log.ts           统一日志（IDB），级别/模块/上下文；不记录 Cookie/Token/Webhook 密钥
  ├─ settings.ts      配置读取（IDB+storage.local，带默认值与版本迁移）
  └─ router.ts        runtime.onMessage 路由（admin 页 ↔ SW）
modules/
  sku-monitor/        采集器（内联 JSON skuModel 解析 + DOM 兜底）、完整性校验、快照、diff、通知聚合
  claim-engine/       扫描框架、去重（orderId 唯一索引）、状态机、重试(≤4次=首次+3重试)、
                      ClaimExecutor 接口（SimulationExecutor 完整可测 / RealExecutor 留待真实订单）
  html-capture/       【仅预留】接口与模块边界，不实现推送
common/               db(idb) / idb-schema(版本迁移) / types / utils
pages/admin/          总览 / 理赔 / SKU 监控 / 任务 / 设置 / 日志 / 数据备份恢复（单页多 Tab）
tests/                vitest 用例（内存版 IDB 或 fake-indexeddb）
```

### 关键业务规则（固化进代码）

1. **SKU 首次扫描只建基准快照**，无通知、不比对；第二次有效扫描起 diff。
2. **不完整扫描（SKU 数异常骤降、JSON 解析失败、缺 canBookCount、风控/验证码拦截）→ 标记 invalid，不改基准、不产生删除/归零变化，连续失败计数 +1**；成功一次即清零。
3. 连续失败 **3 次 → 自动暂停该商品** + 通知 + 列表展示暂停态；用户可手动恢复。
4. 变化比较覆盖：新增/删除 SKU、规格属性变化（同 skuId 优先识别为属性变化而非删+增）、库存增减/归零/恢复、价格变化（仅记录）。
5. 通知：**每商品每轮一次汇总**；无变化不通知；同一（商品+skuId+变化类型+前后值）不重复通知（通知去重表）。
6. 理赔：**申请提交状态与最终理赔结果分开记录**，成功提交 ≠ 到账；`无法确认是否提交成功 → 先查平台状态，禁止盲目重复提交`；orderId 唯一索引防重；同一订单同时只能在一个任务里（running 租约）。
7. 风控/验证码/登录失效 → 立即暂停相关任务 + 桌面通知 + **保留标签页**等人工处理；绝不自动绕过。
8. 浏览器关闭后 alarm 补发；SW 回收后从 IDB 重建；中断任务（running 且租约过期）重新入队。
9. 模块间故障隔离：每个模块的任务执行独立 try/catch，单模块异常不影响其它模块。
10. 数据备份：全库导出 JSON（下载），导入恢复；历史默认长期保留，提供手动清理。

### 数据库（IndexedDB，v1，带 upgrade 分支支持后续迁移）

stores: `settings`, `skuProducts`, `skuSnapshots`, `skuChanges`, `skuFailures`(并入 product), 
`claimOrders`(唯一索引 orderId), `claimBatches`, `tasks`, `logs`, `notificationLog`, `meta`(schemaVersion)

## 3. 里程碑与顺序

1. **基础设施**：Vite+TS 脚手架、manifest、DB schema、日志、设置、alarms/队列/tab-runner、通知、备份恢复。
2. **SKU 监控（完整交付）**：添加/列表/暂停恢复/立即扫描/详情/快照/变化/通知聚合 + 完整性校验 + 连续失败暂停 + 单测。
3. **理赔框架**：扫描框架（后台标签到订单列表页）、去重、状态机、重试、恢复、模拟执行器、批次汇总通知 + 单测。
4. **管理界面**：总览/理赔/SKU/任务/设置/日志/备份。
5. **集成验证**：真实商品页实采（含数据完整性）、断点恢复、SW 回收恢复、安装冒烟；README/docs/测试报告/Agent.md。

## 4. 真实揽收超时订单依赖项（待用户提供）

以下工作**必须等真实揽收超时订单出现后**才能完成与验证，届时按增量开发继续：

1. 列表页「待收货」下拉 →「揽收超时」的确切控件/参数（2026-11-15 截图已确认入口存在，当前 0 笔订单，无法实测控件参数；此前 TMOT 臆测已纠正）；
2. 「去申请理赔」按钮在真实理赔订单上的 DOM 结构、点击后表单字段（理赔原因/金额/凭证）；
3. 提交成功/失败的平台提示识别；
4. 理赔金额读取、理赔最终状态回读（bao.1688.com 我申请的理赔列表）；
5. 揽收超时订单样本 ≥1 笔用于 E2E。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 内联 JSON 结构随 1688 改版变化 | 解析器版本化 + 完整性校验，失败只报警不产错误数据 |
| 库存字段 `canBookCount` 语义偏移 | 快照同时保留原始 price/stock 文本用于人工核对 |
| 后台标签被 Chrome 丢弃/冻结 | 采集前检查 `discarded/frozen`，失败重排队；任务超时自动释放租约 |
| 风控页伪装加载成功 | 检测 baxia/punish/login 跳转 + 数据完整性双保险 |
| 重复通知 | 通知去重键 + 批次汇总 |
| Webhook 泄密 | 密钥仅 storage.local，日志脱敏；UI 不明文回显（仅掩码） |

## 6. 验收（第一阶段）

见任务书 §十二/§十六；本阶段对外交付：可安装扩展（unpacked）、源码、README（中文）、安装/使用/配置说明、测试报告（单测+实采+安装冒烟）、已知问题清单、真实订单依赖清单。
