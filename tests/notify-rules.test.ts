// SKU 通知规则：compare 的低库存检测 + 全局/商品覆盖合并 + 设置迁移（v1→v2）。
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { compareSnapshots } from '@/modules/sku/compare';
import { effectiveSkuNotify, filterNotifiableChanges, isSkuNotifyCustomized } from '@/modules/sku/notifyRules';
import { DEFAULT_SETTINGS, DEFAULT_SKU_NOTIFY } from '@/common/types';
import { getSettings } from '@/common/settings';
import type { NormalizedSku } from '@/modules/sku/skuModel';

const sku = (over: Partial<NormalizedSku> & { name: string }): NormalizedSku => ({
  specAttrs: over.name,
  propNames: ['颜色'],
  stock: 10,
  price: 3.6,
  ...over,
  inStock: (over.stock ?? 10) > 0,
});

const ctx = (lowStockThreshold?: number) => ({ productId: 'p1', offerId: '123', productTitle: '测试商品', lowStockThreshold });

const lowTypes = (prev: NormalizedSku[], curr: NormalizedSku[], threshold = 5) =>
  compareSnapshots(prev, curr, ctx(threshold)).changes.filter((c) => c.type === 'STOCK_LOW');

const base = [sku({ name: '黑色', skuId: '1001', stock: 50 }), sku({ name: '白色', skuId: '1002', stock: 30 })];
const at = (stock: number) => base.map((s) => (s.skuId === '1001' ? { ...s, stock, inStock: stock > 0 } : s));

describe('STOCK_LOW（低库存预警）', () => {
  it('跌破阈值触发一次：50→6 不触发；6→5 触发', () => {
    expect(lowTypes(base, at(6))).toHaveLength(0);
    expect(lowTypes(at(6), at(5))).toHaveLength(1);
  });

  it('已在阈值内继续下跌不重复提醒（5→4）', () => {
    expect(lowTypes(at(5), at(4))).toHaveLength(0);
  });

  it('变成 0 归 STOCK_OUT，不额外发 STOCK_LOW', () => {
    const changes = compareSnapshots(at(3), at(0), ctx(5)).changes;
    expect(changes.some((c) => c.type === 'STOCK_OUT')).toBe(true);
    expect(changes.some((c) => c.type === 'STOCK_LOW')).toBe(false);
  });

  it('补货回到阈值上方后再次跌破会再次提醒（补仓→再预警）', () => {
    // 3（已预警过的状态）→ 50（补货）→ 4（再次跌破）
    expect(lowTypes(at(3), at(50))).toHaveLength(0);
    expect(lowTypes(at(50), at(4))).toHaveLength(1);
  });

  it('新增 SKU 即为低库存不额外触发（由 SKU_ADDED 承载）', () => {
    const next = [...base, sku({ name: '蓝色', skuId: '1003', stock: 2 })];
    expect(lowTypes(base, next)).toHaveLength(0);
  });

  it('阈值可配置：threshold=10 时 12→10 触发', () => {
    expect(lowTypes(at(12), at(10), 10)).toHaveLength(1);
  });
});

describe('全局 + 商品覆盖 → 有效规则', () => {
  const settings = { skuNotify: { ...DEFAULT_SKU_NOTIFY, stockDecreased: true, lowStockThreshold: 5 } };

  it('无覆盖时等于全局默认', () => {
    const r = effectiveSkuNotify({}, settings);
    expect(r.stockDecreased).toBe(true);
    expect(r.added).toBe(true);
    expect(isSkuNotifyCustomized({})).toBe(false);
  });

  it('商品覆盖优先于全局；未覆盖字段仍跟随全局', () => {
    const r = effectiveSkuNotify({ skuNotify: { stockDecreased: false, lowStockThreshold: 20 } }, settings);
    expect(r.stockDecreased).toBe(false); // 覆盖
    expect(r.lowStockThreshold).toBe(20); // 覆盖
    expect(r.added).toBe(true);           // 跟随全局
  });

  it('isSkuNotifyCustomized：有任意覆盖字段即为自定义', () => {
    expect(isSkuNotifyCustomized({ skuNotify: { added: false } })).toBe(true);
    expect(isSkuNotifyCustomized({ skuNotify: {} })).toBe(false);
  });

  it('filterNotifiableChanges 只留下规则中开启的类型，不修改入参数组', () => {
    const changes = [{ type: 'STOCK_DECREASED' }, { type: 'SKU_ADDED' }, { type: 'STOCK_LOW' }] as const;
    const kept = filterNotifiableChanges([...changes], effectiveSkuNotify({}, settings));
    expect(kept.map((c) => c.type)).toEqual(['STOCK_DECREASED', 'SKU_ADDED', 'STOCK_LOW']);
    const quiet = filterNotifiableChanges([...changes], { ...DEFAULT_SKU_NOTIFY, stockDecreased: false });
    expect(quiet.map((c) => c.type)).toEqual(['SKU_ADDED', 'STOCK_LOW']);
  });
});

describe('settings 迁移 v1 → v2', () => {
  it('老用户（无 skuNotify 的 v1 数据）自动补默认规则并升级到 v2', async () => {
    (globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage?.();
    await chrome.storage.local.set({
      settings: { schemaVersion: 1, skuScanIntervalMinutes: 120 },
    });
    const s = await getSettings();
    expect(s.schemaVersion).toBe(2);
    expect(s.skuNotify).toEqual(DEFAULT_SKU_NOTIFY);
    expect(s.skuScanIntervalMinutes).toBe(120);
  });

  it('已存的 skuNotify 覆盖字段被保留', async () => {
    (globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage?.();
    await chrome.storage.local.set({
      settings: { schemaVersion: 1, skuNotify: { stockDecreased: true, lowStockThreshold: 99 } },
    });
    const s = await getSettings();
    expect(s.skuNotify.stockDecreased).toBe(true);
    expect(s.skuNotify.lowStockThreshold).toBe(99);
    expect(s.skuNotify.added).toBe(true); // 其余字段取默认
  });
});

describe('默认规则内容', () => {
  it('默认只开上架/下架/售罄/补货/低库存，其余静音', () => {
    expect(DEFAULT_SKU_NOTIFY).toMatchObject({
      added: true,
      removed: true,
      stockOut: true,
      stockRestored: true,
      lowStock: true,
      lowStockThreshold: 5,
      stockIncreased: false,
      stockDecreased: false,
      specChanged: false,
      priceChanged: false,
    });
    expect(DEFAULT_SETTINGS.skuNotify).toEqual(DEFAULT_SKU_NOTIFY);
  });
});
