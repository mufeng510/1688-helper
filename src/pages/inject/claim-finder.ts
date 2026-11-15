// 注入到买家订单列表 iframe（air.1688.com）：把列表导航到「揽收超时」筛选视图。
// 真实页面实证（2026-11-16）：「揽收超时」入口在 hover tooltip 中，点击后 iframe 整页
// 导航到 buyer-order-list.html?…&tradeStatus=CTMO&page=1，注入上下文随之销毁、无法原地轮询。
// 因此本脚本只触发导航（URL 参数等价点击效果），不读数据、不提交任何表单；
// 列表数据由 pages/inject/claim-collector.js 在导航完成后读取（两阶段注入）。
// 本脚本在所有 frame 执行；非列表 frame 返回 undefined。

interface InjectedClaimFindResult {
  frame: 'list';
  navigating?: boolean;
  alreadyCtmo?: boolean;
  risk?: 'login';
  error?: string;
}

(async (): Promise<InjectedClaimFindResult | undefined> => {
  const href = location.href;
  if (/[?&]tradeStatus=CTMO(\b|&|$)/.test(href)) {
    // 已经是揽收超时视图（例如前一次导航已生效、重复扫描）
    return { frame: 'list', alreadyCtmo: true };
  }
  if (!href.includes('buyer-order-list')) {
    if (/login/i.test(href) || /登录/.test(document.title || '')) {
      return { frame: 'list', risk: 'login', error: '页面已跳转到登录页（登录状态可能失效）' };
    }
    return undefined;
  }
  try {
    const u = new URL(href);
    u.searchParams.set('tradeStatus', 'CTMO');
    u.searchParams.set('page', '1');
    location.assign(u.toString());
    return { frame: 'list', navigating: true };
  } catch (err) {
    return { frame: 'list', error: err instanceof Error ? err.message : String(err) };
  }
})();
