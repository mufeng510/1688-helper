// Vitest 环境准备：fake-indexeddb + 最小 chrome API 桩
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

const storageData = new Map<string, unknown>();

const chromeStub = {
  storage: {
    local: {
      get: async (key: string | string[] | Record<string, unknown> | null) => {
        if (key === null || key === undefined) return Object.fromEntries(storageData);
        if (typeof key === 'string') return storageData.has(key) ? { [key]: storageData.get(key) } : {};
        if (Array.isArray(key)) {
          const out: Record<string, unknown> = {};
          for (const k of key) if (storageData.has(k)) out[k] = storageData.get(k);
          return out;
        }
        const out: Record<string, unknown> = {};
        for (const [k, def] of Object.entries(key)) out[k] = storageData.has(k) ? storageData.get(k) : def;
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageData.set(k, v);
      },
      remove: async (key: string) => { storageData.delete(key); },
      clear: async () => { storageData.clear(); },
    },
  },
  notifications: {
    create: vi.fn(async () => 'notif-id'),
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: '0.1.0' }),
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  },
  alarms: {
    get: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    onAlarm: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(async () => ({ id: 1 } as chrome.tabs.Tab)),
    get: vi.fn(async () => ({ id: 1 } as chrome.tabs.Tab)),
    remove: vi.fn(async () => undefined),
    query: vi.fn(async () => []),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn(async () => [{ result: undefined }]),
  },
  action: {
    onClicked: { addListener: vi.fn() },
  },
  permissions: {
    request: vi.fn(async () => true),
  },
};

(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;

(globalThis as { __clearChromeStorage?: () => void }).__clearChromeStorage = () => storageData.clear();
