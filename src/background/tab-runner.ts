// 后台标签页运行器：创建 → 等待加载完成 → 注入采集脚本 → 返回结果 → 按状态关闭。
// 任何采集类任务共用；保证后台标签不抢焦点、采集完即回收。
import { logger } from '@/common/log';

const log = logger('tab-runner');

export interface TabRunRequest {
  url: string;
  /** 注入脚本路径（相对扩展根目录，如 pages/inject/sku-collector.js） */
  injectFile: string;
  timeoutMs?: number;
  /** 任务需要人工处理时保留标签页（用于风控/验证码） */
  keepTabOnOutcome?: (result: unknown) => boolean;
  /** 注入到全部 frame（含跨域 iframe；仅当脚本自身按 frame 分流时有意义） */
  allFrames?: boolean;
  /** complete 后等待页面 SPA 创建 iframe（毫秒）。订单列表是 JS 懒创建的跨域 iframe，立即注入会落空 */
  settleMs?: number;
}

export type TabRunFailure =
  | { kind: 'create_failed' }
  | { kind: 'load_timeout' }
  | { kind: 'frozen' }
  | { kind: 'inject_failed'; message: string }
  | { kind: 'script_error'; message: string };

export interface TabRunOk<T> {
  ok: true;
  value: T;
  tabId: number;
  /** 若为 true，标签页被保留（人工处理需要） */
  tabKept: boolean;
}

export type TabRunResult<T> = TabRunOk<T> | { ok: false; error: TabRunFailure; tabId?: number };

const waitForCompleteInner = (tabId: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

/** 等待标签 complete（供后台 SW 中其他流程复用）；超时返回 false */
export const waitForComplete = waitForCompleteInner;

export interface InjectIntoTabRequest {
  injectFile: string;
  /** 注入到全部 frame（含跨域 iframe；仅当脚本自身按 frame 分流时有意义） */
  allFrames?: boolean;
  /** 诊断标签，便于日志关联（如 phaseA / phaseB） */
  tag?: string;
}

export interface InjectIntoTabOk<T> {
  ok: true;
  /** allFrames 时为「第一个有定义的 frame 返回值」 */
  value: T | undefined;
  /** 每个 frame 一条诊断（不含内容，仅可数事实） */
  frames: FrameDiagnostic[];
}
export type InjectIntoTabResult<T> = InjectIntoTabOk<T> | { ok: false; message: string };

export interface FrameDiagnostic {
  i: number;
  frameId?: number;
  type?: string;
  keys?: string[];
  ok?: unknown;
  risk?: unknown;
  frame?: unknown;
  error?: string;
  ordersLen?: number;
}

/** 向已存在的标签页注入脚本并返回结果（含每 frame 诊断日志）。不负责创建/关闭标签。 */
export const injectIntoTab = async <T>(tabId: number, req: InjectIntoTabRequest): Promise<InjectIntoTabResult<T>> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: req.allFrames ? { tabId, allFrames: true } : { tabId },
      files: [req.injectFile],
    });
    const frames: FrameDiagnostic[] = results.map((r, i) => {
      const v = (r as { result?: unknown } | undefined)?.result;
      const o = (v && typeof v === 'object' ? v : undefined) as Record<string, unknown> | undefined;
      return {
        i,
        frameId: (r as { frameId?: number } | undefined)?.frameId,
        type: v === null ? 'null' : typeof v,
        keys: o ? Object.keys(o).slice(0, 10) : [],
        ok: o?.ok,
        risk: o?.risk,
        frame: o?.frame,
        error: o?.error && typeof o.error === 'string' ? o.error.slice(0, 120) : undefined,
        ordersLen: Array.isArray(o?.orders) ? o.orders.length : undefined,
      };
    });
    await log.info('后台标签注入结果', { inject: req.tag ?? req.injectFile, allFrames: Boolean(req.allFrames), frames });
    // allFrames：非列表 frame 的返回值在跨进程序列化后为 null（而非 undefined）；find 须同时排除两者，
    // 否则会选中 null 并把「真实 CTMO 结果」视为缺失
    const first = (req.allFrames
      ? results.map((r) => r?.result as T | undefined | null).find((v) => v != null)
      : (results[0]?.result as T | undefined | null)) as T | undefined;
    return { ok: true, value: first, frames };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.warn('后台标签注入失败', { tabId, inject: req.tag ?? req.injectFile, message: message.slice(0, 200) });
    return { ok: false, message };
  }
};

export const runInBackgroundTab = async <T>(req: TabRunRequest): Promise<TabRunResult<T>> => {
  const timeoutMs = req.timeoutMs ?? 45_000;
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.create({ url: req.url, active: false });
  } catch (err) {
    await log.error('后台标签创建失败', String(err));
    return { ok: false, error: { kind: 'create_failed' } };
  }
  const tabId = tab.id!;
  try {
    const loaded = await waitForComplete(tabId, timeoutMs);
    if (!loaded) {
      await log.warn('后台标签加载超时', { url: req.url, tabId });
      return { ok: false, error: { kind: 'load_timeout' }, tabId };
    }
    // SPA 的 iframe（订单列表）在 complete 之后由页面 JS 懒创建，等待后再注入
    if (req.settleMs && req.settleMs > 0) {
      await new Promise((r) => setTimeout(r, req.settleMs));
    }
    const fresh = await chrome.tabs.get(tabId);
    if (fresh.discarded || fresh.frozen) {
      return { ok: false, error: { kind: 'frozen' }, tabId };
    }
    const injected = await injectIntoTab<T>(tabId, { injectFile: req.injectFile, allFrames: req.allFrames, tag: req.injectFile });
    if (!injected.ok) {
      return { ok: false, error: { kind: 'inject_failed', message: injected.message }, tabId };
    }
    const first = injected.value;
    const keep = req.keepTabOnOutcome ? req.keepTabOnOutcome(first) : false;
    if (!keep) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // 标签可能已被用户关闭
      }
      return { ok: true, value: first as T, tabId, tabKept: false };
    }
    return { ok: true, value: first as T, tabId, tabKept: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error('后台标签采集失败', { url: req.url, tabId, message });
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // ignore
    }
    return { ok: false, error: { kind: 'inject_failed', message }, tabId };
  }
};
