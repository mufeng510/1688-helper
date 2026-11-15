// Service Worker 入口：注册 alarm、生命周期恢复、消息路由。
// 任何关键状态都落在 IndexedDB / chrome.storage.local，SW 回收不影响业务。
import { logger } from '@/common/log';
import { ensureAlarms, tick, TICK_ALARM } from './scheduler';
import { handleMessage } from './router';
import type { MessageRequest, MessageResponse } from '@/common/types';

const log = logger('sw');

// 启动即确保 alarm 存在并恢复中断任务（顶层事件，SW 被回收后也能重新执行）
const boot = async (reason: string): Promise<void> => {
  try {
    await ensureAlarms();
    await log.info('Service Worker 已启动', { reason });
  } catch (err) {
    await log.error('Service Worker 启动恢复失败', String(err));
  }
};

chrome.runtime.onInstalled.addListener((details) => {
  void boot(`onInstalled:${details.reason}`);
});
chrome.runtime.onStartup.addListener(() => {
  void boot('onStartup');
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    tick().catch((err) => console.error('[1688helper] tick 失败', err));
  }
});

chrome.runtime.onMessage.addListener((msg: MessageRequest, _sender, sendResponse: (response: MessageResponse) => void) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // 异步响应
});

chrome.action.onClicked.addListener(async () => {
  // 已配置 default_popup 时此事件不会触发；作为兜底保留
  const url = chrome.runtime.getURL('pages/manage/manage.html');
  await chrome.tabs.create({ url, active: true });
});

void boot('sw-load');
