// 1688 导入功能：纯逻辑与客户端错误映射单测
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeBaseUrl,
  originOf,
  maskToken,
  isAllowedImageUrl,
  normalizeImageUrl,
  isValidOfferId,
  defaultCardState,
  buildExecuteRequest,
  isValidExecuteRequest,
  MAX_IMAGES,
  MAX_BLOCKS,
} from '@/modules/import1688/payload';
import { ingest, executeImport, checkHealth, checkByOffer, checkConnection, Import1688Error } from '@/modules/import1688/client';
import type { Import1688Preview } from '@/modules/import1688/types';

describe('normalizeBaseUrl', () => {
  it('去空白与末尾斜杠', () => {
    expect(normalizeBaseUrl('  http://127.0.0.1:8080/  ')).toBe('http://127.0.0.1:8080');
    expect(normalizeBaseUrl('http://192.0.2.10:8080///')).toBe('http://192.0.2.10:8080');
  });
  it('缺省补 http://', () => {
    expect(normalizeBaseUrl('192.0.2.10:8080')).toBe('http://192.0.2.10:8080');
  });
  it('保留 https 与路径前缀', () => {
    expect(normalizeBaseUrl('https://example.com/workbench/')).toBe('https://example.com/workbench');
  });
  it('空输入回落到默认值', () => {
    expect(normalizeBaseUrl('   ')).toBe('http://127.0.0.1:8080');
  });
  it('非法协议/无法解析抛错', () => {
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow();
    expect(() => normalizeBaseUrl('http://')).toThrow();
  });
});

describe('originOf', () => {
  it('返回带末尾斜杠的 origin', () => {
    expect(originOf('http://192.0.2.10:8080')).toBe('http://192.0.2.10:8080/');
  });
});

describe('maskToken', () => {
  it('空/短 token', () => {
    expect(maskToken(undefined)).toBe('');
    expect(maskToken('')).toBe('');
    expect(maskToken('abcd')).toBe('***');
  });
  it('正常 token 只露尾 4 位', () => {
    expect(maskToken('sk-1234567890abcdef')).toBe('***cdef');
  });
});

