/**
 * Content Scanner — Text-driven extraction
 * Scans a DOM subtree for translatable text blocks.
 * Rules: semantic tags are extracted directly; any other tag with enough
 * direct text (excluding child elements) is treated as a text block.
 */

import {
  TRANSLATABLE_TAGS,
  EXCLUDED_CONTAINERS,
  EXCLUDED_ROLES,
  EXCLUDED_CLASS_PATTERNS,
  PROTECTED_TAGS,
} from '../../shared/constants.js';
import { isPureUrl, isShortNumberOrTimestamp } from '../../shared/utils.js';

const MIN_TEXT_LENGTH = 3;
const MIN_DIRECT_TEXT_LENGTH = 15;
const MAX_TEXT_LENGTH = 5000;
const LINK_DENSITY_THRESHOLD = 0.5;

const INTERACTIVE_TAGS = new Set([
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
]);

/**
 * Scan a root element for translatable text blocks.
 * @param {Element} root
 * @returns {{element: Element, text: string}[]}
 */
export function scanTextBlocks(root) {
  const results = [];

  function walk(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    if (isExcluded(el)) return;

    // Skip already-translated elements and translation UI cards
    if (el.dataset?.wtDone) return;
    if (el.classList?.contains('wt-inline-block') || el.classList?.contains('wt-pending')) return;

    const tag = el.tagName;

    // Case 1: semantic translatable tag — extract directly
    if (TRANSLATABLE_TAGS.has(tag)) {
      // Skip elements that contain protected tags (math, code, pre, svg)
      if (hasProtectedDescendant(el)) return;
      const text = getText(el);
      if (isContentBlock(text, el)) {
        results.push({ element: el, text });
      }
      return;
    }

    // Case 2: contains interactive elements — recurse children only
    if (hasInteractiveDescendant(el)) {
      for (const child of el.children) walk(child);
      return;
    }

    // Case 3: contains semantic descendants — recurse so p/h1/etc are extracted individually
    if (hasTranslatableDescendant(el)) {
      for (const child of el.children) walk(child);
      return;
    }

    // Case 4: any other tag with enough direct text (not from children)
    const text = getText(el);
    const directText = getDirectText(el);
    if (directText.length >= MIN_DIRECT_TEXT_LENGTH && isContentBlock(text, el)) {
      // Skip elements that contain protected tags (math, code, pre, svg)
      if (hasProtectedDescendant(el)) return;
      results.push({ element: el, text });
      return;
    }

    // Case 5: recurse into children
    for (const child of el.children) walk(child);
  }

  for (const child of root.children) walk(child);
  return results;
}

// ------------------------------------------------------------------
// Exclusion
// ------------------------------------------------------------------

function isExcluded(el) {
  let node = el;
  while (node && node !== document.body) {
    if (EXCLUDED_CONTAINERS.has(node.tagName)) return true;

    const role = node.getAttribute?.('role');
    if (role && EXCLUDED_ROLES.includes(role)) return true;

    const cls = node.className;
    if (typeof cls === 'string') {
      for (const pattern of EXCLUDED_CLASS_PATTERNS) {
        if (pattern.test(cls)) return true;
      }
    }

    node = node.parentElement;
  }
  return false;
}

// ------------------------------------------------------------------
// Block-level filtering
// ------------------------------------------------------------------

function isContentBlock(text, el) {
  if (!text || text.length < MIN_TEXT_LENGTH) return false;
  if (text.length > MAX_TEXT_LENGTH) return false;
  if (isPureUrl(text)) return false;
  if (isShortNumberOrTimestamp(text)) return false;
  if (getLinkDensity(el) > LINK_DENSITY_THRESHOLD) return false;
  return true;
}

function getLinkDensity(el) {
  const text = el.textContent.trim();
  if (!text) return 0;
  const links = el.querySelectorAll('a');
  let linkTextLen = 0;
  for (const a of links) linkTextLen += a.textContent.length;
  return linkTextLen / text.length;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function getText(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function getDirectText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function hasInteractiveDescendant(el) {
  return el.querySelector(Array.from(INTERACTIVE_TAGS).join(',')) !== null;
}

function hasTranslatableDescendant(el) {
  return el.querySelector(Array.from(TRANSLATABLE_TAGS).join(',')) !== null;
}

function hasProtectedDescendant(el) {
  // Lowercase for jsdom compatibility (MathML/SVG elements use lowercase tagName in queries)
  return el.querySelector(Array.from(PROTECTED_TAGS).map(t => t.toLowerCase()).join(',')) !== null;
}
