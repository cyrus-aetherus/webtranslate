/**
 * Content Root Finder
 * Finds the best content root(s) for translation extraction.
 * Multi-candidate collection + deduplication + smart sibling merging.
 */

import { CONTENT_SELECTORS } from '../../shared/constants.js';

/**
 * Find all candidate content roots on the page.
 * @returns {Element[]}
 */
export function findContentRoots() {
  const candidates = [];

  for (const selector of CONTENT_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => candidates.push(el));
  }

  if (candidates.length === 0) {
    return [document.body];
  }

  // Deduplicate: if A contains B, keep only the outermost A
  const roots = candidates.filter((a) =>
    !candidates.some((b) => b !== a && b.contains(a))
  );

  // Smart merge: if multiple candidates are same-tag siblings, return their parent
  if (roots.length >= 2) {
    const firstParent = roots[0].parentElement;
    if (
      firstParent &&
      roots.every((r) => r.parentElement === firstParent)
    ) {
      const allSameTag = roots.every((r) => r.tagName === roots[0].tagName);
      if (allSameTag) {
        return [firstParent];
      }
    }
  }

  // Sort by area + center-weighted score (larger and more centered = better)
  roots.sort((a, b) => scoreRoot(b) - scoreRoot(a));
  return roots;
}

/**
 * Score a root element by area and visual centrality.
 * Larger area and closer to viewport center = higher score.
 */
function scoreRoot(el) {
  const rect = el.getBoundingClientRect();
  const area = rect.width * rect.height;
  const centerX = (rect.left + rect.right) / 2;
  const screenCenterX = window.innerWidth / 2;
  const centerDist = Math.abs(centerX - screenCenterX);
  // penalize elements far from center; minimum area threshold of 100
  return Math.max(0, area - centerDist * 10);
}
