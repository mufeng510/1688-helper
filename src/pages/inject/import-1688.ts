// 1688 商品详情页注入脚本：「📥 导入工作台」悬浮按钮 + 预览确认卡片。
// 运行在隔离世界；所有 HTTP 请求走 background（runtime message），本脚本不直接调 API。
// 页面数据一律通过 textContent / DOM API 渲染，绝不拼接 innerHTML（防 XSS）。
// 只在 offer 详情页注入（manifest matches 已限定，此处再兜底校验一次）。
import { buildExecuteRequest, defaultCardState, normalizeImageUrl } from '@/modules/import1688/payload';
import type { CardState } from '@/modules/import1688/payload';
import type { Import1688Preview, ExecuteResponse, Import1688ExistingProduct } from '@/modules/import1688/types';

(() => {
  const HOST_ID = 'import1688-overlay-host';
  if (document.getElementById(HOST_ID)) return; // 防重复注入
  if (!/\/offer\/\d{6,15}\.html/.test(location.pathname)) return; // 兜底：非商品页不注入

  interface MsgResp<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    code?: number;
  }
  const send = <T>(msg: unknown): Promise<MsgResp<T>> => chrome.runtime.sendMessage(msg) as Promise<MsgResp<T>>;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  #fab {
    position: fixed; right: 20px; bottom: 120px; z-index: 2147483646;
    padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;
    background: #ff6a00; color: #fff; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 16px rgba(255, 106, 0, .45); transition: transform .15s, box-shadow .15s;
  }
  #fab:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255, 106, 0, .55); }
  #fab:disabled { background: #bbb; box-shadow: none; cursor: wait; }
  #overlay {
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(0, 0, 0, .45);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  #overlay[hidden] { display: none; }
  #card {
    width: min(720px, 96vw); max-height: 88vh; overflow-y: auto;
    background: #fff; border-radius: 12px; padding: 18px 20px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, .35); color: #1f2329; font-size: 13px;
  }
  #card h2 { margin: 0; font-size: 16px; display: flex; align-items: center; justify-content: space-between; }
  .close-btn { border: none; background: none; font-size: 18px; cursor: pointer; color: #888; padding: 4px 8px; }
  .close-btn:hover { color: #333; }
  .info-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px;
    background: #f7f8fa; border-radius: 8px; padding: 10px 12px; margin: 12px 0;
  }
  .info-grid .label { color: #888; font-size: 11px; }
  .info-grid .value { font-weight: 600; font-size: 12px; word-break: break-all; }
  .section-head { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 6px; }
  .section-head h3 { margin: 0; font-size: 13px; }
  .mini-btn { border: 1px solid #ddd; background: #fff; border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer; color: #555; }
  .mini-btn:hover { border-color: #ff6a00; color: #ff6a00; }
  .block-item { border: 1px solid #eceef1; border-radius: 8px; padding: 8px; margin-bottom: 8px; background: #fdfdfd; }
  .block-row { display: flex; align-items: center; gap: 8px; }
  .block-title { flex: 1; min-width: 0; border: 1px solid #e3e5e8; border-radius: 6px; padding: 5px 8px; font-size: 12px; }
  .block-del { border: none; background: none; color: #c00; cursor: pointer; font-size: 14px; padding: 2px 6px; }
  .block-content {
    width: 100%; margin-top: 6px; border: 1px solid #e3e5e8; border-radius: 6px;
    padding: 6px 8px; font-size: 12px; line-height: 1.5; resize: vertical;
    min-height: 2.5em; max-height: 12em; overflow-y: auto;
  }
  .img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .img-cell { position: relative; border: 1px solid #eceef1; border-radius: 8px; overflow: hidden; background: #f2f3f5; aspect-ratio: 1; cursor: pointer; }
  .img-cell img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .img-cell .ph { display: flex; height: 100%; align-items: center; justify-content: center; color: #aaa; font-size: 11px; text-align: center; padding: 4px; }
  .img-cell input[type=checkbox] { position: absolute; top: 6px; left: 6px; width: 16px; height: 16px; accent-color: #ff6a00; }
  .img-cell.checked { outline: 2px solid #ff6a00; }
  .warn-box { background: #fff8e6; border: 1px solid #ffe08a; color: #8a6d00; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 8px 0; }
  .mode-box { background: #eef4ff; border: 1px solid #a8c6fa; border-radius: 8px; padding: 10px 12px; font-size: 12px; margin: 8px 0; color: #17385e; }
  .mode-box[hidden] { display: none; }
  .mode-title { font-weight: 700; margin-bottom: 2px; }
  .mode-desc { color: #3d5a80; word-break: break-all; margin-bottom: 6px; }
  .mode-choice { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; border-radius: 6px; }
  .mode-choice:hover { background: #e2ecfc; }
  .mode-choice input { accent-color: #ff6a00; width: 15px; height: 15px; flex: none; }
  .mode-choice .mode-sub { color: #6b7280; font-size: 11px; }
  .mode-note { color: #6b7280; font-size: 11px; margin-top: 4px; word-break: break-all; }
  .err-box { background: #fff0ec; border: 1px solid #ffc4b2; color: #b3261e; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 10px 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .err-box button { border: 1px solid #b3261e; background: #fff; color: #b3261e; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .err-box[hidden] { display: none; }
  .footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; border-top: 1px solid #eceef1; padding-top: 12px; }
  .summary { color: #888; font-size: 11px; }
  .btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
  .btn:hover { border-color: #ff6a00; color: #ff6a00; }
  .btn--primary { background: #ff6a00; border-color: #ff6a00; color: #fff; font-weight: 600; }
  .btn--primary:hover { background: #e55f00; color: #fff; }
  .btn--primary:disabled, .btn:disabled { opacity: .55; cursor: not-allowed; }
  .name-input { width: 100%; border: 1px solid #e3e5e8; border-radius: 6px; padding: 7px 9px; font-size: 13px; margin-top: 4px; }
  #toast {
    position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
    background: rgba(30, 30, 30, .92); color: #fff; border-radius: 8px; padding: 10px 14px;
    font-size: 12px; max-width: min(480px, 92vw); display: flex; align-items: center; gap: 12px;
  }
  #toast[hidden] { display: none; }
  #toast button { border: none; background: #ff6a00; color: #fff; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; white-space: nowrap; }
  .field-label { color: #888; font-size: 11px; }
</style>
<button id="fab" title="把本商品导入到小红书多账号内容生产工作台">📥 导入工作台</button>
<div id="toast" hidden><span id="toastText"></span><button id="toastAction" hidden></button></div>
<div id="overlay" hidden>
  <div id="card" role="dialog" aria-label="导入工作台确认">
    <h2>导入到工作台 <button class="close-btn" id="closeBtn" title="关闭">✕</button></h2>

    <div id="warnBox" class="warn-box" hidden></div>

    <div id="modeBox" class="mode-box" hidden>
      <div class="mode-title" id="modeTitle">工作台已有该商品</div>
      <div class="mode-desc" id="modeDesc"></div>
      <div id="modeChoices">
        <label class="mode-choice" for="modeUpdate"><input type="radio" name="importMode" id="modeUpdate" value="update" checked />
          <span><strong>更新已有商品</strong>（推荐）<br /><span class="mode-sub">只刷新导入来源数据，不产生重复商品</span></span></label>
        <label class="mode-choice" for="modeCreate"><input type="radio" name="importMode" id="modeCreate" value="create" />
          <span><strong>仍然新建</strong><br /><span class="mode-sub">会产生重复商品（需工作台支持 allow_duplicate）</span></span></label>
      </div>
      <div class="mode-note" id="modeNote" hidden></div>
    </div>

    <label class="field-label" for="nameInput">商品名称（可编辑）</label>
    <input id="nameInput" class="name-input" maxlength="120" autocomplete="off" />

    <div class="info-grid" id="infoGrid"></div>

    <div class="section-head">
      <h3>资料区块 <span id="blockCount" class="summary"></span></h3>
      <span>
        <button class="mini-btn" id="blocksAll">全选</button>
        <button class="mini-btn" id="blocksNone">全不选</button>
        <button class="mini-btn" id="blocksReset">恢复默认</button>
      </span>
    </div>
    <div id="blocksBox"></div>

    <div class="section-head"><h3>主图<span id="mainCount" class="summary"></span>（默认全选）</h3></div>
    <div class="img-grid" id="mainGrid"></div>

    <div class="section-head"><h3>详情图<span id="detailCount" class="summary"></span>（默认不选）</h3></div>
    <div class="img-grid" id="detailGrid"></div>

    <div id="errBox" class="err-box" hidden><span id="errText"></span><button id="errSettingsBtn" hidden>打开扩展设置页</button></div>

    <div class="footer">
      <span class="summary" id="summary"></span>
      <span style="display:flex;gap:10px;align-items:center">
        <button class="mini-btn" id="docLinkBtn" title="打开工作台仓库 docs/import-1688.md">使用说明</button>
        <button class="btn" id="cancelBtn">取消</button>
        <button class="btn btn--primary" id="confirmBtn">确认导入</button>
      </span>
    </div>
  </div>
</div>`;

  document.body.appendChild(host);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => shadow.querySelector<T>(sel)!;
  const fab = $<HTMLButtonElement>('#fab');
  const overlay = $('#overlay');
  const toastEl = $('#toast');
  const toastText = $('#toastText');
  const toastAction = $<HTMLButtonElement>('#toastAction');
  const nameInput = $<HTMLInputElement>('#nameInput');
  const infoGrid = $('#infoGrid');
  const blocksBox = $('#blocksBox');
  const blockCount = $('#blockCount');
  const mainGrid = $('#mainGrid');
  const detailGrid = $('#detailGrid');
  const mainCount = $('#mainCount');
  const detailCount = $('#detailCount');
  const warnBox = $('#warnBox');
  const errBox = $('#errBox');
  const errText = $('#errText');
  const errSettingsBtn = $<HTMLButtonElement>('#errSettingsBtn');
  const summary = $('#summary');
  const confirmBtn = $<HTMLButtonElement>('#confirmBtn');
  const modeBox = $('#modeBox');
  const modeTitle = $('#modeTitle');
  const modeDesc = $('#modeDesc');
  const modeChoices = $('#modeChoices');
  const modeNote = $('#modeNote');
  const modeUpdate = $<HTMLInputElement>('#modeUpdate');
  const modeCreate = $<HTMLInputElement>('#modeCreate');

  let preview: Import1688Preview | null = null;
  let state: CardState | null = null;
  let submitting = false;
  let toastTimer = 0;
  /** 工作台已有同 offer 商品（null=确定没有；undefined=未能检查，见 existingError） */
  let existing: Import1688ExistingProduct | null | undefined;
  let existingError: string | undefined;
  let importChoice: 'update' | 'create' = 'update';

  const confirmIdleLabel = (): string => (existing && importChoice === 'update' ? '确认更新' : '确认导入');

  const showToast = (text: string, actionLabel?: string, onAction?: () => void): void => {
    toastText.textContent = text;
    if (actionLabel && onAction) {
      toastAction.hidden = false;
      toastAction.textContent = actionLabel;
      toastAction.onclick = () => {
        toastEl.hidden = true;
        onAction();
      };
    } else {
      toastAction.hidden = true;
      toastAction.onclick = null;
    }
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 6000);
  };

  const showErr = (message: string, authRequired: boolean): void => {
    errText.textContent = message;
    errSettingsBtn.hidden = !authRequired;
    errBox.hidden = false;
  };
  const clearErr = (): void => {
    errBox.hidden = true;
  };

  // ---------- 重复导入检查结果（FAB 点击时由 SW 顺带查询工作台） ----------
  const renderModeBox = (): void => {
    if (existing) {
      modeBox.hidden = false;
      modeTitle.textContent = '工作台已有该商品';
      const when = existing.updated_at ?? existing.created_at;
      modeDesc.textContent = [
        `id=${existing.id}`,
        existing.name ? existing.name : null,
        when ? `最近更新：${when.replace('T', ' ').slice(0, 16)}` : null,
      ].filter(Boolean).join(' · ');
      modeChoices.hidden = false;
      modeNote.hidden = true;
      modeUpdate.checked = importChoice === 'update';
      modeCreate.checked = importChoice === 'create';
    } else if (existingError) {
      modeBox.hidden = false;
      modeTitle.textContent = '未能检查工作台是否已有该商品';
      modeDesc.textContent = existingError;
      modeChoices.hidden = true;
      modeNote.hidden = false;
      modeNote.textContent = '继续导入会创建新商品；若工作台支持重复保护，重复会被拒绝（409）。若不放心，可先去工作台确认。';
    } else {
      modeBox.hidden = true;
    }
    if (!submitting) confirmBtn.textContent = confirmIdleLabel();
  };
  const setImportChoice = (choice: 'update' | 'create'): void => {
    importChoice = choice;
    if (!submitting) confirmBtn.textContent = confirmIdleLabel();
  };
  modeUpdate.addEventListener('change', () => { if (modeUpdate.checked) setImportChoice('update'); });
  modeCreate.addEventListener('change', () => { if (modeCreate.checked) setImportChoice('create'); });

  const openSettings = (): void => {
    void send({ type: 'import1688.openSettings' });
  };
  $('#docLinkBtn').addEventListener('click', () => {
    void send({ type: 'import1688.openDoc' });
  });

  // ---------- 信息网格 ----------
  const infoItem = (label: string, value: string): HTMLElement => {
    const cell = document.createElement('div');
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = value;
    cell.append(l, v);
    return cell;
  };

  const renderInfo = (p: Import1688Preview): void => {
    infoGrid.innerHTML = '';
    const price = p.price?.display ? `¥${p.price.display}` : '—';
    const shop = p.shop?.company ?? '—';
    const location = p.shop?.location ?? '—';
    const pay30d = p.sales?.pay_30d ?? (p.sales?.saled_count !== undefined ? String(p.sales.saled_count) : '—');
    const combo = p.sku?.combo_count !== undefined ? String(p.sku.combo_count) : '—';
    const factory = p.shop?.is_factory ? `（工厂）` : '';
    infoGrid.append(
      infoItem('价格', price),
      infoItem('供应商', `${shop}${factory}`),
      infoItem('发货地', location),
      infoItem('30 天成交', pay30d),
      infoItem('SKU 组合数', combo),
      infoItem('图数量', `主图 ${p.main_images?.length ?? 0} · 详情图 ${p.detail_images?.length ?? 0}`),
    );
  };

  // ---------- 区块 ----------
  const renderBlocks = (): void => {
    blocksBox.innerHTML = '';
    if (!state) return;
    if (state.blocks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'summary';
      empty.textContent = '（无资料区块）';
      blocksBox.appendChild(empty);
    }
    state.blocks.forEach((block, index) => {
      const item = document.createElement('div');
      item.className = 'block-item';

      const row = document.createElement('div');
      row.className = 'block-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = block.checked;
      checkbox.setAttribute('aria-label', '选择区块');
      checkbox.addEventListener('change', () => {
        block.checked = checkbox.checked;
        refreshSummary();
      });

      const title = document.createElement('input');
      title.className = 'block-title';
      title.value = block.title;
      title.maxLength = 120;
      title.placeholder = '区块标题';
      title.addEventListener('input', () => {
        block.title = title.value;
      });

      const del = document.createElement('button');
      del.className = 'block-del';
      del.textContent = '✕';
      del.title = '删除该区块';
      del.addEventListener('click', () => {
        if (state) {
          state.blocks.splice(index, 1);
          renderBlocks();
          refreshSummary();
        }
      });

      const content = document.createElement('textarea');
      content.className = 'block-content';
      content.value = block.content;
      content.rows = 2;
      content.spellcheck = false;
      content.addEventListener('input', () => {
        block.content = content.value;
      });

      row.append(checkbox, title, del);
      item.append(row, content);
      blocksBox.appendChild(item);
    });
    refreshSummary();
  };

  // ---------- 图片网格 ----------
  const renderImageGrid = (
    container: HTMLElement,
    images: CardState['mainImages'],
    onChange: () => void,
  ): void => {
    container.innerHTML = '';
    images.forEach((img) => {
      const cell = document.createElement('label');
      cell.className = `img-cell${img.checked ? ' checked' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = img.checked;

      const picture = document.createElement('img');
      picture.loading = 'lazy';
      picture.alt = '';
      picture.src = img.url;
      picture.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = normalizeImageUrl(img.url) !== null ? '图片加载失败（不影响导入，服务端会下载）' : '非工作台支持的图片域名';
        picture.replaceWith(ph);
      });

      checkbox.addEventListener('change', () => {
        img.checked = checkbox.checked;
        cell.classList.toggle('checked', img.checked);
        onChange();
      });

      cell.append(checkbox, picture);
      container.appendChild(cell);
    });
  };

  const refreshSummary = (): void => {
    if (!state) return;
    const checkedBlocks = state.blocks.filter((b) => b.checked).length;
    const checkedMain = state.mainImages.filter((i) => i.checked).length;
    const checkedDetail = state.detailImages.filter((i) => i.checked).length;
    blockCount.textContent = `（${checkedBlocks}/${state.blocks.length} 选中）`;
    mainCount.textContent = `（${checkedMain}/${state.mainImages.length}）`;
    detailCount.textContent = `（${checkedDetail}/${state.detailImages.length}）`;
    summary.textContent = `已选：区块 ${checkedBlocks} · 主图 ${checkedMain} · 详情图 ${checkedDetail}`;
  };

  const renderAll = (): void => {
    if (!preview || !state) return;
    nameInput.value = state.name;
    renderInfo(preview);

    // 警告
    if (preview.warnings && preview.warnings.length > 0) {
      warnBox.hidden = false;
      warnBox.textContent = `提示：${preview.warnings.join('；')}`;
    } else {
      warnBox.hidden = true;
    }

    renderBlocks();
    renderImageGrid(mainGrid, state.mainImages, refreshSummary);
    renderImageGrid(detailGrid, state.detailImages, refreshSummary);
    refreshSummary();
  };

  const setConfirming = (active: boolean): void => {
    submitting = active;
    confirmBtn.disabled = active;
    confirmBtn.textContent = active ? '导入中…' : confirmIdleLabel();
    $('#cancelBtn').toggleAttribute('disabled', active);
  };

  // ---------- 消息 ----------
  errSettingsBtn.addEventListener('click', openSettings);

  $('#blocksAll').addEventListener('click', () => {
    if (!state) return;
    state.blocks.forEach((b) => { b.checked = true; });
    renderBlocks();
  });
  $('#blocksNone').addEventListener('click', () => {
    if (!state) return;
    state.blocks.forEach((b) => { b.checked = false; });
    renderBlocks();
  });
  $('#blocksReset').addEventListener('click', () => {
    if (!preview) return;
    state = defaultCardState(preview);
    renderAll();
    showToast('已恢复默认勾选与内容');
  });
  nameInput.addEventListener('input', () => {
    if (state) state.name = nameInput.value;
  });

  const closeOverlay = (): void => {
    overlay.hidden = true;
    clearErr();
  };
  $('#closeBtn').addEventListener('click', () => {
    if (!submitting) closeOverlay();
  });
  $('#cancelBtn').addEventListener('click', () => {
    if (!submitting) closeOverlay();
  });

  confirmBtn.addEventListener('click', () => {
    if (!preview || !state || submitting) return; // 请求期间禁用，禁止重复提交
    clearErr();
    // 导入意图：工作台已有该商品时由用户选择「更新（默认）/ 仍然新建」；没有则普通新建
    const plan = !existing ? 'create' : importChoice === 'update' ? 'update' : 'create-anyway';
    const built = buildExecuteRequest(preview.offer_id, state, plan);
    if (!built.ok) {
      showErr(built.error, false);
      return;
    }
    setConfirming(true);
    if (built.skippedImages > 0) {
      showToast(`已自动跳过 ${built.skippedImages} 张非工作台支持域名的图片（https + alicdn/tmall/taobao 才可入库）`);
    }
    void (async () => {
      const resp = await send<ExecuteResponse>({ type: 'import1688.execute', request: built.request });
      setConfirming(false);
      if (resp.ok && resp.data) {
        const importedId = resp.data.id;
        const importedName = resp.data.name || built.request.name;
        const wasUpdate = resp.data.action === 'updated' || (!resp.data.action && plan === 'update');
        closeOverlay();
        showToast(`${wasUpdate ? '已更新商品' : '已导入商品'}：${importedName}`, '打开工作台', () => {
          void send({ type: 'import1688.openProduct', id: importedId });
        });
        return;
      }
      const code = resp.code;
      const authRequired = code === 401 || code === 403;
      if (code === 409) {
        // 重复保护兜底：提示后引导用户选择「更新」
        showErr(`${resp.error ?? '工作台已存在同 offer 商品，已阻止重复创建'}。关闭窗口重开后选择「更新已有商品」即可。`, false);
        return;
      }
      showErr(resp.error ?? '导入失败', authRequired);
      if (authRequired) {
        // 401/403 明确引导去设置页
        showToast('Token 无效或权限不足，请打开扩展设置页更新', '打开扩展设置页', openSettings);
      }
    })();
  });

  fab.addEventListener('click', () => {
    if (fab.disabled) return;
    fab.disabled = true;
    fab.textContent = '⏳ 读取中…';
    void (async () => {
      const resp = await send<{ preview: Import1688Preview; strategy: string; existing?: Import1688ExistingProduct | null; existingError?: string }>({ type: 'import1688.preview' });
      fab.disabled = false;
      fab.textContent = '📥 导入工作台';
      if (resp.ok && resp.data) {
        preview = resp.data.preview;
        existing = resp.data.existing ?? null;
        existingError = resp.data.existingError;
        importChoice = existing ? 'update' : 'create';
        state = defaultCardState(preview);
        renderAll();
        renderModeBox();
        overlay.hidden = false;
        return;
      }
      const code = resp.code;
      const authRequired = code === 401 || code === 403;
      const message = resp.error ?? '解析失败';
      if (authRequired) {
        showToast(message, '打开扩展设置页', openSettings);
      } else {
        showToast(message);
      }
    })();
  });
})();
