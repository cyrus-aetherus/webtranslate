/**
 * Generate Chrome extension icons using Jimp
 * Produces 16x16, 32x32, 48x48, 128x128 PNG icons
 * Material 3 design: white rounded rect + purple line-drawn ring + "T"
 */

import { Jimp } from 'jimp';
import path from 'path';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = 'src/assets/icons';

// Material 3 palette
const PR = 103, PG = 80, PB = 164;  // primary #6750a4
const LIGHT_R = 234, LIGHT_G = 221, LIGHT_B = 255; // primary-light #eaddff

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function toHex(r, g, b, a = 255) {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

async function generate(size) {
  const buf = Buffer.alloc(size * size * 4); // transparent

  function setRaw(x, y, r, g, b, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  }

  const cx = size / 2, cy = size / 2;

  /* ---- rounded rect corner radius ---- */
  const cr = Math.max(1, Math.round(size * 0.2));

  function inRRect(x, y) {
    if (x >= cr && x < size - cr) return true;
    if (y >= cr && y < size - cr) return true;
    if (x < cr && y < cr && (x - cr) ** 2 + (y - cr) ** 2 <= cr * cr) return true;
    if (x >= size - cr && y < cr && (x - (size - cr - 1)) ** 2 + (y - cr) ** 2 <= cr * cr) return true;
    if (x < cr && y >= size - cr && (x - cr) ** 2 + (y - (size - cr - 1)) ** 2 <= cr * cr) return true;
    if (x >= size - cr && y >= size - cr &&
      (x - (size - cr - 1)) ** 2 + (y - (size - cr - 1)) ** 2 <= cr * cr) return true;
    return false;
  }

  /* ================================================================
     LAYER 1: white rounded rectangle background
     ================================================================ */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRRect(x, y)) continue;
      setRaw(x, y, 255, 255, 255, 255);
    }
  }

  /* ================================================================
     LAYER 2: circle ring (line-drawn)
     ================================================================ */
  const ringR = size * 0.33;
  const ringW = Math.max(1, size * 0.055);  // stroke width
  const halfW = ringW / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRRect(x, y)) continue;
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      const ed = Math.abs(d - ringR);
      if (ed <= halfW + 0.5) {
        const a = Math.max(0, Math.min(1, halfW + 0.5 - ed));
        // Anti-aliased: blend purple onto white
        const base = buf[(y * size + x) * 4]; // existing R (should be 255)
        const r = clamp(base * (1 - a) + PR * a);
        const g = clamp(buf[(y * size + x) * 4 + 1] * (1 - a) + PG * a);
        const b = clamp(buf[(y * size + x) * 4 + 2] * (1 - a) + PB * a);
        setRaw(x, y, r, g, b, 255);
      }
    }
  }

  /* ================================================================
     LAYER 3: "T" letter
     ================================================================ */
  const barH = Math.max(1, Math.round(size * 0.065));
  const barW = Math.max(2, Math.round(size * 0.34));
  const stemW = Math.max(1, Math.round(size * 0.065));
  const barTop = Math.round(cy - size * 0.17);
  const stemTop = barTop + barH;
  const stemBot = Math.round(cy + size * 0.19);

  function fillRect(x1, y1, x2, y2, r, g, b, a = 255) {
    for (let yy = y1; yy < y2; yy++)
      for (let xx = x1; xx < x2; xx++) setRaw(xx, yy, r, g, b, a);
  }

  // Horizontal bar
  fillRect(Math.round(cx - barW / 2), barTop, Math.round(cx + barW / 2), barTop + barH, PR, PG, PB);

  // Vertical stem
  fillRect(Math.round(cx - stemW / 2), stemTop, Math.round(cx + stemW / 2), stemBot, PR, PG, PB);

  /* ================================================================
     LAYER 4: corner brackets (only for ≥48px, lighter purple)
     ================================================================ */
  if (size >= 48) {
    const bMargin = Math.max(2, Math.round(size * 0.1));
    const bLen = Math.max(3, Math.round(size * 0.12));
    const bW = Math.max(1, Math.round(size * 0.025));

    function bracket(sx, sy, dxS, dyS) {
      // Horizontal arm
      const x0 = Math.min(sx, sx + dxS * bLen);
      const x1 = Math.max(sx, sx + dxS * bLen);
      for (let x = x0; x <= x1; x++)
        for (let d = 0; d < bW; d++)
          setRaw(x, sy + dyS * d, LIGHT_R, LIGHT_G, LIGHT_B, 255);
      // Vertical arm
      const y0 = Math.min(sy, sy + dyS * bLen);
      const y1 = Math.max(sy, sy + dyS * bLen);
      for (let y = y0; y <= y1; y++)
        for (let d = 0; d < bW; d++)
          setRaw(sx + dxS * d, y, LIGHT_R, LIGHT_G, LIGHT_B, 255);
    }

    bracket(bMargin, bMargin, 1, 1);
    bracket(size - 1 - bMargin, bMargin, -1, 1);
    bracket(bMargin, size - 1 - bMargin, 1, -1);
    bracket(size - 1 - bMargin, size - 1 - bMargin, -1, -1);
  }

  /* ================================================================
     EXPORT
     ================================================================ */
  const img = new Jimp({ width: size, height: size, color: 0x00000000 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.setPixelColor(toHex(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), x, y);
    }
  }

  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  await img.write(outPath);
  console.log(`[icons] Generated ${outPath}`);
}

async function main() {
  for (const size of SIZES) {
    await generate(size);
  }
  console.log('[icons] All icons generated successfully');
}

main().catch((err) => {
  console.error('[icons] Failed:', err);
  process.exit(1);
});
