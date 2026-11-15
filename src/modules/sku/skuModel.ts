// 1688 商品详情页内联 JSON 模型解析（纯函数，可单测）。
// 背景：detail.1688.com 把 `window.context=(function...` 内联 JS 写进 <script>，
// 其中 result.data.skuModel = { skuProps, skuInfoMap }。该脚本在真实页面被 CSP 拦截，
// 但其文本仍存在于 DOM 中，因此直接从原始文本切分解析最稳。

export interface RawSkuProp {
  fid?: number;
  prop: string;
  value: Array<{ name: string; imageUrl?: string }>;
}

export interface RawSkuInfoEntry {
  specId?: string;
  skuId?: string | number;
  specAttrs?: string;
  price?: string | number;
  discountPrice?: string | number;
  canBookCount?: string | number;
  isPromotionSku?: boolean;
}

export interface ParsedSkuModel {
  props: RawSkuProp[];
  /** 键为 specAttrs（单维度为值名；多维度通常为逗号连接） */
  skuMap: Record<string, RawSkuInfoEntry>;
}

/** 从一段文本中截取以 start 开始、大括号平衡且忽略字符串内括号的最外层对象 */
const extractBalancedObject = (text: string, start: number): string | null => {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/** 从内联脚本文本解析 skuModel；失败返回 null */
export const parseSkuModelFromScript = (scriptText: string): ParsedSkuModel | null => {
  const marker = '"skuModel":';
  const markerIdx = scriptText.indexOf(marker);
  if (markerIdx < 0) return null;
  const objStart = scriptText.indexOf('{', markerIdx + marker.length);
  if (objStart < 0) return null;
  const raw = extractBalancedObject(scriptText, objStart);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { skuProps?: RawSkuProp[]; skuInfoMap?: Record<string, RawSkuInfoEntry> };
    if (!Array.isArray(parsed.skuProps) || typeof parsed.skuInfoMap !== 'object' || parsed.skuInfoMap === null) {
      return null;
    }
    return { props: parsed.skuProps, skuMap: parsed.skuInfoMap };
  } catch {
    return null;
  }
};

export interface NormalizedSku {
  skuId?: string;
  specId?: string;
  specAttrs: string;
  propNames: string[];
  name: string;
  price?: number;
  stock: number | null;
  inStock: boolean;
}

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

const splitSpecAttrs = (attrs: string, propCount: number): string[] => {
  // 常见分隔符：中文逗号 / 英文逗号 / 顿号 / 分号 / 竖线
  for (const sep of [',', '，', '、', ';', '；', '|']) {
    const parts = attrs.split(sep).map((s) => s.trim()).filter(Boolean);
    if (parts.length === Math.max(1, propCount)) return parts;
  }
  return [attrs.trim()];
};

/**
 * 归一化为统一 SKU 条目。
 * - 库存取 canBookCount；缺失/非法 → stock=null（由上层判为不完整快照）
 * - 名称为各维度值拼接
 */
export const normalizeSkuModel = (model: ParsedSkuModel): NormalizedSku[] => {
  const propNames = model.props.map((p) => p.prop);
  const result: NormalizedSku[] = [];
  for (const [attrsKey, entry] of Object.entries(model.skuMap)) {
    const attrs = (entry.specAttrs ?? attrsKey).trim();
    const valueParts = splitSpecAttrs(attrs, propNames.length);
    const stock = toNumber(entry.canBookCount);
    const price = toNumber(entry.discountPrice ?? entry.price);
    const skuId = entry.skuId === undefined ? undefined : String(entry.skuId);
    result.push({
      skuId,
      specId: entry.specId,
      specAttrs: attrs,
      propNames,
      name: valueParts.join(' / '),
      price,
      stock: stock === undefined ? null : Math.max(0, Math.floor(stock)),
      inStock: stock !== undefined ? stock > 0 : false,
    });
  }
  return result;
};