describe('isAllowedImageUrl', () => {
  it('允许 https + alicdn/tmall/taobao（含子域名）', () => {
    expect(isAllowedImageUrl('https://cbu01.alicdn.com/img/ibank/x.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://img.alicdn.com/x.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://itemcdn.tmall.com/x.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://gw.taobao.com/x.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://alicdn.com/x.jpg')).toBe(true);
  });
  it('拒绝 http、非白名单域名、伪装域名', () => {
    expect(isAllowedImageUrl('http://cbu01.alicdn.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://evil.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://alicdn.com.evil.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://notalicdn.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('//cbu01.alicdn.com/x.jpg')).toBe(false); // 协议相对：需先 normalize
    expect(isAllowedImageUrl('not-a-url')).toBe(false);
    expect(isAllowedImageUrl('')).toBe(false);
  });
  it('normalizeImageUrl：协议相对补 https 后放行，其余规则不变', () => {
    expect(normalizeImageUrl('//cbu01.alicdn.com/img/ibank/x.jpg')).toBe('https://cbu01.alicdn.com/img/ibank/x.jpg');
    expect(normalizeImageUrl('  HTTPS://cbu01.alicdn.com/x.jpg  ')).toBe('https://cbu01.alicdn.com/x.jpg');
    expect(normalizeImageUrl('http://cbu01.alicdn.com/x.jpg')).toBeNull();
    expect(normalizeImageUrl('//evil.com/x.jpg')).toBeNull();
    expect(normalizeImageUrl('')).toBeNull();
  });
});

describe('isValidOfferId', () => {
  it('6–15 位数字', () => {
    expect(isValidOfferId('916521902819')).toBe(true);
    expect(isValidOfferId('12345')).toBe(false);
    expect(isValidOfferId('1234567890123456')).toBe(false);
    expect(isValidOfferId('abc123')).toBe(false);
  });
});

const preview: Import1688Preview = {
  offer_id: '916521902819',
  url: 'https://detail.1688.com/offer/916521902819.html',
  name: '全棉女士三两棉花保暖裤',
  blocks: [
    { title: '1688 来源链接', content: 'offerId：916521902819' },
    { title: '核心卖点', content: '全棉、保暖' },
  ],
  main_images: [
    'https://cbu01.alicdn.com/img/ibank/a.jpg',
    'https://cbu01.alicdn.com/img/ibank/b.jpg',
  ],
  detail_images: [
    'https://cbu01.alicdn.com/img/ibank/d1.jpg',
  ],
};

describe('defaultCardState', () => {
  it('区块全选、主图全选、详情图不选', () => {
    const s = defaultCardState(preview);
    expect(s.blocks.every((b) => b.checked)).toBe(true);
    expect(s.mainImages.every((i) => i.checked)).toBe(true);
    expect(s.detailImages.every((i) => !i.checked)).toBe(true);
    expect(s.name).toBe(preview.name);
  });
});

describe('buildExecuteRequest', () => {
  it('快乐路径：主图 remark 空、详情图 remark「详情图」，顺序为主图在前', () => {
    const s = defaultCardState(preview);
    s.detailImages[0]!.checked = true;
    const r = buildExecuteRequest(preview.offer_id, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.offer_id).toBe('916521902819');
    expect(r.request.name).toBe(preview.name);
    expect(r.request.blocks).toHaveLength(2);
    expect(r.request.images.map((i) => i.remark)).toEqual(['', '', '详情图']);
  });
  it('offer_id 非法 → 失败', () => {
    const s = defaultCardState(preview);
    expect(buildExecuteRequest('abc', s).ok).toBe(false);
  });
  it('名称为空/超长 → 失败', () => {
    const s = defaultCardState(preview);
    s.name = '   ';
    expect(buildExecuteRequest(preview.offer_id, s).ok).toBe(false);
    s.name = 'x'.repeat(121);
    expect(buildExecuteRequest(preview.offer_id, s).ok).toBe(false);
  });
  it('区块数量超限 → 失败', () => {
    const s = defaultCardState(preview);
    s.blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ checked: true, title: `t${i}`, content: 'c' }));
    expect(buildExecuteRequest(preview.offer_id, s).ok).toBe(false);
  });
  it('区块内容超 20000 字 → 失败；标题超 120 字 → 失败', () => {
    const s = defaultCardState(preview);
    s.blocks[0]!.content = 'c'.repeat(20001);
    expect(buildExecuteRequest(preview.offer_id, s).ok).toBe(false);
    const s2 = defaultCardState(preview);
    s2.blocks[0]!.title = 't'.repeat(121);
    expect(buildExecuteRequest(preview.offer_id, s2).ok).toBe(false);
  });
  it('非法域名图片被剔除并计数', () => {
    const s = defaultCardState(preview);
    s.mainImages.push({ url: 'https://evil.com/x.jpg', checked: true });
    const r = buildExecuteRequest(preview.offer_id, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedImages).toBe(1);
    expect(r.request.images).toHaveLength(2);
  });
  it('协议相对地址被规范化为 https 后保留（1688 常见）', () => {
    const s = defaultCardState(preview);
    s.mainImages = [{ url: '//cbu01.alicdn.com/img/ibank/proto-rel.jpg', checked: true }];
    s.detailImages = [{ url: '//cbu01.alicdn.com/img/ibank/proto-rel-d.jpg', checked: true }];
    const r = buildExecuteRequest(preview.offer_id, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedImages).toBe(0);
    expect(r.request.images.map((i) => i.url)).toEqual([
      'https://cbu01.alicdn.com/img/ibank/proto-rel.jpg',
      'https://cbu01.alicdn.com/img/ibank/proto-rel-d.jpg',
    ]);
    expect(r.request.images[1]?.remark).toBe('详情图');
  });
  it('合法图片超 24 张 → 失败', () => {
    const s = defaultCardState(preview);
    s.mainImages = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => ({
      url: `https://cbu01.alicdn.com/img/ibank/${i}.jpg`,
      checked: true,
    }));
    s.detailImages = [];
    expect(buildExecuteRequest(preview.offer_id, s).ok).toBe(false);
  });
  it('未勾选的区块/图片不出现在请求中', () => {
    const s = defaultCardState(preview);
    s.blocks[0]!.checked = false;
    s.mainImages[0]!.checked = false;
    const r = buildExecuteRequest(preview.offer_id, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.blocks).toHaveLength(1);
    expect(r.request.images).toHaveLength(1);
  });
  it('plan：默认 create（显式带 mode=create，不带 allow_duplicate）', () => {
    const s = defaultCardState(preview);
    const r = buildExecuteRequest(preview.offer_id, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.mode).toBe('create');
    expect(r.request.allow_duplicate).toBeUndefined();
  });
  it('plan：update → mode=update，不带 allow_duplicate', () => {
    const s = defaultCardState(preview);
    const r = buildExecuteRequest(preview.offer_id, s, 'update');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.mode).toBe('update');
    expect(r.request.allow_duplicate).toBeUndefined();
  });
  it('plan：create-anyway → mode=create 且 allow_duplicate=true', () => {
    const s = defaultCardState(preview);
    const r = buildExecuteRequest(preview.offer_id, s, 'create-anyway');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.mode).toBe('create');
    expect(r.request.allow_duplicate).toBe(true);
  });
});

