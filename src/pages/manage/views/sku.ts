// SKU 监控管理页
import {
  skuChangesList,
  skuSnapshotLatestValid,
  skuSnapshotList,
} from '@/common/db';
import { listSkuProducts } from '@/modules/sku/products';
import { pauseSkuProduct, resumeSkuProduct, deleteSkuProduct, enqueueSkuScan, setSkuNotifyOverride } from '@/modules/sku/actions';
import { CHANGE_TYPE_LABEL } from '@/modules/sku/compare';
import { getSettings } from '@/common/settings';
import { effectiveSkuNotify, isSkuNotifyCustomized } from '@/modules/sku/notifyRules';
import { esc, fmtTime, sendMessage, toast, confirmDanger } from './helpers';
import type { SkuProduct, SkuChange, SkuSnapshot, SkuNotifySettings } from '@/common/types';

const ruleSummary = (rules: SkuNotifySettings): string => {
  const on: string[] = [];
  if (rules.added) on.push('上架');
  if (rules.removed) on.push('下架');
  if (rules.stockOut) on.push('售罄');
  if (rules.stockRestored) on.push('补货');
  if (rules.lowStock) on.push(`低库存（≤${rules.lowStockThreshold}件）`);
  if (rules.stockIncreased) on.push('库存增加');
  if (rules.stockDecreased) on.push('库存减少');
  if (rules.specChanged) on.push('规格变化');
  if (rules.priceChanged) on.push('价格变化');
  return on.length ? on.join(' / ') : '全部静音';
};

const renderNotifySection = (p: ListedProduct, effective: SkuNotifySettings, customized: boolean): string => `
    <div class="notify-box" style="border:1px solid var(--border,#eceef1);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#fff">
      <div class="row" style="margin-bottom:6px">
        <strong>本商品通知规则</strong>
        <span class="spacer"></span>
        <span class="hint">${customized ? '已自定义（覆盖全局）' : '跟随全局设置'}</span>
      </div>
      <p class="hint" style="margin:0 0 8px">当前生效：${esc(ruleSummary(effective))}</p>
      ${customized
        ? `<button class="btn btn--small btn--danger" data-act="notify-reset">恢复跟随全局</button>`
        : `<button class="btn btn--small" data-act="notify-customize">自定义本商品…</button>`}
      <div class="notify-editor" hidden style="margin-top:8px">
        <label class="checkbox"><input class="ov" data-k="added" type="checkbox" ${effective.added ? 'checked' : ''} /> 新增 SKU（上架）</label>
        <label class="checkbox"><input class="ov" data-k="removed" type="checkbox" ${effective.removed ? 'checked' : ''} /> 删除 SKU（下架）</label>
        <label class="checkbox"><input class="ov" data-k="stockOut" type="checkbox" ${effective.stockOut ? 'checked' : ''} /> 库存归零（有货变无货）</label>
        <label class="checkbox"><input class="ov" data-k="stockRestored" type="checkbox" ${effective.stockRestored ? 'checked' : ''} /> 补货恢复（从 0 变得更多）</label>
        <label class="checkbox"><input class="ov" data-k="lowStock" type="checkbox" ${effective.lowStock ? 'checked' : ''} /> 库存偏低（跌破阈值提醒一次）</label>
        <label class="field" style="max-width:260px"><span>低库存阈值（件）</span>
          <input id="ov_lowStockThreshold" type="number" min="1" max="9999" value="${effective.lowStockThreshold}" />
        </label>
        <label class="checkbox"><input class="ov" data-k="stockIncreased" type="checkbox" ${effective.stockIncreased ? 'checked' : ''} /> 库存增加</label>
        <label class="checkbox"><input class="ov" data-k="stockDecreased" type="checkbox" ${effective.stockDecreased ? 'checked' : ''} /> 库存减少</label>
        <label class="checkbox"><input class="ov" data-k="specChanged" type="checkbox" ${effective.specChanged ? 'checked' : ''} /> 规格变化</label>
        <label class="checkbox"><input class="ov" data-k="priceChanged" type="checkbox" ${effective.priceChanged ? 'checked' : ''} /> 价格变化</label>
        <div class="row" style="margin-top:8px">
          <button class="btn btn--primary btn--small" data-act="notify-save">保存覆盖</button>
          <button class="btn btn--small" data-act="notify-cancel">取消</button>
        </div>
      </div>
    </div>`;

interface ListedProduct extends SkuProduct {
  lastValidSkuCount: number | null;
  lastValidScanAt: number | null;
}

