// 理赔编排：扫描发现 → 去重入队 → 申请执行 → 状态更新 → 批次汇总通知。
// 模拟模式与真实模式由 settings.claimMode 决定；applyStatus 与最终理赔结果分开记录。
import {
  claimBatchesList,
  claimBatchesPut,
  claimOrdersGetByOrderId,
  claimOrdersList,
  claimOrdersPut,
} from '@/common/db';
import { newId } from '@/common/id';
import { logger } from '@/common/log';
import { sendNotification } from '@/common/notify';
import { enqueue, tasksList } from '@/common/tasks';
import { getSettings } from '@/common/settings';
import type { ClaimApplyResult, ClaimBatch, ClaimOrder } from '@/common/types';
import { createExecutor } from './executor';
import { createOrderSource } from './source';
import { syncClaimResults } from './resultSync';
import { isTerminal, nextApplyStatus } from './stateMachine';

const log = logger('claim');

export const scanOverdueOrders = async (): Promise<ClaimBatch> => {
  const settings = await getSettings();
  const mode = settings.claimMode;
  const batch: ClaimBatch = {
    id: newId('batch'),
    startedAt: Date.now(),
    discovered: 0,
    submitted: 0,
    failed: 0,
    needsHuman: 0,
    mode,
  };
  await claimBatchesPut(batch);

  const source = createOrderSource(mode);
  let discovered: Awaited<ReturnType<typeof source.discover>> = [];
  try {
    discovered = await source.discover();
  } catch (err) {
    await log.error('理赔扫描：发现订单失败', err instanceof Error ? err.message : String(err));
    batch.finishedAt = Date.now();
    await claimBatchesPut(batch);
    return batch;
  }

  let enqueued = 0;
  for (const d of discovered) {
    const existing = await claimOrdersGetByOrderId(d.orderId);
    if (existing) {
      if (isTerminal(existing.applyStatus) || existing.applyStatus === 'submitted' || existing.applyStatus === 'applying') {
        continue; // 已成功提交/处理中/终态：禁止重复申请
      }
      // 已存在但失败/待申请：确保任务存在（去重入队）
      const t = await enqueue({ type: 'claim.apply', payload: { claimId: existing.id, batchId: batch.id }, dedupeKey: `claim.apply:${existing.id}` });
      if (t) enqueued += 1;
      continue;
    }
    const order: ClaimOrder = {
      id: newId('claim'),
      orderId: d.orderId,
      goodsName: d.goodsName,
      goodsInfo: d.goodsInfo,
      seller: d.seller,
      orderAmount: d.orderAmount,
      expectedClaimAmount: d.expectedClaimAmount,
      discoveredAt: Date.now(),
      applyStatus: 'pending_apply',
      resultStatus: 'unknown',
      retryCount: 0,
      batchId: batch.id,
      mode,
      updatedAt: Date.now(),
    };
    await claimOrdersPut(order);
    batch.discovered += 1;
    const t = await enqueue({ type: 'claim.apply', payload: { claimId: order.id, batchId: batch.id }, dedupeKey: `claim.apply:${order.id}` });
    if (t) enqueued += 1;
  }

  await claimBatchesPut(batch);

  if (batch.discovered === 0) {
    batch.finishedAt = Date.now();
    await claimBatchesPut(batch);
    await log.info('理赔扫描：未发现新订单');
  } else {
    await log.info('理赔扫描：发现订单并入队', { discovered: batch.discovered, enqueued });
    await sendNotification({
      type: 'claim.found',
      title: '1688 理赔',
      body: `发现 ${batch.discovered} 笔揽收超时订单，已加入申请队列（${mode === 'simulation' ? '模拟模式' : '真实模式'}）`,
    });
  }
  return batch;
};

