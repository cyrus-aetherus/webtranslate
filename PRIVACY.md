# Privacy Policy for WebTranslate

**Last updated: 2026-06-11**

WebTranslate translates webpage text through an API endpoint selected and
configured by the user. This policy explains what data the extension handles,
where it is sent, and how it is stored.

## Data Handled by the Extension

WebTranslate may handle the following data when the user uses its features:

- Webpage text selected by the extension for translation
- Webpage URLs and image URLs needed to identify cached content or create a
  user-requested Markdown/ZIP download
- The API endpoint, API key, model, language, and other settings entered by the
  user
- Local translation cache, token counts, estimated cost, and error counts

The extension developer does not operate a server that receives this data and
does not receive analytics or telemetry from the extension.

## Translation Requests

When the user starts a translation or tests an API connection, WebTranslate
sends the relevant webpage text, model settings, and API authentication
credential directly from the browser to the HTTPS API endpoint configured by
the user. The configured API provider processes that data under its own terms
and privacy policy.

Users should not translate sensitive webpage content unless they trust their
configured API provider and are authorized to send that content to it.

## Local Storage

The API key, settings, translation cache, and usage statistics are stored
locally using Chrome extension storage. They are not synchronized by
WebTranslate and are not sent to the extension developer.

Users can remove this locally stored data by clearing the extension's settings
or uninstalling the extension. Exported configuration files exclude the API
key.

## Downloads

When the user requests a page download, WebTranslate processes webpage content
locally and may fetch images referenced by that page to create a ZIP file. The
result is saved through Chrome's download system.

## Data Sharing and Sale

WebTranslate does not sell user data, use it for advertising, creditworthiness,
or unrelated purposes, and does not share it with the extension developer.
Translation data and authentication credentials are disclosed only to the API
endpoint explicitly configured by the user as necessary to provide the
translation feature.

## Limited Use

WebTranslate's use of information received from Chrome APIs complies with the
Chrome Web Store User Data Policy, including the Limited Use requirements. Data
is used and transferred only as necessary to provide the extension's
user-facing translation, local cache, usage statistics, and export features.
The extension does not use this data for advertising and does not permit humans
to read it.

## Security

WebTranslate requires HTTPS for configured API endpoints. Users are responsible
for choosing a trustworthy API provider and protecting access to their browser
profile and API credentials.

## Permissions

- **storage**: Store settings, API credentials, translation cache, and local
  usage statistics.
- **downloads**: Save user-requested Markdown/ZIP exports.
- **sidePanel**: Display translated content in Chrome's side panel.
- **HTTP(S) site access**: Read translatable webpage content, communicate with
  the user-configured HTTPS API endpoint, and fetch webpage images for
  user-requested exports.

## Contact

Project and issue tracker:
https://github.com/cyrus-aetherus/webtranslate
