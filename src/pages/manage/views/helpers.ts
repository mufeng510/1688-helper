// admin 视图共享工具
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const fmtTime = (ts?: number): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtDateTimeLocal = (ts?: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const sendMessage = async <T = unknown>(msg: Record<string, unknown>): Promise<T> => {
  const resp = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string };
  if (!resp?.ok) throw new Error(resp?.error ?? '消息发送失败');
  return resp.data as T;
};

export const toast = (msg: string): void => {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  window.setTimeout(() => { el.hidden = true; }, 2600);
};

export const confirmDanger = (msg: string): boolean => window.confirm(msg);
