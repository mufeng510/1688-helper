// 共享类型定义（SW / admin 页 / inject 脚本共用）

// ---------- SKU 监控 ----------

export type SkuProductStatus = 'active' | 'paused';

export interface SkuProduct {
  id: string;
  offerId: string;
  url: string;
  title: string;
  image?: string;
  company?: string;
  status: SkuProductStatus;
  /** 是否由连续失败自动暂停（用户手动暂停为 false） */
  autoPaused: boolean;
  pauseReason?: string;
  baselineEstablished: boolean;
  consecutiveFailures: number;
  lastError?: string;
  lastScanAt?: number;
  lastSuccessAt?: number;
  createdAt: number;
  updatedAt: number;
  /** 通知规则覆盖：不填=跟随全局；填了的字段覆盖全局（进入自定义时会快照全局当前值，见 notifyRules.ts） */
  skuNotify?: Partial<SkuNotifySettings>;
}

export interface SkuNotifySettings {
  added: boolean;
  removed: boolean;
  stockOut: boolean;
  stockRestored: boolean;
  lowStock: boolean;
  /** 低库存预警阈值（件）：从 > 阈值 跌破到 ≤ 阈值 时通知一次 */
  lowStockThreshold: number;
  stockIncreased: boolean;
  stockDecreased: boolean;
  specChanged: boolean;
  priceChanged: boolean;
}

export const DEFAULT_SKU_NOTIFY: SkuNotifySettings = {
  added: true,
  removed: true,
  stockOut: true,
  stockRestored: true,
  lowStock: true,
  lowStockThreshold: 5,
  stockIncreased: false,
  stockDecreased: false,
  specChanged: false,
  priceChanged: false,
};

export interface SkuEntry {
  skuId?: string;
  specId?: string;
  /** 归一化后的规格属性串（如 "颜色=强磁塑胶黑色"） */
  specAttrs: string;
  /** 商品规格维度名（如 颜色 / 颜色,尺码） */
  propNames?: string[];
  /** 展示名称（销售属性名拼接） */
  name: string;
  price?: number;
  /** 库存（件）；null 表示缺失 */
  stock: number | null;
  inStock: boolean;
}

export interface SkuSnapshot {
  id: string;
  productId: string;
  offerId: string;
  scannedAt: number;
  /** 是否有效（完整）快照；无效快照保存用于审计但不参与比较 */
  valid: boolean;
  skus: SkuEntry[];
  error?: string;
}

export type SkuChangeType =
  | 'SKU_ADDED'
  | 'SKU_REMOVED'
  | 'SPEC_CHANGED'
  | 'STOCK_INCREASED'
  | 'STOCK_DECREASED'
  | 'STOCK_OUT'
  | 'STOCK_RESTORED'
  | 'STOCK_LOW'
  | 'PRICE_CHANGED';

export interface SkuChange {
  id: string;
  productId: string;
  offerId: string;
  productTitle: string;
  skuKey: string;
  skuName: string;
  type: SkuChangeType;
  before?: Partial<SkuEntry>;
  after?: Partial<SkuEntry>;
  detectedAt: number;
}

export interface InjectedSkuScanResult {
  ok: boolean;
  /** 风控/验证码/登录失效等页面级问题 */
  risk?: 'baxia' | 'login' | 'punish' | 'empty';
  /** 商品 offerId（从 URL 提取） */
  offerId?: string;
  url?: string;
  title?: string;
  image?: string;
  priceRangeText?: string;
  soldText?: string;
  /** 内联 skuModel 所在脚本文本（优先数据源） */
  scriptText?: string;
  model?: {
    props: Array<{ fid?: number; prop: string; values: Array<{ name: string; imageUrl?: string }> }>;
    skuMap: Record<string, InjectedSkuMapEntry>;
  };
  error?: string;
}

export interface InjectedSkuMapEntry {
  specId?: string;
  skuId?: string | number;
  specAttrs?: string;
  price?: string | number;
  canBookCount?: string | number;
  discountPrice?: string | number;
  isPromotionSku?: boolean;
}

export interface ScanOutcome {
  productId: string;
  valid: boolean;
  snapshot?: SkuSnapshot;
  changes: SkuChange[];
  error?: string;
  risk?: 'baxia' | 'login' | 'punish' | 'empty';
  baselineJustEstablished?: boolean;
  autoPaused?: boolean;
}

// ---------- 理赔 ----------

export type ClaimApplyStatus =
  | 'pending_apply'      // 待申请
  | 'applying'           // 申请中
  | 'submitted'          // 已提交申请（平台是否受理未知/处理中）
  | 'failed'             // 申请失败（可重试）
  | 'needs_human'        // 需要人工处理
  | 'completed'          // 已完成终结（含平台拒绝后人工结论）
  | 'rejected';          // 理赔资格不满足（终态，不再重试）

