# 1688 页面调研笔记（2026-11-14，真实登录态实测）

实测环境：用户 Chrome（已登录 1688 买家账号），中继/自动化由 browse 驱动。
测试期间仅做浏览与只读操作，测试订单为账号内已有的真实历史订单；页面未执行任何提交/修改操作。

## 1. 买家订单列表

- 入口：买家工作台 `https://work.1688.com/home/buyer.htm?_path_=buyer2017Base/2017buyerbase_trade/buyList`
  - 主页面嵌入订单列表 iframe：`https://trade.1688.com/order/buyer_order_list.htm?tracelog=work_2_m_buyList`
  - 实际 SPA：`https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html?tracelog=work_2_m_buyList&page=1&pageSize=10`
- 列表以 Lit Web Components + shadow DOM 渲染（`<app-root> > <order-list> > <order-item> > 各部件`）。
- 每个列表项含影子 DOM 内链：
  - 订单详情：`https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=<订单号>`
- 数据加载走 1688 内部 mtop 网关（POST，带服务端签名）：
  - `mtop.1688.trading.dataline.service` + serviceId `OrderListDataLineService.buyerOrderList`，param `{"page":1,"pageSize":10}`
  - 响应为双层嵌套 JSON（`data.data.result` 是字符串化 JSON），内含订单完整信息：orderId(`id`/`idStr`)、`gmtCreate`、`gmtPayment`、`orderEntries[]`（含 `skuId`? 不含skuId，含 spec 文本/价格/数量/`trackingNo`/售后标记 `afterSaleComplaintDoing` 等）、`buyerInfo.loginId` …
  - 该接口签名由页面自身 mtop 库（`lib-mtop/2.7.4/mtop.js`）在浏览器内完成，扩展**不应重放签名请求**，应走「后台标签 + 读页面数据」方案。
- 筛选条件（来自 `OrderQueryFilterDataLineService.getQueryFilterOptions`，`ORDER_LIST_PC_BUYER`）：
  - 订单状态 tradeStatusOptions：待付款 waitbuyerpay / 待发货 waitsellersend / 正常发货 deliveryGoodsNormal / **发货超时 TMOT** / 待收货 waitbuyerreceive / 已收货 confirm_goods_but_not_fund / 退款售后 dispute / 退款退货中 waitselleragree / 售后中 aftersale / 投诉中 toushu / 待评价 availableRemark / 交易成功 success / 交易关闭 cancel
  - 订单类型 orderTypeOptions：分销 fx / 淘宝代销 sp / 加工定制 custom_made / 极速收款 instant / 伙拼 hp / 内部商城 mall / 分销严选 jxhy / 一件代发 yjdf / 先采后付 xchf / 跨境直采 kjzc
  - 支付方式 tradeTypeOptions：支付宝 6 / 账期 10 / 分阶段 7 / 先采后付 shegou / 对公转账 mybank_eft / 银行转账 mybank_peft / 跨境宝 kjpay / 跨境直采 CROSS_BORDER_MYBANK
- 顶部视图 Tab：全部订单 / 常购 / 履约异常 / 售后待处理 / 复购合约；「履约异常」下有子 Tab：待收货 / 退款售后。
- **「揽收超时」的真实入口（2026-11-15 用户截图确认）：买家工作台 → 全部订单 →「待收货 127」下拉菜单 →「正常待收 127 / 揽收超时」**。即「待收货」状态下有一个子筛选下拉，可切换「揽收超时」视图；截图时「揽收超时」下无数据（0 笔）。该入口是理赔扫描模块 A 的正确切入点，不是 TMOT 筛选值，也不是「履约异常」Tab（两者是此前臆测，已被截图纠正）。
  - 实际 URL/控件参数待出现揽收超时订单后实测记录；在此之前不臆造筛选参数。
  - 已为该订单发现路径预留 `LiveOrderSource`（见 src/modules/claim/source.ts），未适配前明确返回空并记录日志。
- **未发现名称为「揽收超时」的订单状态值**；与揽收/发货超时相关的可见入口为「发货超时 TMOT」与「履约异常」视图。「去申请理赔」按钮只可能出现在符合理赔条件（48小时发货延必赔 / 揽收超时赔付等）订单的详情或列表项操作区，当前账号无此类订单，无法实测 DOM。**真实揽收超时订单相关 DOM 结构为真实页面依赖项，不得臆造。**
- 订单列表 URL 支持分页参数 `page` / `pageSize`。

## 2. 订单详情

- 新版详情（air.1688.com ctf trade-order-detail）：基础状态时间轴（待付款→待发货→待买家确认收货→交易成功）、订单信息/物流信息/交易方式三个 Tab、收货信息、卖家信息、货品表（含 7天无理由 / 极速退款 / 48小时发货 / 退货包运费 等保障标签）。
- 旧版页面（page.1688.com）已 404。
- 理赔入口不存在于普通已完成订单——符合预期。

## 3. 理赔（发起的理赔）

