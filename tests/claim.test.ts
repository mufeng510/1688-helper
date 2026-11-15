import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDBForTests, getDB, claimOrdersGetByOrderId, claimOrdersList, claimBatchesList } from '@/common/db';
import { enqueue, claimRunnable, completeTask, requeueTask, recoverStaleTasks, tasksForTestsClearAll, backoffFor } from '@/common/tasks';
import { scanOverdueOrders, applyClaimOrder, finalizeCompletedBatches, markClaimManually } from '@/modules/claim/claim';
import { nextApplyStatus, canApply } from '@/modules/claim/stateMachine';
import { SimulationExecutor } from '@/modules/claim/executor';
import type { ClaimOrder } from '@/common/types';

const resetAll = async () => {
  resetDBForTests();
  (globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage?.();
  await tasksForTestsClearAll();
  const db = await getDB();
  for (const store of ['skuProducts', 'skuSnapshots', 'skuChanges', 'claimOrders', 'claimBatches', 'logs', 'notificationLog', 'notifiedChanges', 'meta'] as const) {
    await db.clear(store);
  }
};

describe('理赔状态机', () => {
  it('submitted → 平台处理中（申请成功不代表到账）', () => {
    expect(nextApplyStatus('applying', { kind: 'submitted' })).toBe('submitted');
  });
  it('资格不满足 → rejected 终态，不重试', () => {
    expect(nextApplyStatus('applying', { kind: 'not_eligible', reason: 'r' })).toBe('rejected');
  });
  it('提交结果不确认 → needs_human（禁止盲目重复提交）', () => {
    expect(nextApplyStatus('applying', { kind: 'unknown', reason: 'r' })).toBe('needs_human');
  });
  it('retryable_error → failed（可再次申请）', () => {
    expect(nextApplyStatus('applying', { kind: 'retryable_error', reason: 'r' })).toBe('failed');
    expect(canApply('failed')).toBe(true);
    expect(canApply('submitted')).toBe(false);
    expect(canApply('rejected')).toBe(false);
  });
});

describe('任务队列', () => {
  beforeEach(resetAll);

  it('dedupeKey 去重：同一业务对象不重复入队', async () => {
    const a = await enqueue({ type: 'claim.apply', payload: { claimId: 'c1' }, dedupeKey: 'claim.apply:c1' });
    const b = await enqueue({ type: 'claim.apply', payload: { claimId: 'c1' }, dedupeKey: 'claim.apply:c1' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('claimRunnable 占用租约并增加尝试次数', async () => {
    await enqueue({ type: 'sku.scan', payload: { productId: 'p1' }, dedupeKey: 'sku.scan:p1' });
    const tasks = await claimRunnable(5);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('running');
    expect(tasks[0]?.attempts).toBe(1);
    expect(tasks[0]?.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('租约过期的中断任务被恢复为待执行', async () => {
    await enqueue({ type: 'sku.scan', payload: { productId: 'p1' } });
    const [t] = await claimRunnable(5);
    // 人为让租约过期
    const db = await getDB();
    await db.put('tasks', { ...t!, lockedUntil: Date.now() - 1000 });
    const recovered = await recoverStaleTasks();
    expect(recovered).toBe(1);
    const pending = await db.getAllFromIndex('tasks', 'status', 'pending');
    expect(pending.length).toBe(1);
  });

  it('重试到达上限后标记 failed，不再恢复', async () => {
    const task = await enqueue({ type: 'claim.apply', payload: { claimId: 'c1' }, maxAttempts: 4 });
    const [t1] = await claimRunnable(1);
    await requeueTask(t1!.id, '错误', 0); // attempt=1
    const [t2] = await claimRunnable(1);
    await requeueTask(t2!.id, '错误', 0); // attempt=2
    const [t3] = await claimRunnable(1);
    await requeueTask(t3!.id, '错误', 0); // attempt=3
    const [t4] = await claimRunnable(1);
    await requeueTask(t4!.id, '错误', 0); // attempt=4 → 用尽
    const db = await getDB();
    const finalTask = await db.get('tasks', task!.id);
    expect(finalTask?.status).toBe('failed');
    expect(finalTask?.attempts).toBe(4); // 首次 + 3 次重试
  });

  it('backoffFor 提供递增退避', () => {
    expect(backoffFor(1)).toBeLessThan(backoffFor(2));
    expect(backoffFor(2)).toBeLessThan(backoffFor(3));
  });
});

describe('理赔扫描（模拟模式）', () => {
  beforeEach(resetAll);

  it('发现模拟订单并入队申请任务，重复扫描不重复创建', async () => {
    const batch = await scanOverdueOrders();
    expect(batch.discovered).toBeGreaterThan(0);
    const orders = await claimOrdersList();
    expect(orders).toHaveLength(batch.discovered);
    const again = await scanOverdueOrders();
    expect(again.discovered).toBe(0); // 已存在 → 不重复
    const orders2 = await claimOrdersList();
    expect(orders2).toHaveLength(orders.length);
  });

  it('端到端：模拟订单全部申请并正确聚合批次', async () => {
    await scanOverdueOrders();
    const db = await getDB();
    // 执行所有 claim.apply 任务直到清空
    for (let i = 0; i < 10; i += 1) {
      const tasks = await claimRunnable(5);
      if (tasks.length === 0) break;
      for (const task of tasks) {
        if (task.type !== 'claim.apply') { await completeTask(task.id); continue; }
        const claimId = String(task.payload['claimId']);
        const result = await applyClaimOrder(claimId);
        const fresh = await db.get('tasks', task.id);
        if (result.ok) {
          if (result.needsHuman) {
            await db.put('tasks', { ...fresh!, status: 'needs_human', lockedBy: undefined, lockedUntil: undefined, updatedAt: Date.now() });
          } else {
            await completeTask(task.id);
          }
        } else {
          await requeueTask(task.id, result.reason ?? '失败', 0);
        }
      }
    }
    await finalizeCompletedBatches();
    const orders = await claimOrdersList();
    const submitted = orders.filter((o) => o.applyStatus === 'submitted');
    const rejected = orders.filter((o) => o.applyStatus === 'rejected');
    const needsHuman = orders.filter((o) => o.applyStatus === 'needs_human');
    const failed = orders.filter((o) => o.applyStatus === 'failed');
    expect(submitted.length).toBeGreaterThanOrEqual(2); // sim-success + sim-flaky
    expect(rejected.length).toBe(1); // sim-ineligible
    expect(needsHuman.length).toBe(2); // sim-captcha + sim-unknown
    expect(failed.length).toBe(1); // sim-fail（重试用尽）
    const batches = await claimBatchesList(5);
    const done = batches.find((b) => b.finishedAt);
    expect(done).toBeTruthy();
    // 防重复提交：submit 状态的订单再次扫描不会重复入队
    const again = await scanOverdueOrders();
    expect(again.discovered).toBe(0);
  });

  it('模拟执行器确定性输出', async () => {
    const executor = new SimulationExecutor();
    const base: ClaimOrder = {
      id: 'c', orderId: 'x-sim-success-1', discoveredAt: 0, applyStatus: 'applying',
      resultStatus: 'unknown', retryCount: 0, mode: 'simulation', updatedAt: 0,
    };
    expect((await executor.apply(base)).kind).toBe('submitted');
    expect((await executor.apply({ ...base, orderId: 'x-sim-fail-1' })).kind).toBe('retryable_error');
    expect((await executor.apply({ ...base, orderId: 'x-sim-captcha-1' })).kind).toBe('needs_human');
    expect((await executor.apply({ ...base, orderId: 'x-sim-unknown-1' })).kind).toBe('unknown');
    expect((await executor.apply({ ...base, orderId: 'x-sim-flaky-1', retryCount: 0 })).kind).toBe('retryable_error');
    expect((await executor.apply({ ...base, orderId: 'x-sim-flaky-1', retryCount: 2 })).kind).toBe('submitted');
  });

  it('需要人工处理的订单可被用户标记完成', async () => {
    await scanOverdueOrders();
    const db = await getDB();
    const order = (await claimOrdersList()).find((o) => o.orderId.includes('captcha'))!;
    await applyClaimOrder(order.id); // → needs_human
    const updated = await claimOrdersGetByOrderId(order.orderId);
    expect(updated?.applyStatus).toBe('needs_human');
    const ok = await markClaimManually(order.id);
    expect(ok).toBe(true);
    expect((await claimOrdersGetByOrderId(order.orderId))?.applyStatus).toBe('completed');
    await db.clear('tasks');
  });
});
