// IndexedDB 数据访问层（基于 idb）。所有业务数据集中在此管理，版本迁移在此分支。
import { openDB, type IDBPDatabase } from 'idb';
import type {
  SkuProduct, SkuSnapshot, SkuChange, ClaimOrder, ClaimBatch,
  Task, LogEntry, NotificationLog,
} from './types';

export const DB_NAME = 'h1688helper';
export const DB_VERSION = 1;

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface BackupFile {
  app: '1688-helper';
  version: number;
  exportedAt: number;
  settings?: unknown;
  stores: Record<string, unknown[]>;
}

const upgrade = (db: IDBPDatabase) => {
  // v1：初始结构
  const mk = (name: string, keyPath: string, indexes: Array<[string, string | string[], IDBIndexParameters?]> = []) => {
    if (!db.objectStoreNames.contains(name)) {
      const store = db.createObjectStore(name, { keyPath });
      for (const [idx, key, opts] of indexes) store.createIndex(idx, key, opts);
    }
  };
  mk('meta', 'key');
  mk('skuProducts', 'id', [['offerId', 'offerId', { unique: true }], ['status', 'status']]);
  mk('skuSnapshots', 'id', [['productId', 'productId'], ['productId_scannedAt', ['productId', 'scannedAt']]]);
  mk('skuChanges', 'id', [['productId', 'productId'], ['detectedAt', 'detectedAt']]);
  mk('claimOrders', 'id', [['orderId', 'orderId', { unique: true }], ['applyStatus', 'applyStatus'], ['discoveredAt', 'discoveredAt']]);
  mk('claimBatches', 'id', [['startedAt', 'startedAt']]);
  mk('tasks', 'id', [['status', 'status'], ['dedupeKey', 'dedupeKey'], ['runAfter', 'runAfter']]);
  mk('logs', 'id', [['ts', 'ts'], ['level', 'level'], ['module', 'module']]);
  mk('notificationLog', 'id', [['ts', 'ts'], ['dedupeKey', 'dedupeKey']]);
  mk('notifiedChanges', 'key');
};

let dbPromise: Promise<IDBPDatabase> | null = null;

export const getDB = (): Promise<IDBPDatabase> => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        upgrade(db);
      },
    });
  }
  return dbPromise;
};

/** 测试用：重置连接 */
export const resetDBForTests = (): void => {
  dbPromise = null;
};

// ---------- meta ----------
export const metaGet = async <T>(key: string): Promise<T | undefined> => {
  const db = await getDB();
  const row = (await db.get('meta', key)) as MetaEntry | undefined;
  return row?.value as T | undefined;
};
export const metaSet = async (key: string, value: unknown): Promise<void> => {
  const db = await getDB();
  await db.put('meta', { key, value } satisfies MetaEntry);
};

// ---------- skuProducts ----------
export const skuProductsPut = async (p: SkuProduct): Promise<void> => {
  const db = await getDB();
  await db.put('skuProducts', p);
};
export const skuProductsGet = async (id: string): Promise<SkuProduct | undefined> => {
  const db = await getDB();
  return db.get('skuProducts', id) as Promise<SkuProduct | undefined>;
};
export const skuProductsGetByOfferId = async (offerId: string): Promise<SkuProduct | undefined> => {
  const db = await getDB();
  return db.getFromIndex('skuProducts', 'offerId', offerId) as Promise<SkuProduct | undefined>;
};
export const skuProductsList = async (): Promise<SkuProduct[]> => {
  const db = await getDB();
  return db.getAll('skuProducts') as Promise<SkuProduct[]>;
};
export const skuProductsDelete = async (id: string): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(['skuProducts', 'skuSnapshots', 'skuChanges'], 'readwrite');
  await tx.objectStore('skuProducts').delete(id);
  for (const snap of await tx.objectStore('skuSnapshots').index('productId').getAllKeys(id)) {
    await tx.objectStore('skuSnapshots').delete(snap);
  }
  for (const ch of await tx.objectStore('skuChanges').index('productId').getAllKeys(id)) {
    await tx.objectStore('skuChanges').delete(ch);
  }
  await tx.done;
};

