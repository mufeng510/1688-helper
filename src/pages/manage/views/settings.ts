// 系统设置页
import { getSettings, setSettings } from '@/common/settings';
import { DEFAULT_SETTINGS, DEFAULT_SKU_NOTIFY } from '@/common/types';
import { getImport1688Settings, setImport1688Settings, clearImport1688Token } from '@/modules/import1688/settings';
import { maskToken, originOf as wsOriginOf } from '@/modules/import1688/payload';
import { sendMessage, toast, confirmDanger, esc } from './helpers';

const originOf = (rawUrl: string): string | null => {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return null;
  }
};

export const renderSettings = async (container: HTMLElement): Promise<void> => {
  const settings = await getSettings();
  const wsSettings = await getImport1688Settings();
  const tokenHint = wsSettings.token ? `已设置（末 4 位 ${maskToken(wsSettings.token).slice(-4)}）` : '未设置';

  container.innerHTML = `
    <h1 class="page-title">系统设置</h1>
    <div class="page-sub">配置保存在本机（chrome.storage.local）。修改后即时生效，下次调度/请求起作用。</div>

    <div class="card">
      <h2>扫描调度</h2>
      <label class="field"><span>SKU 全局扫描间隔（分钟，最小 5）</span>
        <input id="skuInterval" type="number" min="5" max="1440" value="${settings.skuScanIntervalMinutes}" />
      </label>
      <div class="row">
        <label class="checkbox"><input id="claimScanEnabled" type="checkbox" ${settings.claimScanEnabled ? 'checked' : ''} /> 启用理赔扫描</label>
      </div>
      <label class="field"><span>理赔扫描间隔（分钟，最小 5）</span>
        <input id="claimInterval" type="number" min="5" max="1440" value="${settings.claimScanIntervalMinutes}" ${settings.claimScanEnabled ? '' : 'disabled'} />
      </label>
      <label class="field"><span>理赔模式</span>
        <select id="claimMode">
          <option value="simulation" ${settings.claimMode === 'simulation' ? 'selected' : ''}>模拟模式（虚构订单，验证框架用）</option>
          <option value="live" ${settings.claimMode === 'live' ? 'selected' : ''}>真实模式（揽收超时只读适配；不提交申请）</option>
        </select>
      </label>
      <p class="hint">真实模式：已完成揽收超时「只读」适配（扫描发现 + 平台状态探测 + 理赔结果回读），不会提交任何真实理赔。真实提交需另行评审。</p>
    </div>

    <div class="card">
      <h2>Webhook 通知</h2>
      <label class="checkbox"><input id="whEnabled" type="checkbox" ${settings.webhook.enabled ? 'checked' : ''} /> 启用 Webhook</label>
      <label class="field"><span>Webhook URL</span>
        <input id="whUrl" type="text" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" value="${settings.webhook.url}" autocomplete="off" />
      </label>
      <label class="field"><span>请求方法</span>
        <select id="whMethod">
          <option value="POST" ${settings.webhook.method === 'POST' ? 'selected' : ''}>POST（默认）</option>
          <option value="GET" ${settings.webhook.method === 'GET' ? 'selected' : ''}>GET</option>
        </select>
      </label>
      <label class="field"><span>请求头（每行一个「Key: Value」）</span>
        <textarea id="whHeaders" placeholder="Authorization: Bearer xxx">${settings.webhook.headers}</textarea>
      </label>
      <label class="field"><span>请求体模板（支持 {{title}} / {{body}} / {{text}} 占位符；留空则发送 JSON {title, body, text}）</span>
        <textarea id="whBody" placeholder='{"msgtype":"text","text":{"content":"{{text}}"}}'>${settings.webhook.bodyTemplate}</textarea>
      </label>
      <div class="row">
        <button id="whTestBtn" class="btn">发送测试消息</button>
        <button id="whAuthBtn" class="btn">授权 Webhook 域名</button>
        <span class="hint">若测试提示 CORS/权限错误，请先点击「授权 Webhook 域名」</span>
      </div>
      <p class="hint">URL 与密钥仅保存在本机，不会写入日志；Webhook 失败不影响业务任务。</p>
    </div>

    <div class="card">
      <h2>SKU 通知规则</h2>
      <p class="hint">桌面通知与 Webhook 共用下面的选择；静音的场景仍会记录到「SKU 监控 → 详情 → 历史变化」，只是不发送。每商品可在「SKU 监控 → 详情」里单独覆盖。</p>
      <label class="checkbox"><input id="skAdded" type="checkbox" ${settings.skuNotify.added ? 'checked' : ''} /> 新增 SKU（上架）</label>
      <label class="checkbox"><input id="skRemoved" type="checkbox" ${settings.skuNotify.removed ? 'checked' : ''} /> 删除 SKU（下架）</label>
      <label class="checkbox"><input id="skStockOut" type="checkbox" ${settings.skuNotify.stockOut ? 'checked' : ''} /> 库存归零（有货变无货）</label>
      <label class="checkbox"><input id="skStockRestored" type="checkbox" ${settings.skuNotify.stockRestored ? 'checked' : ''} /> 补货恢复（从 0 变得更多）</label>
      <label class="checkbox"><input id="skLowStock" type="checkbox" ${settings.skuNotify.lowStock ? 'checked' : ''} /> 库存偏低（快变成 0 时提醒一次）</label>
      <label class="field" style="max-width:280px"><span>低库存阈值（件；从 &gt; 阈值 跌破到 ≤ 阈值 时通知一次）</span>
        <input id="skLowStockThreshold" type="number" min="1" max="9999" value="${settings.skuNotify.lowStockThreshold}" />
      </label>
      <label class="checkbox"><input id="skSpec" type="checkbox" ${settings.skuNotify.specChanged ? 'checked' : ''} /> 规格变化</label>
      <label class="checkbox"><input id="skPrice" type="checkbox" ${settings.skuNotify.priceChanged ? 'checked' : ''} /> 价格变化（仅记录，不通知推荐静音）</label>
      <div class="row" style="margin-top:8px">
        <button id="skResetBtn" class="btn">恢复默认通知规则</button>
        <span id="skRuleSummary" class="hint"></span>
      </div>
    </div>

    <div class="card">
      <h2>桌面通知</h2>
      <label class="checkbox"><input id="dtEnabled" type="checkbox" ${settings.desktopNotify.enabled ? 'checked' : ''} /> 启用 Chrome 桌面通知</label>
      <label class="checkbox"><input id="dtSku" type="checkbox" ${settings.desktopNotify.skuChanges ? 'checked' : ''} /> SKU 变化汇总通知（每商品每轮一条）</label>
      <label class="checkbox"><input id="dtClaim" type="checkbox" ${settings.desktopNotify.claimBatch ? 'checked' : ''} /> 理赔批次结果汇总通知</label>
      <label class="checkbox"><input id="dtExc" type="checkbox" ${settings.desktopNotify.exceptions ? 'checked' : ''} /> 异常通知（登录失效 / 风控 / 连续失败暂停 / Webhook 失败）</label>
    </div>

    <div class="card">
      <h2>工作台（1688 商品导入）</h2>
      <p class="hint">在 1688 商品详情页点「📥 导入工作台」即可把本商品导入小红书多账号内容生产工作台。先在工作台网页 → API 令牌 创建 <code>manage</code> 权限 Token 后粘贴到此；撤销后本功能不可用。</p>
      <label class="field"><span>工作台 Base URL</span>
        <input id="wsBaseUrl" type="text" placeholder="http://127.0.0.1:8080" value="${esc(wsSettings.baseUrl)}" autocomplete="off" />
      </label>
      <label class="field"><span>API Token（${esc(tokenHint)}；留空则保持不变）</span>
        <input id="wsToken" type="password" placeholder="粘贴 manage 权限 Token" autocomplete="new-password" />
      </label>
      <div class="row">
        <button id="wsSaveBtn" class="btn btn--primary">保存工作台设置</button>
        <button id="wsClearTokenBtn" class="btn btn--danger">清除 Token</button>
        <button id="wsAuthBtn" class="btn">授权工作台域名</button>
        <button id="wsTestBtn" class="btn">连接测试</button>
        <span id="wsResult" class="hint"></span>
      </div>
      <p class="hint">Token 仅保存在本机 chrome.storage.local，不明文回显、不写入日志。请求由扩展后台发出，不受页面混合内容/CORS 限制，但仍需「授权工作台域名」放行私有地址（http 局域网也需要）。若 https 商品页 → http 工作台仍被浏览器拦截，请给工作台套 https，或在 chrome://flags 放行本地网络访问。使用说明见工作台仓库 <a href="https://github.com/mufeng510/xhs-workstation/blob/main/docs/import-1688.md" target="_blank" rel="noreferrer">docs/import-1688.md</a>（D-13 变更对齐）。</p>
    </div>

    <div class="card">
      <h2>日志</h2>
      <label class="field"><span>日志级别</span>
        <select id="logLevel">
          ${['debug', 'info', 'warn', 'error'].map((l) => `<option value="${l}" ${settings.logLevel === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="row">
      <button id="saveBtn" class="btn btn--primary">保存设置</button>
      <button id="resetBtn" class="btn btn--danger">恢复默认</button>
      <span id="saveHint" class="hint"></span>
    </div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel)!;

  $<HTMLInputElement>('#claimScanEnabled').addEventListener('change', () => {
    $<HTMLInputElement>('#claimInterval').disabled = !$<HTMLInputElement>('#claimScanEnabled').checked;
  });

  $('#whAuthBtn').addEventListener('click', async () => {
    const origin = originOf($<HTMLInputElement>('#whUrl').value);
    if (!origin) { toast('请先填写合法的 Webhook URL'); return; }
    try {
      const granted = await chrome.permissions.request({ origins: [origin] });
      toast(granted ? '已授权该域名' : '未授权（Webhook 将无法发送）');
    } catch (err) {
      toast(`授权失败：${err instanceof Error ? err.message : String(err)}`);
    }
  });

  $('#whTestBtn').addEventListener('click', async () => {
    // 先保存当前 URL/方法等，测试使用最新输入
    await persist();
    const btn = $('#whTestBtn') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const result = await sendMessage<{ ok: boolean; message: string }>({ type: 'settings.testWebhook' });
      toast(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
    } catch (err) {
      toast(`测试失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      btn.disabled = false;
    }
  });

  $('#wsAuthBtn').addEventListener('click', async () => {
    let origin: string;
    try {
      origin = wsOriginOf($<HTMLInputElement>('#wsBaseUrl').value);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return;
    }
    try {
      const granted = await chrome.permissions.request({ origins: [origin] });
      toast(granted ? `已授权 ${origin}` : '未授权（导入请求将无法发送，请重试）');
    } catch (err) {
      toast(`授权失败：${err instanceof Error ? err.message : String(err)}`);
    }
  });

  $('#wsSaveBtn').addEventListener('click', async () => {
    const baseUrl = $<HTMLInputElement>('#wsBaseUrl').value;
    const token = $<HTMLInputElement>('#wsToken').value;
    try {
      await setImport1688Settings(token.trim() ? { baseUrl, token } : { baseUrl });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return;
    }
    $<HTMLInputElement>('#wsToken').value = '';
    const saved = await getImport1688Settings();
    toast('工作台设置已保存');
    $('#wsResult').textContent = saved.token ? `Token 已设置（末 4 位 ${maskToken(saved.token).slice(-4)}）` : 'Token 未设置';
  });

  $('#wsClearTokenBtn').addEventListener('click', async () => {
    if (!confirmDanger('清除工作台 API Token？清除后 1688 导入功能将不可用，直到重新设置。')) return;
    await clearImport1688Token();
    $('#wsResult').textContent = 'Token 已清除';
    toast('已清除工作台 Token');
  });

  $('#wsTestBtn').addEventListener('click', async () => {
    const btn = $('#wsTestBtn') as HTMLButtonElement;
    const resultEl = $('#wsResult');
    btn.disabled = true;
    resultEl.textContent = '测试中…';
    try {
      // 先归一化保存当前 Base URL（与保存按钮一致），再尽力授权并测试
      const baseUrl = $<HTMLInputElement>('#wsBaseUrl').value;
      const saved = await setImport1688Settings({ baseUrl });
      try {
        await chrome.permissions.request({ origins: [wsOriginOf(saved.baseUrl)] });
      } catch {
        // 授权失败不阻断测试，由测试结果直观反馈
      }
      const result = await sendMessage<{ ok: boolean; message: string }>({ type: 'import1688.testConnection', baseUrl: saved.baseUrl });
      resultEl.textContent = result.ok ? `✅ ${result.message}` : `❌ ${result.message}`;
      toast(result.ok ? '工作台连接正常' : '工作台连接异常');
    } catch (err) {
      resultEl.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`;
      toast('连接测试失败');
    } finally {
      btn.disabled = false;
    }
  });

  const skLabel = () => {
    const on: string[] = [];
    if ($<HTMLInputElement>('#skAdded').checked) on.push('上架');
    if ($<HTMLInputElement>('#skRemoved').checked) on.push('下架');
    if ($<HTMLInputElement>('#skStockOut').checked) on.push('售罄（变成0）');
    if ($<HTMLInputElement>('#skStockRestored').checked) on.push('补货');
    if ($<HTMLInputElement>('#skLowStock').checked) on.push(`低库存（≤${$<HTMLInputElement>('#skLowStockThreshold').value || 5}件）`);
    if ($<HTMLInputElement>('#skSpec').checked) on.push('规格变化');
    if ($<HTMLInputElement>('#skPrice').checked) on.push('价格变化');
    return on.length ? `当前生效：桌面+Webhook 仅发送 ${on.join(' / ')}` : '当前已全部静音（桌面和 Webhook 都不会发送 SKU 通知）';
  };
  const skSummary = $('#skRuleSummary');
  const syncSkSummary = () => { skSummary.textContent = skLabel(); };
  for (const id of ['skAdded','skRemoved','skStockOut','skStockRestored','skLowStock','skLowStockThreshold','skSpec','skPrice']) {
    $(`#${id}`).addEventListener('change', syncSkSummary);
  }
  syncSkSummary();

  $('#skResetBtn').addEventListener('click', async () => {
    await setSettings({ skuNotify: { ...DEFAULT_SKU_NOTIFY } });
    toast('已恢复默认通知规则（上架/下架/售罄/补货/低库存≤5件）');
    window.location.reload();
  });

  const persist = async () => {
    const num = (id: string, fallback: number) => {
      const v = Number.parseInt($<HTMLInputElement>(id).value, 10);
      return Number.isFinite(v) ? Math.max(5, Math.min(1440, v)) : fallback;
    };
    const mode = $<HTMLSelectElement>('#claimMode').value;
    if (mode === 'live' && settings.claimMode !== 'live') {
      if (!confirmDanger('切换到「真实模式」：扫描将真实打开工作台并筛选「揽收超时」订单；申请页仅探测平台状态，不会提交任何理赔。确定切换？')) {
        $<HTMLSelectElement>('#claimMode').value = 'simulation';
        return;
      }
    }
    await setSettings({
      skuScanIntervalMinutes: num('#skuInterval', 60),
      claimScanIntervalMinutes: num('#claimInterval', 30),
      claimScanEnabled: $<HTMLInputElement>('#claimScanEnabled').checked,
      claimMode: mode as 'simulation' | 'live',
      webhook: {
        enabled: $<HTMLInputElement>('#whEnabled').checked,
        url: $<HTMLInputElement>('#whUrl').value.trim(),
        method: $<HTMLSelectElement>('#whMethod').value as 'GET' | 'POST',
        headers: $<HTMLTextAreaElement>('#whHeaders').value,
        bodyTemplate: $<HTMLTextAreaElement>('#whBody').value,
      },
      desktopNotify: {
        enabled: $<HTMLInputElement>('#dtEnabled').checked,
        skuChanges: $<HTMLInputElement>('#dtSku').checked,
        claimBatch: $<HTMLInputElement>('#dtClaim').checked,
        exceptions: $<HTMLInputElement>('#dtExc').checked,
      },
      skuNotify: {
        added: $<HTMLInputElement>('#skAdded').checked,
        removed: $<HTMLInputElement>('#skRemoved').checked,
        stockOut: $<HTMLInputElement>('#skStockOut').checked,
        stockRestored: $<HTMLInputElement>('#skStockRestored').checked,
        lowStock: $<HTMLInputElement>('#skLowStock').checked,
        lowStockThreshold: (() => {
          const v = Number.parseInt($<HTMLInputElement>('#skLowStockThreshold').value, 10);
          return Number.isFinite(v) ? Math.max(1, Math.min(9999, v)) : DEFAULT_SKU_NOTIFY.lowStockThreshold;
        })(),
        specChanged: $<HTMLInputElement>('#skSpec').checked,
        priceChanged: $<HTMLInputElement>('#skPrice').checked,
      },
      logLevel: $<HTMLSelectElement>('#logLevel').value as typeof settings.logLevel,
    });
  };

  $('#saveBtn').addEventListener('click', async () => {
    await persist();
    toast('设置已保存');
  });

  $('#resetBtn').addEventListener('click', async () => {
    if (!confirmDanger('恢复所有设置为默认值？（数据不受影响）')) return;
    await setSettings({ ...DEFAULT_SETTINGS });
    toast('已恢复默认设置');
    window.location.hash = '#settings';
    window.location.reload();
  });
};
