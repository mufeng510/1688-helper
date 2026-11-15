# Chrome MV3 技术调研结论（2026-11-14）

完整调研报告由研究代理产出，这里记录对本项目有约束力的结论（官方文档 developer.chrome.com，访问日 2026-11-14）。

## 结论摘要

1. **MV3 唯一合规路径**。MV2 自 2025-07（Chrome 138）全通道禁用，2026-08-31 起从 Web Store 下架。`background.service_worker` 单文件，`persistent` 已移除。
2. **SW 生命周期**：闲置 ~30s 即被终止；单个事件/API 请求 >5min 被强杀；fetch 响应 >30s 也会导致 SW 挂掉。**无内存状态依赖**，一切状态落 IndexedDB / chrome.storage.session。
3. **alarms**：Chrome 120+ 最小周期 30s（官方两处口径不一，按 ≥`periodInMinutes: 0.5` 设计，且它不是精确计时器）；SW 启动时必须校验并补建关键 alarm；睡眠期错过的重复 alarm 最多补发一次。
4. **IndexedDB 在 SW 中可用**（无 window 全局）；chrome.storage.session 10MB、storage.local 10MB；storage.sync ~100KB 不适用大数据。
5. **后台标签**：`chrome.tabs.create({ active: false })` 合法；`chrome.scripting.executeScript({ world: "MAIN" })` Chrome 95+；`tab.url` 需要 host_permissions 或 tabs 权限；后台标签可能被冻结（`frozen`/`discarded` 132+），注入前需确认 readyState。
6. **host_permissions** 授权域名的 SW fetch 可绕过 CORS，但 **CHIPS 分区 cookie 不会随 SW fetch 发出（Chromium 2025-10 已知问题，未修复）**；且 1688 mtop 接口自带签名——**结论：采集一律走后台标签 + 页面上下文，不走 SW fetch**。内容脚本永远受同源策略限制。
7. **notifications**：MV3 可用，iconUrl 必须真实存在；Linux 需通知守护进程。
8. **chrome.alarms 可跨会话持久**（persistAcrossSessions，Chrome 150+ 默认 true），但官方建议仍在 SW 启动时做 ensure。
9. `browser.*` Promise 命名空间 Chrome 148+ 可用，但本项目统一用 `chrome.*` + async/await（配合 `"minimum_chrome_version": "120"`），减少工具链风险。

## 对项目的约束（强制性）

- SW 不保存任何业务状态；所有任务状态先落库再驱动下一步。
- 定时只用 chrome.alarms（≥30s），禁止 setInterval 常驻。
- 采集全部走后台标签 + scripting 注入；SW 直连 1688 仅用于低风险 GET（如连通性测试）且必须校验响应内容。
- 采集器必须做「数据完整性校验」：不完整的扫描不得参与比较、不得覆盖历史快照。
