// 系统设置页
import { getSettings, setSettings } from '@/common/settings';
import { DEFAULT_SETTINGS } from '@/common/types';
import { sendMessage, toast, confirmDanger } from './helpers';

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
          <option value="live" ${settings.claimMode === 'live' ? 'selected' : ''}>真实模式（揽收超时页面尚未适配，不会提交申请）</option>
        </select>
      </label>
      <p class="hint">真实模式需在真实揽收超时订单出现并完成页面适配后方可使用。切换不涉及任何真实提交。</p>
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
      <h2>桌面通知</h2>
      <label class="checkbox"><input id="dtEnabled" type="checkbox" ${settings.desktopNotify.enabled ? 'checked' : ''} /> 启用 Chrome 桌面通知</label>
      <label class="checkbox"><input id="dtSku" type="checkbox" ${settings.desktopNotify.skuChanges ? 'checked' : ''} /> SKU 变化汇总通知（每商品每轮一条）</label>
      <label class="checkbox"><input id="dtClaim" type="checkbox" ${settings.desktopNotify.claimBatch ? 'checked' : ''} /> 理赔批次结果汇总通知</label>
      <label class="checkbox"><input id="dtExc" type="checkbox" ${settings.desktopNotify.exceptions ? 'checked' : ''} /> 异常通知（登录失效 / 风控 / 连续失败暂停 / Webhook 失败）</label>
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

  const persist = async () => {
    const num = (id: string, fallback: number) => {
      const v = Number.parseInt($<HTMLInputElement>(id).value, 10);
      return Number.isFinite(v) ? Math.max(5, Math.min(1440, v)) : fallback;
    };
    const mode = $<HTMLSelectElement>('#claimMode').value;
    if (mode === 'live' && settings.claimMode !== 'live') {
      if (!confirmDanger('切换到「真实模式」：揽收超时页面尚未适配，不会发现真实订单、不会提交任何申请。确定切换？')) {
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
