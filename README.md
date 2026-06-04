# WebTranslate

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/yourname/webtranslate)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-orange)](.nvmrc)

> LLM-powered webpage translation Chrome extension. Translate any page inline or via side panel, with one-click download as Markdown.

[English](README.md) · [中文](README.zh.md)

<!-- TODO: add a demo GIF here -->

---

## Features

### Dual Translation Modes

| Mode | Description |
|------|-------------|
| **Inline** | Inserts translation below each paragraph. Isolated styles, no DOM pollution. |
| **Panel** | Displays translations in Chrome Side Panel. Zero modification to the page. |

### Text-Driven Extraction

- Extracts semantic tags (`<p>`, `<h1>`–`<h6>`, `<li>`, etc.) **and** any element with sufficient direct text (`<div>`, `<span>`, custom elements).
- Auto-excludes navigation, ads, code blocks, and interactive UI.

### Viewport-First Lazy Loading

- `IntersectionObserver` monitors visible paragraphs. No full-page scan on startup.
- Preloads content within `rootMargin` before it enters the viewport.

### Batch Translation

- Merges up to **8 paragraphs** (≤800 chars) per API call with a unique separator protocol.
- Eliminates N+1 API requests.

### Two-Level Deduplication

- **L1 DOM marker** (`data-wt-done`) prevents duplicate rendering.
- **L2 Content fingerprint** (stable djb2 hash) survives SPA re-renders.

### Resilient & Secure

- Exponential backoff, circuit breaker (pause after 5 consecutive failures), 429 rate-limit handling.
- DOMPurify sanitization, Shadow DOM isolation, API Key stored only in `chrome.storage.local`, HTTPS enforced.

### Download as ZIP

- Markdown + images packaged via JSZip, delivered via Data URL.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build    # Production build → dist/
npm run dev      # Vite watch mode
```

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

### 4. Configure API

1. Click the extension icon → **Settings**
2. Enter your API URL, Key, and select a model
3. Supported adapters: OpenAI-compatible, DeepSeek, Anthropic

---

## Development

```bash
npm test         # Run all tests (unit + integration)
npm run lint     # ESLint check
```

**Test Coverage**

| Category | Count |
|----------|-------|
| Unit tests | 110 |
| Integration tests | 3 |

---

## Architecture

📐 **Detailed diagrams**
- [English](docs/architecture-en.md)
- [中文](docs/architecture-zh.md)

| Layer | Components | Environment |
|-------|------------|-------------|
| Content Script | `BatchCollector`, `StateManager`, `ObserverManager`, `InlineRenderer` | Page sandbox |
| Service Worker | `ApiProxy`, `DownloadManager`, `ConfigStore` | Background process |
| Storage | `chrome.storage.local` (config) / `chrome.storage.session` (cache) | Browser persistent layer |

---

## Tech Stack

- Chrome Extension **Manifest V3**
- Vanilla **ES2022** (no framework, minimal bundle)
- **Vite** + **Vitest**
- **JSZip**, **DOMPurify**, **turndown.js**

---

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
│   │   ├── extractor/       # Text-driven extraction
│   │   ├── renderers/       # Inline & Panel renderers
│   │   └── styles/
│   ├── panel/               # Side Panel UI
│   ├── popup/               # Settings popup
│   └── shared/              # Constants, i18n, utils
├── tests/
│   ├── unit/
│   └── integration/
└── vite.config.js
```

---

## License

[MIT](LICENSE)
