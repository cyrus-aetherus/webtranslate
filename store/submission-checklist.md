# Chrome Web Store Submission Checklist

## Package

- Build with `npm run build`.
- Upload the ZIP whose root contains `manifest.json`, not the repository root.
- Confirm the uploaded version is greater than the previously uploaded version.
- Confirm `minimum_chrome_version` is `116`, matching the minimum version for
  `chrome.sidePanel.open()`.
- Confirm the package contains no remote JavaScript, `eval`, or remotely hosted
  executable code.
- Confirm the built JavaScript contains no `new Function` string-execution
  fallback from bundled dependencies.

## Store Listing

- Use screenshots that show the current extension UI and real functionality.
- Upload only `translate.png`, `panel-translate.png`, `stat-v2.png`,
  `set-model-v2.png`, and `setting-extension-v2.png`.
- Do not upload the older screenshots whose privacy footer says that the API
  key is never sent to third-party servers.
- Do not claim that data never leaves the browser. Translation text and the API
  key are sent to the user-configured API provider.
- Keep the extension's single purpose focused on webpage translation and
  translation-related export.
- Provide a stable, publicly accessible HTTPS privacy-policy URL that does not
  require sign-in.

## Privacy Practices

- Authentication information: disclose the API key.
- Website content: disclose webpage text used for translation/export.
- Web history: disclose the current page URL used locally for cache identity.
- State that data is used for the extension's core functionality.
- State that translation data is sent to the API provider selected by the user.
- Do not claim that the extension does not handle data.

## Permission Justifications

- `storage`: Local settings, API credentials, translation cache, and statistics.
- `downloads`: User-requested Markdown/ZIP export.
- `sidePanel`: User-selected side panel translation mode.
- HTTP(S) hosts: Page translation, configured API calls, and export images.

## Reviewer Notes

Suggested reviewer note:

> WebTranslate injects a content script on HTTP(S) pages to extract text after
> the user clicks its floating Translate control. It sends that text and the
> locally stored API credential directly to the HTTPS LLM endpoint configured
> by the user. The developer operates no backend and receives no extension
> data. The downloads permission is used only when the user requests a
> Markdown/ZIP export. The sidePanel permission powers the optional panel
> translation mode.
