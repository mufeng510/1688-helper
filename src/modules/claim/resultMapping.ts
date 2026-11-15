// 理赔列表「状态」文本 → 本地 resultStatus 映射（纯函数，可单测）。
// 数据源：bao.1688.com compensation_buyer_list.htm 状态列（2026-11-15 实测：理赔成功 / 理赔失败）。
// 未识别的文本一律返回 'unknown'，绝不猜测。
import type { ClaimResultStatus } from '@/common/types';

export const mapClaimStatusText = (raw: string): ClaimResultStatus => {
  const t = (raw || '').trim();
  if (!t) return 'unknown';
  if (/理赔成功|已放款|到账|已赔付/.test(t)) return 'paid';
  if (/理赔失败|驳回|拒绝|不符合|不支持|关闭/.test(t)) return 'rejected';
  if (/处理中|审核中|审核|介入|协商|受理|待|仲裁/.test(t)) return 'processing';
  return 'unknown';
};

/** 订单金额/理赔金额只补缺，不覆盖已有值 */
export const backfillAmount = (local: number | undefined, remote: number | undefined): number | undefined =>
  local !== undefined ? local : remote;
