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
  // 1. Clone document and merge translations into original elements.
  //    .wt-inline-block DIVs are inserted after the original element.
  //    We append the translated text to the original element, then remove
  //    the block so Readability sees a single text node with both languages.
  const docClone = document.cloneNode(true);
  docClone.querySelectorAll('#wt-fab, #wt-fab-backdrop, .wt-progress, .wt-pending').forEach(el => el.remove());

  // Remove equation/formula display tables (ltx_equation, ltx_eqn_table) —
  // these are LaTeX formulas rendered as HTML tables for layout, not content.
  docClone.querySelectorAll('.ltx_equation, .ltx_eqn_table, .ltx_equationgroup').forEach(el => el.remove());

  docClone.querySelectorAll('.wt-inline-block').forEach((block) => {
    const body = block.querySelector('.wt-inline-body');
    const trans = body ? body.textContent.trim() : '';
    if (!trans) { block.remove(); return; }
    const orig = block.previousElementSibling;
    // Only merge translations for non-table elements.  Modifying table
    // cell DOM (<td>/<th>) breaks Readability's table detection and
    // causes tables to disappear from the output entirely.
    if (orig && !orig.closest('table')) {
      orig.appendChild(docClone.createElement('br'));
      orig.appendChild(docClone.createTextNode(`[中文] ${trans}`));
    }
    block.remove();
  });

  // 2. Replace content tables with placeholder markers BEFORE Readability.
  //    Each marker is a <div> with a unique ID — it survives Readability
  //    and Turndown as plain text.  After the markdown is generated,
  //    we replace each marker with the corresponding table markdown.
  //    This keeps tables at their correct position in the document flow.
  const tableMarkers = new Map(); // markerId -> tableMarkdown
  let markerSeq = 0;

  docClone.querySelectorAll('table').forEach(t => {
    const cls = t.className || '';
    if (/\b(ltx_equation|ltx_eqn_table|ltx_equationgroup)\b/.test(cls)) return;
    if (t.querySelectorAll('tr').length < 2) return;
    const md = turndown.turndown(t.outerHTML);
    if (!md.trim()) return;
    const markerId = `WTTABLEMARKER${markerSeq++}END`;
    tableMarkers.set(markerId, md.trim());
    const marker = docClone.createElement('p');
    marker.textContent = markerId;
    // Place marker AFTER the figure so the figcaption (title) appears first
    const figure = t.closest('figure');
    if (figure && figure.parentElement) {
      figure.parentElement.insertBefore(marker, figure.nextElementSibling);
    } else {
      t.parentElement?.insertBefore(marker, t.nextElementSibling);
    }
    t.remove();
  });

  // 3. Extract clean article content using Firefox Reader View algorithm
  const article = new Readability(docClone).parse();

  let html;
  let titlePrefix = '';
  if (article && article.content) {
    if (article.title) titlePrefix = '# ' + article.title + '\n\n';
    html = article.content;
  } else {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => el.remove());
    html = clone.innerHTML;
  }

  // 4. Convert to Markdown.  Then replace table markers with actual table content.
  let md = titlePrefix + turndown.turndown(html);
  md = md.replace(/\n{4,}/g, '\n\n\n');
  for (const [markerId, tableMd] of tableMarkers) {
    md = md.replace(markerId, '\n\n' + tableMd + '\n');
  }
  return md.trim() + '\n';
}

/**
 * Collect all image URLs inside the content area.
 * Returns objects with both the resolved absolute URL and the original src attribute —
 * Readability preserves the HTML attribute value which may be relative.
 * @returns {Array<{absolute: string, original: string}>}
 */
export function collectImageUrls() {
  const root = document.querySelector('article, main, .content, .post, .entry-content, [role="main"]')
    || document.body;

  const images = root.querySelectorAll('img');
  const seen = new Set();
  const urls = [];

  for (const img of images) {
    const absolute = img.src;
    if (!absolute || absolute.startsWith('data:')) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const original = img.getAttribute('src') || absolute;
    urls.push({ absolute, original });
  }

  return urls;
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
    imageUrls, // Array<{absolute: string, original: string}>
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
