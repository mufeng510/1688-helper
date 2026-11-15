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

const waitForComplete = (tabId: number, timeoutMs: number): Promise<boolean> =>
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
    const fresh = await chrome.tabs.get(tabId);
    if (fresh.discarded || fresh.frozen) {
      return { ok: false, error: { kind: 'frozen' }, tabId };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: [req.injectFile],
    });
    const first = results[0]?.result as T | undefined;
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
