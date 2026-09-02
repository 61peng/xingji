# 行迹架构说明

## 1. 设计目标

行迹采用“共享产品核心、平台存储隔离”的架构，目标是：

1. 网页、macOS 和 iOS 呈现相同的产品能力。
2. 用户数据默认只存在于当前设备，不依赖服务器。
3. 平台差异集中在边界层，统计和界面不复制实现。
4. 应用程序包与用户数据分离，升级应用不会覆盖记录。

## 2. 总体结构

```text
mobile/main.tsx
      │
      ▼
共享 React 核心
  app/page.tsx
  app/core/*
  app/globals.css
      │
      ▼
app/platform/device-storage.ts
      │
      ├── Browser：localStorage
      ├── macOS：WKWebView message handler → Swift → JSON
      └── iOS：Capacitor Filesystem → App 私有沙盒
```

Vite 是唯一的前端构建入口。浏览器开发服务直接加载该入口；macOS 构建脚本将同一份静态资源打入 `.app`；iOS 通过 Capacitor 同步相同资源。

## 3. 领域模型

核心模型位于 `app/core/types.ts`：

- `JourneyDay`：某一天的移动记录。
- `Leg`：从一个地点到另一个地点的一段路线。
- `Purpose`：上学、探亲、游玩、出差／开会。
- `Transport`：铁路、飞机、公路。
- `DaySnapshot`：由移动历史推导出的某日停留状态。

一条 `JourneyDay` 可以包含多条按顺序排列的 `Leg`。当天最终地点由最后一段路线的终点决定；后续无移动日期延续该地点。

## 4. 数据生命周期

### 首次启动

应用源码不携带示例行程。存储层找不到已有数据时，界面以空记录启动，并在用户首次录入后创建本地存储。

### 日常编辑

界面只修改内存中的 `JourneyDay[]`。React 状态变化后，平台适配层将完整数据集原子写入当前运行端：

- 浏览器写入 `localStorage`。
- macOS 通过 Swift bridge 写入应用支持目录中的 JSON。
- iOS 通过 Capacitor Filesystem 写入私有沙盒。

### 导入导出

导出生成带版本号的 JSON envelope。导入先校验日期、枚举、路线和 ID，再由用户确认是否替换当前数据。不同平台没有后台同步关系。

## 5. macOS 外壳

`macos/XingjiApp.swift` 负责：

- 创建原生窗口和 `WKWebView`。
- 通过自定义 `xingji://` scheme 加载应用包内静态资源。
- 提供读取、写入、导入和导出 JSON 的消息桥。
- 调用系统文件选择器和确认对话框。

Swift 层不实现日历或统计逻辑，因此产品功能修改通常只需修改共享 React 代码。

## 6. 构建边界

- `npm run dev`：浏览器开发服务，支持热更新。
- `npm run build`：生成 `mobile-dist` 静态资源。
- `npm run mac:build`：生成静态资源、编译 Swift、创建图标并签名应用包。
- `npm run ios:sync`：生成静态资源并同步到 Xcode 工程。

构建目录均被 Git 忽略。Git 仓库只保存可复现构建所需的源码和配置。

## 7. 演进原则

- 新增业务规则优先放入 `app/core`，避免依赖 DOM 或平台 API。
- 新增平台能力通过 `app/platform` 暴露小型接口。
- UI 组件不直接读取磁盘或调用原生文件 API。
- 数据格式变更必须提升 envelope 版本并提供向后兼容迁移。
- 任何测试数据必须虚构，不得复制真实用户导出。
