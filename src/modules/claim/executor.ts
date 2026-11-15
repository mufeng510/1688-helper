// 理赔申请执行器接口与实现。
// SimulationExecutor：完全模拟，用于框架验证与自动化测试（数据为虚构，不代表真实 1688 返回）。
// LiveClaimExecutor：真实页面适配前不执行任何提交；只报告 needs_human，绝不伪造成功。
import type { ClaimApplyResult, ClaimOrder } from '@/common/types';

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

/** 真实执行器：页面未适配前拒绝执行，返回 needs_human。 */
export class LiveClaimExecutor implements ClaimExecutor {
  readonly mode = 'live' as const;

  async apply(_order: ClaimOrder): Promise<ClaimApplyResult> {
    return {
      kind: 'needs_human',
      reason: '真实揽收超时订单的申请表单尚未适配（等待真实订单页面验证）。为避免误操作，本次不执行提交。',
      keepTab: true,
    };
  }
}

export const createExecutor = (mode: 'simulation' | 'live'): ClaimExecutor =>
  mode === 'live' ? new LiveClaimExecutor() : new SimulationExecutor();