const renderDetail = (p: ListedProduct, snap: SkuSnapshot | undefined, changes: SkuChange[], snapshots: SkuSnapshot[], notifySectionHtml: string): string => `
  <div class="detail-panel" data-detail="${esc(p.id)}">
    ${notifySectionHtml}
    <div class="row" style="margin-bottom:8px">
      <strong>当前 SKU 状态</strong>
      <span class="spacer"></span>
      <span class="hint">最近有效扫描：${snap ? esc(fmtTime(snap.scannedAt)) : '无'} · 基准：${p.baselineEstablished ? '已建立' : '未建立（首次有效扫描后建立）'}</span>
    </div>
    ${snap ? `
      <div class="sku-table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>规格属性</th><th>价格</th><th>库存</th><th>状态</th></tr></thead>
          <tbody>
            ${snap.skus.map((s) => `<tr>
              <td class="mono">${esc(s.skuId ?? s.specId ?? '—')}</td>
              <td>${esc(s.name)}</td>
              <td>${s.price !== undefined ? `¥${s.price.toFixed(2)}` : '—'}</td>
              <td>${s.stock ?? '<span class="badge badge--err">缺失</span>'}</td>
              <td>${s.inStock ? '<span class="badge badge--ok">有货</span>' : '<span class="badge badge--err">无货</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="hint">暂无有效快照。</p>'}
    <h2 style="margin-top:12px">历史变化（最近 ${changes.length} 条）</h2>
    ${changes.length === 0 ? '<p class="hint">暂无变化记录。</p>' : `
      <div class="sku-table-wrap"><table><thead><tr><th>时间</th><th>SKU</th><th>类型</th><th>变化前</th><th>变化后</th></tr></thead>
      <tbody>${changes.map((c) => `<tr>
        <td>${esc(fmtTime(c.detectedAt))}</td>
        <td>${esc(c.skuName)}</td>
        <td>${esc(CHANGE_TYPE_LABEL[c.type])}</td>
        <td>${c.before?.stock !== undefined ? esc(String(c.before.stock)) : esc(c.before?.price !== undefined ? `¥${c.before.price}` : c.before?.name ?? '—')}</td>
        <td>${c.after?.stock !== undefined ? esc(String(c.after.stock)) : esc(c.after?.price !== undefined ? `¥${c.after.price}` : c.after?.name ?? '—')}</td>
      </tr>`).join('')}</tbody></table></div>`}
    <h2 style="margin-top:12px">历史快照（最近 ${snapshots.length} 份）</h2>
    <div class="sku-table-wrap"><table><thead><tr><th>扫描时间</th><th>有效</th><th>SKU 数</th><th>错误</th></tr></thead>
    <tbody>${snapshots.slice(0, 10).map((s) => `<tr><td>${esc(fmtTime(s.scannedAt))}</td><td>${s.valid ? '✓' : '✗'}</td><td>${s.skus.length}</td><td class="hint">${esc(s.error ?? '')}</td></tr>`).join('')}</tbody></table></div>
    ${p.consecutiveFailures > 0 ? `<div class="warn-box">连续失败 ${p.consecutiveFailures} 次${p.lastError ? `：${esc(p.lastError)}` : ''}</div>` : ''}
  </div>`;

export const renderSku = async (container: HTMLElement): Promise<void> => {
  const render = async () => {
    const products = (await listSkuProducts()) as ListedProduct[];
    container.innerHTML = `
      <h1 class="page-title">SKU 监控</h1>
      <div class="page-sub">监控商品 SKU 的新增/删除/规格/库存/价格变化；首次扫描只建基准，第二次有效扫描起比较并通知。</div>
      <div class="info-box">添加商品：打开 1688 商品详情页 → 点击浏览器工具栏的「1688 智能助手」图标 →「添加监控」。</div>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <strong>监控列表（${products.length}）</strong>
          <span class="spacer"></span>
          <button id="scanAllBtn" class="btn btn--primary">立即扫描全部</button>
          <button id="refreshBtn" class="btn">刷新</button>
        </div>
        ${products.length === 0 ? '<p class="hint">暂无监控商品。</p>' : `
        <table>
          <thead><tr><th>商品</th><th>状态</th><th>最近扫描</th><th>库存 SKU 数</th><th>连续失败</th><th>通知</th><th>操作</th></tr></thead>
          <tbody>
            ${products.map((p) => `<tr data-row="${esc(p.id)}">
              <td><div class="row"><img class="img-thumb" src="${esc(p.image ?? '')}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" /><div><div>${esc(p.title)}</div><div class="hint mono">${esc(p.offerId)}</div></div></div></td>
              <td>${p.status === 'active' ? '<span class="badge badge--ok">监控中</span>' : `<span class="badge badge--warn">${p.autoPaused ? '自动暂停' : '已暂停'}</span>`}</td>
              <td>${fmtTime(p.lastScanAt)}</td>
              <td>${p.lastValidSkuCount ?? '—'}</td>
              <td>${p.consecutiveFailures > 0 ? `<span class="badge badge--err">${p.consecutiveFailures}</span>` : '0'}</td>
              <td class="notify-cell">${isSkuNotifyCustomized(p) ? '<span class="badge badge--warn">自定义</span>' : '<span class="badge badge--ok">全局</span>'}</td>
              <td>
                <div class="row">
                  <button class="btn btn--small" data-act="scan" data-id="${esc(p.id)}">立即扫描</button>
                  <button class="btn btn--small" data-act="toggle" data-id="${esc(p.id)}">${p.status === 'active' ? '暂停' : '恢复'}</button>
                  <button class="btn btn--small" data-act="detail" data-id="${esc(p.id)}">详情</button>
                  <button class="btn btn--small btn--danger" data-act="delete" data-id="${esc(p.id)}">删除</button>
                </div>
              </td>
            </tr>
            <tr class="detail-row" data-detail-row="${esc(p.id)}" hidden><td colspan="7"><div class="detail-slot"></div></td></tr>`).join('')}
          </tbody>
        </table>`}
      </div>`;

    container.querySelector('#refreshBtn')?.addEventListener('click', () => { void render(); });
    container.querySelector('#scanAllBtn')?.addEventListener('click', async () => {
      const active = products.filter((p) => p.status === 'active');
      for (const p of active) await enqueueSkuScan(p.id);
      if (active.length > 0) await sendMessage({ type: 'tasks.process' });
      toast(active.length > 0 ? `已为 ${active.length} 个商品入队扫描` : '没有可扫描的商品');
      void render();
    });

    container.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset['act'];
        const id = btn.dataset['id']!;
        const product = products.find((p) => p.id === id);
        if (!product) return;
        if (act === 'scan') {
          await enqueueSkuScan(id);
          await sendMessage({ type: 'tasks.process' });
          toast('已入队扫描');
        } else if (act === 'toggle') {
          if (product.status === 'active') await pauseSkuProduct(id);
          else await resumeSkuProduct(id);
          void render();
        } else if (act === 'delete') {
          if (!confirmDanger(`删除商品「${product.title}」？其快照与变化历史也会被删除，不可恢复。`)) return;
          await deleteSkuProduct(id);
          void render();
        } else if (act === 'detail') {
          const row = container.querySelector<HTMLTableRowElement>(`[data-detail-row="${CSS.escape(id)}"]`)!;
          const slot = row.querySelector<HTMLDivElement>('.detail-slot')!;
          if (row.hidden) {
            const updateNotifyBadge = (pid: string, customized: boolean): void => {
              const cell = container.querySelector(`tr[data-row="${CSS.escape(pid)}"] .notify-cell`);
              if (cell) cell.innerHTML = customized ? '<span class="badge badge--warn">自定义</span>' : '<span class="badge badge--ok">全局</span>';
            };
            const fillDetail = async (): Promise<void> => {
              const settings = await getSettings();
              const effective = effectiveSkuNotify(product, settings);
              const customized = isSkuNotifyCustomized(product);
              const [snap, changes, snaps] = await Promise.all([
                skuSnapshotLatestValid(id),
                skuChangesList(id, 50),
                skuSnapshotList(id),
              ]);
              slot.innerHTML = renderDetail(product, snap, changes, snaps, renderNotifySection(product, effective, customized));
              const editor = slot.querySelector<HTMLDivElement>('.notify-editor')!;
              slot.querySelector('[data-act="notify-customize"]')?.addEventListener('click', () => { editor.hidden = false; });
              slot.querySelector('[data-act="notify-cancel"]')?.addEventListener('click', () => { editor.hidden = true; });
              slot.querySelector('[data-act="notify-reset"]')?.addEventListener('click', async () => {
                await setSkuNotifyOverride(id, undefined);
                product.skuNotify = undefined;
                toast('已恢复跟随全局通知规则');
                updateNotifyBadge(id, false);
                await fillDetail();
              });
              slot.querySelector('[data-act="notify-save"]')?.addEventListener('click', async () => {
                const q = <T extends HTMLInputElement>(sel: string) => slot.querySelector<T>(sel)!;
                const ov = (k: string) => q<HTMLInputElement>(`.ov[data-k="${k}"]`).checked;
                const th = Number.parseInt(q<HTMLInputElement>('#ov_lowStockThreshold').value, 10);
                const override: Partial<SkuNotifySettings> = {
                  added: ov('added'),
                  removed: ov('removed'),
                  stockOut: ov('stockOut'),
                  stockRestored: ov('stockRestored'),
                  lowStock: ov('lowStock'),
                  lowStockThreshold: Number.isFinite(th) ? Math.max(1, Math.min(9999, th)) : 5,
                  stockIncreased: ov('stockIncreased'),
                  stockDecreased: ov('stockDecreased'),
                  specChanged: ov('specChanged'),
                  priceChanged: ov('priceChanged'),
                };
                const updated = await setSkuNotifyOverride(id, override);
                if (!updated) { toast('商品不存在'); return; }
                product.skuNotify = updated.skuNotify;
                toast('已保存本商品通知规则');
                updateNotifyBadge(id, true);
                await fillDetail();
              });
            };
            await fillDetail();
            row.hidden = false;
          } else {
            row.hidden = true;
            slot.innerHTML = '';
          }
        }
      });
    });
  };
  await render();
};
