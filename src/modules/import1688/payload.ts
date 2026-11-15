// 1688 导入：纯逻辑（不依赖 chrome API / fetch，可单测）
import type { ExecuteImage, ExecuteRequest, Import1688Preview } from './types';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
export const MAX_INGEST_BODY_BYTES = 8 * 1024 * 1024; // 8MB，与工作台契约一致
export const MAX_BLOCKS = 20;
export const MAX_BLOCK_TITLE = 120;
export const MAX_BLOCK_CONTENT = 20000;
export const MAX_NAME = 120;
export const MAX_IMAGES = 24;

/**
 * 归一化 Base URL：去空白、缺省补 http://、去末尾斜杠；仅允许 http/https。
 * 非法输入抛错（调用方转成可读提示）。
 */
export const normalizeBaseUrl = (raw: string): string => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Base URL 无法解析：${trimmed}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL 仅支持 http:// 或 https://');
  }
  if (!url.host) {
    throw new Error('Base URL 缺少主机地址');
  }
  // 只保留 origin + 可选的路径前缀（去掉末尾斜杠）；不支持 query/hash
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path === '/' ? '' : path}`;
};

/** 取 origin（如 http://192.0.2.10:8080/），用于 chrome.permissions.request */
export const originOf = (baseUrl: string): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(normalized);
  return `${url.protocol}//${url.host}/`;
};

/** Token 仅用于设置页的尾 4 位提示，绝不回显明文 */
export const maskToken = (token: string | undefined): string => {
  const t = (token ?? '').trim();
  if (!t) return '';
  if (t.length <= 4) return '***';
  return `***${t.slice(-4)}`;
};

const ALLOWED_IMAGE_HOSTS = ['alicdn.com', 'tmall.com', 'taobao.com'];

/** 图片 URL 约束：https + 指定域名（含子域名），与工作台入库校验一致 */
export const isAllowedImageUrl = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL((raw ?? '').trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
};

/**
 * 规范化图片 URL：协议相对地址（//cbu01.alicdn.com/...，1688 页面常见）补 https:// 后再校验。
 * 合法 → 返回规范化后的 URL；不合法 → null（调用方按 skippedImages 统计）。
 * 仅补全缺省协议；http:// 一律不放行（契约要求 https）。
 */
export const normalizeImageUrl = (raw: string): string | null => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  // scheme 统一小写（WHATWG 大小写不敏感）；路径保持原样
  const candidate = withProtocol.replace(/^([a-z][a-z0-9+.-]*):\/\//i, (scheme) => scheme.toLowerCase());
  return isAllowedImageUrl(candidate) ? candidate : null;
};

export const isValidOfferId = (raw: string): boolean => /^\d{6,15}$/.test((raw ?? '').trim());

/** 导入意图：create=新建（重复由工作台 409 拦截）；update=更新已有；create-anyway=用户明确仍要新建 */
export type ExecutePlan = 'create' | 'update' | 'create-anyway';

export interface CardBlockState {
  checked: boolean;
  title: string;
  content: string;
}

export interface CardImageState {
  url: string;
  checked: boolean;
}

export interface CardState {
  name: string;
  blocks: CardBlockState[];
  mainImages: CardImageState[];
  detailImages: CardImageState[];
}

/** 由预览构建卡片默认状态：区块全选、主图全选、详情图不选 */
export const defaultCardState = (preview: Import1688Preview): CardState => ({
  name: preview.name ?? '',
  blocks: (preview.blocks ?? []).map((b) => ({
    checked: true,
    title: b.title ?? '',
    content: b.content ?? '',
  })),
  mainImages: (preview.main_images ?? []).map((url) => ({ url, checked: true })),
  detailImages: (preview.detail_images ?? []).map((url) => ({ url, checked: false })),
});

export type BuildExecuteResult =
  | { ok: true; request: ExecuteRequest; /** 因域名/协议不合法被剔除的图片数 */ skippedImages: number }
  | { ok: false; error: string };

/** 由卡片状态构建 execute 请求体（含全部客户端校验）
 *  plan 控制导入意图（默认 create）：update=更新已有商品；create-anyway=工作台已存在时仍新建（allow_duplicate）。
 *  重复保护最终以工作台为准：create 且未带 allow_duplicate 时，工作台侧应 409 拒绝重复。 */
