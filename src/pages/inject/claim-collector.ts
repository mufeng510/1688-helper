// 注入买家订单列表的「揽收超时」提取脚本（自包含，禁止 import）。
// 仅在 tradeStatus=CTMO 视图中提取订单行；不点击、不提交任何东西。
// 两阶段注入：先由 claim-finder.js 把列表导航到 CTMO 视图（整页导航，注入上下文随之销毁），
// 本脚本在导航完成后被再次注入读取结果。
// 页面结构（2026-11-15/16 真实实测，docs/1688_PAGES.md §7）：
//   work.1688.com(顶层) > air.1688.com/.../buyer-order-list.html(iframe，Lit + shadow DOM)
// 一致性校验：「共 N 条」声明数与实际提取条数不一致 → 拒绝产出（宁缺勿造）。

interface InjectedClaimOrder {
  orderId: string;
  goodsName?: string;
  goodsInfo?: string;
  seller?: string;
  orderTime?: string;
  claimingInProgress?: boolean;
}

interface InjectedClaimScanResult {
  ok: boolean;
  frame: 'list' | 'other';
  risk?: 'login' | 'baxia';
  orders?: InjectedClaimOrder[];
  countText?: string;
  error?: string;
}

type WalkOut = { el: Element; text: string };

// 深度遍历（穿透 shadow DOM）收集叶子元素文本
const collectLeaves = (root: ParentNode, out: WalkOut[], depth = 0): void => {
  if (depth > 12) return;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) collectLeaves(sr, out, depth + 1);
    const text = (el.textContent || '').trim();
    if (el.children.length === 0 && text && text.length < 200) out.push({ el, text });
  }
};

const collectBy = (root: ParentNode, pred: (el: Element) => boolean, out: Element[] = [], depth = 0): Element[] => {
  if (depth > 12) return out;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) collectBy(sr, pred, out, depth + 1);
    if (pred(el)) out.push(el);
  }
  return out;
};

(async (): Promise<InjectedClaimScanResult | undefined> => {
  const href = location.href;

  // 不在「揽收超时」(CTMO) 视图：不干活（导航可能尚未完成，调用方会重试）
  if (!/[?&]tradeStatus=CTMO(\b|&|$)/.test(href)) {
    if (!href.includes('buyer-order-list')) {
      if (/login/i.test(href) || /登录/.test(document.title || '')) {
        return { ok: false, frame: 'other', risk: 'login', error: '页面已跳转到登录页（登录状态可能失效）' };
      }
      return undefined;
    }
    return undefined;
  }

  try {
    // ---- 等页面渲染出列表或「共 0 条」（最多 12s） ----
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 12_000;
    let ready = false;
    let emptyByCount = false;
    let countText: string | undefined;
    while (Date.now() < deadline) {
      await sleep(250);
      const leavesNow: WalkOut[] = [];
      collectLeaves(document, leavesNow);
      countText = leavesNow.map((l) => l.text).find((t) => /共\s*\d+\s*条/.test(t));
      const hasRow = collectBy(document, (el) => String((el as HTMLElement).className || '').includes('order-item-header')).length > 0;
      if (countText && /共\s*0\s*条/.test(countText)) { emptyByCount = true; ready = true; break; }
      if (hasRow) { ready = true; break; }
    }
    if (!ready) {
      return { ok: false, frame: 'list', countText, error: '揽收超时列表加载超时（页面可能未渲染出订单行）' };
    }
    if (emptyByCount) return { ok: true, frame: 'list', orders: [], countText };

    // ---- 提取订单 ----
    const headers = collectBy(document, (el) => String((el as HTMLElement).className || '').includes('order-item-header'));
    const entries = collectBy(document, (el) => String((el as HTMLElement).className || '').includes('order-item-entry') && !String((el as HTMLElement).className || '').includes('order-item-entry-container'));
    const headerTop = headers.map((h) => h.getBoundingClientRect().top);
    const leavesAll: WalkOut[] = [];
    collectLeaves(document, leavesAll);
    const orderTimeLeaf = leavesAll.map((l) => l.text).join('\n').match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);

    // 卖家：全 frame 内匹配公司类后缀的链接文本（每单 1 个；多单时按行归属最优近似）
    const companyRe = /(有限公司|制衣厂|服饰|贸易|科技|工厂|商行|实业)/;
    const noise = /查看卖家所有订单|找同款|订单详情|确认收货|再次购买|联系卖家|申请理赔|查看保单/;
    const sellerLeaf = leavesAll.find((l) => companyRe.test(l.text) && l.text.length <= 40 && !noise.test(l.text));

    const orders: InjectedClaimOrder[] = [];
    for (const h of headers) {
      const hTop = h.getBoundingClientRect().top;
      // 归属到该 header 之后、下一 header 之前的 entries
      const hIdx = headerTop.indexOf(hTop);
      const nextTop = hIdx >= 0 ? headerTop[hIdx + 1] ?? Infinity : Infinity;
      const myEntries = entries.filter((e) => {
        const et = e.getBoundingClientRect().top;
        return et >= hTop - 1 && et < nextTop;
      });
      const gid = h.getAttribute('data-tracker-args') || '';
      const m = gid.match(/orderId=(\d+)/);
      let orderId = m ? m[1] : undefined;
      if (!orderId) {
        const holder = collectBy(h, (el) => /^\d{13,20}$/.test(el.getAttribute('text') || ''))[0];
        orderId = holder?.getAttribute('text') || undefined;
      }
      if (!orderId) continue; // 没有订单号的行跳过，宁缺勿造
      // 商品名：entry 内最长且像商品标题的链接/文本
      let goodsName: string | undefined;
      let goodsInfo: string | undefined;
      let claimingInProgress = false;
      for (const e of myEntries) {
        const eLeaves: WalkOut[] = [];
        collectLeaves(e, eLeaves);
        for (const l of eLeaves) {
          if (/理赔中/.test(l.text)) claimingInProgress = true;
          if (/^(颜色|尺码|规格)/.test(l.text) && !goodsInfo) goodsInfo = l.text.slice(0, 120);
          if (!goodsName && l.el.tagName === 'A' && l.text.length > 8 && !/快照|48小时|退货|理赔|确认收货|订单详情|再次购买|查看保单|找同款/.test(l.text)) {
            goodsName = l.text.slice(0, 200);
          }
        }
      }
      orders.push({
        orderId,
        goodsName,
        goodsInfo,
        seller: sellerLeaf?.text,
        orderTime: orderTimeLeaf?.[0],
        claimingInProgress,
      });
    }
    // 一致性校验：countText 声明 N 条与实际提取条数不一致 → 视为结构变更，拒绝产出（宁缺勿造）
    const declared = countText ? Number((countText.match(/共\s*(\d+)\s*条/) || [])[1]) : undefined;
    if (declared !== undefined && declared !== orders.length) {
      return { ok: false, frame: 'list', countText, error: `页面声明${declared}条但仅解析出${orders.length}条，拒绝产出（页面结构可能已变更）` };
    }
    return { ok: true, frame: 'list', orders, countText };
  } catch (err) {
    return { ok: false, frame: 'list', error: err instanceof Error ? err.message : String(err) };
  }
})();
