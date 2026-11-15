// 通知系统：Chrome 桌面通知 + Webhook（可同时启用/分别关闭）。
// 原则：不记录敏感配置；Webhook 失败只记日志，不影响业务任务状态；重试有限次数。
import { metaGet, metaSet, notificationLogPut } from './db';
import { newId } from './id';
import { logger } from './log';
import { getSettings } from './settings';
import type { NotifyChannel, NotifyStatus } from './types';

const log = logger('notify');
const ICON = 'icons/icon-128.png';

const fillTemplate = (tpl: string, title: string, body: string): string =>
  tpl
    .replaceAll('{{title}}', title)
    .replaceAll('{{body}}', body)
    .replaceAll('{{text}}', `${title}\n${body}`);

const parseHeaders = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
};

const recordLog = async (entry: {
  channel: NotifyChannel;
  type: string;
  title: string;
  body: string;
  status: NotifyStatus;
  error?: string;
  dedupeKey?: string;
}): Promise<void> => {
  await notificationLogPut({
    id: newId('n'),
    ts: Date.now(),
    channel: entry.channel,
    type: entry.type,
    title: entry.title,
    body: entry.body,
    status: entry.status,
    error: entry.error,
    dedupeKey: entry.dedupeKey,
  });
};

export const throttled = async (dedupeKey: string, windowMs: number): Promise<boolean> => {
  const last = await metaGet<number>(`notify-throttle:${dedupeKey}`);
  if (last && Date.now() - last < windowMs) return true;
  await metaSet(`notify-throttle:${dedupeKey}`, Date.now());
  return false;
};

export interface NotifyPayload {
  type: string;
  title: string;
  body: string;
  dedupeKey?: string;
  /** 桌面通知与周围开关独立的强制开关（如登录失效） */
  forceDesktop?: boolean;
}

export const sendNotification = async (payload: NotifyPayload): Promise<void> => {
  const settings = await getSettings();

  // ---- 桌面通知 ----
  if (settings.desktopNotify.enabled) {
    const allow =
      payload.forceDesktop ||
      (settings.desktopNotify.skuChanges && payload.type.startsWith('sku')) ||
      (settings.desktopNotify.claimBatch && payload.type.startsWith('claim')) ||
      (settings.desktopNotify.exceptions && payload.type.startsWith('exception'));
    if (allow) {
      try {
        await chrome.notifications.create(`${payload.type}:${payload.dedupeKey ?? newId('n')}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL(ICON),
          title: payload.title,
          message: payload.body.slice(0, 240),
          priority: payload.type.startsWith('exception') ? 2 : 0,
        });
        await recordLog({ channel: 'desktop', ...payload, status: 'sent' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await recordLog({ channel: 'desktop', ...payload, status: 'failed', error: msg });
        await log.warn('桌面通知发送失败', msg);
      }
    }
  }

  // ---- Webhook ----
  if (settings.webhook.enabled && settings.webhook.url.trim()) {
    const { url, method, headers, bodyTemplate } = settings.webhook;
    const text = `${payload.title}\n${payload.body}`;
    let body: string | undefined;
    if (method === 'POST') {
      body = bodyTemplate.trim() ? fillTemplate(bodyTemplate, payload.title, payload.body) : JSON.stringify({ title: payload.title, body: payload.body, text });
    }
    const target = method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}` : url;
    const headerObj = parseHeaders(headers);
    try {
      const resp = await fetch(target, {
        method,
        headers: { 'content-type': 'application/json', ...headerObj },
        body,
        credentials: 'omit', // 不向 Webhook 发送任何环境 Cookie/凭证
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await recordLog({ channel: 'webhook', ...payload, status: 'sent' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordLog({ channel: 'webhook', ...payload, status: 'failed', error: msg });
      await log.error('Webhook 发送失败', { type: payload.type, error: msg });
    }
  }
};

/** 连通性测试（设置页「测试」按钮）。不抛异常，返回可读结果。 */
export const testWebhook = async (): Promise<{ ok: boolean; message: string }> => {
  const settings = await getSettings();
  const { url, method, headers, bodyTemplate } = settings.webhook;
  if (!url.trim()) return { ok: false, message: '请先填写 Webhook URL' };
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, message: 'URL 必须是 http/https' };
  } catch {
    return { ok: false, message: 'URL 格式不正确' };
  }
  const title = '1688 智能助手 - Webhook 测试';
  const body = '如果你收到这条消息，说明 Webhook 配置可用。';
  const text = `${title}\n${body}`;
  let bodyStr: string | undefined;
  if (method === 'POST') {
    bodyStr = bodyTemplate.trim() ? fillTemplate(bodyTemplate, title, body) : JSON.stringify({ title, body, text });
  }
  const target = method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}` : url;
  try {
    const resp = await fetch(target, {
      method,
      headers: { 'content-type': 'application/json', ...parseHeaders(headers) },
      body: bodyStr,
      credentials: 'omit', // 不向 Webhook 发送任何环境 Cookie/凭证
    });
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status} ${resp.statusText}` };
    return { ok: true, message: '发送成功，请在接收端确认消息' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `请求失败：${msg}（若提示 CORS/权限，请确认扩展已获得该域名权限）` };
  }
};
