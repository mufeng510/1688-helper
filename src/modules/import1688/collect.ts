// 1688 导入：在目标标签页的主世界（MAIN world）读取 window.context / outerHTML。
// content script 自身只能读隔离世界的 DOM（outerHTML 可以读），但 window.context
// 需要 MAIN world；统一在 SW 里用 scripting.executeScript({ world: 'MAIN' }) 完成，
// 大对象不经 runtime message 传递。
import { MAX_INGEST_BODY_BYTES } from './payload';
import type { IngestBody } from './client';

export class CollectError extends Error {}

export interface CollectResult {
  body: IngestBody;
  offerId?: string;
  strategy: 'context' | 'html';
}

interface RawCollected {
  href: string;
  title: string;
  context?: unknown;
  /** outerHTML；可能超过 8MB 限制 */
  html?: string;
}

// 自包含函数：不能引用闭包变量（会被序列化注入页面）
const collectInPage = (): RawCollected => {
  const w = window as unknown as { context?: unknown };
  const href = location.href;
  const title = document.title || '';
  let context: unknown;
  try {
    if (w.context && typeof w.context === 'object') {
      context = w.context;
    }
  } catch {
    context = undefined;
  }
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  return { href, title, context, html };
};

export const collectFromTab = async (tabId: number): Promise<CollectResult> => {
  let results: chrome.scripting.InjectionResult<RawCollected>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: collectInPage,
    });
  } catch (err) {
    throw new CollectError(
      `未能读取页面：${err instanceof Error ? err.message : String(err)}（页面可能未加载完成，或被浏览器拦截）`,
    );
  }
  const data = results[0]?.result;
  if (!data) {
    throw new CollectError('未能读取页面（executeScript 无返回）');
  }
  const offerId = /offer\/(\d{6,15})\.html/.exec(data.href)?.[1];

  // 优先 context（体积小、结构稳定）；其次 html 兜底
  if (data.context && typeof data.context === 'object') {
    try {
      const serialized = JSON.stringify(data.context);
      if (serialized.length <= MAX_INGEST_BODY_BYTES) {
        return {
          body: offerId ? { context: data.context, offer_id: offerId } : { context: data.context },
          offerId,
          strategy: 'context',
        };
      }
    } catch {
      // context 不可序列化 → 退回 html
    }
  }
  if (data.html && data.html.length > 0) {
    // 按字符数粗估字节数（含非 ASCII 时实际更大），接近上限时明确提示
    if (data.html.length <= MAX_INGEST_BODY_BYTES) {
      return { body: { html: data.html }, offerId, strategy: 'html' };
    }
    throw new CollectError('页面 HTML 超过 8MB，无法上报（请刷新页面后重试；若持续如此请反馈）');
  }
  throw new CollectError('当前页面未加载出商品数据，请等页面加载完成或过完验证后再试');
};
