// 统一日志：落 IndexedDB；敏感信息（Cookie/Token/Webhook 密钥）绝不写入；
// 对疑似敏感的键/值做脱敏。
import { logsPut } from './db';
import { newId } from './id';
import type { LogLevel } from './types';
import { chromeStorageGet } from './storage';

const SENSITIVE_KEY_RE = /(cookie|token|secret|authorization|api[-_]?key|password|sign)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+\S+|cookie=\S+|[A-Za-z0-9_-]{32,})/g;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const sanitize = (input: unknown): string => {
  if (input === null || input === undefined) return '';
  let text = typeof input === 'string' ? input : safeStringify(input);
  text = text.replace(SENSITIVE_VALUE_RE, '[REDACTED]');
  return text;
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, (key, v) => {
      if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
      return v;
    });
  } catch {
    return String(value);
  }
};

const currentLevel = async (): Promise<LogLevel> => {
  try {
    const settings = await chromeStorageGet<{ logLevel?: LogLevel }>('settings');
    return settings?.logLevel ?? 'info';
  } catch {
    return 'info';
  }
};

export const log = async (level: LogLevel, module: string, message: string, detail?: unknown): Promise<void> => {
  const threshold = await currentLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  try {
    await logsPut({
      id: newId('log'),
      ts: Date.now(),
      level,
      module,
      message: sanitize(message),
      detail: detail === undefined ? undefined : sanitize(detail),
    });
  } catch (err) {
    // 日志系统自身失败不应影响业务
    console.error('[1688helper] 日志写入失败', err);
  }
};

export const logger = (module: string) => ({
  debug: (msg: string, detail?: unknown) => log('debug', module, msg, detail),
  info: (msg: string, detail?: unknown) => log('info', module, msg, detail),
  warn: (msg: string, detail?: unknown) => log('warn', module, msg, detail),
  error: (msg: string, detail?: unknown) => log('error', module, msg, detail),
});
