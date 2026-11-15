import { describe, expect, it } from 'vitest';
import { normalizeSkuModel, parseSkuModelFromScript, type NormalizedSku } from '@/modules/sku/skuModel';
import { compareSnapshots } from '@/modules/sku/compare';

const sku = (over: Partial<NormalizedSku> & { name: string }): NormalizedSku => ({
  specAttrs: over.name,
  propNames: ['颜色'],
  stock: 10,
  price: 3.6,
  ...over,
  inStock: (over.stock ?? 10) > 0,
});

const ctx = { productId: 'p1', offerId: '123', productTitle: '测试商品' };
const types = (prev: NormalizedSku[], curr: NormalizedSku[]) =>
  compareSnapshots(prev, curr, ctx).changes.map((c) => c.type);

describe('skuModel 解析', () => {
  const script = `window.contextPath="/default";window.context=(function(b,d){return d})(window.contextPath,{"result":{"data":{"skuModel":{"skuProps":[{"fid":404,"prop":"颜色","value":[{"name":"黑色"},{"name":"白色"}]}],"skuInfoMap":{"黑色":{"specId":"s1","skuId":1001,"specAttrs":"黑色","price":"3.60","canBookCount":100,"isPromotionSku":false},"白色":{"specId":"s2","skuId":1002,"specAttrs":"白色","price":"3.60","canBookCount":0}}}}}});`;

  it('从内联脚本文本中提取并归一化 skuModel', () => {
    const model = parseSkuModelFromScript(script);
    expect(model).not.toBeNull();
    expect(model!.props).toHaveLength(1);
    const skus = normalizeSkuModel(model!);
    expect(skus).toHaveLength(2);
    expect(skus[0]).toMatchObject({ skuId: '1001', stock: 100, price: 3.6, inStock: true });
    expect(skus[1]).toMatchObject({ skuId: '1002', stock: 0, inStock: false });
  });

  it('字符串内的括号不会影响大括号平衡匹配', () => {
    const tricky = `{"skuModel":{"skuProps":[{"prop":"颜色","value":[{"name":"黑色,含{赠品}"}]}],"skuInfoMap":{"黑色,含{赠品}":{"skuId":1001,"specAttrs":"黑色,含{赠品}","canBookCount":"7","price":"9.9"}}}}`;
    const model = parseSkuModelFromScript(tricky);
    expect(model).not.toBeNull();
    const skus = normalizeSkuModel(model!);
    expect(skus[0]?.stock).toBe(7);
  });

  it('无 skuModel 标记时返回 null', () => {
    expect(parseSkuModelFromScript('{"other": true}')).toBeNull();
  });

  it('canBookCount 缺失 → stock 为 null', () => {
    const model = parseSkuModelFromScript(`{"skuModel":{"skuProps":[{"prop":"颜色","value":[{"name":"黑色"}]}],"skuInfoMap":{"黑色":{"skuId":1001,"specAttrs":"黑色"}}}}`);
    const skus = normalizeSkuModel(model!);
    expect(skus[0]?.stock).toBeNull();
  });

  it('多维度规格按维度值拆分 specAttrs', () => {
    const model = parseSkuModelFromScript(`{"skuModel":{"skuProps":[{"prop":"颜色","value":[{"name":"黑色"}]},{"prop":"尺码","value":[{"name":"L"}]}],"skuInfoMap":{"黑色,L":{"skuId":2001,"specAttrs":"黑色,L","canBookCount":5,"price":"10"}}}}`);
    const skus = normalizeSkuModel(model!);
    expect(skus[0]?.name).toBe('黑色 / L');
  });
});

describe('快照比较', () => {
  const base: NormalizedSku[] = [
    sku({ name: '黑色', skuId: '1001', specId: 's1', price: 3.6, stock: 100 }),
    sku({ name: '白色', skuId: '1002', specId: 's2', price: 3.6, stock: 50 }),
  ];

  it('首次无基准时不会产生变化（基准逻辑由 monitor 保证，此处验证对称性）', () => {
    expect(types([], [])).toEqual([]);
  });

  it('检测 SKU 新增', () => {
    const next = [...base, sku({ name: '蓝色', skuId: '1003', stock: 20 })];
    expect(types(base, next)).toContain('SKU_ADDED');
  });

  it('检测 SKU 删除', () => {
    expect(types(base, base.slice(0, 1))).toContain('SKU_REMOVED');
  });

  it('检测库存增加与减少', () => {
    const inc = base.map((s) => (s.skuId === '1001' ? { ...s, stock: 150, inStock: true } : s));
    expect(types(base, inc)).toContain('STOCK_INCREASED');
    const dec = base.map((s) => (s.skuId === '1001' ? { ...s, stock: 40, inStock: true } : s));
    expect(types(base, dec)).toContain('STOCK_DECREASED');
  });

  it('检测库存归零与恢复', () => {
    const out = base.map((s) => (s.skuId === '1001' ? { ...s, stock: 0, inStock: false } : s));
    expect(types(base, out)).toContain('STOCK_OUT');
    const back = out.map((s) => (s.skuId === '1001' ? { ...s, stock: 30, inStock: true } : s));
    expect(types(out, back)).toContain('STOCK_RESTORED');
  });

  it('同 skuId 规格改名 → SPEC_CHANGED，不误判为删+增', () => {
    const renamed = base.map((s) => (s.skuId === '1001' ? { ...s, specAttrs: '神秘黑色', name: '神秘黑色' } : s));
    const t = types(base, renamed);
    expect(t).toContain('SPEC_CHANGED');
    expect(t).not.toContain('SKU_REMOVED');
    expect(t).not.toContain('SKU_ADDED');
  });

  it('价格变化仅记录', () => {
    const repriced = base.map((s) => (s.skuId === '1001' ? { ...s, price: 4.2 } : s));
    expect(types(base, repriced)).toContain('PRICE_CHANGED');
  });

  it('库存无变化时不产生 STOCK 类变化', () => {
    expect(types(base, base.map((s) => ({ ...s }))).filter((t) => t.startsWith('STOCK'))).toEqual([]);
  });
});
