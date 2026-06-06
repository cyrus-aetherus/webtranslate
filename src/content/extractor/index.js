/**
 * Extractor — Unified entry for content extraction.
 * Orchestrates content-root-finder + content-scanner.
 */

export { findContentRoots } from './content-root-finder.js';
import { findContentRoots } from './content-root-finder.js';
import { scanTextBlocks } from './content-scanner.js';

const MAX_ID_DEPTH = 6;

/**
 * Extract paragraphs eligible for translation from the current document.
 * Returns block descriptors: {element, text, allElements}
 * - element: anchor element (last of group) for card positioning & fingerprint
 * - text: combined text content
 * - allElements: all elements in this group (to mark all as translated)
 * @returns {Array<{element: Element, text: string, allElements: Element[]}>}
 */
export function extractParagraphs() {
  const roots = findContentRoots();
  const seen = new Set();
  const results = [];

  for (const root of roots) {
    const blocks = scanTextBlocks(root);
    for (const block of blocks) {
      if (seen.has(block.element)) continue;
      seen.add(block.element);
      results.push(block);
    }
  }

  // Flatten to descriptor objects
  const descriptors = results.map(block => ({
    element: block.element,
    text: block.text,
    allElements: block.groupElements || [block.element],
  }));

  // Debug: log extraction summary
  console.log(
    `[WT] Extracted ${descriptors.length} blocks from ${roots.length} root(s). ` +
    `Tags: ${descriptors.map(d => d.element.tagName.toLowerCase()).join(',') || 'none'}`
  );

  return descriptors;
}

/**
 * Get clean translatable text from an element.
 * No clone needed — script/style containers are already excluded by the scanner.
 * @param {Element} el
 * @returns {string}
 */
export function getTranslatableText(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Generate a stable paragraph ID based on its DOM path.
 * @param {Element} el
 * @returns {string}
 */
export function generateParagraphId(el) {
  const path = [];
  let node = el;
  let depth = 0;

  while (node && node !== document.body && depth < MAX_ID_DEPTH) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    const index = parent ? Array.from(parent.children).indexOf(node) : 0;
    path.unshift(`${tag}${index}`);
    node = parent;
    depth++;
  }

  return 'wt_' + path.join('_');
}
