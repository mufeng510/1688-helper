import { describe, expect, it } from 'vitest';
import { mapClaimStatusText, backfillAmount } from '@/modules/claim/resultMapping';

describe('mapClaimStatusText（理赔列表状态 → resultStatus）', () => {
  it('理赔成功类文案 → paid', () => {
    expect(mapClaimStatusText('理赔成功')).toBe('paid');
    expect(mapClaimStatusText('已放款')).toBe('paid');
    expect(mapClaimStatusText('已赔付')).toBe('paid');
  });
  it('理赔失败/驳回类文案 → rejected', () => {
    expect(mapClaimStatusText('理赔失败')).toBe('rejected');
    expect(mapClaimStatusText('理赔失败，客服介入中')).toBe('rejected'); // 含失败 → rejected（客服介入信息记入日志即可）
    expect(mapClaimStatusText('已驳回')).toBe('rejected');
    expect(mapClaimStatusText('已关闭')).toBe('rejected');
  });
  it('处理中/审核类文案 → processing', () => {
    expect(mapClaimStatusText('处理中')).toBe('processing');
    expect(mapClaimStatusText('审核中')).toBe('processing');
    expect(mapClaimStatusText('待商家处理')).toBe('processing');
    expect(mapClaimStatusText('仲裁中')).toBe('processing');
  });
  it('无法识别 → unknown（绝不猜测）', () => {
    expect(mapClaimStatusText('')).toBe('unknown');
    expect(mapClaimStatusText('随便什么')).toBe('unknown');
    expect(mapClaimStatusText('  ')).toBe('unknown');
  });
});

describe('backfillAmount（只补缺，不覆盖）', () => {
  it('本地已有值 → 保留本地', () => {
    expect(backfillAmount(180.8, 999)).toBe(180.8);
  });
  it('本地缺失 → 用远端补', () => {
    expect(backfillAmount(undefined, 180.8)).toBe(180.8);
    expect(backfillAmount(undefined, undefined)).toBeUndefined();
  });
});
