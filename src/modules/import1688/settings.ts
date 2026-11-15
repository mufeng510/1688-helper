// 1688 导入：工作台连接配置（独立 storage key，不进 AppSettings schema，避免影响既有设置迁移）
import { chromeStorageGet, chromeStorageSet } from '@/common/storage';
import { DEFAULT_BASE_URL, normalizeBaseUrl } from './payload';
import type { Import1688Settings } from './types';

const KEY = 'import1688';

export const getImport1688Settings = async (): Promise<Import1688Settings> => {
  const raw = await chromeStorageGet<Partial<Import1688Settings>>(KEY);
  const baseUrl = (raw?.baseUrl ?? '').trim() || DEFAULT_BASE_URL;
  const settings: Import1688Settings = { baseUrl };
  if (typeof raw?.token === 'string' && raw.token.trim()) {
    settings.token = raw.token;
  }
  return settings;
};

/** 保存 Base URL（归一化，非法抛错）；token 传入 undefined 表示不改动，传入 '' 表示清除 */
export const setImport1688Settings = async (patch: { baseUrl?: string; token?: string }): Promise<Import1688Settings> => {
  const current = await getImport1688Settings();
  const next: Import1688Settings = { ...current };
  if (patch.baseUrl !== undefined) {
    next.baseUrl = normalizeBaseUrl(patch.baseUrl);
  }
  if (patch.token !== undefined) {
    const t = patch.token.trim();
    if (t) next.token = t;
    else delete next.token;
  }
  await chromeStorageSet(KEY, next);
  return next;
};

export const clearImport1688Token = async (): Promise<void> => {
  const current = await getImport1688Settings();
  delete current.token;
  await chromeStorageSet(KEY, current);
};
