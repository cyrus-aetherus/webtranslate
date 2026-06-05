/**
 * DownloadTrigger - Generates Markdown from page content and collects image URLs,
 * then sends the payload to the Service Worker for ZIP packaging.
 *
 * Uses Mozilla Readability (Firefox Reader View algorithm) to extract clean
 * article content — ads, navigation, sidebars, scripts, and other page chrome
 * are automatically removed.  This is the same battle-tested engine that
 * powers Reader Mode in Firefox and Safari.
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});
turndown.use(gfm);

/**
 * Generate Markdown from the current page content.
 * Uses Readability to extract clean article content, then converts to Markdown.
 * Falls back to document.body + basic filtering if no article is found.
 * @returns {string}
 */
export function generateMarkdown() {
  // 1. Clone document and remove translation UI blocks BEFORE Readability.
  //    If Readability processes HTML that contains .wt-inline-block cards,
  //    it can split the translation text away from the original table/cell
  //    structure, producing duplicate content in the output.
  const docClone = document.cloneNode(true);
  docClone.querySelectorAll('.wt-inline-block, .wt-pending, #wt-fab, #wt-fab-backdrop, .wt-progress').forEach(el => el.remove());

  // 2. Extract clean article content using Firefox Reader View algorithm
  const article = new Readability(docClone).parse();

  let html;
  let titlePrefix = '';
  if (article && article.content) {
    if (article.title) titlePrefix = '# ' + article.title + '\n\n';
    html = article.content;
  } else {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, .wt-inline-block, .wt-pending, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => el.remove());
    html = clone.innerHTML;
  }

  // 3. Convert to Markdown with GFM table support, prepend title
  let md = titlePrefix + turndown.turndown(html);
  md = md.replace(/\n{4,}/g, '\n\n\n');
  return md.trim() + '\n';
}

/**
 * Collect all image URLs inside the content area.
 * @returns {string[]}
 */
export function collectImageUrls() {
  const root = document.querySelector('article, main, .content, .post, .entry-content, [role="main"]')
    || document.body;

  const images = root.querySelectorAll('img');
  const urls = [];

  for (const img of images) {
    const src = img.src;
    if (src && !src.startsWith('data:')) {
      urls.push(src);
    }
  }

  return [...new Set(urls)]; // deduplicate
}

/**
 * Trigger a page download via Service Worker.
 * @param {string} pageTitle
 * @param {string} markdown
 * @param {string[]} imageUrls
 * @returns {Promise<{downloadId: string}>}
 */
export async function triggerDownload(pageTitle, markdown, imageUrls) {
  const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await chrome.runtime.sendMessage({
    type: 'DOWNLOAD',
    tabId: 0, // SW will infer from sender if needed
    downloadId,
    pageTitle: sanitizeFilename(pageTitle),
    markdown,
    imageUrls,
  });

  return { downloadId };
}

/**
 * Sanitize a string for use as a filename.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
