// 注入商品详情页的采集脚本（自包含，禁止 import）。
// 职责：识别风控/登录失效；提取内联 skuModel 脚本文本与基础商品信息；原样返回给 SW。
// 解析逻辑在 SW 端（可单测），本脚本不做重活。

interface InjectedResult {
  ok: boolean;
  risk?: 'baxia' | 'login' | 'punish' | 'empty';
  offerId?: string;
  url?: string;
  title?: string;
  image?: string;
  priceRangeText?: string;
  soldText?: string;
  scriptText?: string;
  error?: string;
}

((): InjectedResult => {
  try {
    const href = location.href;
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const title = document.title || '';

    // ---- 风控 / 登录失效识别 ----
    // 注意：1688 商品页始终嵌入 baxia 反爬脚本与隐藏的验证码容器，
    // 「页面包含 baxia 字样」≠ 被风控。只有出现【可见】的验证/拦截界面、
    // 或被重定向到验证页/punish 页时，才判定为风控。
    const isVisible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const isLoginUrl = /login/i.test(href);
    const hasLoginForm = !!document.querySelector('input[name="fm-login-id"], form[action*="login"]');
    const loginHint = isLoginUrl || (hasLoginForm && /登录|login/i.test(title));
    const punishUrl = /punish/i.test(href) || /verify|captcha/i.test(new URL(href, window.location.href).pathname);
    const titleVerify = /验证码|安全验证|滑块验证/.test(title);
    const baxiaVisible = Array.from(
      document.querySelectorAll('[class*="baxia"], [id*="baxia"], [class*="nc_wrapper"], [class*="captcha"], [class*="slide-view"], [class*="punish"]'),
    ).some(isVisible);
    const offerMatch = href.match(/offer\/(\d+)\.html/);

    if (loginHint) {
      return { ok: false, risk: 'login', offerId: offerMatch?.[1], url: href, title };
    }
    if (punishUrl || titleVerify || baxiaVisible) {
      return { ok: false, risk: 'baxia', offerId: offerMatch?.[1], url: href, title };
    }
    if (!document.body || (document.body.textContent || '').trim().length < 20 && !html.includes('skuModel')) {
      return { ok: false, risk: 'empty', offerId: offerMatch?.[1], url: href, title };
    }

    // ---- 商品信息 ----
    const cleanTitle = title.replace(/\s*-\s*阿里巴巴\s*$/, '').trim();
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined;
    const priceMatch = (document.body?.textContent ?? '').match(/¥[\d.]+\s*[~～-]\s*¥?[\d.]+[^\s]{0,12}/);
    const soldMatch = (document.body?.textContent ?? '').match(/已售[\d万+]+件[^\s]{0,6}/);

    // ---- 内联 skuModel 脚本文本 ----
    let scriptText: string | undefined;
    const scripts = Array.from(document.scripts);
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes('"skuModel"')) {
        scriptText = text;
        break;
      }
    }

    return {
      ok: Boolean(scriptText),
      offerId: offerMatch?.[1],
      url: href,
      title: cleanTitle,
      image: ogImage,
      priceRangeText: priceMatch?.[0]?.slice(0, 40),
      soldText: soldMatch?.[0]?.slice(0, 20),
      scriptText,
      error: scriptText ? undefined : '未找到包含 skuModel 的内联脚本（页面结构可能已变更或未加载完成）',
    };
  } catch (err) {
    return { ok: false, error: `采集脚本异常：${err instanceof Error ? err.message : String(err)}` };
  }
})();
