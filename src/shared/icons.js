/**
 * WebTranslate shared SVG icon helpers.
 * Material 3 design language — primary #6750a4.
 *
 * Usage:
 *   import { logoBadge, logoFull } from '../shared/icons.js';
 *   element.innerHTML = logoBadge(14);
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

/**
 * Full logo — four corner brackets + purple reticle circle + "T".
 * Best at 18px and above.
 * @param {number} [size=20] - pixel width/height
 * @returns {string} inline SVG markup
 */
export function logoFull(size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <path d="M2 7V2h5" stroke="#6750a4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M17 2h5v5" stroke="#6750a4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 17v5h5" stroke="#6750a4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M17 22h5v-5" stroke="#6750a4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="6.5" stroke="#6750a4" stroke-width="1.5"/>
    <path d="M8.5 8.5h7v1.4h-2.8v5.6h-1.4V9.9H8.5z" fill="#6750a4"/>
  </svg>`;
}
