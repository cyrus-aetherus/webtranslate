# WebTranslate

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Chrome](https://img.shields.io/badge/chrome-%3E%3D114-brightgreen)](https://www.google.com/chrome/)

> LLM-powered webpage translation Chrome extension. Translate any page inline or via side panel, with one-click download as Markdown.

[English](README.md) · [中文](README.zh.md)

---

## What It Does

Click the floating button on any webpage, and WebTranslate translates the article content in-place using your own LLM API key. No page reload, no copy-paste.

![FAB with IDLE menu](docs/screenshot-1-idle-menu.png)

---

## How to Use

### 1. Install the extension

```bash
npm install && npm run build
```

Load the `dist/` folder in `chrome://extensions/` (Developer mode → Load unpacked).

### 2. Configure your API

Click the extension icon to open the popup settings. Enter your API URL, Key, and model name.

![Popup settings](docs/screenshot-4-popup.png)

**Supported providers:** OpenAI, DeepSeek, Anthropic, or any OpenAI-compatible endpoint.

### 3. Start translating

Navigate to any article page. Click the floating action button (FAB) in the bottom-right corner, then click **Translate**.

![Translation in progress](docs/screenshot-2-translating.png)

Translations appear inline below each paragraph. A progress bar at the top shows how many paragraphs have been processed.

### 4. Pause, clear, or retranslate

Click **Stop** to pause translation. The FAB turns yellow and automatically expands to show your options:

![PAUSED state with menu](docs/screenshot-3-paused-menu.png)

| Action | What it does |
|--------|-------------|
| **Translate** | Resume translation (instant for cached paragraphs) |
| **Retranslate** | Clear cache and re-translate everything (e.g. after changing models) |
| **Clear** | Remove all translation blocks from the page, keeping the cache warm |

### 5. Download the page

In the FAB menu, click **Download Page** to save the article as a ZIP file containing Markdown text and images.

---

## Features

### Dual Translation Modes
- **Inline** — translations appear below each paragraph on the page
- **Panel** — translations displayed in Chrome's Side Panel, leaving the original page unchanged

### Smart Content Extraction
- Extracts semantic tags (`<p>`, `<h1>`–`<h6>`, `<li>`) and any element with enough direct text
- Auto-excludes navigation, ads, code blocks, sidebars, and interactive UI

### Batch Translation
- Groups up to 8 paragraphs per API call, reducing API costs

### Caching
- Three-tier cache (memory → session → storage) means re-translating the same page is instant

### Cost Tracking
- View token usage and estimated cost in the popup's Statistics tab

### Resilient
- Exponential backoff, rate-limit handling, circuit breaker against persistent failures

---

## Development

```bash
npm install
npm run build    # Production build → dist/
npm test         # Run 150+ unit & integration tests
npm run lint     # ESLint
```

**Tech Stack:** Chrome Extension Manifest V3 · Vanilla ES2022 · Vite · Vitest · JSZip · DOMPurify · turndown

**Docs:**
- [UI Interaction Design](docs/ui-interaction-design.md)
- [Architecture (English)](docs/architecture-en.md) · [Architecture (中文)](docs/architecture-zh.md)

---

## License

[MIT](LICENSE)
