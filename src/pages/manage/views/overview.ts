// 总览页
import { getDB, skuProductsList, claimOrdersList, skuChangesListRecent, metaGet } from '@/common/db';
import { esc, fmtTime, sendMessage, toast } from './helpers';

export const renderOverview = async (container: HTMLElement): Promise<void> => {
  const refresh = async () => {
    const products = await skuProductsList();
    const claimOrders = await claimOrdersList();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayChanges = await skuChangesListRecent(dayStart.getTime());
    const changedProducts = new Set(todayChanges.map((c) => c.productId)).size;

    const db = await getDB();
    const allTasks = await db.getAll('tasks');
    const queued = allTasks.filter((t) => t.status === 'pending').length;
    const running = allTasks.filter((t) => t.status === 'running').length;
    const recentError = (await db.getAllFromIndex('logs', 'level', 'error')).sort((a, b) => b.ts - a.ts)[0];

    const pendingClaims = claimOrders.filter((o) => ['pending_apply', 'failed', 'needs_human', 'applying'].includes(o.applyStatus)).length;
    const submittedToday = claimOrders.filter((o) => o.lastApplyAt && o.lastApplyAt >= dayStart.getTime() && o.applyStatus === 'submitted').length;
    const active = products.filter((p) => p.status === 'active').length;
    const paused = products.filter((p) => p.status === 'paused').length;
    const autoPaused = products.filter((p) => p.autoPaused).length;
    const lastScan = products.reduce((max, p) => Math.max(max, p.lastSuccessAt ?? 0), 0);

    const login = (await metaGet<{ loggedIn: boolean; checkedAt: number }>('lastLoginStatus'));
    const loginHtml = login
      ? login.loggedIn
        ? '<span class="badge badge--ok">已登录</span>'
        : '<span class="badge badge--err">登录失效</span>'
      : '<span class="badge">未检查</span>';

    container.innerHTML = `
      <h1 class="page-title">总览</h1>
      <div class="page-sub">扩展运行状态一览 · 数据全部保存在本机浏览器</div>
      <div class="cards">
        <div class="stat"><div class="stat__label">扩展状态</div><div class="stat__value"><small>运行中</small></div></div>
        <div class="stat"><div class="stat__label">1688 登录状态</div><div class="stat__value" id="loginValue">${loginHtml}</div></div>
        <div class="stat"><div class="stat__label">理赔待处理</div><div class="stat__value">${pendingClaims}<small> 笔</small></div></div>
        <div class="stat"><div class="stat__label">今日申请成功</div><div class="stat__value">${submittedToday}<small> 笔</small></div></div>
        <div class="stat"><div class="stat__label">监控商品</div><div class="stat__value">${active}<small> 个在监控${paused ? `，${paused} 个暂停${autoPaused ? `（${autoPaused} 自动暂停）` : ''}` : ''}</small></div></div>
        <div class="stat"><div class="stat__label">今日 SKU 变化商品</div><div class="stat__value">${changedProducts}<small> 个（${todayChanges.length} 条记录）</small></div></div>
        <div class="stat"><div class="stat__label">最近扫描时间</div><div class="stat__value" style="font-size:14px">${lastScan ? esc(fmtTime(lastScan)) : '—'}</div></div>
        <div class="stat"><div class="stat__label">任务队列</div><div class="stat__value">${running}<small> 运行中 / ${queued} 排队</small></div></div>
      </div>
      ${recentError ? `<div class="warn-box"><strong>最近异常：</strong>${esc(fmtTime(recentError.ts))} · [${esc(recentError.module)}] ${esc(recentError.message)}</div>` : ''}
      <div class="card">
        <h2>操作</h2>
        <div class="row">
          <button id="checkLoginBtn" class="btn">检查 1688 登录状态</button>
          <button id="refreshBtn" class="btn">刷新</button>
          <span class="hint">登录检查会在后台打开工作台标签页，检查完自动关闭</span>
        </div>
      </div>
    `;

    container.querySelector('#refreshBtn')!.addEventListener('click', () => { void refresh(); });
    container.querySelector('#checkLoginBtn')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const result = await sendMessage<{ loggedIn: boolean }>({ type: 'overview.checkLogin' });
        toast(result.loggedIn ? '1688 登录正常' : '1688 登录已失效，请重新登录');
        await refresh();
      } catch (err) {
        toast(`检查失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        btn.disabled = false;
      }
    });
  };
  await refresh();
};
