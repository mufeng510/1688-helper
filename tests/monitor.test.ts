// SKU 监控失败路径：连续失败自动暂停、成功清零、通知记录。
// 任务书 §6.9 / §12.2-10/11：连续失败 3 次自动暂停 + 通知；成功扫描后重置计数。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('@/background/tab-runner', () => ({
  runInBackgroundTab: vi.fn(),
}));

import { runInBackgroundTab } from '@/background/tab-runner';
import { scanSkuProduct } from '@/modules/sku/monitor';
import {
  resetDBForTests,
  getDB,
  skuProductsPut,
  skuProductsGet,
} from '@/common/db';
import type { SkuProduct } from '@/common/types';

const mockedTab = vi.mocked(runInBackgroundTab);

const resetAll = async () => {
  resetDBForTests();
  (globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage?.();
  mockedTab.mockReset();
  const db = await getDB();
  for (const store of ['skuProducts', 'skuSnapshots', 'skuChanges', 'logs', 'notificationLog', 'notifiedChanges', 'meta'] as const) {
    await db.clear(store);
  }
};

const seedProduct = async (overrides: Partial<SkuProduct> = {}): Promise<SkuProduct> => {
  const product: SkuProduct = {
    id: 'prd_mon_1',
    offerId: '991485897552',
    url: 'https://detail.1688.com/offer/991485897552.html',
    title: '监控测试商品',
    status: 'active',
    autoPaused: false,
    baselineEstablished: true,
    consecutiveFailures: 0,
    createdAt: Date.now() - 100000,
    updatedAt: Date.now() - 100000,
    ...overrides,
  };
  await skuProductsPut(product);
  return product;
};

const failTab = () => mockedTab.mockResolvedValue({ ok: false, error: { kind: 'load_timeout', message: '超时' } } as never);
const noRiskCollectFailure = () => mockedTab.mockResolvedValue({ ok: true, value: { ok: false, error: '采集脚本未返回有效数据' } } as never);
const okTab = (stockBlack = 50) => mockedTab.mockResolvedValue({
  ok: true,
  value: {
    ok: true,
    offerId: '991485897552',
    title: '监控测试商品',
    // 内联 skuModel 脚本文本：2 个 SKU，库存完整
    scriptText:
      `window.contextPath = {"skuModel":{"skuProps":[{"fid":1,"prop":"颜色","value":[{"name":"黑"},{"name":"白"}]}],"skuInfoMap":{"黑":{"specId":"101","skuId":1001,"specAttrs":"颜色=黑","canBookCount":"${stockBlack}","price":"9.9"},"白":{"specId":"102","skuId":1002,"specAttrs":"颜色=白","canBookCount":"30","price":"10.9"}}}};`,
  },
} as never);

describe('SKU 扫描失败处理', () => {
  beforeEach(resetAll);

  it('连续 3 次失败 → 自动暂停 + 记录原因 + 发送桌面通知', async () => {
    await seedProduct();
    failTab();

    const r1 = await scanSkuProduct('prd_mon_1');
    expect(r1.valid).toBe(false);
    let p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.consecutiveFailures).toBe(1);
    expect(p.status).toBe('active');

    const r2 = await scanSkuProduct('prd_mon_1');
    expect(r2.valid).toBe(false);
    p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.consecutiveFailures).toBe(2);
    expect(p.status).toBe('active');

    const r3 = await scanSkuProduct('prd_mon_1');
    expect(r3.valid).toBe(false);
    expect(r3.autoPaused).toBe(true);
    p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.consecutiveFailures).toBe(3);
    expect(p.status).toBe('paused');
    expect(p.autoPaused).toBe(true);
    expect(p.pauseReason).toContain('连续扫描失败 3 次');

    // 无效快照被记录（skus 为空、error 有值），但不参与比较
    const db = await getDB();
    const snaps = await db.getAll('skuSnapshots');
    expect(snaps).toHaveLength(3);
    expect(snaps.every((s) => s.valid === false)).toBe(true);

    // 桌面通知被记录
    const notifs = await db.getAll('notificationLog');
    const autoPauseNotif = notifs.find((n) => n.type === 'exception.sku.auto_paused');
    expect(autoPauseNotif).toBeDefined();
    expect(autoPauseNotif?.status).toBe('sent');
  });

  it('已自动暂停的商品不再扫描（不消耗标签、不重复通知）', async () => {
    await seedProduct({ status: 'paused', autoPaused: true, pauseReason: '连续扫描失败 3 次，已自动暂停', consecutiveFailures: 3 });
    const r = await scanSkuProduct('prd_mon_1');
    expect(r.valid).toBe(false);
    expect(mockedTab).not.toHaveBeenCalled();
    const p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.consecutiveFailures).toBe(3);
  });

  it('采集返回风控页 → 计为失败并记录风险类型', async () => {
    await seedProduct();
    mockedTab.mockResolvedValue({ ok: true, value: { ok: false, risk: 'baxia' } } as never);
    const r = await scanSkuProduct('prd_mon_1');
    expect(r.valid).toBe(false);
    expect(r.risk).toBe('baxia');
    const p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.consecutiveFailures).toBe(1);
    expect(p.lastError).toContain('风控');
  });

  it('登录失效 → 计为失败并发送登录失效异常通知', async () => {
    await seedProduct();
    mockedTab.mockResolvedValue({ ok: true, value: { ok: false, risk: 'login' } } as never);
    await scanSkuProduct('prd_mon_1');
    const db = await getDB();
    const notifs = await db.getAll('notificationLog');
    expect(notifs.some((n) => n.type === 'exception.login')).toBe(true);
  });

  it('解析不到 SKU（页面结构变化）→ 计为失败而不是建立错误基准', async () => {
    await seedProduct({ baselineEstablished: false });
    noRiskCollectFailure();
    const r = await scanSkuProduct('prd_mon_1');
    expect(r.valid).toBe(false);
    const p = (await skuProductsGet('prd_mon_1'))!;
    expect(p.baselineEstablished).toBe(false);
    expect(p.consecutiveFailures).toBe(1);
  });

  it('首次扫描只建基准且完全不发通知（任务书 §6.4 / §12.2-1）', async () => {
    await seedProduct({ baselineEstablished: false });
    okTab();
    const r = await scanSkuProduct('prd_mon_1');
    expect(r.valid).toBe(true);
    expect(r.baselineJustEstablished).toBe(true);
    expect(r.changes).toHaveLength(0);
    expect((await skuProductsGet('prd_mon_1'))!.baselineEstablished).toBe(true);
    const db = await getDB();
    expect(await db.count('notificationLog')).toBe(0);
  });

  it('检测到库存减少 → 汇总一条通知；再次扫描相同数据 → 不重复通知（任务书 §12.2-12/13）', async () => {
    await seedProduct({ baselineEstablished: false });
    okTab(50);
    await scanSkuProduct('prd_mon_1'); // 建基准
    okTab(20); // 黑：50 → 20
    const r2 = await scanSkuProduct('prd_mon_1');
    expect(r2.changes.some((c) => c.type === 'STOCK_DECREASED')).toBe(true);

    let db = await getDB();
    const notifs1 = await db.getAll('notificationLog');
    const changed1 = notifs1.filter((n) => n.type === 'sku.changed');
    expect(changed1).toHaveLength(1);
    expect(changed1[0]?.body).toContain('库存减少');

    okTab(20); // 无变化
    const r3 = await scanSkuProduct('prd_mon_1');
    expect(r3.changes).toHaveLength(0);
    db = await getDB();
    const changed2 = (await db.getAll('notificationLog')).filter((n) => n.type === 'sku.changed');
    expect(changed2).toHaveLength(1); // 仍然只有一条
  });

  it('失败两次后成功 → 连续失败计数清零', async () => {
    await seedProduct();
    failTab();
    await scanSkuProduct('prd_mon_1');
    await scanSkuProduct('prd_mon_1');
    expect((await skuProductsGet('prd_mon_1'))!.consecutiveFailures).toBe(2);

    okTab();
    // 需要第二次扫描有前驱有效快照；首次成功只建基准
    const r = await scanSkuProduct('prd_mon_1');
    expect(r.valid).toBe(true);
    expect((await skuProductsGet('prd_mon_1'))!.consecutiveFailures).toBe(0);
    expect((await skuProductsGet('prd_mon_1'))!.status).toBe('active');
  });
});
