// 配置管理：chrome.storage.local 持久化；带默认值与 schema 迁移分支。
import { chromeStorageGet, chromeStorageSet } from './storage';
import { DEFAULT_SETTINGS, type AppSettings, type LogLevel } from './types';

const KEY = 'settings';

export const SETTINGS_SCHEMA_VERSION = 3;

const migrate = (raw: Partial<AppSettings> | undefined): AppSettings => {
  // v2 → v3：库存增加/减少类型已从变化模型中删除，清掉存量设置里的死键
  const skuNotify = { ...(raw?.skuNotify ?? {}) } as Record<string, unknown>;
  delete skuNotify.stockIncreased;
  delete skuNotify.stockDecreased;
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    webhook: { ...DEFAULT_SETTINGS.webhook, ...(raw?.webhook ?? {}) },
    desktopNotify: { ...DEFAULT_SETTINGS.desktopNotify, ...(raw?.desktopNotify ?? {}) },
    skuNotify: { ...DEFAULT_SETTINGS.skuNotify, ...(skuNotify as Partial<AppSettings['skuNotify']>) },
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };
  // 未来 schema 升级写在这里：if (raw?.schemaVersion === 3) { ... }
  return merged;
};

export const getSettings = async (): Promise<AppSettings> => {
  const raw = await chromeStorageGet<Partial<AppSettings>>(KEY);
  const migrated = migrate(raw);
  if (raw && raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    await chromeStorageSet(KEY, migrated);
  }
  return migrated;
};

export const setSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    webhook: { ...current.webhook, ...(patch.webhook ?? {}) },
    desktopNotify: { ...current.desktopNotify, ...(patch.desktopNotify ?? {}) },
    skuNotify: { ...current.skuNotify, ...(patch.skuNotify ?? {}) },
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };
  await chromeStorageSet(KEY, next);
  return next;
};

export const setLogLevel = async (level: LogLevel): Promise<void> => {
  await setSettings({ logLevel: level });
};
