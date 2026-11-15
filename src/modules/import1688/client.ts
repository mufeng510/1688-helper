// 1688 导入：工作台 HTTP 客户端。
// 所有请求必须在 background service worker 中发起（content script 不直接调 API），
// 由 host_permissions / 可选权限放行；credentials: 'omit'（不带任何 cookie）；
// 错误信息绝不包含 Token。
import { normalizeBaseUrl, isValidOfferId } from './payload';
import type { ByOfferResult } from './types';

export type Import1688ErrorCode = 'http' | 'network' | 'config' | 'too-large';

export class Import1688Error extends Error {
  readonly status?: number;
  readonly code: Import1688ErrorCode;
  /** 401/403：需要引导用户去设置页处理 Token */
  readonly authRequired: boolean;

  constructor(message: string, code: Import1688ErrorCode, status?: number) {
    super(message);
    this.name = 'Import1688Error';
    this.code = code;
    this.status = status;
    this.authRequired = status === 401 || status === 403;
  }
}

const readDetail = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as { detail?: unknown } | null;
    const detail = body?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail !== undefined) return JSON.stringify(detail).slice(0, 300);
    return res.statusText || `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
};

const mapHttpError = (status: number, detail: string): Import1688Error => {
  switch (status) {
    case 400:
      return new Import1688Error(`参数错误：${detail}`, 'http', status);
    case 401:
      return new Import1688Error('API Token 无效或已撤销，请到「管理页 → 系统设置 → 工作台」更新 Token', 'http', status);
    case 403:
      return new Import1688Error('Token 权限不足（需要 manage 权限）', 'http', status);
    case 413:
      return new Import1688Error('页面数据超过 8MB 上限，无法导入', 'http', status);
    case 422:
      // 工作台返回的中文提示（如「被 1688 风控拦截……」），直接展示给用户
      return new Import1688Error(detail, 'http', status);
    case 502:
      return new Import1688Error('导入失败，商品未创建（已整体回滚），可重试', 'http', status);
    case 503:
      return new Import1688Error('工作台磁盘不足，请清理后重试', 'http', status);
    default:
      return new Import1688Error(`工作台返回 ${status}：${detail}`, 'http', status);
  }
};

interface RequestOptions {
  method: 'GET' | 'POST';
  timeoutMs: number;
  token?: string;
  /** JSON body；GET 时为空 */
  body?: unknown;
}

const request = async <T>(baseUrl: string, path: string, opts: RequestOptions): Promise<T> => {
  let normalized: string;
  try {
    normalized = normalizeBaseUrl(baseUrl);
  } catch (err) {
    throw new Import1688Error(err instanceof Error ? err.message : String(err), 'config');
  }
  const url = `${normalized}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const reason = aborted ? `请求超时（${Math.round(opts.timeoutMs / 1000)}s）` : '无法连接工作台';
    throw new Import1688Error(
      `${reason}：请检查 Base URL、工作台是否在运行、以及是否已在设置页「授权工作台域名」`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw mapHttpError(res.status, await readDetail(res));
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Import1688Error('工作台返回了非 JSON 响应', 'http', res.status);
  }
};

export type IngestBody = { html: string } | { context: unknown; offer_id?: string };

export const ingest = async <T>(baseUrl: string, token: string, body: IngestBody): Promise<T> =>
  request<T>(baseUrl, '/api/products/import/1688/ingest', { method: 'POST', timeoutMs: 60_000, token, body });

export const executeImport = async <T>(baseUrl: string, token: string, body: unknown): Promise<T> =>
  // 图片由工作台服务端下载，可能较慢；给足超时
  request<T>(baseUrl, '/api/products/import/1688/execute', { method: 'POST', timeoutMs: 180_000, token, body });

/**
 * 查工作台是否已有同 offer_id 商品（导入前检查，非致命）。
 * 工作台返回 200 {exists, product?}；返回无法识别的内容时抛 Import1688Error。
 * 任何失败都应由调用方按「未能检查」降级处理，不阻断导入（重复最终由 execute 端 409 兜底）。
 */
export const checkByOffer = async (
  baseUrl: string,
  token: string,
  offerId: string,
): Promise<ByOfferResult> => {
  if (!isValidOfferId(offerId)) {
    throw new Import1688Error('offer_id 非法（6–15 位数字）', 'config');
  }
  const data = await request<ByOfferResult>(baseUrl, `/api/products/import/1688/by-offer/${offerId}`, {
    method: 'GET',
    timeoutMs: 10_000,
    token,
  });
  if (!data || typeof data !== 'object' || typeof data.exists !== 'boolean') {
    throw new Import1688Error('工作台返回了无法识别的重复检查结果', 'http', 200);
  }
  return data;
};

export interface HealthResult {
  ok: boolean;
  message: string;
}

export const checkHealth = async (baseUrl: string): Promise<HealthResult> => {
  let normalized: string;
  try {
    normalized = normalizeBaseUrl(baseUrl);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${normalized}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, message: `ok（HTTP ${res.status}）` };
    return { ok: false, message: `异常（HTTP ${res.status}）` };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return { ok: false, message: aborted ? '异常：请求超时' : '异常：无法连接（检查地址/工作台是否运行/域名是否已授权）' };
  } finally {
    clearTimeout(timer);
  }
};
