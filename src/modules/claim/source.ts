// 揽收超时订单发现源。simulation：返回虚构订单；live：后台标签打开买家工作台 →「待收货」下拉 →「揽收超时」，读取列表。
import { logger } from '@/common/log';
import { injectIntoTab, waitForComplete } from '@/background/tab-runner';
import { sendNotification } from '@/common/notify';
import { mapCollectedOrders, type RawCollectedOrder } from './discovery';

const log = logger('claim.source');

export interface DiscoveredOrder {
  orderId: string;
  goodsName?: string;
  goodsInfo?: string;
  seller?: string;
  orderAmount?: number;
  expectedClaimAmount?: number;
  /** 下单时间（页面原文，Best-effort） */
  orderTime?: string;
  /** 列表行内出现「理赔中」标记（Best-effort，用于日志/人工判断；不以此做自动提交决策） */
  claimingInProgress?: boolean;
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

const BUYER_WORKLIST_URL =
  'https://work.1688.com/home/buyer.htm?_path_=buyer2017Base/2017buyerbase_trade/buyList';
const FINDER_FILE = 'pages/inject/claim-finder.js';
const COLLECTOR_FILE = 'pages/inject/claim-collector.js';
const PHASE_B_POLL_MS = 1500;
const PHASE_B_TIMEOUT_MS = 18_000;

interface InjectedClaimScanResult {
  ok: boolean;
  frame?: 'list' | 'other';
  risk?: 'login' | 'baxia';
  orders?: RawCollectedOrder[];
  countText?: string;
  error?: string;
}

export class LiveOrderSource implements OrderSource {
  /**
   * 真实发现（2026-11-16 两阶段适配）：
   * 后台标签打开买家工作台 → Phase A：注入 claim-finder 把订单列表 iframe 导航到「揽收超时」(tradeStatus=CTMO) 视图
   * （真实页面入口在 hover tooltip 中，点击 CTMO 会整页导航，注入上下文随之销毁，故不能原地轮询）→
   * Phase B：轮询注入 claim-collector 读取 CTMO 视图订单行。
   * 任何环节拿不准（未登录/页面声明的条数与解析条数不一致）→ 返回空并记录警告，绝不把未过滤的订单当成揽收超时订单。
   */
  async discover(): Promise<DiscoveredOrder[]> {
    // 订单列表 iframe（air.1688.com）由工作台 SPA 在 complete 之后懒创建：注入前先等 settleMs。
    return this.discoverOnce(12_000);
  }

  private async discoverOnce(settleMs: number): Promise<DiscoveredOrder[]> {
    // 1) 建后台标签（不关闭；Phase B 结束后再决定是否保留）
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.create({ url: BUYER_WORKLIST_URL, active: false });
    } catch (err) {
      await log.error('真实理赔扫描：后台标签创建失败', String(err));
      return [];
    }
    const tabId = tab.id!;
    let keepTab = false;
    try {
      const loaded = await waitForComplete(tabId, 45_000);
      if (!loaded) {
        await log.warn('真实理赔扫描：后台标签加载超时', { tabId });
        return [];
      }
      await new Promise((r) => setTimeout(r, settleMs));
      const fresh = await chrome.tabs.get(tabId);
      if (fresh.discarded || fresh.frozen) {
        await log.warn('真实理赔扫描：后台标签被冻结，放弃扫描', { tabId });
        return [];
      }
      // 2) Phase A：触发导航（返回值可能随 frame 导航丢失，忽略；Phase B 以 URL 判定是否成功）
      const phaseA = await injectIntoTab(tabId, { injectFile: FINDER_FILE, allFrames: true, tag: 'phaseA:finder' });
      if (!phaseA.ok) {
        await log.warn('真实理赔扫描：Phase A 注入失败（将继续尝试 Phase B，导航可能已生效）', { message: phaseA.message.slice(0, 120) });
      }
      // 3) Phase B：轮询提取器，直到 CTMO 视图渲染出结果或超时
      const deadline = Date.now() + PHASE_B_TIMEOUT_MS;
      let value: InjectedClaimScanResult | undefined;
      let lastDiag = 'no-ctmo-frame（导航可能未生效）';
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, PHASE_B_POLL_MS));
        const inj = await injectIntoTab<InjectedClaimScanResult>(tabId, { injectFile: COLLECTOR_FILE, allFrames: true, tag: 'phaseB:collector' });
        if (!inj.ok) {
          lastDiag = `phaseB 注入失败：${inj.message.slice(0, 100)}`;
          continue;
        }
        if (inj.value === undefined) {
          lastDiag = 'phaseB 无 frame 产出（CTMO 视图可能尚未导航完成）';
          continue;
        }
        value = inj.value;
        break;
      }
      if (!value) {
        await log.warn('真实理赔扫描：导航到 CTMO 视图后仍未采集到任何 frame 结果', { note: lastDiag });
        return [];
      }
      if (value.risk === 'login') {
        await log.warn('真实理赔扫描：检测到登录失效，需人工登录 1688 买家账号');
        try {
          await sendNotification({
            type: 'exception.login',
            title: '1688 登录状态失效',
            body: '理赔扫描发现 1688 登录已失效，请重新登录后恢复任务。',
            dedupeKey: 'login-expired',
            forceDesktop: true,
          });
        } catch {
          // 通知失败不影响业务
        }
        keepTab = true;
        return [];
      }
      if (value.risk === 'baxia') {
        await log.warn('真实理赔扫描：检测到可见的风控/验证码界面，需人工处理（标签页已保留）');
        try {
          await sendNotification({
            type: 'exception.risk',
            title: '1688 风控/验证码',
            body: '理赔扫描检测到可见的验证/拦截界面，请人工处理（标签页已保留）。',
            dedupeKey: 'risk-visible',
            forceDesktop: true,
          });
        } catch {
          // 通知失败不影响业务
        }
        keepTab = true;
        return [];
      }
      if (!value.ok) {
        await log.warn('真实理赔扫描：采集失败', value.error ?? '未知错误');
        return [];
      }
      const orders = mapCollectedOrders(value.orders ?? []);
      if (orders.length === 0) {
        await log.info('真实理赔扫描：揽收超时列表为空或未解析到订单', value.countText ? { countText: value.countText } : undefined);
        return [];
      }
      await log.info('真实理赔扫描：发现揽收超时订单', {
        count: orders.length,
        orderIds: orders.map((o) => o.orderId).join(','),
        claimingInProgress: orders.filter((o) => o.claimingInProgress).length,
      });
      return orders;
    } finally {
      if (!keepTab) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          // 标签可能已被用户关闭
        }
      }
    }
  }
}

export const createOrderSource = (mode: 'simulation' | 'live'): OrderSource =>
  mode === 'live' ? new LiveOrderSource() : new SimulationOrderSource();
