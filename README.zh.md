# WebTranslate

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/yourname/webtranslate)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-orange)](.nvmrc)

> 基于大模型 API 的网页翻译 Chrome 扩展。支持内联翻译和侧边面板两种模式，一键打包下载为 Markdown。

[English](README.md) · [中文](README.zh.md)

<!-- TODO: 添加演示 GIF -->

---

## 特性

### 双模式翻译

| 模式 | 说明 |
|------|------|
| **内联模式** | 译文插入每段原文下方，样式隔离，不污染原页面 DOM。 |
| **面板模式** | 译文展示在 Chrome 侧边面板，完全不修改原页面。 |

### 文本驱动提取

- 提取语义标签（`<p>`、`<h1>`–`<h6>`、`<li>` 等）**以及**任何具有足够直接文本的元素（`<div>`、`<span>`、自定义组件）。
- 自动排除导航栏、广告、代码块和交互式 UI。

### 视口优先懒加载

- `IntersectionObserver` 监听可视区域段落，启动时不扫描全文。
- 在内容进入视口前通过 `rootMargin` 预加载。

### 批量合并翻译

- 每批最多 **8 段**（≤800 字符），通过唯一分隔符协议合并为单次 API 调用。
- 消除 N+1 次 API 请求问题。

### 双重去重

- **L1 DOM 标记**（`data-wt-done`）防止重复渲染。
- **L2 内容指纹**（稳定 djb2 哈希）在 SPA 重新渲染后仍能命中缓存。

### 容错与安全

- 指数退避重试、断路器（连续 5 批失败自动暂停）、429 限流处理。
- DOMPurify 净化、Shadow DOM 隔离、API Key 仅存储于本地、强制 HTTPS。

### 打包下载

- Markdown + 图片通过 JSZip 打包，Data URL 触发下载。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
npm run build    # 生产构建 → dist/
npm run dev      # Vite 监听模式
```

### 3. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启**开发者模式**
3. 点击**加载已解压的扩展程序** → 选择 `dist/` 文件夹

### 4. 配置 API

1. 点击扩展图标 → **设置**
2. 输入 API 地址、Key，选择模型
3. 支持适配器：OpenAI 兼容、DeepSeek、Anthropic

---

## 开发

```bash
npm test         # 运行全部测试（单元 + 集成）
npm run lint     # ESLint 检查
```

**测试覆盖**

| 类别 | 数量 |
|------|------|
| 单元测试 | 110 |
| 集成测试 | 3 |

---

## 架构

📐 **详细架构图**
- [English](docs/architecture-en.md)
- [中文](docs/architecture-zh.md)

| 层级 | 组件 | 运行环境 |
|------|------|----------|
| Content Script | `BatchCollector`、`StateManager`、`ObserverManager`、`InlineRenderer` | 页面沙箱 |
| Service Worker | `ApiProxy`、`DownloadManager`、`ConfigStore` | 后台进程 |
| 存储 | `chrome.storage.local`（配置）/ `chrome.storage.session`（缓存） | 浏览器持久层 |

---

## 技术栈

- Chrome Extension **Manifest V3**
- 原生 **ES2022**（无框架，极小体积）
- **Vite** + **Vitest**
- **JSZip**、**DOMPurify**、**turndown.js**

---

## 项目结构

```
webtranslate/
├── manifest.json
├── src/
│   ├── background/          # Service Worker
│   │   ├── sw.js
│   │   ├── api-proxy.js
│   │   ├── download-manager.js
│   │   ├── config-store.js
│   │   └── adapters/        # OpenAI、Anthropic
│   ├── content/             # Content Script
│   │   ├── content.js
│   │   ├── extractor/       # 文本驱动提取
│   │   ├── renderers/       # 内联与面板渲染器
│   │   └── styles/
│   ├── panel/               # 侧边面板 UI
│   ├── popup/               # 设置弹窗
│   └── shared/              # 常量、国际化、工具函数
├── tests/
│   ├── unit/
│   └── integration/
└── vite.config.js
```

---

## 许可证

[MIT](LICENSE)
