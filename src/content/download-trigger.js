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
import { Readability } from '@mozilla/readability';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/**
 * Generate Markdown from the current page content.
 * Uses Readability to extract clean article content, then converts to Markdown.
 * Falls back to document.body + basic filtering if no article is found.
 * @returns {string}
 */
export function generateMarkdown() {
  // 1. Extract clean article content using Firefox Reader View algorithm
  const docClone = document.cloneNode(true);
  const article = new Readability(docClone).parse();

  let html;
  if (article && article.content) {
    // Readability found an article — use its cleaned HTML
    html = article.content;
  } else {
    // Fallback: use body with basic script/style/nav removal
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => el.remove());
    html = clone.innerHTML;
  }

  // 2. Replace inline translation blocks with their text
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('.wt-inline-block').forEach((block) => {
    const body = block.querySelector('.wt-inline-body');
    if (body) {
      const span = document.createElement('span');
      span.textContent = ` [${body.textContent}] `;
      block.replaceWith(span);
    } else {
      block.remove();
    }
  });

  // 3. Convert to Markdown and clean up excess whitespace
  let md = turndown.turndown(tmp.innerHTML);
  // Collapse 3+ consecutive blank lines into 2
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
