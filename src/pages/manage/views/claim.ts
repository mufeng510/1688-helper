// 理赔管理页
import { claimBatchesList, claimOrdersList } from '@/common/db';
import { getSettings } from '@/common/settings';
import { markClaimManually } from '@/modules/claim/claim';
import { esc, fmtTime, sendMessage, toast } from './helpers';
import type { ClaimApplyStatus, ClaimOrder } from '@/common/types';

const STATUS_LABEL: Record<ClaimApplyStatus, string> = {
  pending_apply: '待申请',
  applying: '申请中',
  submitted: '平台处理中',
  failed: '申请失败',
  needs_human: '需人工处理',
  completed: '已完成',
  rejected: '资格不满足',
};

const badgeFor = (s: ClaimApplyStatus): string => {
  if (s === 'submitted') return '<span class="badge badge--ok">平台处理中</span>';
  if (s === 'completed') return '<span class="badge badge--ok">已完成</span>';
  if (s === 'failed') return '<span class="badge badge--err">申请失败</span>';
  if (s === 'needs_human') return '<span class="badge badge--warn">需人工处理</span>';
  if (s === 'rejected') return '<span class="badge">资格不满足</span>';
  if (s === 'applying') return '<span class="badge badge--accent">申请中</span>';
  return '<span class="badge">待申请</span>';
};

const RESULT_LABEL: Record<string, string> = {
  unknown: '未知',
  accepted: '平台已受理',
  processing: '平台处理中',
  rejected: '平台驳回',
  paid: '已到账',
  closed: '已关闭',
};

export const renderClaim = async (container: HTMLElement): Promise<void> => {
  const settings = await getSettings();
  const modeBadge = settings.claimMode === 'simulation'
    ? '<span class="badge badge--sim">模拟模式</span>'
    : '<span class="badge badge--warn">真实模式</span>';

  const render = async () => {
    const orders = await claimOrdersList();
    const batches = await claimBatchesList(8);

    const statusFilter = (container.querySelector<HTMLSelectElement>('#fStatus')?.value ?? 'all') as string;
    const orderIdFilter = (container.querySelector<HTMLInputElement>('#fOrderId')?.value ?? '').trim();
    const since = container.querySelector<HTMLInputElement>('#fSince')?.value;
    const until = container.querySelector<HTMLInputElement>('#fUntil')?.value;

    let filtered = orders;
    if (statusFilter !== 'all') filtered = filtered.filter((o) => o.applyStatus === statusFilter);
    if (orderIdFilter) filtered = filtered.filter((o) => o.orderId.toLowerCase().includes(orderIdFilter.toLowerCase()));
    if (since) {
      const ts = new Date(since).getTime();
      filtered = filtered.filter((o) => o.discoveredAt >= ts);
    }
    if (until) {
      const ts = new Date(until).getTime() + 24 * 3600e3;
      filtered = filtered.filter((o) => o.discoveredAt < ts);
    }
    filtered = [...filtered].sort((a, b) => b.discoveredAt - a.discoveredAt);

    container.innerHTML = `
      <h1 class="page-title">理赔管理</h1>
      <div class="page-sub">揽收超时订单理赔跟踪。申请提交状态与最终理赔结果分开记录：申请成功 ≠ 理赔到账。</div>
      ${settings.claimMode === 'simulation' ? '<div class="info-box">当前为<strong>模拟模式</strong>：所有订单与申请均为虚构数据，仅用于验证框架；不会产生真实理赔申请。请在「系统设置 → 理赔模式」确认真实页面适配后再切换。</div>' : '<div class="warn-box">当前为<strong>真实模式</strong>：揽收超时筛选与「去申请理赔」页面尚未适配，扫描不会发现真实订单，申请不会被提交。</div>'}
      <div class="card">
        <div class="row">
          <h2 style="margin:0">我申请的理赔 ${modeBadge}</h2>
          <span class="spacer"></span>
          <button id="scanBtn" class="btn btn--primary">立即扫描</button>
          <button id="refreshBtn" class="btn">刷新</button>
        </div>
        <div class="row" style="margin-top:10px">
          <select id="fStatus" style="width:auto">
            <option value="all">全部状态</option>
            ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${statusFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <input id="fOrderId" type="text" placeholder="搜索订单号" value="${esc(orderIdFilter)}" style="width:200px" />
          <input id="fSince" type="date" value="${esc(since ?? '')}" style="width:150px" />
          <span class="hint">至</span>
          <input id="fUntil" type="date" value="${esc(until ?? '')}" style="width:150px" />
          <span class="hint">${filtered.length} / ${orders.length} 笔</span>
        </div>
        <div class="sku-table-wrap" style="margin-top:10px">
          <table>
            <thead><tr><th>订单号</th><th>商品</th><th>卖家</th><th>发现时间</th><th>申请状态</th><th>理赔结果</th><th>重试</th><th>失败原因</th><th>操作</th></tr></thead>
            <tbody>
              ${filtered.length === 0 ? '<tr><td colspan="9" class="hint">暂无记录</td></tr>' : filtered.map((o) => `<tr>
                <td class="mono">${esc(o.orderId)}${o.mode === 'simulation' ? ' <span class="badge badge--sim">模</span>' : ''}</td>
                <td>${esc(o.goodsName ?? '—')}</td>
                <td>${esc(o.seller ?? '—')}</td>
                <td>${fmtTime(o.discoveredAt)}</td>
                <td>${badgeFor(o.applyStatus)}</td>
                <td class="hint">${esc(RESULT_LABEL[o.resultStatus] ?? o.resultStatus)}</td>
                <td>${o.retryCount}</td>
                <td class="hint" title="${esc(o.lastError ?? '')}">${esc((o.lastError ?? '').slice(0, 30))}</td>
                <td>${o.applyStatus === 'needs_human' ? `<button class="btn btn--small" data-complete="${esc(o.id)}">标记完成</button>` : ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>最近申请批次</h2>
        ${batches.length === 0 ? '<p class="hint">暂无批次。</p>' : `
        <table>
          <thead><tr><th>开始时间</th><th>模式</th><th>发现</th><th>成功</th><th>失败</th><th>需人工</th><th>结束</th></tr></thead>
          <tbody>${batches.map((b) => `<tr><td>${fmtTime(b.startedAt)}</td><td>${b.mode === 'simulation' ? '模拟' : '真实'}</td><td>${b.discovered}</td><td>${b.submitted}</td><td>${b.failed}</td><td>${b.needsHuman}</td><td>${b.finishedAt ? fmtTime(b.finishedAt) : '进行中'}</td></tr>`).join('')}</tbody>
        </table>`}
      </div>
    `;

    container.querySelector('#refreshBtn')!.addEventListener('click', () => { void render(); });
    container.querySelector('#scanBtn')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        await sendMessage({ type: 'claim.scanNow' });
        toast('扫描完成');
        await render();
      } catch (err) {
        toast(`扫描失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        btn.disabled = false;
      }
    });
    for (const id of ['fStatus', 'fOrderId', 'fSince', 'fUntil']) {
      container.querySelector(`#${id}`)!.addEventListener('change', () => { void render(); });
      container.querySelector(`#${id}`)!.addEventListener('input', () => { void render(); });
    }
    container.querySelectorAll<HTMLButtonElement>('[data-complete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await markClaimManually(btn.dataset['complete']!);
        toast(ok ? '已标记完成' : '状态不允许（仅需人工处理可标记）');
        void render();
      });
    });
  };
  await render();
};
