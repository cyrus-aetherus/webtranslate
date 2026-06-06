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

    // Skip elements inside protected containers (math, pre, code, svg)
    if (isInsideProtected(el)) return;

    // Skip elements inside table cells — prevents table content from being
    // extracted as individual translation cards
    if (isInsideTable(el)) return;

    // Skip already-translated elements and translation UI cards
    if (el.dataset?.wtDone) return;
    if (el.classList?.contains('wt-inline-block') || el.classList?.contains('wt-pending')) return;

    const tag = el.tagName;

    // Case 1: semantic translatable tag — extract directly
    if (TRANSLATABLE_TAGS.has(tag)) {
      // Skip all table cells — inserting a block <div> card inside a
      // <tr>/<table> corrupts table layout (tested: 100% overlap rate).
      if (tag === 'TD' || tag === 'TH') return;
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
      results.push({ element: el, text });
      return;
    }

    // Case 5: recurse into children
    for (const child of el.children) walk(child);
  }

  for (const child of root.children) walk(child);
  return groupAdjacentBlocks(results);
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

/** Check if the element is inside a table (TD, TH, TR, TABLE ancestors). */
function isInsideTable(el) {
  let node = el.parentElement;
  while (node) {
    const tag = node.tagName;
    if (tag === 'TD' || tag === 'TH') return true;
    // Stop at block-level containers — don't walk past section boundaries
    if (tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'BODY') return false;
    node = node.parentElement;
  }
  return false;
}

/** Check if the element is inside a protected container (math, pre, code, svg).
 *  SVG container elements (<g>, <defs>, <a>) and <foreignObject> are NOT
 *  protected — they may contain translatable HTML content. */
function isInsideProtected(el) {
  if (el.tagName.toUpperCase() === 'FOREIGNOBJECT') return false;

  let node = el.parentElement;
  while (node) {
    const tag = node.tagName.toUpperCase();
    if (tag === 'FOREIGNOBJECT') return false;
    if (PROTECTED_TAGS.has(tag)) {
      // SVG container elements may hold foreignObject with HTML content
      if (tag === 'SVG') {
        const et = el.tagName.toUpperCase();
        if (et === 'G' || et === 'DEFS' || et === 'A' || et === 'SYMBOL') return false;
      }
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

// ------------------------------------------------------------------
// Grouping — consecutive sibling blocks merged into one translation unit
// ------------------------------------------------------------------

/**
 * Group consecutive blocks that belong to the same logical section.
 * Two blocks are grouped when:
 *   a) they share the same direct parent, OR
 *   b) their parents are adjacent siblings in the same grandparent
 *      (e.g. P elements inside consecutive ltx_para divs within a section).
 *
 * If the combined text would exceed MAX_TEXT_LENGTH the group is capped
 * and a new group starts.
 */
function groupAdjacentBlocks(blocks) {
  if (blocks.length <= 1) return blocks;

  const groups = [];
  let currentGroup = [blocks[0]];
  let currentLen = blocks[0].text.length;

  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1].element;
    const curr = blocks[i].element;
    const nextLen = blocks[i].text.length + 2; // +2 for '\n\n' separator

    if (currentLen + nextLen <= MAX_TEXT_LENGTH && sameLogicalGroup(prev, curr)) {
      currentGroup.push(blocks[i]);
      currentLen += nextLen;
    } else {
      groups.push(currentGroup);
      currentGroup = [blocks[i]];
      currentLen = blocks[i].text.length;
    }
  }
  groups.push(currentGroup);

  return groups.map(group => {
    if (group.length === 1) return group[0];
    return {
      element: group[group.length - 1].element, // last element → card anchor
      text: group.map(b => b.text).join('\n\n'),
      groupElements: group.map(b => b.element),
    };
  });
}

/**
 * Two elements belong to the same logical group when:
 * 1. Same direct parent, OR
 * 2. Both are inside the same SVG foreignObject (Summary boxes, etc.)
 */
function sameLogicalGroup(el1, el2) {
  if (el1.parentElement === el2.parentElement) return true;

  // Elements inside the same foreignObject form one logical unit
  // (e.g. arXiv "Summary & Ideas" boxes rendered as SVG foreignObject)
  const fo = findForeignObject(el1);
  if (fo && fo === findForeignObject(el2)) return true;

  return false;
}

function findForeignObject(el) {
  let node = el;
  while (node) {
    if (node.tagName.toUpperCase() === 'FOREIGNOBJECT') return node;
    node = node.parentElement;
  }
  return null;
}