// ---------- skuSnapshots ----------
export const skuSnapshotPut = async (s: SkuSnapshot): Promise<void> => {
  const db = await getDB();
  await db.put('skuSnapshots', s);
};
export const skuSnapshotLatestValid = async (productId: string): Promise<SkuSnapshot | undefined> => {
  const db = await getDB();
  const idx = db.transaction('skuSnapshots').store.index('productId_scannedAt');
  let cursor = await idx.openCursor(IDBKeyRange.bound([productId, 0], [productId, Date.now() + 86400e3]), 'prev');
  while (cursor) {
    const snap = cursor.value as SkuSnapshot;
    if (snap.valid) return snap;
    cursor = await cursor.continue();
  }
  return undefined;
};
export const skuSnapshotList = async (productId: string): Promise<SkuSnapshot[]> => {
  const db = await getDB();
  const all = (await db.getAllFromIndex('skuSnapshots', 'productId', productId)) as SkuSnapshot[];
  return all.sort((a, b) => b.scannedAt - a.scannedAt);
};

// ---------- skuChanges ----------
export const skuChangesPutMany = async (changes: SkuChange[]): Promise<void> => {
  if (changes.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('skuChanges', 'readwrite');
  for (const c of changes) await tx.objectStore('skuChanges').put(c);
  await tx.done;
};
export const skuChangesList = async (productId: string, limit = 200): Promise<SkuChange[]> => {
  const db = await getDB();
  const all = (await db.getAllFromIndex('skuChanges', 'productId', productId)) as SkuChange[];
  return all.sort((a, b) => b.detectedAt - a.detectedAt).slice(0, limit);
};
export const skuChangesListRecent = async (since: number): Promise<SkuChange[]> => {
  const db = await getDB();
  const all = (await db.getAllFromIndex('skuChanges', 'detectedAt', IDBKeyRange.lowerBound(since))) as SkuChange[];
  return all;
};

// ---------- claimOrders ----------
export const claimOrdersPut = async (o: ClaimOrder): Promise<void> => {
  const db = await getDB();
  await db.put('claimOrders', o);
};
export const claimOrdersGetByOrderId = async (orderId: string): Promise<ClaimOrder | undefined> => {
  const db = await getDB();
  return db.getFromIndex('claimOrders', 'orderId', orderId) as Promise<ClaimOrder | undefined>;
};
export const claimOrdersList = async (): Promise<ClaimOrder[]> => {
  const db = await getDB();
  return db.getAll('claimOrders') as Promise<ClaimOrder[]>;
};
export const claimBatchesPut = async (b: ClaimBatch): Promise<void> => {
  const db = await getDB();
  await db.put('claimBatches', b);
};
export const claimBatchesList = async (limit = 20): Promise<ClaimBatch[]> => {
  const db = await getDB();
  const all = (await db.getAll('claimBatches')) as ClaimBatch[];
  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
};

// ---------- tasks ----------
export const tasksPut = async (t: Task): Promise<void> => {
  const db = await getDB();
  await db.put('tasks', t);
};
export const tasksGet = async (id: string): Promise<Task | undefined> => {
  const db = await getDB();
  return db.get('tasks', id) as Promise<Task | undefined>;
};
export const tasksList = async (): Promise<Task[]> => {
  const db = await getDB();
  return db.getAll('tasks') as Promise<Task[]>;
};
export const tasksListByStatus = async (status: Task['status']): Promise<Task[]> => {
  const db = await getDB();
  return db.getAllFromIndex('tasks', 'status', status) as Promise<Task[]>;
};
export const tasksFindPendingByDedupeKey = async (dedupeKey: string): Promise<Task[]> => {
  const db = await getDB();
  const all = (await db.getAllFromIndex('tasks', 'dedupeKey', dedupeKey)) as Task[];
  return all.filter((t) => t.status === 'pending' || t.status === 'running');
};
export const tasksDelete = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete('tasks', id);
};

