// 注入「保障服务理赔」申请页的探测脚本（自包含，禁止 import）。
// 入口：https://air.1688.com/app/ctf-page/compensation/service-compensation.html?orderId=<订单号>
// 页面结构（2026-11-15 真实实测，docs/1688_PAGES.md §7）：
//   顶部提示条：「当前订单存在已申请（或系统自动判定产生）的理赔记录。」
//   主区域：「未到承诺发货时间，暂不支持理赔」
// 职责（只读，绝不提交）：识别页面状态，原样返回给 SW，由 executor 映射到理赔结果。
interface InjectedClaimProbe {
  ok: boolean;
  frame: 'top';
  risk?: 'login' | 'baxia';
  /** 页面状态：has_record=已有理赔记录 / not_yet=未到承诺发货时间 / form_ready=出现申请入口 / blocked_unknown=未能识别 */
  state?: 'has_record' | 'not_yet' | 'form_ready' | 'blocked_unknown';
  error?: string;
}

((): InjectedClaimProbe => {
  const href = location.href;
  if (/login/i.test(href) || /login.1688.com/i.test(href)) {
    return { ok: false, frame: 'top', risk: 'login', error: '页面已跳转到登录页（登录状态可能失效）' };
  }
  const body = document.body;
  const text = body ? body.innerText || '' : '';
  const title = document.title || '';
  if (!body || (text.trim().length < 5 && !title)) {
    return { ok: false, frame: 'top', error: '页面未加载或内容为空' };
  }
  // 风控：可见的验证码/拦截界面（与商品页同一规则，勿把隐藏容器误判）
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const baxiaVisible = Array.from(
    document.querySelectorAll('[class*="baxia"], [id*="baxia"], [class*="nc_wrapper"], [class*="captcha"], [class*="slide-view"]'),
  ).some(isVisible);
  if (/验证码|安全验证|滑块验证/.test(title) || baxiaVisible) {
    return { ok: false, frame: 'top', risk: 'baxia', error: '检测到可见的验证码/风控界面' };
  }
  // 状态识别（只匹配固定文案关键词，不臆造表单结构）
  if (/当前订单存在已申请|已申请（或系统自动判定产生）的理赔记录|已存在的理赔记录/.test(text)) {
    return { ok: true, frame: 'top', state: 'has_record' };
  }
  if (/未到承诺发货时间|暂不支持理赔|不支持理赔/.test(text)) {
    return { ok: true, frame: 'top', state: 'not_yet' };
  }
  // 页面出现申请/提交入口且未被平台拦住：真实表单就绪（本期仍不自动提交）
  if (/申请理赔|提交理赔申请|确认申请/.test(text)) {
    return { ok: true, frame: 'top', state: 'form_ready' };
  }
  return { ok: true, frame: 'top', state: 'blocked_unknown' };
})();
