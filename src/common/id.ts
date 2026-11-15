// 简短唯一 ID：时间戳前缀 + 随机部分，可排序、便于人工识别
const rand = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
};

export const newId = (prefix = ''): string => {
  const ts = Date.now().toString(36);
  return prefix ? `${prefix}_${ts}${rand()}` : `${ts}${rand()}`;
};

export const sha1Hex = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
