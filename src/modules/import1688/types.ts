// 1688 → 工作台导入：类型定义（与工作台 docs/api-reference.md 的 API 契约对齐）

export interface Import1688Price {
  display?: string;
  min_price?: string;
  max_price?: string;
  tiers?: Array<{ begin: number; price: string }>;
  min_order?: number;
  booked_amount?: number;
}

export interface Import1688Attribute {
  name: string;
  value: string;
}

export interface Import1688Shop {
  company?: string;
  is_factory?: boolean;
  service_score?: string;
  repeat_rate?: string;
  good_rate?: number;
  location?: string;
  logistics?: string;
}

export interface Import1688Sales {
  saled_count?: number;
  pay_30d?: string;
  uv_7d?: number;
}

export interface Import1688Sku {
  props?: Array<{ prop: string; values: string[] }>;
  combo_count?: number;
}

/** POST ingest 成功返回的预览 JSON（字段均可能缺省，UI 需容错） */
export interface Import1688Preview {
  offer_id: string;
  url?: string;
  name: string;
  price?: Import1688Price;
  attributes?: Import1688Attribute[];
  sku?: Import1688Sku;
  shop?: Import1688Shop;
  sales?: Import1688Sales;
  main_images?: string[];
  detail_images?: string[];
  detail_text?: string;
  blocks?: Array<{ title: string; content: string }>;
  warnings?: string[];
  fetched_at?: string;
}

/** 扩展本地保存的工作台连接配置（chrome.storage.local，key: 'import1688'） */
export interface Import1688Settings {
  baseUrl: string;
  /** manage 权限 API Token；不存在则为空 */
  token?: string;
}

export interface ExecuteBlock {
  title: string;
  content: string;
}

export interface ExecuteImage {
  url: string;
  remark: string;
}

export type ExecuteMode = 'create' | 'update';

export interface ExecuteRequest {
  offer_id: string;
  name: string;
  blocks: ExecuteBlock[];
  images: ExecuteImage[];
  /**
   * 导入意图（扩展侧总是显式发送）：
   * - create（默认）：新建商品；工作台已存在同 offer_id 时应 409（除非 allow_duplicate=true）。
   * - update：工作台已存在同 offer_id 时更新该商品；不存在则创建（upsert）。
   */
  mode?: ExecuteMode;
  /** 用户明确选择「仍然新建」时为 true：工作台应跳过重复检查，直接新建。仅 create 时有意义。 */
  allow_duplicate?: boolean;
}

export interface ExecuteResponse {
  id: number;
  name: string;
  block_count: number;
  image_count: number;
  /** 工作台实际执行的动作：新建或更新（旧版工作台可能缺省） */
  action?: 'created' | 'updated';
}

/** 工作台中同 offer_id 的既有商品摘要（by-offer 检查结果） */
export interface Import1688ExistingProduct {
  id: number;
  name?: string;
  updated_at?: string;
  created_at?: string;
  block_count?: number;
  image_count?: number;
}

/** GET /api/products/import/1688/by-offer/{offer_id}（manage 鉴权）的响应 */
export interface ByOfferResult {
  exists: boolean;
  product?: Import1688ExistingProduct;
}
