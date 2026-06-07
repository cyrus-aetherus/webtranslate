/**
 * WebTranslate shared SVG icon helpers.
 * Material 3 design language — primary #6750a4.
 */

/**
 * Simplified logo mark — purple reticle circle + "T".
 * Optimised for small sizes (12-20px). No corner brackets.
 * @param {number} [size=14] - pixel width/height
 * @returns {string} inline SVG markup
 */
export function logoBadge(size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="#6750a4" stroke-width="1.8"/><path d="M9 9h6v1.2h-2.4v4.8h-1.2V10.2H9z" fill="#6750a4"/></svg>`;
}
