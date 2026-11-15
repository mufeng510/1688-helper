// 持久任务队列。语义：
// - 任务先入库再执行；SW 被回收后从库重建；
// - running 任务带租约（lockedUntil），过期自动回收重新入队；
// - dedupeKey 去重：同一业务对象不产生重复的待执行任务；
// - 浏览器关闭后由 alarm 唤醒补发（alarm 跨重启持久，启动时仍会 ensure）。
import {
  tasksFindPendingByDedupeKey,
  getDB,
  tasksDelete,
  tasksGet,
  tasksList,
  tasksPut,
} from './db';
import { newId } from './id';
import { logger } from './log';
import type { Task, TaskStatus, TaskType } from './types';

const log = logger('tasks');

const LEASE_MS = 120_000;

export interface EnqueueOptions {
  type: TaskType;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  runAfter?: number;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS: Record<TaskType, number> = {
  'sku.scan': 3,
  'claim.scan': 3,
  'claim.apply': 4, // 首次 + 最多 3 次重试（任务书要求）
  'notify.retry': 3,
};

export const enqueue = async (opts: EnqueueOptions): Promise<Task | null> => {
  if (opts.dedupeKey) {
    const existing = await tasksFindPendingByDedupeKey(opts.dedupeKey);
    if (existing.length > 0) return null;
  }
  const now = Date.now();
  const task: Task = {
    id: newId('task'),
    type: opts.type,
    payload: opts.payload,
    status: 'pending',
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS[opts.type],
    runAfter: opts.runAfter ?? now,
    dedupeKey: opts.dedupeKey,
    createdAt: now,
    updatedAt: now,
  };
  await tasksPut(task);
  return task;
};

/** 取一批可运行任务并占用（租约）。并发执行由调用方控制。 */
export const claimRunnable = async (limit: number): Promise<Task[]> => {
  const now = Date.now();
  const db = await getDB();
  const due = (await db.getAllFromIndex('tasks', 'runAfter', IDBKeyRange.upperBound(now))) as Task[];
  const candidates = due
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.runAfter - b.runAfter)
    .slice(0, limit);
  const claimed: Task[] = [];
  for (const task of candidates) {
    const fresh = await tasksGet(task.id);
    if (!fresh || fresh.status !== 'pending') continue;
    const updated: Task = {
      ...fresh,
      status: 'running',
      attempts: fresh.attempts + 1,
      lockedBy: `sw-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      lockedUntil: now + LEASE_MS,
      updatedAt: now,
    };
    await tasksPut(updated);
    claimed.push(updated);
  }
  return claimed;
};

export const completeTask = async (taskId: string): Promise<void> => {
  const task = await tasksGet(taskId);
  if (!task) return;
  await tasksPut({ ...task, status: 'done', lockedUntil: undefined, lockedBy: undefined, updatedAt: Date.now() });
};

export const requeueTask = async (taskId: string, reason: string, backoffMs: number): Promise<void> => {
  const task = await tasksGet(taskId);
  if (!task) return;
  const now = Date.now();
  const exhausted = task.attempts >= task.maxAttempts;
  if (exhausted) {
    await tasksPut({ ...task, status: 'failed', lastError: reason, lockedUntil: undefined, lockedBy: undefined, updatedAt: now });
    await log.warn('任务重试次数用尽，标记失败', { taskId, type: task.type, attempts: task.attempts, reason });
    return;
  }
  await tasksPut({
    ...task,
    status: 'pending',
    runAfter: now + backoffMs,
    lastError: reason,
    lockedUntil: undefined,
    lockedBy: undefined,
    updatedAt: now,
  });
};

export const failTask = async (taskId: string, reason: string): Promise<void> => {
  const task = await tasksGet(taskId);
  if (!task) return;
  await tasksPut({ ...task, status: 'failed', lastError: reason, lockedUntil: undefined, lockedBy: undefined, updatedAt: Date.now() });
};

export const markNeedsHuman = async (taskId: string, reason: string): Promise<void> => {
  const task = await tasksGet(taskId);
  if (!task) return;
  await tasksPut({ ...task, status: 'needs_human', lastError: reason, lockedUntil: undefined, lockedBy: undefined, updatedAt: Date.now() });
};

/** SW 启动 / alarm 巡检时调用：恢复租约过期的 running 任务。返回恢复数量。 */
export const recoverStaleTasks = async (): Promise<number> => {
  const now = Date.now();
  const running = (await tasksList()).filter((t) => t.status === 'running');
  let recovered = 0;
  for (const task of running) {
    if (task.lockedUntil && task.lockedUntil > now) continue;
    const exhausted = task.attempts >= task.maxAttempts;
    const next: Task = exhausted
      ? { ...task, status: 'failed', lastError: '任务中断且重试次数用尽', updatedAt: now }
      : { ...task, status: 'pending', runAfter: now + 5_000, lockedBy: undefined, lockedUntil: undefined, lastError: '任务中断，已重新入队', updatedAt: now };
    await tasksPut(next);
    recovered += 1;
  }
  if (recovered > 0) await log.info('恢复中断任务', { recovered });
  return recovered;
};

export const cancelTask = async (taskId: string): Promise<boolean> => {
  const task = await tasksGet(taskId);
  if (!task || (task.status !== 'pending' && task.status !== 'failed')) return false;
  await tasksPut({ ...task, status: 'cancelled', updatedAt: Date.now() });
  return true;
};

export const retryTask = async (taskId: string): Promise<boolean> => {
  const task = await tasksGet(taskId);
  if (!task || (task.status !== 'failed' && task.status !== 'needs_human' && task.status !== 'cancelled')) return false;
  await tasksPut({
    ...task,
    status: 'pending',
    attempts: 0,
    runAfter: Date.now(),
    lastError: undefined,
    lockedBy: undefined,
    lockedUntil: undefined,
    updatedAt: Date.now(),
  });
  return true;
};

/** 测试专用：清空任务表 */
export const tasksForTestsClearAll = async (): Promise<void> => {
  const d = await getDB();
  await d.clear('tasks');
};

/** 指数退避（毫秒）：5min, 30min, 2h */
export const backoffFor = (attempt: number): number => {
  const ladder = [5 * 60_000, 30 * 60_000, 2 * 3_600_000];
  return ladder[Math.min(attempt - 1, ladder.length - 1)] ?? ladder[ladder.length - 1]!;
};

export type { Task, TaskStatus };
export { tasksDelete, tasksGet, tasksList, getDB };
