/**
 * DownloadTrigger - Generates Markdown from page content and collects image URLs,
 * then sends the payload to the Service Worker for ZIP packaging.
 */

import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/**
 * Generate Markdown from the current page content.
 * Prefer translated content where available.
 * @returns {string}
 */
export function generateMarkdown() {
  const root = document.querySelector('article, main, .content, .post, .entry-content, [role="main"]')
    || document.body;

  // Clone to avoid mutating live DOM
  const clone = root.cloneNode(true);

  // Replace inline translations with their text for cleaner Markdown
  clone.querySelectorAll('.wt-inline-block').forEach((block) => {
    const body = block.querySelector('.wt-inline-body');
    if (body) {
      const span = document.createElement('span');
      span.textContent = ` [${body.textContent}] `;
      block.replaceWith(span);
    } else {
      block.remove();
    }
  });

  return turndown.turndown(clone.innerHTML);
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
