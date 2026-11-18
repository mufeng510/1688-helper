# 1688 智能助手 — 上架商店材料索引

适用于 Chrome Web Store（chromewebstore.google.com/developer）与 Edge Add-ons（partner.microsoft.com / Microsoft Partner Center）。

## 文件清单

| 文件 | 用途 |
|---|---|
| `listing.zh-CN.md` | 中文商品页文案（名称/短描述/详细描述/分类/要求） |
| `listing.en.md` | 英文商品页文案 |
| `permissions-justification.md` | 单一用途声明 + 逐项权限理由 + 隐私实践表单建议答案 + 审核预案 |
| `privacy-policy.md` | 隐私政策（中英双语；商店隐私表单填其 URL） |
| `screenshots.md` | 截图清单与规格（需本人截取，勿造假） |
| `assets/promo-small-440x280.png` | 商店宣传小图（Chrome） |
| `assets/marquee-1400x560.png` | Marquee 大图（Chrome） |

GitHub 公开 URL（隐私表单 / listing 需要）：
`https://github.com/mufeng510/1688-helper/blob/main/docs/store/privacy-policy.md`

## 提交步骤

### 公共前置

- `npm run build`（dist/ 已是 v0.5.1，若改代码需重新 build 再打包）
- 打包扩展 zip（根为 dist/ 内容，不含外层目录）：

```bash
python3 - <<'EOF'
import zipfile, os
with zipfile.ZipFile('1688-helper-v0.5.1.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('dist'):
        for f in files:
            if not f.startswith('.'):
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, 'dist'))
print('done')
EOF
```

（zip 不提交到 git；如需可放 /tmp/opencode/1688-helper-v0.5.1.zip。）

### Chrome Web Store

1. 开发者账号（一次性 US $5 注册费）；
2. 控制台 → 创建新项目 → 上传 zip；
3. 填写：商品名称/短描述/详细描述（用 listing.zh-CN.md，可加英文）、分类（购物）、语言（中文简体）、图标（manifest 自带 128px）、截图（≥1 张 1280×800）；
4. 隐私实践表单：按 `permissions-justification.md` §3 填写；隐私政策 URL 填上表 GitHub 链接；
5. 权限理由：若审核问及 optional_host_permissions，用 §4 第 2 条回答；
6. 提交审核（通常数小时至数天）。

### Edge Add-ons

1. Partner Center 注册（免费）；
2. 产品 → 新扩展 → 上传同一 zip；
3. 材料同上（名称/描述/分类/隐私/截图）；
4. 审核一般较快（数小时至 2 天）。

## 版本发布流程（之后每版）

### Edge Add-ons：自动（推荐）

1. 递增 `public/manifest.json` 与 `package.json` 的 version（保持一致；semver，如 0.5.1），`npm run build`；
2. 提交并推送 main；
3. 打 tag 并推送：`git tag v0.5.1 && git push origin v0.5.1`；
4. GitHub Actions（`.github/workflows/publish-edge.yml`）自动执行：`npm ci` → typecheck → 单测 → build → 校验 tag 与 manifest/package.json 版本一致 → 打包 zip → 调 Edge Update REST API v1.1（upload → 等待 Succeeded → publish → 等待 Succeeded）；
5. 需要仓库 secrets（repo → Settings → Secrets and variables → Actions）：`EDGE_CLIENT_ID` / `EDGE_API_KEY` / `EDGE_PRODUCT_ID`（Partner Center → Publish API 页生成；API key 有过期时间，过期后 Actions 会 401，需要重新生成并更新 secret）；
6. 提交 notes 自动取 tag 指向的提交信息；审核一般数小时至数天；若已有 In Review 提交，API 会返回 `InProgressSubmission` 错误，等当前审核结束后再打 tag。

本地如需手动发布（调试用）：`node scripts/publish-edge.mjs <zip> [notes]`（需先在本地导出三个环境变量；`--dry-run` 只校验环境，不发网络请求）。

### Chrome Web Store：手动

1. 更新 `public/manifest.json` 版本号（semver）并 `npm run build`；
2. 更新 zip → 上传到 Chrome Web Store 控制台；
3. 更新 `docs/store/` 文案中的变更点（listing「版本与更新」段，如需要）；
4. git 打 tag（如 v0.5.1）便于回溯。

## 尚未完成（需你操作/决定）

- [ ] 商店真实截图（见 screenshots.md，至少 1 张 1280×800；我无法代截）
- [ ] 图标若要区分品牌：现有 128×128 图标风格偏简洁占位，如需精美图标可找设计或另创作
- [ ] 两个商店的开发者账号注册（Chrome US $5 / Edge 免费）
- [ ] （可选）Marquee 大图已生成，Chrome「宣传图片」栏直接用；Edge 不需要
- [ ] 英文 listing 仅作备选；若只上架中文市场，可不填英文
