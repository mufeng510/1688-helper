// 日志页
import { getDB } from '@/common/db';
import { esc, fmtTime, toast, confirmDanger } from './helpers';
import type { LogEntry, LogLevel } from '@/common/types';

export const renderLogs = async (container: HTMLElement): Promise<void> => {
  const render = async () => {
    const level = (container.querySelector<HTMLSelectElement>('#lvLevel')?.value ?? 'all') as LogLevel | 'all';
    const moduleFilter = (container.querySelector<HTMLInputElement>('#lvModule')?.value ?? '').trim();
    const search = (container.querySelector<HTMLInputElement>('#lvSearch')?.value ?? '').trim().toLowerCase();

    const db = await getDB();
    let entries = (await db.getAll('logs')) as LogEntry[];
    entries.sort((a, b) => b.ts - a.ts);
    if (level !== 'all') entries = entries.filter((e) => e.level === level);
    if (moduleFilter) entries = entries.filter((e) => e.module.includes(moduleFilter));
    if (search) entries = entries.filter((e) => `${e.message} ${e.detail ?? ''}`.toLowerCase().includes(search));
    const shown = entries.slice(0, 200);

    container.innerHTML = `
      <h1 class="page-title">日志</h1>
      <div class="page-sub">最近 200 条（共 ${entries.length} 条匹配）。Cookie / Token / Webhook 密钥不会写入日志。</div>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <select id="lvLevel" style="width:auto">
            ${['all', 'debug', 'info', 'warn', 'error'].map((l) => `<option value="${l}" ${level === l ? 'selected' : ''}>${l === 'all' ? '全部级别' : l}</option>`).join('')}
          </select>
          <input id="lvModule" type="text" placeholder="模块过滤，如 sku.monitor" value="${esc(moduleFilter)}" style="width:180px" />
          <input id="lvSearch" type="text" placeholder="搜索消息内容" value="${esc(search)}" style="width:220px" />
          <span class="spacer"></span>
          <button id="clearBtn" class="btn btn--danger">清空日志</button>
          <button id="refreshBtn" class="btn">刷新</button>
        </div>
        <div class="sku-table-wrap">
          <table>
            <thead><tr><th>时间</th><th>级别</th><th>模块</th><th>消息</th></tr></thead>
            <tbody>
              ${shown.length === 0 ? '<tr><td colspan="4" class="hint">暂无日志</td></tr>' : shown.map((e) => `<tr>
                <td>${fmtTime(e.ts)}</td>
                <td><span class="badge ${e.level === 'error' ? 'badge--err' : e.level === 'warn' ? 'badge--warn' : ''}">${e.level}</span></td>
                <td class="mono">${esc(e.module)}</td>
                <td>${esc(e.message)}${e.detail ? `<div class="hint mono">${esc(e.detail.slice(0, 300))}</div>` : ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector('#refreshBtn')!.addEventListener('click', () => { void render(); });
    for (const id of ['lvLevel', 'lvModule', 'lvSearch']) {
      container.querySelector(`#${id}`)!.addEventListener('change', () => { void render(); });
      container.querySelector(`#${id}`)!.addEventListener('input', () => { void render(); });
    }
    container.querySelector('#clearBtn')!.addEventListener('click', async () => {
      if (!confirmDanger('清空全部日志？')) return;
      const d = await getDB();
      await d.clear('logs');
      toast('日志已清空');
      void render();
    });
  };
  await render();
};
