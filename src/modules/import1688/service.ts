// 1688 导入：SW 侧编排（采集 → ingest → 预览 / 入库）
import { logger } from '@/common/log';
import { getImport1688Settings } from './settings';
import { collectFromTab } from './collect';
import { ingest, executeImport, checkByOffer, Import1688Error } from './client';
import type { Import1688ExistingProduct } from './types';
import { isValidExecuteRequest } from './payload';
import type { Import1688Preview, ExecuteResponse, ExecuteRequest } from './types';

const log = logger('import1688');

export interface PreviewOutcome {
  preview: Import1688Preview;
  strategy: 'context' | 'html';
  /**
   * 工作台是否已有同 offer_id 商品；null=确定不存在；undefined/缺省=未检查或检查失败（见 existingError）。
   * 仅用于 UI 提示与默认勾选；重复保护以工作台 execute 端 409 为准。
   */
  existing?: Import1688ExistingProduct | null;
  /** 重复检查失败原因（非致命；导入仍可继续） */
  existingError?: string;
}

export const previewImport = async (tabId: number): Promise<PreviewOutcome> => {
  const settings = await getImport1688Settings();
  if (!settings.token) {
    throw new Import1688Error('尚未配置 API Token，请先在「管理页 → 系统设置 → 工作台」中设置', 'config');
  }
  const { body, strategy, offerId } = await collectFromTab(tabId);
  await log.info('1688 导入：采集完成', { strategy });
  const preview = await ingest<Import1688Preview>(settings.baseUrl, settings.token, body);
  await log.info('1688 导入：预览成功', { offerId: preview.offer_id, warnings: preview.warnings?.length ?? 0 });

  // 顺手检查工作台是否已有同 offer 商品（降级：失败不抛出，仅提示）
  let existing: Import1688ExistingProduct | null | undefined;
  let existingError: string | undefined;
  const checkId = offerId ?? preview.offer_id;
  if (checkId) {
    try {
      const result = await checkByOffer(settings.baseUrl, settings.token, checkId);
      existing = result.exists ? (result.product ?? { id: 0 }) : null;
    } catch (err) {
      existingError = err instanceof Error ? err.message : String(err);
      existing = undefined;
      await log.warn('1688 导入：未能检查重复商品（非致命，将由工作台 409 兜底）', { reason: existingError });
    }
  }
  return { preview, strategy, existing, existingError };
};

export const executeImportRequest = async (raw: unknown): Promise<ExecuteResponse> => {
  if (!isValidExecuteRequest(raw)) {
    throw new Import1688Error('提交的导入数据不合法（offer_id/名称/区块/图片超限或图片域名不允许）', 'config');
  }
  const settings = await getImport1688Settings();
  if (!settings.token) {
    throw new Import1688Error('尚未配置 API Token，请先在「管理页 → 系统设置 → 工作台」中设置', 'config');
  }
  const req: ExecuteRequest = {
    offer_id: raw.offer_id.trim(),
    name: raw.name.trim(),
    blocks: raw.blocks.map((b) => ({ title: b.title.trim() || '未命名区块', content: b.content })),
    images: raw.images.map((i) => ({ url: i.url.trim(), remark: typeof i.remark === 'string' ? i.remark : '' })),
  };
  const result = await executeImport<ExecuteResponse>(settings.baseUrl, settings.token, req);
  // 日志不含 Token，只记录 offer/商品 id
  await log.info('1688 导入：入库成功', { offerId: req.offer_id, id: result.id, images: result.image_count });
  return result;
};
