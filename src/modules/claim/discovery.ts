// 注入脚本返回的采集结果 → DiscoveredOrder 映射（纯函数，可单测）。
// 宁缺勿造：orderId 不合法的行一律丢弃；商品名/卖家/金额缺失不致命。
import type { DiscoveredOrder } from './source';

export interface RawCollectedOrder {
  orderId?: unknown;
  goodsName?: unknown;
  goodsInfo?: unknown;
  seller?: unknown;
  orderTime?: unknown;
  claimingInProgress?: unknown;
}

const ORDER_ID_RE = /^\d{10,20}$/;
const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : undefined;
};

export const mapCollectedOrders = (raw: unknown): DiscoveredOrder[] => {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredOrder[] = [];
  const seen = new Set<string>();
  for (const item of raw as RawCollectedOrder[]) {
    if (!item || typeof item !== 'object') continue;
    const orderId = typeof item.orderId === 'string' ? item.orderId.trim() : '';
    if (!ORDER_ID_RE.test(orderId)) continue; // 不合法订单号：丢弃，不臆造
    if (seen.has(orderId)) continue;
    seen.add(orderId);
    out.push({
      orderId,
      goodsName: clean(item.goodsName, 200),
      goodsInfo: clean(item.goodsInfo, 300),
      seller: clean(item.seller, 60),
      orderTime: clean(item.orderTime, 30),
      claimingInProgress: item.claimingInProgress === true,
    });
  }
  return out;
};
