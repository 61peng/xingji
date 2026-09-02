<div align="center">
  <img src="macos/AppIcon-1024.png" width="112" alt="行迹图标" />
  <h1>行迹</h1>
  <p><strong>把移动记录下来，把走过的日子看清楚。</strong></p>
  <p>本地优先、离线可用的个人行程记录与足迹统计应用。</p>
  <p>
    <a href="../../releases"><strong>下载桌面版</strong></a>
    · <a href="#在浏览器中运行">浏览器运行</a>
    · <a href="docs/PRIVACY.md">隐私说明</a>
    · <a href="docs/ARCHITECTURE.md">架构文档</a>
  </p>
</div>

## 界面预览

![行迹年度概览](docs/images/overview.jpg)

<table>
  <tr>
    <td width="50%">
      <img src="docs/images/calendar.jpg" alt="行迹月日历，以颜色和路线展示每日所在城市与移动方式" />
      <br />
      <sub><strong>日历回看</strong>：移动日展示完整路线，停留日延续所在城市。</sub>
    </td>
    <td width="50%">
      <img src="docs/images/province-map.jpg" alt="行迹中国省域足迹地图，按主要出行目的为到访地区着色" />
      <br />
      <sub><strong>省域足迹</strong>：按主要停留目的着色，并汇总停留天数与到访次数。</sub>
    </td>
  </tr>
</table>

![行迹移动记录列表](docs/images/records.jpg)

> 截图使用完全虚构的演示行程生成，不包含维护者或任何用户的真实轨迹。

## 产品定位

行迹用于记录“某一天如何从一个地方移动到另一个地方”，并由移动记录推导停留地点、出行目的和时间分布。它不是社交平台，也不是云同步服务；账户、服务器和在线地图都不是运行所必需的。

同一天可以记录多段路线，例如：

```text
甲市 🚄 乙市 🚗 丙市 🚄 丁市
```

没有移动的日期会延续上一段行程的最终地点。概览、日历和地图均由同一份本地记录实时计算。

## 核心能力

- **时间概览**：年度、全部记录、自定义时间范围统计。
- **日历回看**：月视图和年视图；移动日显示完整路线，停留日显示所在城市。
- **移动记录**：新增、编辑、删除同一天的一段或多段路线。
- **出行目的**：上学、探亲、游玩、出差／开会，以统一颜色贯穿全局。
- **交通统计**：铁路、飞机、公路的次数、热门路线和逐条明细。
- **省域足迹**：按主要停留目的为到访省级行政区着色，覆盖港澳台。
- **数据迁移**：通过 JSON 导入和导出，在不同设备或运行方式之间手动迁移。
- **完全离线**：无账户、无遥测、无云端数据库、无在线地图依赖。

## 下载桌面版

面向普通用户的 macOS 安装包发布在项目的 [**Releases**](../../releases) 页面。下载最新的 `行迹-macOS-arm64.zip`，解压后将 `行迹.app` 拖入“应用程序”目录即可。

当前桌面构建面向 Apple Silicon Mac，最低支持 macOS 13。未经过 Apple 公证的社区构建首次启动时，可能需要在 Finder 中右键应用并选择“打开”。正式分发建议使用 Developer ID 签名与 Apple 公证，详见[发布指南](docs/RELEASING.md)。

## 在浏览器中运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

然后访问：

```text
http://127.0.0.1:3000
```

浏览器版与桌面版使用同一套 React 界面和业务逻辑。浏览器开发服务支持热更新；桌面版需要重新构建后才能包含新的代码。

## 本地数据与隔离边界

源码仓库不包含任何个人行程，首次启动从空数据开始。

| 运行方式 | 数据位置 | 是否自动同步 |
| --- | --- | --- |
| 浏览器 | 当前浏览器配置中的 `localStorage` | 否 |
| macOS | `~/Library/Application Support/行迹/journeys-v1.json` | 否 |
| iOS | App 私有沙盒的 `Library/Application Support/io.github.peng61.xingji/journeys-v1.json` | 否 |

重新下载、重新构建或替换 `行迹.app` 不会删除 macOS 数据文件。导入操作会在确认后**完整替换当前运行端的数据**，不会合并，也不会修改另一端的数据。

建议定期使用“导出数据”保存独立备份。完整格式见[数据格式文档](docs/DATA_FORMAT.md)，隐私边界见[隐私说明](docs/PRIVACY.md)。

## 技术架构

```text
共享 React 核心（界面、日历、统计、地图）
                │
       平台存储适配层
        ┌───────┼────────┐
        │       │        │
     Browser   macOS     iOS
   localStorage JSON   Capacitor
              + Swift    Filesystem
```

- `app/page.tsx`：产品界面与页面状态。
- `app/core/`：平台无关的数据类型和领域代码。
- `app/platform/`：浏览器、macOS 与 iOS 的存储适配。
- `mobile/`：浏览器、macOS 和 iOS 共用的 Vite 入口。
- `macos/`：轻量 Swift／WebKit 桌面外壳。
- `ios/`：Capacitor iOS 工程。
- `scripts/`：应用图标与桌面打包脚本。

设计决策和数据流详见[架构文档](docs/ARCHITECTURE.md)。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 在 `127.0.0.1:3000` 启动网页开发服务 |
| `npm run build` | 生成离线静态网页资源 |
| `npm run mac:build` | 构建 `mac-dist/行迹.app` |
| `npm run ios:sync` | 构建网页资源并同步到 iOS 工程 |
| `npm run ios:open` | 用 Xcode 打开 iOS 工程 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | 代码规范检查 |
| `npm run privacy:check` | 检查源码和提交目录中的个人行程残留 |
| `npm test` | 构建并运行产品完整性测试 |

## 参与贡献

欢迎提交 Issue 和 Pull Request。涉及行程数据的示例必须使用虚构地点与日期，不得提交真实个人轨迹、导出文件或系统生成的数据目录。

开始贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。版本发布流程见[发布指南](docs/RELEASING.md)。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
