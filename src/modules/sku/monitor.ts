// SKU 监控核心编排（SW 侧）：打开后台标签 → 采集 → 校验 → 快照/比较 → 通知。
import {
  skuChangesList,
  skuChangesPutMany,
  notifiedChangeHas,
  notifiedChangeMark,
  skuProductsGet,
  skuProductsPut,
  skuSnapshotLatestValid,
  skuSnapshotPut,
} from '@/common/db';
import { newId } from '@/common/id';
import { logger } from '@/common/log';
import { sendNotification } from '@/common/notify';
import { runInBackgroundTab } from '@/background/tab-runner';
import type { InjectedSkuScanResult, ScanOutcome, SkuChange, SkuProduct, SkuSnapshot } from '@/common/types';
import { compareSnapshots, CHANGE_TYPE_LABEL } from './compare';
import { validateScan } from './completeness';
import { normalizeSkuModel, parseSkuModelFromScript, type NormalizedSku } from './skuModel';

const log = logger('sku.monitor');
export const MAX_CONSECUTIVE_FAILURES = 3;

const INJECT_FILE = 'pages/inject/sku-collector.js';

const changeDedupeKey = (c: SkuChange): string =>
  [c.productId, c.skuKey, c.type, JSON.stringify(c.before?.stock ?? c.before?.price ?? c.before?.name ?? ''), JSON.stringify(c.after?.stock ?? c.after?.price ?? c.after?.name ?? '')].join('|');

const summarizeChanges = (changes: SkuChange[]): string => {
  const count = (t: SkuChange['type'][]) => changes.filter((c) => t.includes(c.type)).length;
  const lines: string[] = [];
  const added = count(['SKU_ADDED']);
  if (added) lines.push(`新增 ${added} 个 SKU`);
  const removed = count(['SKU_REMOVED']);
  if (removed) lines.push(`删除 ${removed} 个 SKU`);
  const spec = count(['SPEC_CHANGED']);
  if (spec) lines.push(`规格变化 ${spec} 个`);
  const dec = changes.filter((c) => c.type === 'STOCK_DECREASED');
  for (const c of dec.slice(0, 8)) lines.push(`库存减少：${c.skuName}，${c.before?.stock} → ${c.after?.stock}`);
  const out = changes.filter((c) => c.type === 'STOCK_OUT');
  for (const c of out.slice(0, 8)) lines.push(`库存归零：${c.skuName}，${c.before?.stock} → 0`);
  const restored = changes.filter((c) => c.type === 'STOCK_RESTORED');
  for (const c of restored.slice(0, 8)) lines.push(`恢复有货：${c.skuName}，0 → ${c.after?.stock}`);
  const inc = changes.filter((c) => c.type === 'STOCK_INCREASED');
  if (inc.length) lines.push(`库存增加 ${inc.length} 个 SKU`);
  const price = changes.filter((c) => c.type === 'PRICE_CHANGED');
  if (price.length) lines.push(`价格变化 ${price.length} 个（仅记录）`);
  return lines.join('\n');
};

