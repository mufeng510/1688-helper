// 快照比较（纯函数）：产出结构化变化列表。
// 匹配优先级：skuId → specId → 规格属性串 hash 键。
// 规格名称/属性变化优先识别为同一 SKU 的属性变化（SPEC_CHANGED），而不是 删除+新增。
import type { NormalizedSku } from './skuModel';
import type { SkuChange, SkuChangeType, SkuEntry } from '@/common/types';
import { newId } from '@/common/id';

const identityKey = (s: Pick<SkuEntry, 'skuId' | 'specId' | 'specAttrs'>): string =>
  s.skuId ? `sku:${s.skuId}` : s.specId ? `spec:${s.specId}` : `attr:${s.specAttrs}`;

const toEntry = (s: NormalizedSku): SkuEntry => ({
  skuId: s.skuId,
  specId: s.specId,
  specAttrs: s.specAttrs,
  propNames: s.propNames,
  name: s.name,
  price: s.price,
  stock: s.stock,
  inStock: s.inStock,
});

export interface CompareResult {
  changes: SkuChange[];
  /** 比较所基于的匹配方式（用于诊断日志） */
  matchedBy: 'skuId' | 'specId' | 'attrs' | 'mixed';
}

export const compareSnapshots = (
  prev: NormalizedSku[],
  curr: NormalizedSku[],
  ctx: { productId: string; offerId: string; productTitle: string },
): CompareResult => {
  const now = Date.now();
  const prevMap = new Map(prev.map((s) => [identityKey(s), s] as const));
  const currMap = new Map(curr.map((s) => [identityKey(s), s] as const));
  const changes: SkuChange[] = [];

  const matchedKinds = new Set<string>();
  for (const s of prev) {
    if (s.skuId && currMap.has(`sku:${s.skuId}`)) matchedKinds.add('skuId');
    else if (s.specId && currMap.has(`spec:${s.specId}`)) matchedKinds.add('specId');
  }
  if (matchedKinds.size === 0 && curr.length > 0) matchedKinds.add('attrs');
  const matchedBy: CompareResult['matchedBy'] =
    matchedKinds.size > 1 ? 'mixed' : ([...matchedKinds][0] as CompareResult['matchedBy']) ?? 'mixed';

  const mk = (type: SkuChangeType, before: NormalizedSku | undefined, after: NormalizedSku | undefined, skuName: string): SkuChange => ({
    id: newId('chg'),
    productId: ctx.productId,
    offerId: ctx.offerId,
    productTitle: ctx.productTitle,
    skuKey: after ? identityKey(after) : before ? identityKey(before) : 'unknown',
    skuName,
    type,
    before: before ? toEntry(before) : undefined,
    after: after ? toEntry(after) : undefined,
    detectedAt: now,
  });

  const namesEqual = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

  for (const [key, after] of currMap) {
    const before = prevMap.get(key);
    if (!before) {
      changes.push(mk('SKU_ADDED', undefined, after, after.name));
      continue;
    }
    // 同一 SKU（按稳定标识匹配）的规格属性变化
    if (before.skuId && after.skuId && before.skuId === after.skuId && !namesEqual(before.specAttrs, after.specAttrs)) {
      changes.push(mk('SPEC_CHANGED', before, after, after.name));
    } else if (before.specId && after.specId && before.specId === after.specId && !namesEqual(before.specAttrs, after.specAttrs)) {
      changes.push(mk('SPEC_CHANGED', before, after, after.name));
    }
    // 库存变化
    const bStock = before.stock;
    const aStock = after.stock;
    if (bStock !== null && aStock !== null && bStock !== aStock) {
      if (bStock > 0 && aStock === 0) {
        changes.push(mk('STOCK_OUT', before, after, after.name));
      } else if (bStock === 0 && aStock > 0) {
        changes.push(mk('STOCK_RESTORED', before, after, after.name));
      } else if (aStock > bStock) {
        changes.push(mk('STOCK_INCREASED', before, after, after.name));
      } else {
        changes.push(mk('STOCK_DECREASED', before, after, after.name));
      }
    }
    // 价格变化（扩展监控信息；价格缺失不影响核心库存比较）
    if (before.price !== undefined && after.price !== undefined && Math.abs(before.price - after.price) > 0.001) {
      changes.push(mk('PRICE_CHANGED', before, after, after.name));
    }
  }

  for (const [key, before] of prevMap) {
    if (!currMap.has(key)) {
      changes.push(mk('SKU_REMOVED', before, undefined, before.name));
    }
  }

  return { changes, matchedBy };
};

export const CHANGE_TYPE_LABEL: Record<SkuChangeType, string> = {
  SKU_ADDED: '新增 SKU',
  SKU_REMOVED: '删除 SKU',
  SPEC_CHANGED: '规格变化',
  STOCK_INCREASED: '库存增加',
  STOCK_DECREASED: '库存减少',
  STOCK_OUT: '库存归零（有货变无货）',
  STOCK_RESTORED: '恢复有货',
  PRICE_CHANGED: '价格变化',
};