export const buildExecuteRequest = (
  offerId: string,
  state: CardState,
  plan: ExecutePlan = 'create',
): BuildExecuteResult => {
  const id = (offerId ?? '').trim();
  if (!isValidOfferId(id)) {
    return { ok: false, error: 'offer_id 非法（6–15 位数字）' };
  }
  const name = state.name.trim();
  if (name.length === 0) {
    return { ok: false, error: '商品名称不能为空' };
  }
  if (name.length > MAX_NAME) {
    return { ok: false, error: `商品名称超过 ${MAX_NAME} 字（当前 ${name.length} 字）` };
  }

  const checkedBlocks = state.blocks.filter((b) => b.checked);
  if (checkedBlocks.length > MAX_BLOCKS) {
    return { ok: false, error: `资料区块最多 ${MAX_BLOCKS} 个（当前选中 ${checkedBlocks.length} 个）` };
  }
  const blocks = [];
  for (const b of checkedBlocks) {
    const title = b.title.trim() || '未命名区块';
    if (title.length > MAX_BLOCK_TITLE) {
      return { ok: false, error: `区块标题超过 ${MAX_BLOCK_TITLE} 字：${title.slice(0, 20)}…` };
    }
    if (b.content.length > MAX_BLOCK_CONTENT) {
      return { ok: false, error: `区块「${title.slice(0, 30)}」内容超过 ${MAX_BLOCK_CONTENT} 字` };
    }
    blocks.push({ title, content: b.content });
  }

  const images: ExecuteImage[] = [];
  let skippedImages = 0;
  for (const img of state.mainImages) {
    if (!img.checked) continue;
    const normalized = normalizeImageUrl(img.url);
    if (!normalized) { skippedImages += 1; continue; }
    images.push({ url: normalized, remark: '' });
  }
  for (const img of state.detailImages) {
    if (!img.checked) continue;
    const normalized = normalizeImageUrl(img.url);
    if (!normalized) { skippedImages += 1; continue; }
    images.push({ url: normalized, remark: '详情图' });
  }
  if (images.length > MAX_IMAGES) {
    return { ok: false, error: `图片最多 ${MAX_IMAGES} 张（当前选中且域名合法的共 ${images.length} 张），请取消部分勾选` };
  }

  const mode: ExecuteRequest['mode'] = plan === 'update' ? 'update' : 'create';
  const allow_duplicate = plan === 'create-anyway' ? true : undefined;

  return {
    ok: true,
    request: { offer_id: id, name, blocks, images, mode, ...(allow_duplicate ? { allow_duplicate } : {}) },
    skippedImages,
  };
};

/** SW 侧对 content script 传来的 execute 请求做兜底校验（同契约规则） */
export const isValidExecuteRequest = (req: unknown): req is ExecuteRequest => {
  if (!req || typeof req !== 'object') return false;
  const r = req as Partial<ExecuteRequest>;
  if (typeof r.offer_id !== 'string' || !isValidOfferId(r.offer_id)) return false;
  if (typeof r.name !== 'string') return false;
  const name = r.name.trim();
  if (name.length === 0 || name.length > MAX_NAME) return false;
  if (!Array.isArray(r.blocks) || r.blocks.length > MAX_BLOCKS) return false;
  for (const b of r.blocks as unknown[]) {
    if (!b || typeof b !== 'object') return false;
    const { title, content } = b as { title?: unknown; content?: unknown };
    if (typeof title !== 'string' || typeof content !== 'string') return false;
    if (title.length > MAX_BLOCK_TITLE || content.length > MAX_BLOCK_CONTENT) return false;
  }
  if (!Array.isArray(r.images) || r.images.length > MAX_IMAGES) return false;
  if (r.mode !== undefined && r.mode !== 'create' && r.mode !== 'update') return false;
  if (r.allow_duplicate !== undefined) {
    if (typeof r.allow_duplicate !== 'boolean') return false;
    // allow_duplicate 仅允许出现在 create 上（update 本就是「更新已有」，不需要）
    if (r.allow_duplicate && r.mode === 'update') return false;
  }
  for (const img of r.images as unknown[]) {
    if (!img || typeof img !== 'object') return false;
    const { url, remark } = img as { url?: unknown; remark?: unknown };
    if (typeof url !== 'string' || !isAllowedImageUrl(url)) return false;
    if (remark !== undefined && typeof remark !== 'string') return false;
  }
  return true;
};
