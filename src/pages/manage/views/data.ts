// 数据与备份页
import { EXPORTABLE_STORES, clearHistory, estimateStorage, exportBackup, getDB, importBackup } from '@/common/db';
import { getSettings, setSettings } from '@/common/settings';
import { esc, toast, confirmDanger } from './helpers';

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export const renderData = async (container: HTMLElement): Promise<void> => {
  const refresh = async () => {
    const db = await getDB();
    const counts: Record<string, number> = {};
    for (const store of EXPORTABLE_STORES) {
      counts[store] = await db.count(store as never);
    }
    const est = await estimateStorage();
    container.innerHTML = `
      <h1 class="page-title">数据与备份</h1>
      <div class="page-sub">历史长期保留，不自动清理。手动清理只影响所选数据，不影响监控配置。</div>

      <div class="card">
        <h2>存储占用</h2>
        <p class="hint">${est ? `已用 ${fmtBytes(est.usage)} / 配额 ${fmtBytes(est.quota)}` : '浏览器未提供配额信息'}</p>
        <table>
          <thead><tr><th>数据表</th><th>记录数</th></tr></thead>
          <tbody>${Object.entries(counts).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>备份与恢复</h2>
        <div class="row">
          <button id="exportBtn" class="btn btn--primary">导出备份（JSON）</button>
          <label class="btn" style="cursor:pointer">导入恢复…<input id="importFile" type="file" accept="application/json" hidden /></label>
          <select id="importMode" style="width:auto">
            <option value="merge">合并（覆盖同名记录）</option>
            <option value="replace">替换（先清空全部数据）</option>
          </select>
        </div>
        <p class="hint">备份包含监控商品、全部快照、变化记录、理赔记录、任务、日志、通知记录与设置。不含浏览器级数据（如扩展自身权限授权）。</p>
      </div>

      <div class="card">
        <h2>清理历史数据</h2>
        <div class="row">
          <label class="checkbox"><input type="checkbox" data-kind="skuSnapshots" checked /> SKU 历史快照</label>
          <label class="checkbox"><input type="checkbox" data-kind="skuChanges" checked /> SKU 变化记录</label>
          <label class="checkbox"><input type="checkbox" data-kind="logs" /> 日志</label>
          <label class="checkbox"><input type="checkbox" data-kind="notificationLog" /> 通知记录</label>
        </div>
        <div class="row" style="margin-top:8px">
          <select id="retention" style="width:auto">
            <option value="30">保留最近 30 天，清理更早</option>
            <option value="90">保留最近 90 天，清理更早</option>
            <option value="365">保留最近 1 年，清理更早</option>
            <option value="0">全部清空</option>
          </select>
          <button id="clearBtn" class="btn btn--danger">执行清理</button>
        </div>
      </div>

      <div class="card">
        <h2>危险操作</h2>
        <button id="resetAllBtn" class="btn btn--danger">重置扩展（清空所有数据与设置）</button>
        <p class="hint">清空 IndexedDB 全部数据表与 chrome.storage.local 中的设置。扩展本身不被卸载。</p>
      </div>
    `;

    container.querySelector('#exportBtn')!.addEventListener('click', async () => {
      const settings = await getSettings();
      const backup = await exportBackup(settings);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `1688-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('备份已开始下载');
    });

    container.querySelector<HTMLInputElement>('#importFile')!.addEventListener('change', async (e) => {
      const file = (e.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const mode = (container.querySelector<HTMLSelectElement>('#importMode')!.value) as 'merge' | 'replace';
        if (mode === 'replace' && !confirmDanger('替换模式将先清空全部现有数据再导入。确定？')) return;
        const { imported } = await importBackup(json, mode);
        if (json.settings) await setSettings(json.settings);
        toast(`已导入 ${imported} 条记录`);
        void refresh();
      } catch (err) {
        toast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    });

    container.querySelector('#clearBtn')!.addEventListener('click', async () => {
      const kinds = Array.from(container.querySelectorAll<HTMLInputElement>('[data-kind]:checked')).map((i) => i.dataset['kind']) as Array<'skuSnapshots' | 'skuChanges' | 'logs' | 'notificationLog'>;
      if (kinds.length === 0) { toast('请至少勾选一项'); return; }
      const days = Number((container.querySelector<HTMLSelectElement>('#retention')!).value);
      if (days === 0 && !confirmDanger('将清空所选数据全部记录。确定？')) return;
      const deleted = await clearHistory(kinds, days);
      toast(`已删除 ${deleted} 条记录`);
      void refresh();
    });

    container.querySelector('#resetAllBtn')!.addEventListener('click', async () => {
      if (!confirmDanger('清空所有数据与设置，且不可恢复。确定继续？')) return;
      if (!confirmDanger('再次确认：此操作无法撤销。继续？')) return;
      const d = await getDB();
      for (const store of EXPORTABLE_STORES) await d.clear(store as never);
      await chrome.storage.local.clear();
      toast('已重置扩展数据');
      void refresh();
    });
  };
  await refresh();
};
