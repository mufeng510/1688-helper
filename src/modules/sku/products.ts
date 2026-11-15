// 商品添加/列表管理（popup 与 admin 共用 SW 逻辑）
import { skuProductsGetByOfferId, skuProductsList, skuProductsPut, skuSnapshotLatestValid } from '@/common/db';
import { newId } from '@/common/id';
import { enqueue } from '@/common/tasks';

export interface OfferInfo {
  offerId: string;
  url: string;
  title: string;
  image?: string;
  company?: string;
}

export const parseOfferUrl = (rawUrl: string): { offerId: string; url: string } | null => {
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)1688\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/offer\/(\d+)\.html/);
    if (!m) return null;
    return { offerId: m[1]!, url: `https://detail.1688.com/offer/${m[1]}.html` };
  } catch {
    return null;
  }
};

/** 添加商品；重复添加返回已存在的记录 */
export const addSkuProduct = async (info: OfferInfo): Promise<{ product: NonNullable<Awaited<ReturnType<typeof skuProductsGetByOfferId>>>; created: boolean }> => {
  const existing = await skuProductsGetByOfferId(info.offerId);
  if (existing) return { product: existing, created: false };
  const now = Date.now();
  const product = {
    id: newId('prod'),
    offerId: info.offerId,
    url: info.url,
    title: info.title || info.offerId,
    image: info.image,
    company: info.company,
    status: 'active' as const,
    autoPaused: false,
    baselineEstablished: false,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
  await skuProductsPut(product);
  // 立即入队建立基准快照（不发通知）
  await enqueue({ type: 'sku.scan', payload: { productId: product.id }, dedupeKey: `sku.scan:${product.id}` });
  return { product, created: true };
};

export const listSkuProducts = async () => {
  const products = await skuProductsList();
  return Promise.all(
    products.map(async (p) => {
      const latest = await skuSnapshotLatestValid(p.id);
      return {
        ...p,
        lastValidSkuCount: latest?.skus.length ?? null,
        lastValidScanAt: latest?.scannedAt ?? null,
      };
    }),
  );
};