describe('isValidExecuteRequest', () => {
  const good = {
    offer_id: '916521902819',
    name: '测试商品',
    blocks: [{ title: 't', content: 'c' }],
    images: [{ url: 'https://cbu01.alicdn.com/img/ibank/a.jpg', remark: '' }],
  };
  it('合法请求通过', () => {
    expect(isValidExecuteRequest(good)).toBe(true);
  });
  it('各种非法输入拒绝', () => {
    expect(isValidExecuteRequest(null)).toBe(false);
    expect(isValidExecuteRequest({ ...good, offer_id: 'x' })).toBe(false);
    expect(isValidExecuteRequest({ ...good, name: '' })).toBe(false);
    expect(isValidExecuteRequest({ ...good, name: 'x'.repeat(121) })).toBe(false);
    expect(isValidExecuteRequest({ ...good, images: [{ url: 'http://cbu01.alicdn.com/a.jpg', remark: '' }] })).toBe(false);
    expect(isValidExecuteRequest({ ...good, blocks: Array.from({ length: 21 }, () => ({ title: 't', content: 'c' })) })).toBe(false);
  });
  it('mode 合法组合通过，非法组合拒绝', () => {
    expect(isValidExecuteRequest({ ...good, mode: 'create' })).toBe(true);
    expect(isValidExecuteRequest({ ...good, mode: 'update' })).toBe(true);
    expect(isValidExecuteRequest({ ...good, mode: 'upsert' })).toBe(false);
    expect(isValidExecuteRequest({ ...good, allow_duplicate: true, mode: 'create' })).toBe(true);
    expect(isValidExecuteRequest({ ...good, allow_duplicate: true })).toBe(true); // 未显式带 mode 但带 allow_duplicate：视为 create
    expect(isValidExecuteRequest({ ...good, allow_duplicate: true, mode: 'update' })).toBe(false);
    expect(isValidExecuteRequest({ ...good, allow_duplicate: 1 })).toBe(false);
  });
});

