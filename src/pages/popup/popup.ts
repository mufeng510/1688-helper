// Popup：识别当前 1688 商品详情页，展示基本信息，一键加入监控。
import { parseOfferUrl, addSkuProduct } from '@/modules/sku/products';

const main = document.getElementById('main')!;
const openAdmin = document.getElementById('openAdmin')!;

openAdmin.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('pages/manage/manage.html') });
  window.close();
});

const reader = (): { title: string; image?: string } => {
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined;
  const title = (document.title || '').replace(/\s*-\s*阿里巴巴\s*$/, '').trim();
  return { title, image: ogImage };
};

const render = (html: string) => { main.innerHTML = html; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// 按需注入：popup「📥 导入 1688」按钮点击时注入一次（不跟随页面加载自动注入，也不声明 content_scripts）；
// 脚本由 popup 注入后经 runtime message 触发预览确认卡；脚本自身有防重入 guard。
const injectImport = async (tabId: number): Promise<boolean> => {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['pages/inject/import-1688.js'] });
    return true;
  } catch {
    return false;
  }
};

const init = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const parsed = url ? parseOfferUrl(url) : null;
  if (!tab?.id || !parsed) {
    render(`<p class="hint">当前不是 1688 商品详情页。</p>
      <p class="hint">在商品详情页（detail.1688.com/offer/xxx.html）点击本扩展图标，即可一键添加监控。</p>`);
    return;
  }
  render(`<div class="card"><div class="hint">正在读取商品信息…</div></div>`);
  let info: { title: string; image?: string } = { title: parsed.offerId };
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: reader });
    const r = results[0]?.result;
    if (r) info = { title: r.title || parsed.offerId, image: r.image };
  } catch {
    /* 注入失败时仅用 offerId */
  }
  render(`
    <div class="card">
      ${info.image ? `<img class="card__img" src="${esc(info.image)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div class="card__title">${esc(info.title)}</div>
      <div class="card__meta">商品 ID：${esc(parsed.offerId)}</div>
      <button id="addBtn" class="btn">添加监控</button>
      <button id="importBtn" class="btn btn--ghost">📥 导入 1688</button>
      <div id="status"></div>
    </div>`);
  const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
  const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
  const status = document.getElementById('status')!;
  addBtn.addEventListener('click', () => {
    addBtn.disabled = true;
    void (async () => {
      try {
        const { product, created } = await addSkuProduct({ offerId: parsed.offerId, url: parsed.url, title: info.title, image: info.image });
        if (created) {
          await chrome.runtime.sendMessage({ type: 'sku.scanNow', productId: product.id });
        }
        status.textContent = created ? '已添加！首次扫描建立基准快照（不发通知），第二次扫描起比较变化。' : '该商品已在监控列表中，未重复添加。';
        status.className = 'status status--ok';
      } catch (err) {
        status.textContent = `添加失败：${err instanceof Error ? err.message : String(err)}`;
        status.className = 'status status--err';
        addBtn.disabled = false;
      }
    })();
  });

  importBtn.addEventListener('click', () => {
    importBtn.disabled = true;
    void (async () => {
      const injected = await injectImport(tab.id!);
      if (!injected) {
        importBtn.disabled = false;
        status.textContent = '无法注入导入脚本：请刷新页面后重试。';
        status.className = 'status status--err';
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id!, { type: 'import1688.openFromPopup' });
        // 已打开导入确认卡，popup 关闭把注意力还给页面
        window.close();
      } catch {
        importBtn.disabled = false;
        status.textContent = '无法触发导入界面：扩展重载后旧页面中的脚本已失效，请刷新页面后重试。';
        status.className = 'status status--err';
      }
    })();
  });
};

void init();
