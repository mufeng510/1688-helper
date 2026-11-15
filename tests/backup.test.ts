// 数据备份/恢复：exportBackup → importBackup 完整往返验证。
// 覆盖任务书 §十一.1「数据备份与恢复」中 DB 层最关键的正确性，
// UI 文件选择路径在浏览器中验证过导出；导入的 DB 逻辑在此保证。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  resetDBForTests,
  getDB,
  EXPORTABLE_STORES,
  exportBackup,
  importBackup,
} from '@/common/db';
import type { BackupFile } from '@/common/db';

const resetAll = async () => {
  resetDBForTests();
  (globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage?.();
  const db = await getDB();
  for (const store of ['skuProducts', 'skuSnapshots', 'skuChanges', 'claimOrders', 'claimBatches', 'tasks', 'logs', 'notificationLog', 'notifiedChanges', 'meta'] as const) {
    await db.clear(store);
  }
};

const sampleBackup = (): Omit<BackupFile, 'settings'> & { settings: unknown } => ({
  app: '1688-helper',
  version: 1,
  exportedAt: 1794700000000,
  settings: { claimMode: 'simulation' },
  stores: {
    skuProducts: [{
      id: 'prd_test_1', offerId: '991485897552', url: 'https://detail.1688.com/offer/991485897552.html',
      title: '测试商品', status: 'active', autoPaused: false, baselineEstablished: true,
      consecutiveFailures: 0, createdAt: 1794600000000, updatedAt: 1794600000000,
    }],
    skuSnapshots: [{
      id: 'snap_test_1', productId: 'prd_test_1', offerId: '991485897552',
      scannedAt: 1794600000000, valid: true,
      skus: [{ specAttrs: '颜色=黑', name: '黑色', price: 1.5, stock: 100, inStock: true }],
    }],
    skuChanges: [{
      id: 'chg_test_1', productId: 'prd_test_1', offerId: '991485897552', productTitle: '测试商品',
      skuKey: '颜色=黑', skuName: '黑色', type: 'STOCK_DECREASED',
      before: { stock: 100 }, after: { stock: 80 }, detectedAt: 1794650000000,
    }],
    claimOrders: [{
      id: 'clm_test_1', orderId: 'TB123456', applyStatus: 'submitted', resultStatus: 'processing',
      retryCount: 0, discoveredAt: 1794600000000, mode: 'simulation', updatedAt: 1794600000000,
    }],
    claimBatches: [{
      id: 'batch_test_1', startedAt: 1794600000000, discovered: 1, submitted: 1, failed: 0,
      needsHuman: 0, mode: 'simulation',
    }],
    tasks: [{
      id: 'task_test_1', type: 'sku.scan', payload: { productId: 'prd_test_1' }, status: 'done',
      attempts: 1, maxAttempts: 3, runAfter: 1794600000000, createdAt: 1794600000000, updatedAt: 1794600000000,
    }],
    logs: [{ id: 'log_test_1', ts: 1794600000000, level: 'info', module: 'test', message: '测试日志' }],
    notificationLog: [{ id: 'n_test_1', ts: 1794600000000, channel: 'desktop', type: 'claim.found', title: 't', body: 'b', status: 'sent' }],
    notifiedChanges: [{ key: 'prd_test_1:STOCK_DECREASED:颜色=黑', ts: 1794650000000 }],
  },
});

describe('备份导出/导入', () => {
  beforeEach(resetAll);

  it('导出→清空→替换导入，记录数与内容一致', async () => {
    const backup = sampleBackup();
    // 模拟一份"真实已有"的备份文件直接导入
    const { imported } = await importBackup({ ...backup }, 'replace');
    expect(imported).toBe(9)

    // 导出再导入后数据应完整
    const exported = await exportBackup({ claimMode: 'simulation' });
    expect(exported.app).toBe('1688-helper');
    expect(Object.keys(exported.stores).sort()).toEqual([...EXPORTABLE_STORES].sort());
    expect(exported.stores.skuProducts).toHaveLength(1);
    expect(exported.stores.skuSnapshots!).toHaveLength(1);
    expect((exported.stores.skuSnapshots![0] as { valid: boolean }).valid).toBe(true);
    expect(exported.stores.claimOrders).toHaveLength(1);
    expect(exported.stores.notificationLog![0]).toMatchObject({ channel: 'desktop', status: 'sent' });

    // 清空后 replace 模式恢复
    const db = await getDB();
    for (const store of EXPORTABLE_STORES) await db.clear(store as never);
    const { imported: again } = await importBackup(exported, 'replace');
    expect(again).toBe(9);
    const db2 = await getDB();
    expect(await db2.count('skuProducts' as never)).toBe(1);
    expect(await db2.count('skuChanges' as never)).toBe(1);
    expect(await db2.count('notifiedChanges' as never)).toBe(1);
  });

  it('merge 模式覆盖同名记录且不产生重复', async () => {
    const backup = sampleBackup();
    await importBackup({ ...backup }, 'merge');
    await importBackup({ ...backup }, 'merge'); // 再导一次
    const db = await getDB();
    expect(await db.count('skuProducts' as never)).toBe(1);
    expect(await db.count('claimOrders' as never)).toBe(1);
    expect(await db.count('notifiedChanges' as never)).toBe(1);
  });

  it('拒绝非本扩展备份（app 标记不匹配）', async () => {
    await expect(importBackup({ app: 'other-app', version: 1, exportedAt: 0, stores: {} } as unknown as BackupFile, 'replace')).rejects.toThrow('备份文件格式不正确');
  });

  it('真实导出文件可被解析并完整导入（若存在）', async () => {
    const file = join(homedir(), 'Downloads', '1688-helper-backup-2026-11-15.json');
    if (!existsSync(file)) return; // 用户未保留备份时跳过，不算失败
    const json = JSON.parse(readFileSync(file, 'utf8')) as BackupFile;
    expect(json.app).toBe('1688-helper');
    const { imported } = await importBackup(json, 'replace');
    expect(imported).toBeGreaterThan(0);
    const db = await getDB();
    expect(await db.count('skuProducts' as never)).toBe(1);
    expect(await db.count('skuSnapshots' as never)).toBeGreaterThan(0);
    expect(await db.count('claimOrders' as never)).toBeGreaterThan(0);
  });
});