// ---------- 客户端错误映射 ----------

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client 错误映射', () => {
  it('422 直接透出后端 detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, { detail: '被 1688 风控拦截，请过完验证后再试' })));
    const err = await ingest('http://127.0.0.1:8080', 'tok', { html: '<html/>' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Import1688Error);
    expect((err as Import1688Error).message).toBe('被 1688 风控拦截，请过完验证后再试');
    expect((err as Import1688Error).status).toBe(422);
    expect((err as Import1688Error).authRequired).toBe(false);
  });
  it('401/403 → authRequired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { detail: 'token revoked' })));
    const err401 = await ingest('http://127.0.0.1:8080', 'tok', { html: 'x' }).catch((e: unknown) => e) as Import1688Error;
    expect(err401.authRequired).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { detail: 'requires manage' })));
    const err403 = await executeImport('http://127.0.0.1:8080', 'tok', {}).catch((e: unknown) => e) as Import1688Error;
    expect(err403.authRequired).toBe(true);
  });
  it('502 → 整体回滚提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(502, { detail: 'image download failed' })));
    const err = await executeImport('http://127.0.0.1:8080', 'tok', {}).catch((e: unknown) => e) as Import1688Error;
    expect(err.message).toContain('已整体回滚');
  });
  it('网络错误 → 可理解提示（不含 token）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await ingest('http://127.0.0.1:8080', 'super-secret-token', { html: 'x' }).catch((e: unknown) => e) as Import1688Error;
    expect(err.code).toBe('network');
    expect(err.message).toContain('无法连接工作台');
    expect(err.message).not.toContain('super-secret-token');
  });
  it('checkHealth：2xx 为 ok，非 2xx/网络错误为异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'ok' })));
    expect((await checkHealth('http://127.0.0.1:8080')).ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, {})));
    expect((await checkHealth('http://127.0.0.1:8080')).ok).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('conn refused'); }));
    expect((await checkHealth('http://127.0.0.1:8080')).ok).toBe(false);
  });
  it('checkConnection：健康 OK + 探测 by-offer 带 Bearer；200 → Token 有效', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(200, { exists: false });
    });
    vi.stubGlobal('fetch', spy);
    const r = await checkConnection('http://127.0.0.1:8080', 'tok123');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Token 有效');
    const [, probe] = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect((probe.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
    expect(String(spy.mock.calls[1]?.[0])).toContain('/api/products/import/1688/by-offer/123456');
  });
  it('checkConnection：健康 OK 但无 Token → 失败并提示未设置', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'ok' })));
    const r = await checkConnection('http://127.0.0.1:8080');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('尚未设置');
  });
  it('checkConnection：健康 OK + by-offer 401 → 无效 Token（带工作台原话）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(401, { detail: 'Token 无效或已撤销' });
    }));
    const r = await checkConnection('http://127.0.0.1:8080', 'tok');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Token 无效或已撤销');
  });
  it('checkConnection：by-offer 403 → 权限不足；404 → 无法验证但视为可达；health 失败 → 失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(403, { detail: 'requires manage' });
    }));
    expect((await checkConnection('http://127.0.0.1:8080', 'tok')).message).toContain('manage 权限');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(404, {});
    }));
    expect((await checkConnection('http://127.0.0.1:8080', 'tok')).ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, {})));
    expect((await checkConnection('http://127.0.0.1:8080', 'tok')).ok).toBe(false);
  });
  it('fetch 被调用时带 Authorization 头且不带 credentials', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', spy);
    await ingest('http://127.0.0.1:8080', 'tok123', { html: 'x' });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/products/import/1688/ingest');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
    expect(init.credentials).toBe('omit');
  });
  it('checkByOffer：200 exists:true/false 正常解析，带 Authorization', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { exists: true, product: { id: 5, name: '已存在商品', updated_at: '2026-11-15T09:17:47' } }));
    vi.stubGlobal('fetch', spy);
    const r = await checkByOffer('http://127.0.0.1:8080', 'tok', '991485897552');
    expect(r.exists).toBe(true);
    expect(r.product?.id).toBe(5);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/products/import/1688/by-offer/991485897552');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(init.method).toBe('GET');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { exists: false })));
    expect((await checkByOffer('http://127.0.0.1:8080', 'tok', '991485897552')).exists).toBe(false);
  });
  it('checkByOffer：无法识别的 200 响应/404/网络错误 → 抛 Import1688Error（调用方降级，不阻断）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { nope: 1 })));
    await expect(checkByOffer('http://127.0.0.1:8080', 'tok', '991485897552')).rejects.toBeInstanceOf(Import1688Error);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
    await expect(checkByOffer('http://127.0.0.1:8080', 'tok', '991485897552')).rejects.toBeInstanceOf(Import1688Error);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('conn refused'); }));
    await expect(checkByOffer('http://127.0.0.1:8080', 'tok', '991485897552')).rejects.toBeInstanceOf(Import1688Error);
  });
  it('checkByOffer：offer_id 非法 → config 错误，不发请求', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { exists: false }));
    vi.stubGlobal('fetch', spy);
    await expect(checkByOffer('http://127.0.0.1:8080', 'tok', 'abc')).rejects.toBeInstanceOf(Import1688Error);
    expect(spy).not.toHaveBeenCalled();
  });
});
