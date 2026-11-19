// runtime.onMessage 路由：admin 页与 popup 通过消息驱动 SW 执行需后台能力的操作。
// 纯 DB 读写（列表/详情）由 admin 直接访问 IndexedDB，减少 SW 往返与消息体积。
import { logger } from '@/common/log';
import { getSettings, setSettings } from '@/common/settings';
import { processTasks, ensureAlarms } from './scheduler';
import { testWebhook } from '@/common/notify';
import { enqueueSkuScan } from '@/modules/sku/actions';
import { runInBackgroundTab } from './tab-runner';
import { metaSet } from '@/common/db';
import { scanOverdueOrders } from '@/modules/claim/claim';
import { tasksGet, tasksPut } from '@/common/db';
import { previewImport, executeImportRequest } from '@/modules/import1688/service';
import { checkConnection, Import1688Error } from '@/modules/import1688/client';
import { getImport1688Settings } from '@/modules/import1688/settings';
import { normalizeBaseUrl } from '@/modules/import1688/payload';
import type { MessageRequest, MessageResponse } from '@/common/types';

const log = logger('router');

const ok = <T>(data: T): MessageResponse<T> => ({ ok: true, data });
const fail = (error: string, code?: number): MessageResponse => ({ ok: false, error, ...(code !== undefined ? { code } : {}) });

const checkLogin = async (): Promise<{ loggedIn: boolean; checkedAt: number }> => {
  // 用后台标签访问买家工作台：根据是否跳转到登录页判断登录状态
  let loggedIn = false;
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.create({ url: 'https://work.1688.com/home/buyer.htm', active: false });
    loggedIn = await new Promise<boolean>((resolve) => {
      const done = (value: boolean): void => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(value);
      };
      const timer = setTimeout(() => done(false), 20000);
      const listener = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, updatedTab: chrome.tabs.Tab) => {
        if (tabId !== tab?.id) return;
        // changeInfo.url 只在 URL 变化的那次事件里有值；complete 事件通常只有 status。
        // 统一以「本次事件能看到的最新 URL」为准：changeInfo.url → updatedTab.url。
        const url = changeInfo.url ?? updatedTab?.url ?? '';
        if (/login/i.test(url)) {
          done(false);
          return;
        }
        if (changeInfo.status === 'complete') {
          // complete 时 changeInfo.url 往往为空，必须读标签页当前真实地址
          if (url) {
            done(url.includes('work.1688.com'));
            return;
          }
          chrome.tabs.get(tabId).then(
            (t) => done(!!t?.url && t.url.includes('work.1688.com')),
            () => done(false),
          );
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  } catch {
    loggedIn = false;
  } finally {
    if (tab?.id !== undefined) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }
  const result = { loggedIn, checkedAt: Date.now() };
  await metaSet('lastLoginStatus', result);
  return result;
};

export const handleMessage = async (msg: MessageRequest, sender?: chrome.runtime.MessageSender): Promise<MessageResponse> => {
  try {
    switch (msg.type) {
      case 'overview.checkLogin':
        return ok(await checkLogin());
      case 'sku.scanNow':
        await enqueueSkuScan(msg.productId);
        await ensureAlarms();
        await processTasks();
        return ok({ enqueued: true });
      case 'claim.scanNow':
        await scanOverdueOrders();
        await processTasks();
        return ok({ done: true });
      case 'tasks.runNow': {
        const task = await tasksGet(msg.taskId);
        if (task && (task.status === 'pending' || task.status === 'failed' || task.status === 'cancelled')) {
          await tasksPut({ ...task, status: 'pending', runAfter: Date.now(), attempts: task.status === 'pending' ? task.attempts : 0, lockedBy: undefined, lockedUntil: undefined, updatedAt: Date.now() });
          await processTasks();
          return ok({ enqueued: true });
        }
        return fail('任务不存在或当前状态不可执行');
      }
      case 'tasks.process':
        await ensureAlarms();
        await processTasks();
        return ok({ done: true });
      case 'settings.get':
        return ok(await getSettings());
      case 'settings.set':
        return ok(await setSettings(msg.patch));
      case 'import1688.preview': {
        const tabId = sender?.tab?.id;
        if (tabId === undefined) return fail('无法从当前上下文获取标签页（仅 content script 可调用）');
        try {
          return ok(await previewImport(tabId));
        } catch (err) {
          if (err instanceof Import1688Error) {
            // SW 侧留一条诊断日志（管理页 → 日志可见）：网络请求由后台发出，页面 DevTools 看不到
            await log.warn('1688 导入：预览失败', { code: err.code, status: err.status, message: err.message });
            return fail(err.message, err.status);
          }
          throw err;
        }
      }
      case 'import1688.execute': {
        try {
          return ok(await executeImportRequest(msg.request));
        } catch (err) {
          if (err instanceof Import1688Error) {
            await log.warn('1688 导入：提交失败', { code: err.code, status: err.status, message: err.message });
            return fail(err.message, err.status);
          }
          throw err;
        }
      }
      case 'import1688.testConnection': {
        // 鉴权探测：只探 /api/health 无法判断 Token 是否有效，连同 Token 一起验证
        const saved = await getImport1688Settings();
        return ok(await checkConnection(msg.baseUrl ?? saved.baseUrl, saved.token));
      }
      case 'import1688.openProduct': {
        const id = Number(msg.id);
        if (!Number.isInteger(id) || id <= 0) return fail('商品 id 非法');
        const { baseUrl } = await getImport1688Settings();
        await chrome.tabs.create({ url: `${normalizeBaseUrl(baseUrl)}/products/${id}` });
        return ok({ opened: true });
      }
      case 'import1688.openSettings': {
        await chrome.tabs.create({ url: chrome.runtime.getURL('pages/manage/manage.html#settings') });
        return ok({ opened: true });
      }
      case 'import1688.openDoc': {
        await chrome.tabs.create({ url: 'https://github.com/mufeng510/xhs-workstation/blob/main/docs/import-1688.md' });
        return ok({ opened: true });
      }
      case 'settings.testWebhook':
        return ok(await testWebhook());
      default:
        return fail(`未实现的消息类型：${(msg as { type: string }).type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error('消息处理失败', { type: (msg as { type: string }).type, message });
    return fail(message);
  }
};
