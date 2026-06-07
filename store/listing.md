# WebTranslate — Chrome Web Store Listing

**GitHub:** https://github.com/cyrus-aetherus/webtranslate

---

## Short Description (132 chars)

Bring your own LLM. AI webpage translation with inline cards, side panel, usage stats, cost tracking, and Markdown export.

---

## What Makes WebTranslate Different

Most translation extensions lock you into their service. **WebTranslate connects to YOUR LLM API key.** You control the model, the cost, and the data. No subscriptions, no middleman, no limits beyond your own API plan.

**Real-time cost tracking.** See tokens consumed and estimated cost as translation runs — no surprises on your API bill.

**Two modes, one click.** Inline cards show translations right below each paragraph. Side panel gives you a clean reading view. Switch anytime.

## Full Description

WebTranslate is an open-source Chrome extension that turns any webpage into bilingual content using your own LLM backend.

### Why WebTranslate

- **You own the API key.** Connect to OpenAI, Anthropic, DeepSeek, or any OpenAI-compatible endpoint. Your data goes directly to your provider — no third party in between.
- **Real-time usage dashboard.** Tokens consumed, requests sent, estimated cost — all visible as translation runs.
- **Dual display modes.** Inline cards nestle below each paragraph. Side panel gives you a distraction-free reading experience. Toggle with one click.
- **Full page download.** Export the translated page as Markdown with GFM tables. All images packed into a ZIP. Perfect for offline reading and knowledge management.
- **Content-aware scanning.** Math formulas, code blocks, and tables are preserved — not mangled. Works on academic papers (arXiv), documentation, blog posts, and more.
- **Free and open source.** MIT license. No hidden fees. Community contributions welcome.

### Get Started in 30 Seconds

1. Pin the extension, open the popup
2. Enter your API URL, key, and model
3. Choose your target language
4. Browse any page — click the floating button — click Translate

### Supported Providers

OpenAI (GPT-4o, GPT-4o-mini) · Anthropic (Claude) · DeepSeek · Any OpenAI-compatible API

### Privacy

Your API key never leaves your browser. All requests go directly from your browser to your configured endpoint. No tracking, no telemetry.

---

## Screenshots (1280×800)

| #   | File                      | Caption                           |
| --- | ------------------------- | --------------------------------- |
| 1   | `init-web-page.png`       | FAB button on page load           |
| 2   | `setting-extention.png`   | API configuration                 |
| 3   | `set-model.png`           | Model selection                   |
| 4   | `set-target-language.png` | Language picker                   |
| 5   | `stat.png`                | Usage statistics                  |
| 6   | `translate.png`           | Inline translation cards on arXiv |
| 7   | `panel-translate.png`     | Panel mode                        |

---

## Store Fields

| Field    | Value                                                         |
| -------- | ------------------------------------------------------------- |
| Category | Productivity                                                  |
| Language | English (UI: 简体中文, English, 日本語)                              |
| Website  | https://github.com/cyrus-aetherus/webtranslate                |
| Privacy  | No data collection. API key stored locally in Chrome storage. |
| Price    | Free                                                          |

Storage — Save user API key, model, language settings and translation cache locally to avoid duplicate API calls.

Active Tab — Access current page DOM content to extract paragraphs, headings, and tables for translation.

Scripting — Inject content script to scan page text, process DOM, and render inline translation cards or side panel content.

Host Permission — Enable translation on any user-visited webpage. No data collected or sent to third parties.

Side Panel — Open Chrome side panel for Panel translation mode. Translations display in a resizable side panel.

Downloads — Package translated page as Markdown with images into ZIP, then trigger browser download.

Remote Code — Send JSON requests to user's own LLM API endpoint (OpenAI, Anthropic, DeepSeek). No remote code executed. User provides their own API key and URL.
