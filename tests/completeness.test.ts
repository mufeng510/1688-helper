import { describe, expect, it } from 'vitest';
import { validateScan } from '@/modules/sku/completeness';
import type { InjectedSkuScanResult } from '@/common/types';
import type { NormalizedSku } from '@/modules/sku/skuModel';

const okInjected: InjectedSkuScanResult = { ok: true, offerId: '123', title: '测试' };
const skus = (n: number): NormalizedSku[] =>
  Array.from({ length: n }, (_, i) => ({
    skuId: `sku-${i}`,
    specAttrs: `规格${i}`,
    propNames: ['颜色'],
    name: `规格${i}`,
    stock: 10,
    inStock: true,
  }));

describe('扫描完整性校验', () => {
  it('风控页 → 无效', () => {
    expect(validateScan(skus(5), { injected: { ...okInjected, risk: 'baxia' } }).valid).toBe(false);
  });
  it('登录失效 → 无效', () => {
    expect(validateScan(skus(5), { injected: { ...okInjected, risk: 'login' } }).valid).toBe(false);
  });
  it('页面为空 → 无效', () => {
    expect(validateScan([], { injected: { ...okInjected, risk: 'empty' } }).valid).toBe(false);
  });
  it('解析失败 → 无效', () => {
    expect(validateScan([], { injected: { ...okInjected, error: '未找到 skuModel' } }).valid).toBe(false);
  });
  it('SKU 数量为 0 → 无效', () => {
    const r = validateScan([], { injected: okInjected });
    expect(r.valid).toBe(false);
  });
  it('缺少库存数据 → 无效', () => {
    const list = skus(2);
    list[0]!.stock = null;
    expect(validateScan(list, { injected: okInjected }).valid).toBe(false);
  });
  it('SKU 数量骤降 → 无效（防止误判为大量 SKU 删除）', () => {
    const r = validateScan(skus(2), { injected: okInjected, prevValidSkuCount: 20 });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('骤降');
  });
  it('正常数据 → 有效', () => {
    expect(validateScan(skus(10), { injected: okInjected, prevValidSkuCount: 10 }).valid).toBe(true);
  });
});