export type ClaimResultStatus = 'unknown' | 'accepted' | 'processing' | 'rejected' | 'paid' | 'closed';

export interface ClaimOrder {
  id: string;
  orderId: string;
  goodsName?: string;
  goodsInfo?: string;
  seller?: string;
  orderAmount?: number;
  expectedClaimAmount?: number;
  discoveredAt: number;
  firstApplyAt?: number;
  lastApplyAt?: number;
  applyStatus: ClaimApplyStatus;
  resultStatus: ClaimResultStatus;
  retryCount: number;
  lastError?: string;
  batchId?: string;
  mode: 'simulation' | 'live';
  updatedAt: number;
}

export interface ClaimBatch {
  id: string;
  startedAt: number;
  finishedAt?: number;
  discovered: number;
  submitted: number;
  failed: number;
  needsHuman: number;
  mode: 'simulation' | 'live';
}

export type ClaimApplyResult =
  | { kind: 'submitted' }
  | { kind: 'retryable_error'; reason: string }
  | { kind: 'not_eligible'; reason: string }
  | { kind: 'needs_human'; reason: string; keepTab?: boolean }
  | { kind: 'unknown'; reason: string };

// ---------- 任务队列 ----------

export type TaskType = 'sku.scan' | 'claim.scan' | 'claim.apply' | 'notify.retry';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'needs_human' | 'cancelled';

export interface Task {
  id: string;
  type: TaskType;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  lockedUntil?: number;
  lockedBy?: string;
  lastError?: string;
  /** 去重键；同 pending 任务不重复入队 */
  dedupeKey?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- 日志 ----------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  module: string;
  message: string;
  detail?: string;
}

// ---------- 通知 ----------

export type NotifyChannel = 'desktop' | 'webhook';
export type NotifyStatus = 'sent' | 'failed' | 'skipped';

export interface NotificationLog {
  id: string;
  ts: number;
  channel: NotifyChannel;
  type: string;
  title: string;
  body: string;
  status: NotifyStatus;
  error?: string;
  dedupeKey?: string;
}

// ---------- 设置 ----------

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  method: 'GET' | 'POST';
  /** 请求头（键值对，一行一个 "Key: Value"） */
  headers: string;
  /** body 模板；支持 {{title}} {{body}} {{text}} 占位符；为空则发送 {{text}} 纯文本 */
  bodyTemplate: string;
}

export interface AppSettings {
  schemaVersion: number;
  skuScanIntervalMinutes: number;
  claimScanIntervalMinutes: number;
  claimScanEnabled: boolean;
  claimMode: 'simulation' | 'live';
  webhook: WebhookConfig;
  desktopNotify: {
    enabled: boolean;
    skuChanges: boolean;
    claimBatch: boolean;
    exceptions: boolean;
  };
  /** SKU 通知规则：桌面+Webhook 共用；历史变化记录不受此影响 */
  skuNotify: SkuNotifySettings;
  logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  skuScanIntervalMinutes: 60,
  claimScanIntervalMinutes: 30,
  claimScanEnabled: true,
  claimMode: 'simulation',
  webhook: { enabled: false, url: '', method: 'POST', headers: '', bodyTemplate: '' },
  desktopNotify: { enabled: true, skuChanges: true, claimBatch: true, exceptions: true },
  skuNotify: { ...DEFAULT_SKU_NOTIFY },
  logLevel: 'info',
};

// ---------- 消息协议 ----------

export type MessageRequest =
  | { type: 'overview.checkLogin' }
  | { type: 'sku.scanNow'; productId: string }
  | { type: 'claim.scanNow' }
  | { type: 'tasks.runNow'; taskId: string }
  | { type: 'tasks.process' }
  | { type: 'settings.get' }
  | { type: 'settings.set'; patch: Partial<AppSettings> }
  | { type: 'settings.testWebhook' }
  | { type: 'import1688.preview' }
  | {
      type: 'import1688.execute';
      request: {
        offer_id: string;
        name: string;
        blocks: Array<{ title: string; content: string }>;
        images: Array<{ url: string; remark: string }>;
      };
    }
  | { type: 'import1688.testConnection'; baseUrl?: string }
  | { type: 'import1688.openProduct'; id: number }
  | { type: 'import1688.openSettings' }
  | { type: 'import1688.openDoc' };

export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  /** code：HTTP 状态码（如 401/403），用于引导用户去设置页；缺省为非 HTTP 错误 */
  | { ok: false; error: string; code?: number };
