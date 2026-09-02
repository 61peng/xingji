# 发布指南

## 发布渠道

普通用户从 GitHub Releases 下载 macOS 压缩包；开发者也可以从源码运行网页服务或自行构建应用。

建议每个 Release 至少包含：

- `行迹-macOS-arm64.zip`
- `SHA256SUMS.txt`
- 版本说明和升级注意事项
- 已知问题，尤其是签名与系统兼容性说明

## 版本规则

项目使用语义化版本：

- `MAJOR`：不兼容的数据格式或产品行为变更。
- `MINOR`：向后兼容的新功能。
- `PATCH`：缺陷修复和小幅体验改进。

## 发布前检查

1. 确认源码中没有个人行程、导出文件或签名材料。
2. 更新 `package.json` 版本和 `CHANGELOG.md`。
3. 执行：

```bash
npm ci
npm run typecheck
npm run lint
npm run privacy:check
npm test
npm run mac:build
```

4. 在一份全新用户目录中验证空数据首次启动、录入、导出、导入和重新启动。
5. 验证升级现有 `.app` 不会改变 `~/Library/Application Support/行迹/journeys-v1.json`。

## 创建 GitHub Release

推送 `vX.Y.Z` 标签后，Release 工作流会构建 Apple Silicon 应用、生成压缩包和校验文件，并将它们附加到 GitHub Releases。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 签名与公证

仓库默认构建采用 ad-hoc 签名，适合本地开发和源码验证。面向公众提供顺畅的双击安装体验，需要：

1. Apple Developer Program 的 Developer ID Application 证书。
2. 使用 `codesign --options runtime` 签名。
3. 使用 `notarytool` 上传 Apple 公证。
4. 使用 `stapler` 将公证票据附加到应用。

证书和密码必须存放在 GitHub Actions Secrets 中，禁止提交到仓库。
