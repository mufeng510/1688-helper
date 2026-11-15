# 1688 智能助手 — 隐私政策

**最后更新：2026-11-15**

本政策适用于「1688 智能助手」Chrome/Edge 扩展（下称「本扩展」）。本扩展的开发者（下称「开发者」）不运营任何服务器，除扩展本身外不收集、不出售、不出租任何用户数据。

## 1. 数据收集与存储

本扩展在你的浏览器本地（IndexedDB 与 chrome.storage.local）保存以下数据：

- 你填写的设置：扫描间隔、通知开关、Webhook 地址/请求头/请求体模板、工作台 Base URL 与对应的 API Token、日志级别等；
- 业务数据：你关注的 1688 商品、SKU 快照与变化记录、理赔任务与订单记录、任务队列、日志、通知发送记录。

**这些数据不发送给开发者，开发者也无法访问它们。**

## 2. 网络请求

本扩展仅向以下地址发送请求：

1. `*.1688.com`：读取你已登录可见的商品详情与订单页面数据（SKU、规格、库存、订单状态等）；
2. 你本人在设置页填写并授权（`chrome.permissions.request`）的 Webhook 地址：推送 SKU 变化/理赔结果/异常通知；
3. 你本人在设置页填写并授权的工作台 Base URL（如自建服务）：通过 ingest/execute 接口导入商品数据；
4. 不发往其他任何地址，不加载远程脚本。

Webhook 与工作台是**你自己拥有和控制的服务**；推送到那些地址的内容（通知文本、商品数据）仅对你的服务可见。

## 3. 敏感信息

- Webhook Token、工作台 API Token：仅保存在本机；不出现在日志、导出文件或任何请求 URL 中（仅出现在发往你自配端点的 `Authorization` 请求头中）；
- 1688 的 Cookie/会话：由浏览器自行管理，本扩展不读取、不复制、不发送 Cookie。

## 4. 数据导出与删除

- 「管理页 → 数据与备份」支持导出全部本地数据为 JSON，并支持导入恢复；
- 卸载/清除扩展立即删除全部本地数据（IndexedDB/chrome.storage.local 随之清除）。

## 5. 第三方服务

本扩展不使用、不嵌入任何第三方分析/统计/广告 SDK。

## 6. 政策更新

如本政策发生变化，将随扩展新版本在商店页面更新日期，重大变更会在更新日志中说明。

## 7. 联系

问题与反馈：<https://github.com/mufeng510/1688-helper/issues>

---

# Privacy Policy — 1688 Helper

**Last updated: 2026-11-15**

This policy covers the "1688 Helper" Chrome/Edge extension (the "Extension"). The developer runs no server and does not collect, sell or rent any user data beyond the Extension itself.

## 1. Data stored locally
The Extension stores the following data **only on your device** (IndexedDB / chrome.storage.local): your settings (scan intervals, notification toggles, Webhook URL/headers/body template, workbench Base URL and API Token, log level) and business data (followed 1688 products, SKU snapshots and changes, claim tasks and orders, task queue, logs, notification records). The developer cannot access these.

## 2. Network requests
The Extension contacts only: (1) `*.1688.com` to read data from pages you are logged into; (2) the Webhook URL you explicitly configure and authorize, to deliver notifications; (3) the workbench Base URL you explicitly configure and authorize, to import product data. It contacts nothing else and executes no remote code. The Webhook/workbench are services you own and control; content sent there is visible only to your service.

## 3. Sensitive data
Tokens are stored locally, never appear in logs, and are sent only in the `Authorization` header to the endpoint you configured. 1688 session cookies are managed by the browser and are never read, copied or transmitted by the Extension.

## 4. Your control
Export/restore everything in Settings → Data & Backup. Uninstalling the Extension deletes all local data.

## 5. Third parties
No analytics, no ads, no third-party SDKs.

## 6. Changes
Material changes will be noted with the extension release and reflected on this page.

## 7. Contact
<https://github.com/mufeng510/1688-helper/issues>
