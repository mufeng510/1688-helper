// 理赔结果回读：打开「我申请的理赔」列表 → 注入脚本读取表格 → 按 orderId 匹配本地记录 → 更新 resultStatus（并补缺订单金额/理赔金额）。
// 只读页面，不点击任何操作按钮。仅 live 模式调用。
import { logger } from '@/common/log';
import { runInBackgroundTab } from '@/background/tab-runner';
import { claimOrdersGetByOrderId, claimOrdersList, claimOrdersPut } from '@/common/db';
import { mapClaimStatusText, backfillAmount } from './resultMapping';

const log = logger('claim.sync');

const COMP_LIST_URL = 'https://bao.1688.com/service/compensation/compensation_buyer_list.htm';
const INJECT_FILE = 'pages/inject/claim-result-list.js';

export interface ClaimResultSyncSummary {
  checked: number;
  updated: number;
  /** 本地已记录、但列表中未出现的订单数（可能平台未生成理赔单） */
  notFound: number;
}

interface InjectedClaimResultList {
  ok: boolean;
  risk?: 'login' | 'baxia';
  records?: Array<{
    claimId?: string;
    orderId?: string;
    applyTime?: string;
    orderAmount?: number;
    claimAmount?: number;
    statusText?: string;
  }>;
  error?: string;
}

/** 回读理赔结果并同步本地记录。失败只记日志，不抛异常（不影响主流程）。 */
export const syncClaimResults = async (): Promise<ClaimResultSyncSummary> => {
  const summary: ClaimResultSyncSummary = { checked: 0, updated: 0, notFound: 0 };
  try {
    const res = await runInBackgroundTab<InjectedClaimResultList>({
      url: COMP_LIST_URL,
      injectFile: INJECT_FILE,
      timeoutMs: 60_000,
    });
    if (!res.ok) {
      await log.warn('理赔结果回读：后台标签加载失败', { kind: res.error.kind });
      return summary;
    }
    const value = res.value;
    if (!value || !value.ok || !Array.isArray(value.records)) {
      await log.warn('理赔结果回读：页面未返回有效列表', value?.error ?? '未知错误');
      return summary;
    }
    summary.checked = value.records.length;
    const remoteIds = new Set(
      value.records.map((r) => (typeof r.orderId === 'string' ? r.orderId.trim() : '')).filter((id) => /^\d{10,20}$/.test(id)),
    );
    try {
      const localOrders = await claimOrdersList();
      summary.notFound = localOrders.filter((o) => o.mode === 'live' && !remoteIds.has(o.orderId)).length;
    } catch {
      // 统计失败不影响同步主流程
    }
    for (const row of value.records) {
      const orderId = typeof row.orderId === 'string' ? row.orderId.trim() : '';
      if (!/^\d{10,20}$/.test(orderId)) continue;
      const local = await claimOrdersGetByOrderId(orderId);
      if (!local) continue; // 只同步本地已记录的订单
      const remoteStatus = mapClaimStatusText(row.statusText ?? '');
      const orderAmount = backfillAmount(local.orderAmount, row.orderAmount);
      const expectedClaimAmount = backfillAmount(local.expectedClaimAmount, row.claimAmount);
      const changed =
        remoteStatus !== 'unknown' && remoteStatus !== local.resultStatus
          ? true
          : orderAmount !== local.orderAmount || expectedClaimAmount !== local.expectedClaimAmount;
      if (!changed) continue;
      await claimOrdersPut({
        ...local,
        resultStatus: remoteStatus !== 'unknown' ? remoteStatus : local.resultStatus,
        orderAmount,
        expectedClaimAmount,
        updatedAt: Date.now(),
      });
      summary.updated += 1;
    }
    if (summary.checked > 0) {
      await log.info('理赔结果回读完成', { checked: summary.checked, updated: summary.updated });
    }
    return summary;
  } catch (err) {
    await log.warn('理赔结果回读异常', err instanceof Error ? err.message : String(err));
    return summary;
  }
};
