// 扫描数据完整性校验（纯函数）。
// 任一条件不满足 → 本次扫描视为无效：不参与比较、不覆盖基准。
import type { NormalizedSku } from './skuModel';
import type { InjectedSkuScanResult } from '@/common/types';

export interface CompletenessContext {
  injected: InjectedSkuScanResult;
  prevValidSkuCount?: number;
}

export interface CompletenessResult {
  valid: boolean;
  reason?: string;
}

export const validateScan = (skus: NormalizedSku[], ctx: CompletenessContext): CompletenessResult => {
  const { injected, prevValidSkuCount } = ctx;

  if (injected.risk === 'baxia' || injected.risk === 'punish') {
    return { valid: false, reason: '页面疑似风控/验证码拦截' };
  }
  if (injected.risk === 'login') {
    return { valid: false, reason: '登录状态失效（页面跳转登录）' };
  }
  if (injected.risk === 'empty') {
    return { valid: false, reason: '页面内容为空（加载失败）' };
  }
  if (!injected.ok || injected.error) {
    return { valid: false, reason: injected.error ?? '采集脚本执行失败' };
  }
  if (skus.length === 0) {
    return { valid: false, reason: '未解析到任何 SKU（页面结构可能已变更）' };
  }
  const missingStock = skus.filter((s) => s.stock === null);
  if (missingStock.length > 0) {
    return { valid: false, reason: `有 ${missingStock.length} 个 SKU 缺少库存数据（canBookCount 缺失）` };
  }
  if (prevValidSkuCount !== undefined && prevValidSkuCount >= 4) {
    // 数量骤降超过 60% 视为异常（页面未加载完整），避免误判为「大量 SKU 被删除」
    if (skus.length < prevValidSkuCount * 0.4) {
      return { valid: false, reason: `SKU 数量从上轮 ${prevValidSkuCount} 骤降到 ${skus.length}，疑似页面加载不完整` };
    }
  }
  return { valid: true };
};