- 入口：买家工作台 → 退款维权管理 → **发起的理赔**：`https://work.1688.com/home/buyer.htm?_path_=buyer2017Base/2017buyerbase_trade/compensationBuyerList`
- 实际 iframe：`https://bao.1688.com/service/compensation/compensation_buyer_list.htm`
- 页面标题「我申请的理赔」；列结构：理赔编号 / 订单编号 / 申请时间 / 卖家 / 订单金额（元）/ 申请理赔金额（元）/ 放款方式 / 状态 / 操作；空状态「您暂无任何理赔」。
- （bao=保障/理赔子系统）

## 4. 商品详情页（detail.1688.com/offer/{id}.html）

- 页面为 SSR + React 应用，**所有 SKU 数据以内联 JSON 形式嵌在 `<script>` 中**（`window.contextPath` 开头的大段 JS，当前实测该内联脚本未被页面执行，`window.context` 为 undefined——疑似 CSP 阻止内联脚本）。
- 直接从 DOM 文本可提取关键模型（脚本文本本身即 JSON 拼装）：
  - `skuModel.skuProps`：规格维度数组，如 `[{"fid":404,"prop":"颜色","value":[{"name":"强磁塑胶黑色","imageUrl":"..."}, …]}]`（本例单维度 11 个值）
  - `skuModel.skuInfoMap`：键 = specAttrs（本例为单值名称如 `强磁塑胶黑色`；多维度商品大概率为逗号连接，需运行时按已知维度值拆分适配，**以真实多维度商品验证**）
    - 每个条目：`{ specId, skuId, specAttrs, price, discountPrice, canBookCount(库存件数), saleCount, isPromotionSku }`
- 渲染后的 DOM 中：SKU 行 `.expand-view-item`，标签 `.item-label`（title 为规格名），价格 `.item-price-stock`，库存为 `od-text[i18n="sku-stock"][data]`（data 为 JSON 数组如 `["99165", "件"]`）。
- **结论：采集器应优先解析内联 JSON（skuModel），DOM 行作为兜底/完整性校验。** 解析内联 JSON 不需要执行页面脚本，比依赖 `window.*` 更稳。
- 商品基本信息：标题在 `<title>`（含「 - 阿里巴巴」后缀）；1688 商品 ID = URL 中 offerId；公司名/主图等在 `window.context` 内联 JSON 的 `result.data.productPackInfo` / offer 字段中可解析。
- 风控页特征：baxia（`g.alicdn.com/sd/baxia/*`、`baxia-entry`、滑块 `baxia-dialog`）、被拦截时 `page.evaluate` 明显变慢/超时（实测遇到一次），可用于「风控/验证码」识别；成熟做法是同时扫描 DOM 关键词 + URL 特征 + 页面加载异常。
- 登录态判定：买家工作台/订单页能出现订单内容即为已登录；未登录会跳 `login.1688.com`。扩展可通过打开任一已登录页检查登录跳转来判断。

## 5. 对架构的影响

1. 一切采集走「后台标签页 + scripting.executeScript 读取页面（隔离世界即可读 DOM 与 script 文本）」，不走 SW 直接 fetch（避免签名/风控/CHIPS 分区 cookie 问题）。
2. 理赔扫描复用订单列表页；真实「揽收超时」入口 = 「待收货」下拉 →「揽收超时」（2026-11-15 截图确认），控件参数待真实订单验证。
3. 商品页 SKU 监控完全可行：内联 JSON 方案确定性高。

## 6. 真实环境验证记录（2026-11-15）

环境：用户 Chrome（已登录 1688 买家账号），扩展解压加载于 `/home/jerry/workspace/1688-helper/dist`（扩展 ID：`bjnbhbmdnhdnplflhmdbinflhdkfcine`）。

- **商品页**：`https://detail.1688.com/offer/991485897552.html`（强磁塑胶引磁片磁吸贴片magsafe无线充电宝伴侣手机壳磁吸引磁环）
- 首次扫描（10:56）：基准快照建立，11 个 SKU，`matchedBy: skuId` 解析路径生效，**不发通知**（符合首次只建基准规则）。
- 第二次扫描（10:58）：与基准对比，`changes: 0`，无变化，无通知（符合预期）。
- 连续失败计数验证：修复前因误判风控连续失败 2 次（UI 显示「2」）；修复后成功，计数清零（符合「成功后清零」规则）。
- 后台标签页机制验证：扫描时后台打开商品标签页 → 注入采集器 → 完成后自动关闭；用户当前标签页（买家工作台）全程未被抢占/刷新。

### 风控/验证码误判事故与修复

- 现象：所有商品扫描均失败，原因日志为「页面疑似风控/验证码拦截」。
- 根因：采集器把「页面 HTML 中出现 baxia 字样 + 存在 baxia 相关 DOM 节点」判定为风控；而 1688 商品页**始终**嵌入 baxia 反爬脚本与隐藏验证码容器，导致 100% 误判。
- 修复（src/pages/inject/sku-collector.ts）：只有**可见**的验证/拦截界面（`getBoundingClientRect` 有尺寸且非 display:none/visibility:hidden/opacity:0）、或 URL 为 punish/verify/captcha、或标题含「验证码/安全验证/滑块验证」时，才判定为风控。
- 验证：修复后同一商品扫描成功（见上）。**教训：风控识别必须基于「可见的拦截界面」，不能基于页面是否包含反爬脚本。**
