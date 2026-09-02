# 参与贡献

感谢你参与行迹。项目重视可读性、隐私边界和跨平台一致性。

## 开始之前

- Node.js 22.13 或更高版本。
- macOS 13 或更高版本（仅构建 Mac App 时需要）。
- iOS 开发需要 Xcode 和有效的本地签名配置。

```bash
npm install
npm run dev
```

## 开发流程

1. 为改动创建独立分支。
2. 保持业务规则位于共享核心，平台 API 位于适配层。
3. 增加或更新相应测试。
4. 提交前运行：

```bash
npm run typecheck
npm run lint
npm run privacy:check
npm test
```

5. 提交 Pull Request，清楚描述问题、行为变化和验证方式。

## 隐私要求

严禁提交以下内容：

- 真实行程导出或 `journeys-v1.json`。
- 包含真实家庭地址、学校、工作地点或精确移动历史的截图。
- Xcode 用户状态、签名证书、Provisioning Profile 或环境密钥。

测试需要行程时，请使用明显虚构的日期、地点和备注，并保持数据量最小。

## 代码约定

- TypeScript 开启严格模式。
- 平台无关逻辑不得直接访问 `window.webkit`、Capacitor 或文件系统。
- UI 改动需要兼顾键盘操作、触摸操作和窄屏布局。
- 数据格式变更必须同步更新 `docs/DATA_FORMAT.md`。
- 用户可见行为变更需要更新 README 或 CHANGELOG。

## Issue 与 Pull Request

Bug 报告应提供复现步骤、预期行为和实际行为。请先删除日志或截图中的个人位置数据。功能提案应说明使用场景，而不是只描述某个控件。