export const scanSkuProduct = async (productId: string): Promise<ScanOutcome> => {
  const product = await skuProductsGet(productId);
  if (!product) return { productId, valid: false, changes: [], error: '商品不存在' };
  if (product.status === 'paused') {
    return { productId, valid: false, changes: [], error: `商品已暂停监控（${product.pauseReason ?? '用户暂停'}）` };
  }

  const tabResult = await runInBackgroundTab<InjectedSkuScanResult>({ url: product.url, injectFile: INJECT_FILE });
  const now = Date.now();

  const fail = async (reason: string, risk?: ScanOutcome['risk']): Promise<ScanOutcome> => {
    // 重新读取，避免覆盖用户在扫描期间的手动暂停
    const current = (await skuProductsGet(product.id)) ?? product;
    const consecutiveFailures = current.consecutiveFailures + 1;
    const alreadyPaused = current.status === 'paused';
    const autoPause = !alreadyPaused && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    const next: SkuProduct = {
      ...current,
      consecutiveFailures,
      lastError: reason,
      lastScanAt: now,
      status: alreadyPaused || autoPause ? 'paused' : 'active',
      autoPaused: alreadyPaused ? current.autoPaused : autoPause ? true : current.autoPaused,
      pauseReason: alreadyPaused
        ? current.pauseReason
        : autoPause
          ? `连续扫描失败 ${consecutiveFailures} 次，已自动暂停`
          : current.pauseReason,
      updatedAt: now,
    };
    await skuProductsPut(next);
    await skuSnapshotPut({
      id: newId('snap'),
      productId: product.id,
      offerId: product.offerId,
      scannedAt: now,
      valid: false,
      skus: [],
      error: reason,
    });
    await log.warn('商品扫描失败', { productId, title: product.title, reason, consecutiveFailures, autoPause });
    if (autoPause) {
      await sendNotification({
        type: 'exception.sku.auto_paused',
        title: '1688 SKU 监控已自动暂停',
        body: `商品「${product.title}」连续扫描失败 ${consecutiveFailures} 次，已自动暂停监控。\n原因：${reason}`,
        dedupeKey: `auto-pause:${product.id}`,
        forceDesktop: true,
      });
    }
    if (risk === 'login') {
      await sendNotification({
        type: 'exception.login',
        title: '1688 登录状态失效',
        body: '采集时发现 1688 登录已失效，请重新登录后恢复任务。',
        dedupeKey: 'login-expired',
        forceDesktop: true,
      });
    }
    return { productId, valid: false, changes: [], error: reason, risk, autoPaused: autoPause };
  };

  if (!tabResult.ok) {
    const err = tabResult.error;
    const reason =
      err.kind === 'load_timeout' ? '后台标签加载超时' :
      err.kind === 'frozen' ? '后台标签被 Chrome 冻结或丢弃' :
      err.kind === 'create_failed' ? '后台标签创建失败' :
      `采集失败：${err.message}`;
    return fail(reason);
  }

  const injected = tabResult.value;
  if (!injected || !injected.ok) {
    if (injected?.risk === 'login') return fail('登录状态失效', 'login');
    if (injected?.risk === 'baxia' || injected?.risk === 'punish') return fail('页面疑似风控/验证码拦截', injected.risk);
    return fail(injected?.error ?? '采集脚本未返回有效数据');
  }

  const parsed = injected.scriptText ? parseSkuModelFromScript(injected.scriptText) : null;
  const skus: NormalizedSku[] = parsed ? normalizeSkuModel(parsed) : [];

  const prevValid = await skuSnapshotLatestValid(product.id);
  const completeness = validateScan(skus, {
    injected,
    prevValidSkuCount: prevValid?.skus.length,
  });

  if (!completeness.valid) {
    return fail(completeness.reason ?? '扫描数据不完整');
  }

  const snapshot: SkuSnapshot = {
    id: newId('snap'),
    productId: product.id,
    offerId: product.offerId,
    scannedAt: now,
    valid: true,
    skus: skus.map((s) => ({
      skuId: s.skuId,
      specId: s.specId,
      specAttrs: s.specAttrs,
      propNames: s.propNames ?? [],
      name: s.name,
      price: s.price,
      stock: s.stock,
      inStock: s.inStock,
    })),
  };
  await skuSnapshotPut(snapshot);

  const fresh = (await skuProductsGet(product.id)) ?? product;
  const baseProduct: SkuProduct = {
    ...fresh,
    consecutiveFailures: 0,
    lastError: undefined,
    lastScanAt: now,
    lastSuccessAt: now,
    title: injected.title || fresh.title,
    image: injected.image ?? fresh.image,
    updatedAt: now,
  };

  // 第一次有效扫描：仅建立基准，不通知
  if (!product.baselineEstablished) {
    await skuProductsPut({ ...baseProduct, baselineEstablished: true });
    await log.info('商品基准快照已建立', { productId: product.id, title: product.title, skuCount: skus.length });
    return { productId, valid: true, snapshot, changes: [], baselineJustEstablished: true };
  }

  const changes: SkuChange[] = [];
  if (prevValid) {
    const prevSkus: NormalizedSku[] = prevValid.skus.map((s) => ({
      skuId: s.skuId,
      specId: s.specId,
      specAttrs: s.specAttrs,
      propNames: s.propNames ?? [],
      name: s.name,
      price: s.price,
      stock: s.stock,
      inStock: s.inStock,
    }));
    const compared = compareSnapshots(prevSkus, skus, {
      productId: product.id,
      offerId: product.offerId,
      productTitle: baseProduct.title,
    });
    changes.push(...compared.changes);
    await skuChangesPutMany(changes);
    await log.info('商品扫描完成', { productId: product.id, skus: skus.length, matchedBy: compared.matchedBy, changes: changes.length });
  }

  await skuProductsPut(baseProduct);

  // 通知：仅真实检测到的变化，逐条去重后按商品汇总一条
  const notifiedFresh: SkuChange[] = [];
  for (const c of changes) {
    const key = changeDedupeKey(c);
    if (await notifiedChangeHas(key)) continue;
    notifiedFresh.push(c);
    await notifiedChangeMark(key);
  }
  if (notifiedFresh.length > 0) {
    const body = [`商品：${baseProduct.title}`, '', summarizeChanges(notifiedFresh)].join('\n');
    await sendNotification({
      type: 'sku.changed',
      title: '1688 商品 SKU 变化',
      body,
      dedupeKey: `sku-changes:${product.id}:${now}`,
    });
  }

  return { productId, valid: true, snapshot, changes };
};

export const listRecentChangesForProduct = (productId: string, limit = 50) => skuChangesList(productId, limit);
export { CHANGE_TYPE_LABEL };
