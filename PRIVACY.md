# Privacy Policy for WebTranslate

**Last updated: 2026-06-07**

## Data Collection

WebTranslate does **not** collect, store, or transmit any personal information.

## API Key

The user's API key is stored **locally** in Chrome's storage (`chrome.storage.local`) and is only used to authenticate requests to the API endpoint configured by the user.

## Translation Data

All translation requests are sent **directly** from the user's browser to their configured LLM API endpoint (e.g., OpenAI, Anthropic, DeepSeek). The extension developer does not have access to:

- The content being translated
- The API responses
- The user's API usage or billing information

## Third-Party Services

This extension does not use any third-party analytics, tracking, or advertising services. No data is shared with any third party.

## Permissions

The extension requests the following permissions solely for its core functionality:

- **activeTab**: Read page content for text extraction
- **storage**: Save user preferences and translation cache locally
- **scripting**: Inject translation UI into web pages
- **downloads**: Save translated pages as Markdown/ZIP files
- **sidePanel**: Display translations in Chrome's side panel
- **host permissions**: Enable translation on any user-visited webpage

## Contact

GitHub: https://github.com/cyrus-aetherus/webtranslate
