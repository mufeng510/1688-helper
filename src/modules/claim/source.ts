// 揽收超时订单发现源。simulation：返回虚构订单；live：等待真实页面适配，返回空并明确记录。
import { logger } from '@/common/log';

const log = logger('claim.source');

export interface DiscoveredOrder {
  orderId: string;
  goodsName?: string;
  goodsInfo?: string;
  seller?: string;
  orderAmount?: number;
  expectedClaimAmount?: number;
}

export interface OrderSource {
  discover(): Promise<DiscoveredOrder[]>;
}

const SIMULATED_ORDERS: DiscoveredOrder[] = [
  { orderId: 'SIM-sim-success-0001', goodsName: '【模拟】强磁引磁片 黑色', goodsInfo: '颜色: 强磁塑胶黑色 x 10', seller: '模拟供应商A', orderAmount: 36, expectedClaimAmount: 3.6 },
  { orderId: 'SIM-sim-flaky-0002', goodsName: '【模拟】官方直送抽纸', goodsInfo: '规格: 110抽*12 x 1', seller: '模拟供应商B', orderAmount: 25.5, expectedClaimAmount: 2.5 },
  { orderId: 'SIM-sim-fail-0003', goodsName: '【模拟】Magsafe 支架', goodsInfo: '颜色: 黑色 x 1', seller: '模拟供应商C', orderAmount: 12, expectedClaimAmount: 1.2 },
  { orderId: 'SIM-sim-ineligible-0004', goodsName: '【模拟】不符合条件的订单', seller: '模拟供应商D', orderAmount: 99 },
  { orderId: 'SIM-sim-captcha-0005', goodsName: '【模拟】触发验证码的订单', seller: '模拟供应商E', orderAmount: 88 },
  { orderId: 'SIM-sim-unknown-0006', goodsName: '【模拟】提交结果不确认的订单', seller: '模拟供应商F', orderAmount: 66 },
];

export class SimulationOrderSource implements OrderSource {
  async discover(): Promise<DiscoveredOrder[]> {
    return SIMULATED_ORDERS;
  }
}

export class LiveOrderSource implements OrderSource {
  // 真实入口（2026-11-15 用户截图确认）：订单列表 →「待收货」下拉 →「揽收超时」。
  // 该视图下当前 0 笔订单，筛选控件参数无法实测，故不臆造。
  // 待出现揽收超时订单后，按增量任务适配：打开后台标签 → 选「待收货」→「揽收超时」→ 读列表 → 详情页找「去申请理赔」。
  async discover(): Promise<DiscoveredOrder[]> {
    await log.warn('真实揽收超时订单发现未适配：订单列表「待收货」下拉 →「揽收超时」的筛选控件参数需在真实订单出现后实测（docs/1688_PAGES.md）。本次未发现订单。');
    // 明确返回空：不臆造真实订单，也不从普通订单里猜
    return [];
  }
}

export const createOrderSource = (mode: 'simulation' | 'live'): OrderSource =>
  mode === 'live' ? new LiveOrderSource() : new SimulationOrderSource();
