#!/usr/bin/env node
// 发布打包好的 zip 到 Microsoft Edge Add-ons（Update REST API v1.1）。
// 只在 GitHub Actions（或本地）中显式调用；绝不自动触发。
//
// 用法:
//   node scripts/publish-edge.mjs <package.zip> [notes]
//   node scripts/publish-edge.mjs --dry-run
//
// 必需环境变量: EDGE_CLIENT_ID / EDGE_API_KEY / EDGE_PRODUCT_ID
// 说明见 docs/store/README.md「Edge Add-ons 自动发布」。

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://api.addons.microsoftedge.microsoft.com/v1';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

const dryRun = process.argv.includes('--dry-run');
const positional = process.argv.slice(2).filter((a) => a !== '--dry-run');
const [zipPath, notesArg] = positional;
const notes = notesArg || process.env.EDGE_PUBLISH_NOTES || 'Automated release via GitHub Actions';

const fail = (msg) => {
  console.error(`::error::publish-edge: ${msg}`);
  process.exit(1);
};

const missing = ['EDGE_CLIENT_ID', 'EDGE_API_KEY', 'EDGE_PRODUCT_ID'].filter((n) => !process.env[n]);
const envReport = ['EDGE_CLIENT_ID', 'EDGE_API_KEY', 'EDGE_PRODUCT_ID']
  .map((n) => `${n}: ${process.env[n] ? '已设置（不打印值）' : '缺失'}`)
  .join(', ');

if (dryRun) {
  const stat = zipPath ? statSync(zipPath, { throwIfNoEntry: false }) : null;
  console.log(`[dry-run] ${envReport}`);
  console.log(`[dry-run] zip: ${zipPath ?? '(未提供路径，仅校验环境)'}${stat ? ` (${stat.size} bytes)` : ''}`);
  console.log(`[dry-run] notes: ${notes}`);
  console.log('[dry-run] 不发任何网络请求。');
  process.exit(0);
}
if (missing.length) {
  fail(`缺少环境变量 ${missing.join(', ')}（GitHub repo → Settings → Secrets and variables → Actions 中添加）`);
}

const headers = (extra = {}) => ({
  Authorization: `ApiKey ${process.env.EDGE_API_KEY}`,
  'X-ClientID': process.env.EDGE_CLIENT_ID,
  ...extra,
});

if (!zipPath) fail('用法: node scripts/publish-edge.mjs <package.zip> [notes]');
const stat = statSync(zipPath, { throwIfNoEntry: false });
if (!stat || !stat.isFile()) fail(`zip 不存在: ${zipPath}`);

const zipName = basename(zipPath);
const zipBuffer = readFileSync(zipPath);
console.log(`[upload] ${zipName} (${zipBuffer.length} bytes) → product ${process.env.EDGE_PRODUCT_ID}`);

const api = (path, init) => fetch(`${API}${path}`, init);

async function pollOperation(kind, opId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const path =
    kind === 'upload'
      ? `/products/${process.env.EDGE_PRODUCT_ID}/submissions/draft/package/operations/${opId}`
      : `/products/${process.env.EDGE_PRODUCT_ID}/submissions/operations/${opId}`;
  while (Date.now() < deadline) {
    const resp = await api(path, { method: 'GET', headers: headers() });
    const text = await resp.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 也可能出现 */
    }
    if (!resp.ok) {
      throw new Error(`${kind} 状态查询 HTTP ${resp.status}: ${text}`);
    }
    const status = body?.status;
    console.log(`[poll:${kind}] status=${status ?? '(非 JSON)'} message=${body?.message ?? text}`);
    if (status === 'Succeeded') return body;
    if (status === 'Failed') {
      throw new Error(`${kind} 失败: ${body?.message ?? text} (errorCode=${body?.errorCode ?? 'none'}${body?.errors ? `, errors=${JSON.stringify(body.errors)}` : ''})`);
    }
    if (status && status !== 'InProgress') {
      throw new Error(`${kind} 未知状态: ${status} (${text})`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${kind} 等待超时（${POLL_TIMEOUT_MS / 60_000} 分钟）`);
}

// ---------- 1. 上传 package（更新 draft submission） ----------
const uploadResp = await api(`/products/${process.env.EDGE_PRODUCT_ID}/submissions/draft/package`, {
  method: 'POST',
  headers: headers({ 'Content-Type': 'application/zip' }),
  body: zipBuffer,
});
const uploadText = await uploadResp.text();
if (uploadResp.status !== 202) {
  fail(`上传被拒绝 HTTP ${uploadResp.status}: ${uploadText}（常见: 版本号未递增 / 401 凭据失效 / 404 productID 不符 / 已有 In Review 提交）`);
}
const uploadOpId = uploadResp.headers.get('location');
if (!uploadOpId) fail(`上传接受（202）但响应缺少 Location 头: ${uploadText}`);
console.log(`[upload] 202 Accepted, operationId=${uploadOpId}`);
await pollOperation('upload', uploadOpId);

// ---------- 2. 提交审核（publish draft submission） ----------
// 官方文档自相矛盾：concept 页示例用 JSON 并称 "JSON format"；reference 页写 plain text。
// 先试 JSON，4XX 时回退 plain text，两次都打日志。
async function publish() {
  const attempts = [
    { label: 'json', body: JSON.stringify({ notes }), contentType: 'application/json' },
    { label: 'plain-text', body: notes, contentType: 'text/plain' },
  ];
  let lastErr = null;
  for (const attempt of attempts) {
    const resp = await api(`/products/${process.env.EDGE_PRODUCT_ID}/submissions`, {
      method: 'POST',
      headers: headers({ 'Content-Type': attempt.contentType }),
      body: attempt.body,
    });
    const text = await resp.text();
    if (resp.status === 202) {
      const opId = resp.headers.get('location');
      if (!opId) throw new Error(`publish 接受（202）但缺少 Location 头: ${text}`);
      console.log(`[publish] 202 Accepted（${attempt.label} body）, operationId=${opId}`);
      return opId;
    }
    lastErr = `HTTP ${resp.status}: ${text}`;
    console.log(`[publish] ${attempt.label} 尝试被拒绝: ${lastErr}`);
    if (resp.status < 400 || resp.status >= 500) break; // 非 4XX 不重试
  }
  throw new Error(`publish 请求失败: ${lastErr}`);
}
const publishOpId = await publish();
const publishResult = await pollOperation('publish', publishOpId);
console.log(`[publish] 成功: ${publishResult?.message ?? 'submission created'}`);
console.log('完成。Edge 商店进入审核流程（通常数小时至数天），状态见 Partner Center。');
