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
import type { MessageRequest, MessageResponse } from '@/common/types';

const log = logger('router');

const ok = <T>(data: T): MessageResponse<T> => ({ ok: true, data });
const fail = (error: string): MessageResponse => ({ ok: false, error });

const checkLogin = async (): Promise<{ loggedIn: boolean; checkedAt: number }> => {
  // 用后台标签访问买家工作台：根据是否跳转到登录页判断登录状态
  let loggedIn = false;
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.create({ url: 'https://work.1688.com/home/buyer.htm', active: false });
    loggedIn = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, 15000);
      const listener = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
        if (tabId !== tab?.id) return;
        const url = changeInfo.url ?? '';
        if (url.includes('login')) {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(false);
        } else if (changeInfo.status === 'complete' && url.includes('work.1688.com')) {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
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

export const handleMessage = async (msg: MessageRequest): Promise<MessageResponse> => {
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
