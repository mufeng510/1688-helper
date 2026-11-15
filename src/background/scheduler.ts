// 调度器：统一由 chrome.alarms 驱动。SW 可随时回收，这里不持有任何内存关键状态。
import { logger } from '@/common/log';
import { metaGet, metaSet, tasksPut, skuProductsList, skuChangesListRecent } from '@/common/db';
import { getSettings } from '@/common/settings';
import {
  claimRunnable, completeTask, markNeedsHuman, recoverStaleTasks, requeueTask, enqueue, backoffFor,
} from '@/common/tasks';
import { scanSkuProduct } from '@/modules/sku/monitor';
import { scanOverdueOrders, applyClaimOrder, finalizeCompletedBatches } from '@/modules/claim/claim';
import type { Task } from '@/common/types';

const log = logger('scheduler');

export const TICK_ALARM = 'scheduler.tick';
const TICK_PERIOD_MIN = 0.5; // 30s：MV3 alarm 最小粒度附近，兼顾及时与省资源
const MAX_TAB_TASKS_PER_TICK = 1;
const MAX_TASK_LIMIT = 3;

/** SW 启动时确保 alarm 存在（alarm 可能被系统推迟/丢失，启动时补建） */
export const ensureAlarms = async (): Promise<void> => {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.1 });
  }
};

const isTabTask = (t: Task): boolean => t.type === 'sku.scan' || t.type === 'claim.apply';

/** 按到期条件生成任务（去重入队），然后执行一批任务。 */
export const tick = async (): Promise<void> => {
  await recoverStaleTasks();
  const settings = await getSettings();
  const now = Date.now();

  // ---- SKU 监控到期检查 ----
  const skuIntervalMs = Math.max(1, settings.skuScanIntervalMinutes) * 60_000;
  const lastSkuTick = (await metaGet<number>('lastSkuTick')) ?? 0;
  if (now - lastSkuTick >= skuIntervalMs) {
    const products = (await skuProductsList()).filter((p) => p.status === 'active');
    for (const p of products) {
      await enqueue({ type: 'sku.scan', payload: { productId: p.id }, dedupeKey: `sku.scan:${p.id}` });
    }
    await metaSet('lastSkuTick', now);
    if (products.length > 0) await log.info('SKU 扫描已入队', { count: products.length });
  }

  // ---- 理赔扫描到期检查 ----
  if (settings.claimScanEnabled) {
    const claimIntervalMs = Math.max(1, settings.claimScanIntervalMinutes) * 60_000;
    const lastClaimTick = (await metaGet<number>('lastClaimTick')) ?? 0;
    if (now - lastClaimTick >= claimIntervalMs) {
      await enqueue({ type: 'claim.scan', payload: {}, dedupeKey: 'claim.scan' });
      await metaSet('lastClaimTick', now);
      await log.info('理赔扫描已入队', { mode: settings.claimMode });
    }
  }

  // ---- 执行任务 ----
  await processTasks();

  // ---- 理赔批次扫尾（汇总通知） ----
  try {
    await finalizeCompletedBatches();
  } catch (err) {
    await log.error('理赔批次扫尾失败', err instanceof Error ? err.message : String(err));
  }
};

/** 领取并执行一批任务（供 tick 与手动触发共用） */
export const processTasks = async (): Promise<void> => {
  const claimed = await claimRunnable(MAX_TASK_LIMIT + 4);
  let tabTasksRun = 0;
  for (const task of claimed) {
    if (isTabTask(task) && tabTasksRun >= MAX_TAB_TASKS_PER_TICK) {
      // 本 tick 不执行的 tab 任务：放回 pending（租约未占用太久，等下个 tick）
      task.status = 'pending';
      task.lockedBy = undefined;
      task.lockedUntil = undefined;
      task.attempts -= 1;
      task.updatedAt = Date.now();
      await tasksPut(task);
      continue;
    }
    if (isTabTask(task)) tabTasksRun += 1;
    await executeTask(task);
  }
};

const executeTask = async (task: Task): Promise<void> => {
  try {
    switch (task.type) {
      case 'sku.scan': {
        const productId = String(task.payload['productId'] ?? '');
        const outcome = await scanSkuProduct(productId);
        if (outcome.valid || (!outcome.risk && outcome.error?.startsWith('商品已暂停'))) {
          await completeTask(task.id);
        } else if (outcome.risk === 'login' || outcome.risk === 'baxia' || outcome.risk === 'punish') {
          // 风控/登录：任务本身等待人工；商品侧已自动处理（失败计数/暂停/通知）
          await markNeedsHuman(task.id, outcome.error ?? '需要人工处理');
        } else if (outcome.autoPaused) {
          await completeTask(task.id); // 商品已暂停，任务完成
        } else {
          await requeueTask(task.id, outcome.error ?? '扫描失败', backoffFor(task.attempts));
        }
        return;
      }
      case 'claim.scan': {
        await scanOverdueOrders();
        await completeTask(task.id);
        return;
      }
      case 'claim.apply': {
        const claimId = String(task.payload['claimId'] ?? '');
        const result = await applyClaimOrder(claimId);
        if (result.ok) {
          if (result.needsHuman) await markNeedsHuman(task.id, result.reason ?? '需要人工处理');
          else await completeTask(task.id);
        } else {
          await requeueTask(task.id, result.reason ?? '申请失败', backoffFor(task.attempts));
        }
        return;
      }
      case 'notify.retry':
        await completeTask(task.id);
        return;
      default:
        await completeTask(task.id);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await log.error('任务执行异常', { taskId: task.id, type: task.type, reason });
    await requeueTask(task.id, reason, backoffFor(task.attempts));
  }
};

/** 统计：今日 SKU 变化商品数（供总览） */
export const countTodayChangedProducts = async (): Promise<{ changedProducts: number; changes: number }> => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const changes = await skuChangesListRecent(dayStart.getTime());
  return { changedProducts: new Set(changes.map((c) => c.productId)).size, changes: changes.length };
};

/** 供 admin 的 alarm 信息（下一次 tick 时间由 alarms 提供近似） */
export const nextTickAt = async (): Promise<number | undefined> => {
  const a = await chrome.alarms.get(TICK_ALARM);
  return a?.scheduledTime;
};
