# WebTranslate

> A Chrome extension for webpage translation powered by LLM APIs (OpenAI-compatible, DeepSeek, Anthropic, etc.).

[中文说明](#中文说明)

---

## Features

- **Dual translation modes**
  - **Inline mode**: Inserts translations directly below original paragraphs using Shadow DOM (isolated styles, no page pollution).
  - **Panel mode**: Uses Chrome Side Panel (MV3) — zero modification to the original page DOM.
- **Viewport-first lazy loading**: IntersectionObserver + rootMargin preloading. No full-page scan on startup.
- **Batch translation**: Merges up to 8 paragraphs (≤800 chars) per API call with a unique separator protocol to eliminate N+1 requests.
- **Smart paragraph extraction**: Prioritizes `<article>`, `<main>`, `.content`; excludes nav/header/footer/code blocks automatically.
- **Two-level deduplication**: L1 DOM marker (`data-wt-done`) + L2 content fingerprint (djb2 hash) prevents duplicate translation, even on SPAs.
- **Download as ZIP**: Markdown + images packaged via JSZip, delivered via Data URL (no Blob URL race conditions).
- **Resilient error handling**: Exponential backoff, circuit breaker (pause after 5 consecutive failures), 429 rate-limit handling, offline detection.
- **Secure by design**: DOMPurify sanitization, Shadow DOM isolation, API Key stored only in `chrome.storage.local`, HTTPS enforced.

## Architecture

| Layer          | Components                                                         | Environment              |
| -------------- | ------------------------------------------------------------------ | ------------------------ |
| Content Script | `BatchCollector`, `StateManager`, `CacheManager`, `Renderer`       | Page sandbox             |
| Service Worker | `ApiProxy`, `DownloadManager`, `ConfigStore`                       | Background process       |
| Storage        | `chrome.storage.local` (config) / `chrome.storage.session` (cache) | Browser persistent layer |

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla ES2022 (no framework, minimal bundle)
- JSZip, DOMPurify, turndown.js
- Vitest for unit & integration testing

## Development

```bash
cd extensions/webtranslate
npm install
npm run dev      # Vite watch mode
npm run build    # Production build to dist/
npm test         # Run all tests (unit + integration)
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

**Icons**: Icons are auto-generated at `src/assets/icons/` (16/32/48/128px). Run `node scripts/generate-icons.js` to regenerate them.

## Project Structure

```
webtranslate/
├── manifest.json
├── src/
│   ├── background/          # Service Worker
│   │   ├── sw.js
│   │   ├── api-proxy.js
│   │   ├── download-manager.js
│   │   ├── config-store.js
│   │   └── adapters/        # OpenAI, Anthropic
│   ├── content/             # Content Script
│   │   ├── content.js
│   │   ├── styles/
│   │   └── components/      # FAB, Shadow DOM components
│   ├── panel/               # Side Panel UI
│   ├── popup/               # Settings popup
│   └── shared/              # Constants & utilities
├── tests/
│   ├── unit/                # 96 unit tests
│   └── integration/         # Mock API + full flow tests
└── vite.config.js
```

## Test Coverage

| Category          | Count  | Files                                                                                                                                                             |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests        | 96     | utils, extractor, batch-collector, state-manager, concurrency, circuit-breaker, wt-translation, inline-renderer, panel-renderer, fab, download-trigger, api-proxy |
| Integration tests | 3      | Mock API full flow                                                                                                                                                |
| **Total**         | **99** | **13 test files**                                                                                                                                                 |

## License

MIT

---

## 中文说明

**WebTranslate** 是一款基于大模型 API 的 Chrome 浏览器扩展，支持在浏览任意网页时按需翻译页面内容。

### 核心特性

- **双模式翻译**
  - **内联模式**：译文以 Shadow DOM 形式插入原文下方，样式隔离，不污染原页面。
  - **面板模式**：通过 Chrome Side Panel 展示，完全不修改原页面 DOM。
- **视口优先懒加载**：IntersectionObserver 监听视口段落，配合 rootMargin 预加载，启动时不扫描全文。
- **批量合并翻译**：每批最多 8 段、≤800 字符，通过唯一分隔符协议合并为单次 API 调用，解决 N+1 问题。
- **智能段落提取**：优先 `<article>` / `<main>`，自动排除导航、页脚、代码块等。
- **双重去重**：L1 DOM 标记 + L2 内容指纹（djb2 哈希），SPA 动态重建也能命中缓存。
- **打包下载**：Markdown + 图片通过 JSZip 打包，Data URL 触发下载，无 Blob URL 竞态风险。
- **容错设计**：指数退避重试、断路器（连续 5 批失败自动暂停）、429 限流处理、离线自动暂停恢复。
- **安全设计**：DOMPurify 净化、Shadow DOM 隔离、API Key 仅存本地、强制 HTTPS。

### 快速开始

```bash
cd extensions/webtranslate
npm install
npm run dev
```

在 Chrome 中加载 `dist/` 文件夹即可。

**图标说明**：构建前请将 PNG 图标（`icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`）放入 `src/assets/icons/` 目录。没有图标时扩展仍可正常运行，但工具栏会显示默认占位符。
