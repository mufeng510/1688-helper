// 管理页入口：基于 hash 的侧边导航，视图按需渲染。
import { renderOverview } from './views/overview';
import { renderSku } from './views/sku';
import { renderClaim } from './views/claim';
import { renderTasks } from './views/tasks';
import { renderSettings } from './views/settings';
import { renderLogs } from './views/logs';
import { renderData } from './views/data';

const NAV = [
  { id: 'overview', label: '总览', render: renderOverview },
  { id: 'sku', label: 'SKU 监控', render: renderSku },
  { id: 'claim', label: '理赔管理', render: renderClaim },
  { id: 'tasks', label: '任务', render: renderTasks },
  { id: 'settings', label: '系统设置', render: renderSettings },
  { id: 'logs', label: '日志', render: renderLogs },
  { id: 'data', label: '数据与备份', render: renderData },
] as const;

const nav = document.getElementById('nav')!;
const view = document.getElementById('view')!;
const versionEl = document.getElementById('version')!;
const toastEl = document.getElementById('toast')!;

versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

export const toast = (msg: string): void => {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  window.setTimeout(() => { toastEl.hidden = true; }, 2600);
};

const renderNav = (active: string): void => {
  nav.innerHTML = NAV.map((item) => `<a class="nav__item ${item.id === active ? 'active' : ''}" href="#${item.id}">${item.label}</a>`).join('');
};

const mount = async (): Promise<void> => {
  const hash = (location.hash || '#overview').slice(1);
  const item = NAV.find((n) => n.id === hash) ?? NAV[0]!;
  renderNav(item.id);
  view.innerHTML = '<div class="hint">加载中…</div>';
  try {
    await item.render(view);
  } catch (err) {
    view.innerHTML = `<div class="card"><h2>页面加载失败</h2><p class="mono">${err instanceof Error ? err.message : String(err)}</p></div>`;
  }
};

window.addEventListener('hashchange', () => { void mount(); });
void mount();