// ---------- logs ----------
export const logsPut = async (entry: LogEntry): Promise<void> => {
  const db = await getDB();
  await db.put('logs', entry);
};

// ---------- notificationLog / notifiedChanges ----------
export const notificationLogPut = async (n: NotificationLog): Promise<void> => {
  const db = await getDB();
  await db.put('notificationLog', n);
};
export const notifiedChangeHas = async (key: string): Promise<boolean> => {
  const db = await getDB();
  return (await db.get('notifiedChanges', key)) !== undefined;
};
export const notifiedChangeMark = async (key: string): Promise<void> => {
  const db = await getDB();
  await db.put('notifiedChanges', { key, ts: Date.now() });
};

// ---------- 备份 / 恢复 ----------
export const EXPORTABLE_STORES = [
  'skuProducts', 'skuSnapshots', 'skuChanges', 'claimOrders', 'claimBatches',
  'tasks', 'logs', 'notificationLog', 'notifiedChanges',
] as const;

export const exportBackup = async (settingsJson: unknown): Promise<BackupFile> => {
  const db = await getDB();
  const stores: Record<string, unknown[]> = {};
  for (const name of EXPORTABLE_STORES) {
    stores[name] = await db.getAll(name);
  }
  return { app: '1688-helper', version: DB_VERSION, exportedAt: Date.now(), settings: settingsJson, stores };
};

export const importBackup = async (backup: BackupFile, mode: 'replace' | 'merge'): Promise<{ imported: number }> => {
  if (backup.app !== '1688-helper') throw new Error('备份文件格式不正确（app 标记不匹配）');
  const db = await getDB();
  const names = EXPORTABLE_STORES.filter((n) => Array.isArray(backup.stores?.[n]));
  let imported = 0;
  const tx = db.transaction([...names, 'meta'], 'readwrite');
  for (const name of names) {
    const store = tx.objectStore(name);
    if (mode === 'replace') await store.clear();
    for (const row of backup.stores[name] as Array<Record<string, unknown>>) {
      await store.put(row as never);
      imported += 1;
    }
  }
  await tx.done;
  return { imported };
};

export const clearHistory = async (
  kinds: Array<'skuSnapshots' | 'skuChanges' | 'logs' | 'notificationLog'>,
  olderThanDays: number | 0,
): Promise<number> => {
  const db = await getDB();
  const cutoff = olderThanDays === 0 ? 0 : Date.now() - olderThanDays * 86400e3;
  let deleted = 0;
  for (const kind of kinds) {
    const tx = db.transaction(kind, 'readwrite');
    const store = tx.objectStore(kind);
    if (cutoff === 0) {
      deleted += await store.count();
      await store.clear();
    } else {
      if (kind === 'skuSnapshots') {
        for (const key of await store.getAllKeys()) {
          const row = (await store.get(key)) as SkuSnapshot;
          if (row.scannedAt < cutoff) { await store.delete(key); deleted += 1; }
        }
      } else if (kind === 'skuChanges') {
        for (const key of await store.getAllKeys()) {
          const row = (await store.get(key)) as SkuChange;
          if (row.detectedAt < cutoff) { await store.delete(key); deleted += 1; }
        }
      } else {
        // logs / notificationLog 有 ts 索引
        const index = store.index('ts');
        for (const key of await index.getAllKeys(IDBKeyRange.upperBound(cutoff))) {
          await store.delete(key);
          deleted += 1;
        }
      }
    }
    await tx.done;
  }
  return deleted;
};

export const estimateStorage = async (): Promise<{ usage: number; quota: number } | null> => {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return null;
};
