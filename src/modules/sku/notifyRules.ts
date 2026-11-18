// SKU 通知规则：全局配置 + 每商品覆盖 → 有效规则（纯函数，SW / 管理页 / 测试共用）。
import type { AppSettings, SkuChangeType, SkuNotifySettings, SkuProduct } from '@/common/types';
import { DEFAULT_SKU_NOTIFY } from '@/common/types';

/** 商品级覆盖（进入自定义时由全局快照写入，之后每字段都是显式值） */
export type SkuNotifyOverride = Partial<SkuNotifySettings>;

/** 全局 + 商品覆盖 → 有效规则 */
export const effectiveSkuNotify = (
  product: Pick<SkuProduct, 'skuNotify'>,
  settings: Pick<AppSettings, 'skuNotify'>,
): SkuNotifySettings => ({
  ...DEFAULT_SKU_NOTIFY,
  ...(settings.skuNotify ?? {}),
  ...(product.skuNotify ?? {}),
});

export const isSkuNotifyCustomized = (product: Pick<SkuProduct, 'skuNotify'>): boolean =>
  !!product.skuNotify && Object.keys(product.skuNotify).length > 0;

export const CHANGE_NOTIFY_KEY: Record<SkuChangeType, keyof SkuNotifySettings> = {
  SKU_ADDED: 'added',
  SKU_REMOVED: 'removed',
  SPEC_CHANGED: 'specChanged',
  STOCK_INCREASED: 'stockIncreased',
  STOCK_DECREASED: 'stockDecreased',
  STOCK_OUT: 'stockOut',
  STOCK_RESTORED: 'stockRestored',
  STOCK_LOW: 'lowStock',
  PRICE_CHANGED: 'priceChanged',
};

/** 按规则过滤出需要通知的变化；不修改输入 */
export const filterNotifiableChanges = <T extends { type: SkuChangeType }>(
  changes: T[],
  rules: SkuNotifySettings,
): T[] => changes.filter((c) => rules[CHANGE_NOTIFY_KEY[c.type]] === true);
