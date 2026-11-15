// 注入「我申请的理赔」列表页的回读脚本（自包含，禁止 import）。
// 入口：https://bao.1688.com/service/compensation/compensation_buyer_list.htm
// 页面结构（2026-11-15 真实实测，docs/1688_PAGES.md §7）：普通 <table>，列 =
//   理赔编号 | 订单编号 | 申请时间 | 卖家 | 订单金额（元） | 申请理赔金额（元） | 放款方式 | 状态 | 操作
// 本脚本只读取，不点击任何操作按钮。
interface ClaimResultRow {
  claimId: string;
  orderId: string;
  applyTime?: string;
  orderAmount?: number;
  claimAmount?: number;
  statusText: string;
}
interface InjectedClaimResultList {
  ok: boolean;
  risk?: 'login' | 'baxia';
  records?: ClaimResultRow[];
  error?: string;
}

const parseMoney = (t: string): number | undefined => {
  const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

((): InjectedClaimResultList => {
  const href = location.href;
  if (/login/i.test(href)) {
    return { ok: false, risk: 'login', error: '页面已跳转到登录页（登录状态可能失效）' };
  }
  const table = document.querySelector('table');
  if (table) {
    const records: ClaimResultRow[] = [];
    const trs = Array.from(table.querySelectorAll('tr'));
    for (const tr of trs) {
      const cells = Array.from(tr.children).map((c) => (c.textContent || '').trim().replace(/\s+/g, ' '));
      if (cells.length < 9) continue; // 表头或空行
      const [claimId = '', orderId = '', applyTime, , orderAmount, claimAmount, , statusText] = cells;
      if (!/^\d{10,20}$/.test(claimId) || !/^\d{10,20}$/.test(orderId)) continue;
      records.push({
        claimId,
        orderId,
        applyTime: applyTime || undefined,
        orderAmount: parseMoney(orderAmount || ''),
        claimAmount: parseMoney(claimAmount || ''),
        statusText: statusText || '',
      });
    }
    return { ok: true, records };
  }
  // 兜底：无 <table> 时按 innerText 解析（理赔编号/订单编号为相邻纯数字行）
  const text = document.body ? document.body.innerText || '' : '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const records: ClaimResultRow[] = [];
  for (let i = 0; i < lines.length - 7; i += 1) {
    const claimId = lines[i];
    const orderId = lines[i + 1];
    const statusText = lines[i + 7];
    if (!claimId || !orderId || !statusText) continue;
    if (/^\d{10,20}$/.test(claimId) && /^\d{10,20}$/.test(orderId)) {
      if (/理赔|处理|审核|仲裁|关闭/.test(statusText)) {
        records.push({
          claimId,
          orderId,
          applyTime: lines[i + 2] || undefined,
          orderAmount: parseMoney(lines[i + 4] || ''),
          claimAmount: parseMoney(lines[i + 5] || ''),
          statusText,
        });
        i += 8;
      }
    }
  }
  return { ok: true, records };
})();