/** 执行单笔理赔申请。由任务队列调用。返回 task 执行结果语义。 */
export const applyClaimOrder = async (claimId: string): Promise<{ ok: boolean; needsHuman?: boolean; retryable?: boolean; reason?: string }> => {
  const dbOrders = await claimOrdersList();
  const order = dbOrders.find((o) => o.id === claimId);
  if (!order) return { ok: false, reason: '理赔记录不存在' };
  if (order.applyStatus === 'applying') {
    // 防并发：applying 中不重复执行（任务中断后由 recoverStaleTasks 重新入队）
  }
  if (!['pending_apply', 'failed'].includes(order.applyStatus)) {
    return { ok: true, reason: `当前状态 ${order.applyStatus}，跳过` };
  }

  const now = Date.now();
  const applying: ClaimOrder = { ...order, applyStatus: 'applying', firstApplyAt: order.firstApplyAt ?? now, lastApplyAt: now, updatedAt: now };
  await claimOrdersPut(applying);

  const settings = await getSettings();
  const executor = createExecutor(settings.claimMode);
  let result: ClaimApplyResult;
  try {
    result = await executor.apply(applying);
  } catch (err) {
    result = { kind: 'retryable_error', reason: err instanceof Error ? err.message : String(err) };
  }

  const to = nextApplyStatus('applying', result);
  const retryCount = result.kind === 'retryable_error' ? order.retryCount + 1 : order.retryCount;
  const next: ClaimOrder = {
    ...applying,
    applyStatus: to ?? (result.kind === 'retryable_error' ? 'failed' : 'needs_human'),
    retryCount,
    lastError: result.kind === 'submitted' ? undefined : result.reason,
    updatedAt: Date.now(),
  };
  if (result.kind === 'submitted') next.resultStatus = 'processing'; // 已提交 ≠ 到账，保持 unknown→processing
  await claimOrdersPut(next);
  await log.info('理赔申请执行完成', { claimId, orderId: order.orderId, kind: result.kind, retryCount, mode: settings.claimMode });

  if (result.kind === 'submitted') return { ok: true };
  if (result.kind === 'not_eligible') return { ok: true }; // 资格不满足：终态，不重试
  if (result.kind === 'needs_human' || result.kind === 'unknown') {
    if (result.kind === 'unknown') {
      await log.warn('理赔提交结果不确认，需人工在「发起的理赔」页核对', { orderId: order.orderId });
    }
    // live 模式：平台该订单很可能已有理赔记录（如系统自动判定），顺便回读结果页同步本地 resultStatus（best-effort）
    if (settings.claimMode === 'live') {
      try {
        await syncClaimResults();
      } catch (err) {
        await log.warn('理赔结果回读触发失败', err instanceof Error ? err.message : String(err));
      }
    }
    return { ok: true, needsHuman: true, reason: result.reason };
  }
  return { ok: false, retryable: true, reason: result.reason };
};

/** 扫尾：批次内无待处理任务时，将批次汇总通知一次。由 scheduler 在每次 tick 调用。 */
export const finalizeCompletedBatches = async (): Promise<void> => {
  const batches = await claimBatchesList(50);
  for (const batch of batches) {
    if (batch.finishedAt) continue;
    const tasks = await tasksList();
    const inFlight = tasks.filter((t) => t.type === 'claim.apply' && t.payload?.['batchId'] === batch.id && (t.status === 'pending' || t.status === 'running'));
    if (inFlight.length > 0) continue;

    const orders = (await claimOrdersList()).filter((o) => o.batchId === batch.id);
    const done: ClaimBatch = {
      ...batch,
      finishedAt: Date.now(),
      submitted: orders.filter((o) => o.applyStatus === 'submitted').length,
      failed: orders.filter((o) => o.applyStatus === 'failed').length,
      needsHuman: orders.filter((o) => o.applyStatus === 'needs_human').length,
    };
    await claimBatchesPut(done);
    if (done.discovered > 0) {
      await sendNotification({
        type: 'claim.batch_done',
        title: '1688 理赔申请结果',
        body: [
          `本批发现订单：${done.discovered} 笔`,
          `申请成功：${done.submitted} 笔`,
          `申请失败：${done.failed} 笔`,
          `等待人工处理：${done.needsHuman} 笔`,
          done.mode === 'simulation' ? '（模拟数据，不代表真实申请）' : '',
        ].filter(Boolean).join('\n'),
        dedupeKey: `claim-batch:${done.id}`,
      });
    }
  }
};

/** 用户在管理页标记：已完成 / 忽略（仅 needs_human → completed） */
export const markClaimManually = async (claimId: string): Promise<boolean> => {
  const orders = await claimOrdersList();
  const order = orders.find((o) => o.id === claimId);
  if (!order || order.applyStatus !== 'needs_human') return false;
  await claimOrdersPut({ ...order, applyStatus: 'completed', updatedAt: Date.now() });
  return true;
};

