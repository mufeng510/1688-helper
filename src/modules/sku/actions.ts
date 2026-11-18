// SKU 商品操作（admin 页与 SW 共用）：暂停/恢复/删除/关注列表等纯 DB 逻辑。
import { skuProductsGet, skuProductsPut, skuProductsDelete } from '@/common/db';
import { enqueue } from '@/common/tasks';
import { logger } from '@/common/log';
import type { SkuProduct } from '@/common/types';
import type { SkuNotifyOverride } from './notifyRules';

const log = logger('sku.actions');

export const pauseSkuProduct = async (productId: string, reason = '用户手动暂停'): Promise<SkuProduct | null> => {
  const p = await skuProductsGet(productId);
  if (!p) return null;
  const next: SkuProduct = {
    ...p,
    status: 'paused',
    autoPaused: false,
    pauseReason: reason,
    updatedAt: Date.now(),
  };
  await skuProductsPut(next);
  await log.info('商品已暂停监控', { productId, title: p.title });
  return next;
};

export const resumeSkuProduct = async (productId: string): Promise<SkuProduct | null> => {
  const p = await skuProductsGet(productId);
  if (!p) return null;
  const next: SkuProduct = {
    ...p,
    status: 'active',
    autoPaused: false,
    pauseReason: undefined,
    consecutiveFailures: 0,
    lastError: undefined,
    updatedAt: Date.now(),
  };
  await skuProductsPut(next);
  await log.info('商品已恢复监控', { productId, title: p.title });
  // 恢复后尽快安排一次扫描
  await enqueue({ type: 'sku.scan', payload: { productId }, dedupeKey: `sku.scan:${productId}` });
  return next;
};

export const deleteSkuProduct = async (productId: string): Promise<void> => {
  const p = await skuProductsGet(productId);
  await skuProductsDelete(productId);
  await log.info('商品已删除', { productId, title: p?.title });
};

export const enqueueSkuScan = async (productId: string): Promise<void> => {
  await enqueue({ type: 'sku.scan', payload: { productId }, dedupeKey: `sku.scan:${productId}` });
};

/** 设置/清除商品级通知规则覆盖。override 为完整快照（10 个键）或 undefined（恢复跟随全局） */
export const setSkuNotifyOverride = async (
  productId: string,
  override: SkuNotifyOverride | undefined,
): Promise<SkuProduct | null> => {
  const p = await skuProductsGet(productId);
  if (!p) return null;
  const next: SkuProduct = { ...p, skuNotify: override, updatedAt: Date.now() };
  await skuProductsPut(next);
  await log.info(override ? '商品已切换为自定义通知规则' : '商品已恢复跟随全局通知规则', { productId, title: p.title });
  return next;
};
