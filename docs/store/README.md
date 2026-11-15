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

- `npm run build`（dist/ 已是 v0.5.0，若改代码需重新 build 再打包）
- 打包扩展 zip（根为 dist/ 内容，不含外层目录）：

```bash
cd dist && zip -r ../1688-helper-v0.5.0.zip . && cd ..
```

（zip 不提交到 git；如需可放 /tmp/opencode/1688-helper-v0.5.0.zip。）

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

1. 更新 `public/manifest.json` 版本号（semver；当前 0.5.0）并 `npm run build`；
2. 更新 zip → 两个商店各提交新版本；
3. 更新 `docs/store/` 文案中的变更点（listing「版本与更新」段，如需要）；
4. git 打 tag（如 v0.5.0）便于回溯。

## 尚未完成（需你操作/决定）

- [ ] 商店真实截图（见 screenshots.md，至少 1 张 1280×800；我无法代截）
- [ ] 图标若要区分品牌：现有 128×128 图标风格偏简洁占位，如需精美图标可找设计或另创作
- [ ] 两个商店的开发者账号注册（Chrome US $5 / Edge 免费）
- [ ] （可选）Marquee 大图已生成，Chrome「宣传图片」栏直接用；Edge 不需要
- [ ] 英文 listing 仅作备选；若只上架中文市场，可不填英文
