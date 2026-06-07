# Chrome Web Store — WebTranslate

> GitHub: https://github.com/cyrus-aetherus/webtranslate

---

## Short Description (132 chars)

AI-powered bilingual webpage translation with inline cards, side panel mode, and full-page Markdown + images ZIP download.

---

## Full Description

WebTranslate brings one-click AI translation to any webpage. It supports two translation modes — **Inline** (translation cards below each paragraph) and **Panel** (clean side panel) — plus full-page Markdown export with images packed in a ZIP file for offline reading.

### Key Features

**Dual Translation Modes**
- **Inline Mode**: Lightweight purple-bordered cards appear below each paragraph. Cards fold/unfold with a single click.
- **Panel Mode**: All translations appear in a resizable side panel. Click any entry to scroll to the original paragraph.

**Smart Content Detection**
- Automatically identifies translatable text blocks on any website.
- Preserves code blocks, math formulas (LaTeX/MathML), and SVG content.
- Handles complex academic paper layouts (arXiv, ACL, etc.) — Summary boxes, equation tables, and mixed formula-text paragraphs.
- Groups related paragraphs split by formula displays into cohesive translation units.

**Full-Page Download**
- Export the translated page as a single Markdown file with GFM table support.
- All images are collected, downloaded, and packed into a ZIP alongside the Markdown.
- Content tables are preserved at their original document positions.

**Floating Action Button**
- Subtle purple-tinted button, draggable to any screen position.
- Context-aware dynamic menu: Translate, Panel Mode, Download, Settings.
- Shows a mode badge ("I" for Inline, "P" for Panel) and changes appearance based on translation state.

**Multi-API Support**
- OpenAI-compatible endpoints (GPT-4o, GPT-4o-mini, DeepSeek, etc.)
- Anthropic Claude models
- Any API following OpenAI's chat completion format

**Performance**
- Configurable batch size and concurrency for optimal speed.
- Intelligent caching eliminates duplicate API calls.
- Real-time usage statistics (tokens, cost estimates).

### Getting Started

1. Click the puzzle piece icon in Chrome toolbar, pin WebTranslate.
2. Click the extension icon → configure your API URL, key, and model.
3. Choose your target language (English, Chinese, Japanese, etc.).
4. Navigate to any webpage → the purple FAB appears on the right side.
5. Click the FAB → click Translate.

### Privacy

- Your API key is stored locally in Chrome storage.
- All translation requests go directly from your browser to your configured API endpoint.
- No telemetry, no tracking, no third-party servers.

---

## Screenshots

| # | File | Description |
|---|------|-------------|
| 1 | init-web-page.png | FAB button on initial page load |
| 2 | setting-extention.png | Extension settings popup |
| 3 | set-model.png | Model configuration |
| 4 | set-target-language.png | Target language selection |
| 5 | stat.png | Usage statistics |
| 6 | translate.png | Inline translation cards on arXiv paper |
| 7 | panel-translate.png | Panel mode with side panel |

---

## Store Details

| Field | Value |
|-------|-------|
| **Category** | Productivity |
| **Language** | English (UI also supports 简体中文 and 日本語) |
| **Developer** | WebTranslate Team |
| **Website** | https://github.com/cyrus-aetherus/webtranslate |
| **Privacy Policy** | All data is processed locally. API key stored in Chrome storage. No data collection. |
| **Price** | Free |

---

## Promo Image Text (for tile)

```
WebTranslate
AI-Powered Bilingual Web Translation
Inline Cards · Side Panel · Markdown Export
OpenAI · Anthropic · DeepSeek Compatible
```
