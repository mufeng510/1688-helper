// 理赔状态机（纯函数）：只描述允许的状态迁移，不碰 IO。
import type { ClaimApplyStatus, ClaimApplyResult } from '@/common/types';

export interface Transition {
  from: ClaimApplyStatus;
  /** 触发事件 */
  on: 'start' | 'applied' | 'retryable_error' | 'needs_human' | 'not_eligible' | 'unknown_result' | 'user_completed' | 'user_ignore';
  to: ClaimApplyStatus;
}

export const TRANSITIONS: Transition[] = [
  { from: 'pending_apply', on: 'start', to: 'applying' },
  { from: 'failed', on: 'start', to: 'applying' },
  { from: 'applying', on: 'applied', to: 'submitted' },
  { from: 'applying', on: 'retryable_error', to: 'failed' },
  { from: 'applying', on: 'needs_human', to: 'needs_human' },
  { from: 'applying', on: 'not_eligible', to: 'rejected' },
  { from: 'applying', on: 'unknown_result', to: 'needs_human' },
  { from: 'needs_human', on: 'user_completed', to: 'completed' },
  { from: 'needs_human', on: 'user_ignore', to: 'completed' },
  { from: 'submitted', on: 'user_completed', to: 'completed' },
];

const find = (from: ClaimApplyStatus, on: Transition['on']): ClaimApplyStatus | null => {
  const t = TRANSITIONS.find((t) => t.from === from && t.on === on);
  return t ? t.to : null;
};

/** 根据执行结果计算下一状态；返回 null 表示非法迁移（保护性） */
export const nextApplyStatus = (from: ClaimApplyStatus, result: ClaimApplyResult): ClaimApplyStatus | null => {
  switch (result.kind) {
    case 'submitted':
      return find(from, 'applied');
    case 'retryable_error':
      return find(from, 'retryable_error');
    case 'not_eligible':
      return find(from, 'not_eligible');
    case 'needs_human':
      return find(from, 'needs_human');
    case 'unknown':
      return find(from, 'unknown_result');
    default:
      return null;
  }
};

export const isTerminal = (s: ClaimApplyStatus): boolean =>
  s === 'completed' || s === 'rejected';

/** 是否允许（重新）进入申请流程 */
export const canApply = (s: ClaimApplyStatus): boolean =>
  s === 'pending_apply' || s === 'failed';
