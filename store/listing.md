# Store Listing

## Title (max 75 chars)

WebTranslate — AI Page Translator with Your Own API Key

## Short Description (max 132 chars)

Translate any webpage using your own LLM API key. Inline cards, side panel, cost tracking, and Markdown export. OpenAI & Anthropic compatible.

## Full Description

Translate any webpage using your own AI API key — no subscriptions, no middleman.

WebTranslate connects directly to the HTTPS LLM API endpoint you configure (OpenAI, Anthropic, DeepSeek, or an OpenAI-compatible API). You control the model and cost. Text selected for translation is sent only to that configured provider, not to the extension developer.

**What you can do:**

- Read foreign papers, documentation, and articles in your language
- Choose inline translation cards (appear below each paragraph) or a clean side panel
- Track tokens and estimated cost in real time as translation runs
- Download the translated page as Markdown with retrievable article images packed in a ZIP
- Translate anywhere — academic papers (arXiv), docs, blogs, Wikipedia

**What makes it different:**

No subscription required. Bring your own API key from OpenAI, Anthropic, DeepSeek, or any compatible provider. Your key is stored locally and sent only to the HTTPS endpoint you configure for authenticated API requests.

**Getting started:**

1. Open the extension popup — enter your API URL, key, and model
2. Pick your target language
3. Browse any page — click the floating button — click Translate

Free and open source under MIT license: https://github.com/cyrus-aetherus/webtranslate

## Screenshots

Upload these 5 images (1280x800 PNG) in this order:

1. `translate.png` — Inline translation cards on an arXiv research paper
2. `panel-translate.png` — Side panel translation mode
3. `stat-v2.png` — Real-time token usage and cost statistics
4. `set-model-v2.png` — Configuration for supported API formats
5. `setting-extension-v2.png` — Extension settings and API setup

Do not upload the older `stat.png`, `set-model.png`, or
`setting-extention.png`; their privacy footer is inaccurate.

## Promo Images

- Small tile (440x280): `small-promo-tile.png`
- Marquee (1400x560): `marquee-promo-tile.png`

## Category

Productivity

## Store Fields

| Field          | Value                                                               |
| -------------- | ------------------------------------------------------------------- |
| Website        | https://github.com/cyrus-aetherus/webtranslate                      |
| Privacy policy | https://github.com/cyrus-aetherus/webtranslate/blob/main/PRIVACY.md |
| Price          | Free                                                                |

## Privacy Practices Disclosure

Declare these handled data categories in the Chrome Web Store dashboard:

- Authentication information: the user-provided API key
- Website content: text extracted from webpages for translation and export
- Web history: the current page URL may be used locally for cache identity

Certification notes:

- Data is used only for the user-facing translation, cache, statistics, and
  export features.
- Translation text and the API key are sent to the HTTPS API provider selected
  by the user, not to the extension developer.
- No analytics, advertising, sale of data, or unrelated use.
- Data transmission to configured API endpoints uses HTTPS.

## Permission Justifications

- `storage`: Store API settings, local translation cache, and usage statistics.
- `downloads`: Save a ZIP/Markdown export only after the user chooses Download.
- `sidePanel`: Show the panel translation mode selected by the user.
- HTTP(S) host access: Translate arbitrary user-visited webpages, call the
  user-configured HTTPS API endpoint, and fetch images for requested exports.
