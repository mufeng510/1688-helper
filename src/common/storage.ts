// chrome.storage.local 的类型安全封装（用于设置等少量配置）
export const chromeStorageGet = async <T>(key: string): Promise<T | undefined> => {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
};

export const chromeStorageSet = async (key: string, value: unknown): Promise<void> => {
  await chrome.storage.local.set({ [key]: value });
};
