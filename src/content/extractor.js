/**
 * DOM paragraph extractor for WebTranslate
 * Responsible for:
 *   - Finding the content root (article > main > .content > body fallback)
 *   - Collecting translatable elements (p, h1-h6, li, td/th, blockquote)
 *   - Excluding navigation, header, footer, aside, ads
 *   - Protecting code blocks, math, URLs, short numbers
 */

import {
  CONTENT_SELECTORS,
  TRANSLATABLE_TAGS,
  EXCLUDED_CONTAINERS,
  EXCLUDED_ROLES,
  PROTECTED_TAGS,
} from '../shared/constants.js';
import { isPureUrl, isShortNumberOrTimestamp } from '../shared/utils.js';

/**
 * Extract paragraphs eligible for translation from the current document.
 * @returns {Element[]}
 */
export function extractParagraphs() {
  const root = findContentRoot();
  const candidates = root.querySelectorAll(Array.from(TRANSLATABLE_TAGS).join(','));

  return Array.from(candidates).filter((el) => {
    if (isExcluded(el)) return false;
    if (isProtected(el)) return false;
    const text = getTranslatableText(el);
    if (!text || text.length < 3) return false;
    if (isPureUrl(text)) return false;
    if (isShortNumberOrTimestamp(text)) return false;
    return true;
  });
}

/**
 * Find the best content root element.
 * Priority: article > main > .content > .post > .entry-content > [role=main] > body
 * @returns {Element}
 */
export function findContentRoot() {
  for (const selector of CONTENT_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return document.body;
}

/**
 * Check if an element or its ancestors are in excluded containers.
 * @param {Element} el
 * @returns {boolean}
 */
function isExcluded(el) {
  let node = el;
  while (node && node !== document.body) {
    if (EXCLUDED_CONTAINERS.has(node.tagName)) return true;
    const role = node.getAttribute?.('role');
    if (role && EXCLUDED_ROLES.includes(role)) return true;
    // Heuristic: common ad container classes
    const cls = node.className;
    if (typeof cls === 'string') {
      const adLike = /(^|\s)(ad-|ads-|advertisement|banner|sponsor)/i;
      if (adLike.test(cls)) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Check if an element contains protected content (code, math, etc.)
 * @param {Element} el
 * @returns {boolean}
 */
function isProtected(el) {
  // Direct child pre/code or math
  for (const tag of PROTECTED_TAGS) {
    if (el.querySelector(tag)) return true;
    if (el.tagName === tag) return true;
  }
  // Inline code is allowed if mixed with other text; pure code blocks are skipped above
  // MathJax / KaTeX delimiters
  const text = el.textContent;
  if (/\$\$[\s\S]+?\$\$/.test(text)) return true;
  return false;
}

/**
 * Get clean translatable text from an element.
 * Strips inline code/tags but preserves readable structure.
 * @param {Element} el
 * @returns {string}
 */
export function getTranslatableText(el) {
  // Clone to avoid mutating the live DOM
  const clone = el.cloneNode(true);

  // Remove sub-elements that should not be translated (images, videos, etc.)
  const removeTags = ['IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'SVG', 'CANVAS'];
  for (const tag of removeTags) {
    clone.querySelectorAll(tag).forEach((n) => n.remove());
  }

  // Get text content and normalize whitespace
  let text = clone.textContent.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Generate a stable paragraph ID based on its DOM position.
 * @param {Element} el
 * @returns {string}
 */
export function generateParagraphId(el) {
  const tag = el.tagName.toLowerCase();
  // Simple index-based ID; may be refined with XPath if needed
  const index = Array.from(el.parentElement?.children || []).indexOf(el);
  return `wt_${tag}_${index}`;
}
