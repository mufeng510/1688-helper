// 任务页：队列可视化（待执行/执行中/已完成/失败/需人工）
import { getDB } from '@/common/db';
import { cancelTask, retryTask } from '@/common/tasks';
import { esc, fmtTime, sendMessage, toast } from './helpers';
import type { Task, TaskStatus, TaskType } from '@/common/types';

const TYPE_LABEL: Record<TaskType, string> = {
  'sku.scan': 'SKU 扫描',
  'claim.scan': '理赔扫描',
  'claim.apply': '理赔申请',
  'notify.retry': '通知重试',
};

const STATUS_LABEL: Record<TaskStatus | 'all', string> = {
  all: '全部',
  pending: '等待执行',
  running: '正在执行',
  done: '已完成',
  failed: '失败',
  needs_human: '需人工处理',
  cancelled: '已取消',
};

const statusBadge = (s: string): string => {
  switch (s) {
    case 'pending': return '<span class="badge">等待执行</span>';
    case 'running': return '<span class="badge badge--accent">执行中</span>';
    case 'done': return '<span class="badge badge--ok">已完成</span>';
    case 'failed': return '<span class="badge badge--err">失败</span>';
    case 'needs_human': return '<span class="badge badge--warn">需人工</span>';
    default: return `<span class="badge">${esc(s)}</span>`;
  }
};

const payloadSummary = (t: Task): string => {
  if (t.type === 'sku.scan') return `商品 ${String(t.payload['productId'] ?? '').slice(0, 14)}`;
  if (t.type === 'claim.apply') return `理赔 ${String(t.payload['claimId'] ?? '').slice(0, 14)}`;
  if (t.type === 'claim.scan') return '扫描揽收超时订单';
  return JSON.stringify(t.payload).slice(0, 40);
};

export const renderTasks = async (container: HTMLElement): Promise<void> => {
  const currentFilter = () => (container.querySelector<HTMLSelectElement>('#taskFilter')?.value ?? 'all') as TaskStatus | 'all';

  const render = async () => {
    const filter = container.isConnected ? currentFilter() : 'all';
    const db = await getDB();
    const all = (await db.getAll('tasks')) as Task[];
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    const filtered = filter === 'all' ? all : all.filter((t) => t.status === filter);
    const counts = all.reduce<Record<string, number>>((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {});

    container.innerHTML = `
      <h1 class="page-title">任务</h1>
      <div class="page-sub">后台任务队列：扫描、申请与通知重试都在这里。Service Worker 被回收后，未完成任务会自动恢复。</div>
      <div class="cards">
        <div class="stat"><div class="stat__label">等待执行</div><div class="stat__value">${counts['pending'] ?? 0}</div></div>
        <div class="stat"><div class="stat__label">正在执行</div><div class="stat__value">${counts['running'] ?? 0}</div></div>
        <div class="stat"><div class="stat__label">需人工处理</div><div class="stat__value">${counts['needs_human'] ?? 0}</div></div>
        <div class="stat"><div class="stat__label">失败</div><div class="stat__value">${counts['failed'] ?? 0}</div></div>
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <select id="taskFilter" style="width:auto">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button id="processBtn" class="btn btn--primary">立即执行队列</button>
          <button id="refreshBtn" class="btn">刷新</button>
        </div>
        <div class="sku-table-wrap">
          <table>
            <thead><tr><th>类型</th><th>目标</th><th>状态</th><th>已试次数</th><th>下次执行</th><th>最近错误</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              ${filtered.length === 0 ? '<tr><td colspan="8" class="hint">暂无任务</td></tr>' : filtered.slice(0, 200).map((t) => `<tr>
                <td>${esc(TYPE_LABEL[t.type])}</td>
                <td class="mono">${esc(payloadSummary(t))}</td>
                <td>${statusBadge(t.status)}</td>
                <td>${t.attempts}/${t.maxAttempts}</td>
                <td>${t.status === 'pending' ? fmtTime(t.runAfter) : '—'}</td>
                <td class="hint" title="${esc(t.lastError ?? '')}">${esc((t.lastError ?? '').slice(0, 36))}</td>
                <td>${fmtTime(t.createdAt)}</td>
                <td>
                  ${t.status === 'pending' || t.status === 'failed' ? `<button class="btn btn--small" data-run="${esc(t.id)}">立即执行</button>` : ''}
                  ${t.status === 'failed' || t.status === 'needs_human' || t.status === 'cancelled' ? `<button class="btn btn--small" data-retry="${esc(t.id)}">重试</button>` : ''}
                  ${t.status === 'pending' || t.status === 'failed' ? `<button class="btn btn--small btn--danger" data-cancel="${esc(t.id)}">取消</button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector('#refreshBtn')!.addEventListener('click', () => { void render(); });
    container.querySelector('#taskFilter')!.addEventListener('change', () => { void render(); });
    container.querySelector('#processBtn')!.addEventListener('click', async () => {
      await sendMessage({ type: 'tasks.process' });
      toast('已触发队列执行');
      void render();
    });
    container.querySelectorAll<HTMLButtonElement>('[data-run]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await sendMessage({ type: 'tasks.runNow', taskId: btn.dataset['run']! });
        toast('已执行');
        void render();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await retryTask(btn.dataset['retry']!);
        toast('已重新入队');
        void render();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await cancelTask(btn.dataset['cancel']!);
        toast('已取消');
        void render();
      });
    });
  };
  await render();
};
