// 理赔申请执行器接口与实现。
// SimulationExecutor：完全模拟，用于框架验证与自动化测试（数据为虚构，不代表真实 1688 返回）。
// LiveClaimExecutor：真实页面只读探测——识别平台状态后安全返回；绝不点击提交、绝不伪造成功。
import type { ClaimApplyResult, ClaimOrder } from '@/common/types';
import { runInBackgroundTab } from '@/background/tab-runner';

export interface ClaimExecutor {
  readonly mode: 'simulation' | 'live';
  apply(order: ClaimOrder): Promise<ClaimApplyResult>;
}

/**
 * 模拟执行器：根据订单号中的模拟场景标记返回确定性结果。
 * 虚构场景（仅存在于模拟模式）：
 *   sim-success   直接成功
 *   sim-flaky     前 2 次失败后成功（验证重试机制）
 *   sim-fail      始终失败（验证 3 次重试上限）
 *   sim-ineligible 资格不满足（终态，不重试）
 *   sim-captcha   验证码/风控（暂停，等待人工）
 *   sim-unknown   提交结果不确认（禁止盲目重复提交）
 *   sim-login     登录失效（暂停等待人工）
 */
export class SimulationExecutor implements ClaimExecutor {
  readonly mode = 'simulation' as const;

  async apply(order: ClaimOrder): Promise<ClaimApplyResult> {
    const id = order.orderId;
    if (id.includes('sim-success')) return { kind: 'submitted' };
    if (id.includes('sim-flaky')) {
      return order.retryCount >= 2
        ? { kind: 'submitted' }
        : { kind: 'retryable_error', reason: `模拟网络错误（第 ${order.retryCount + 1} 次）` };
    }
    if (id.includes('sim-fail')) return { kind: 'retryable_error', reason: '模拟页面加载失败' };
    if (id.includes('sim-ineligible')) return { kind: 'not_eligible', reason: '模拟：不满足48小时发货延必赔理赔条件' };
    if (id.includes('sim-captcha')) return { kind: 'needs_human', reason: '模拟：检测到滑块验证码', keepTab: true };
    if (id.includes('sim-login')) return { kind: 'needs_human', reason: '模拟：登录状态失效', keepTab: true };
    if (id.includes('sim-unknown')) return { kind: 'unknown', reason: '模拟：无法确认提交是否成功' };
    return { kind: 'submitted' };
  }
}

// ---- 真实执行器（2026-11-15 适配，docs/1688_PAGES.md §7）----
// 申请页 service-compensation.html?orderId=<订单号> 的真实状态文案（真实实测）：
//   · 「当前订单存在已申请（或系统自动判定产生）的理赔记录。」→ 已有理赔记录，禁止重复提交
//   · 「未到承诺发货时间，暂不支持理赔」→ 平台暂不受理
// 本期行为：打开后台标签 → 只读探测 → 映射为 needs_human（永不提交）。
// 真实提交必须等（a）平台允许提交的真实场景、（b）用户明确授权、（c）单独评审后启用。
const COMPENSATION_URL = (orderId: string): string =>
  `https://air.1688.com/app/ctf-page/compensation/service-compensation.html?orderId=${encodeURIComponent(orderId)}`;
const PROBE_FILE = 'pages/inject/claim-apply-probe.js';

interface InjectedClaimProbe {
  ok: boolean;
  risk?: 'login' | 'baxia';
  state?: 'has_record' | 'not_yet' | 'form_ready' | 'blocked_unknown';
  error?: string;
}

const tabRunFailureText = (error: { kind: string; message?: string }): string => {
  switch (error.kind) {
    case 'create_failed':
      return '后台标签创建失败';
    case 'load_timeout':
      return '理赔页面加载超时';
    case 'frozen':
      return '后台标签被冻结/丢弃';
    case 'inject_failed':
      return `理赔页面采集失败：${error.message ?? ''}`;
    case 'script_error':
      return `理赔页面脚本错误：${error.message ?? ''}`;
    default:
      return `后台标签执行失败：${error.kind}`;
  }
};

export class LiveClaimExecutor implements ClaimExecutor {
  readonly mode = 'live' as const;

  async apply(order: ClaimOrder): Promise<ClaimApplyResult> {
    const res = await runInBackgroundTab<InjectedClaimProbe>({
      url: COMPENSATION_URL(order.orderId),
      injectFile: PROBE_FILE,
      timeoutMs: 60_000,
      keepTabOnOutcome: (v) => {
        const r = v as InjectedClaimProbe | undefined;
        // 登录失效/风控/真实表单就绪都需人工确认，保留标签页
        return !r || r.risk !== undefined || !r.ok || r.state === 'form_ready';
      },
    });
    if (!res.ok) {
      // 页面打不开/超时：有限次自动重试（不涉及提交，安全）
      return { kind: 'retryable_error', reason: tabRunFailureText(res.error) };
    }
    const v = res.value;
    if (!v) {
      return { kind: 'retryable_error', reason: '理赔页面未返回有效结果（页面结构可能已变更）' };
    }
    if (v.risk === 'login') {
      return { kind: 'needs_human', reason: '检测到 1688 登录失效，请重新登录后人工处理', keepTab: true };
    }
    if (v.risk === 'baxia') {
      return { kind: 'needs_human', reason: '检测到可见的风控/验证码界面，请人工处理（标签页已保留）', keepTab: true };
    }
    if (!v.ok) {
      return { kind: 'retryable_error', reason: v.error ?? '理赔页面采集失败' };
    }
    switch (v.state) {
      case 'has_record':
        return {
          kind: 'needs_human',
          reason: '平台提示该订单已存在理赔记录（或系统自动判定产生），禁止重复申请；请人工核对「我申请的理赔」',
        };
      case 'not_yet':
        return {
          kind: 'needs_human',
          reason: '平台提示未到承诺发货时间，暂不支持理赔；发货承诺到期后再由人工处理',
        };
      case 'form_ready':
        return {
          kind: 'needs_human',
          reason: '真实理赔申请表单已就绪，但真实提交未启用（须人工确认）；本次未执行提交',
          keepTab: true,
        };
      default:
        return {
          kind: 'retryable_error',
          reason: '无法识别理赔页面状态（页面结构可能已变更），禁止提交，等待人工核对',
        };
    }
  }
}

export const createExecutor = (mode: 'simulation' | 'live'): ClaimExecutor =>
  mode === 'live' ? new LiveClaimExecutor() : new SimulationExecutor();
