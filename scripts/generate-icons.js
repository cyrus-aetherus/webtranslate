/**
 * Generate Chrome extension icons using Jimp
 * Produces 16x16, 32x32, 48x48, 128x128 PNG icons
 * Sci-fi design: dark bg + neon glow ring + sharp segmented "T" + HUD brackets
 */

import { Jimp } from 'jimp';
import path from 'path';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = 'src/assets/icons';

// Neon palette
const NR = 0, NG = 235, NB = 255;       // ring: cyan
const AR = 180, AG_ = 60, AB = 255;      // accent: magenta hint

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function toHex(r, g, b, a = 255) {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}
function hexRGB(hex) {
  const u = hex >>> 0;
  return { r: (u >> 24) & 0xff, g: (u >> 16) & 0xff, b: (u >> 8) & 0xff, a: u & 0xff };
}
function addGlow(base, r, g, b, intensity) {
  const i = intensity / 255;
  return { r: clamp(base.r + r * i), g: clamp(base.g + g * i), b: clamp(base.b + b * i), a: 255 };
}
function addGlowAA(base, r, g, b, intensity) {
  const i = intensity / 255;
  return {
    r: clamp(base.r * (1 - i) + r * i),
    g: clamp(base.g * (1 - i) + g * i),
    b: clamp(base.b * (1 - i) + b * i),
    a: clamp((base.a ?? 255) * (1 - i) + 255 * i),
  };
}

async function generate(size) {
  /* ---- pixel buffer (manual, faster than Jimp per-pixel calls) ---- */
  const buf = Buffer.alloc(size * size * 4);

  function setRaw(x, y, r, g, b, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  }
  function getRaw(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return { r: 0, g: 0, b: 0, a: 0 };
    const i = (y * size + x) * 4;
    return { r: buf[i], g: buf[i + 1], b: buf[i + 2], a: buf[i + 3] };
  }

  const cx = size / 2, cy = size / 2;
  const cr = Math.max(1, Math.round(size * 0.18));

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

  /* ---- ring params ---- */
  const ringR = size * 0.34;
  const ringW = Math.max(1.5, size * 0.05);
  const halfW = ringW / 2;
  const glowR = Math.max(3, size * 0.16);

  /* ================================================================
     LAYER 1: background + glow  (this layer will be blurred)
     ================================================================ */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRRect(x, y)) continue;

      const t = size > 1 ? y / (size - 1) : 0;
      const bg = {
        r: Math.round(8 + 4 * t),
        g: Math.round(10 + 8 * t),
        b: Math.round(22 + 14 * t),
        a: 255,
      };

      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      const ed = Math.abs(d - ringR);

      if (ed <= halfW + 0.5) {
        // Ring body — full brightness neon
        const a = Math.max(0, Math.min(1, halfW + 0.5 - ed));
        const c = addGlowAA(bg, NR, NG, NB, a * 255);
        setRaw(x, y, c.r, c.g, c.b, c.a);
      } else if (ed <= glowR) {
        // Outer glow — aggressive exponential for punchy look
        const p = (ed - halfW) / (glowR - halfW);
        const gi = Math.exp(-p * p * 4) * 200;
        // Inner glow — subtle tint inside the ring
        const innerDist = ringR - d;
        const innerGi = innerDist > 0 && innerDist < glowR * 0.6
          ? Math.exp(-((innerDist / (glowR * 0.3)) ** 2)) * 60 : 0;
        const totalI = gi + innerGi;
        const c = addGlow(bg, NR, NG, NB, totalI);
        setRaw(x, y, c.r, c.g, c.b, c.a);
      } else {
        setRaw(x, y, bg.r, bg.g, bg.b, bg.a);
      }
    }
  }

  /* ================================================================
     LAYER 2: blur only the glow layer (adaptive passes)
     ================================================================ */
  const blurPasses = size <= 32 ? 0 : size <= 48 ? 1 : 2;

  for (let pass = 0; pass < blurPasses; pass++) {
    const tmp = Buffer.from(buf);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!inRRect(x, y)) continue;
        let rS = 0, gS = 0, bS = 0, aS = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = x + dx, py = y + dy;
            if (px < 0 || px >= size || py < 0 || py >= size) continue;
            const j = (py * size + px) * 4;
            rS += tmp[j]; gS += tmp[j + 1]; bS += tmp[j + 2]; aS += tmp[j + 3]; cnt++;
          }
        }
        const i = (y * size + x) * 4;
        buf[i] = rS / cnt; buf[i + 1] = gS / cnt; buf[i + 2] = bS / cnt; buf[i + 3] = aS / cnt;
      }
    }
  }

  /* ================================================================
     LAYER 3: sharp foreground — ring body redraw
     ================================================================ */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      const ed = Math.abs(d - ringR);
      if (ed <= halfW + 0.5) {
        const a = Math.max(0, Math.min(1, halfW + 0.5 - ed));
        const base = getRaw(x, y);
        const c = addGlowAA(base, NR, NG, NB, a * 255);
        setRaw(x, y, c.r, c.g, c.b, c.a);
      }
    }
  }

  /* ================================================================
     LAYER 4: sharp "T"  (segmented, stencil style)
     ================================================================ */
  const barH = Math.max(1, Math.round(size * 0.06));
  const barW = Math.max(2, Math.round(size * 0.36));
  const stemW = Math.max(1, Math.round(size * 0.06));
  const barTop = Math.round(cy - size * 0.18);
  const stemTop = barTop + barH;
  const stemBot = Math.round(cy + size * 0.2);

  // For small sizes (≤32), skip the stencil gap
  const gap = size > 32 ? Math.max(1, Math.round(size * 0.025)) : 0;

  const white = { r: 245, g: 248, b: 255 };

  function fillRect(x1, y1, x2, y2, c) {
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2; x++) setRaw(x, y, c.r, c.g, c.b, c.a ?? 255);
  }

  // Horizontal bar
  fillRect(Math.round(cx - barW / 2), barTop, Math.round(cx + barW / 2), barTop + barH, white);

  if (gap > 0) {
    // Upper stem
    fillRect(Math.round(cx - stemW / 2), stemTop,
      Math.round(cx + stemW / 2), Math.round(cy - gap / 2), white);
    // Lower stem
    fillRect(Math.round(cx - stemW / 2), Math.round(cy + gap / 2),
      Math.round(cx + stemW / 2), stemBot, white);
  } else {
    // Solid stem for small sizes
    fillRect(Math.round(cx - stemW / 2), stemTop, Math.round(cx + stemW / 2), stemBot, white);
  }

  // Accent ticks under bar ends (only for ≥48px)
  if (size >= 48) {
    const tickH = Math.max(1, Math.round(barH * 0.6));
    const tickW = Math.max(1, Math.round(size * 0.025));
    const tick = { r: 0, g: 210, b: 240, a: 200 };
    fillRect(Math.round(cx - barW / 2), barTop + barH,
      Math.round(cx - barW / 2 + tickW), barTop + barH + tickH, tick);
    fillRect(Math.round(cx + barW / 2 - tickW), barTop + barH,
      Math.round(cx + barW / 2), barTop + barH + tickH, tick);
  }

  /* ================================================================
     LAYER 5: HUD corner brackets (only for ≥48px)
     ================================================================ */
  if (size >= 48) {
    const bMargin = Math.max(1, Math.round(size * 0.08));
    const bLen = Math.max(2, Math.round(size * 0.13));
    const bW = Math.max(1, Math.round(size * 0.022));
    const bCol = { r: 0, g: 190, b: 220, a: 170 };

    function bracket(sx, sy, dxS, dyS) {
      // Horizontal arm
      const x0 = Math.min(sx, sx + dxS * bLen);
      const x1 = Math.max(sx, sx + dxS * bLen);
      for (let x = x0; x <= x1; x++)
        for (let d = 0; d < bW; d++)
          setRaw(x, sy + dyS * d, bCol.r, bCol.g, bCol.b, bCol.a);
      // Vertical arm
      const y0 = Math.min(sy, sy + dyS * bLen);
      const y1 = Math.max(sy, sy + dyS * bLen);
      for (let y = y0; y <= y1; y++)
        for (let d = 0; d < bW; d++)
          setRaw(sx + dxS * d, y, bCol.r, bCol.g, bCol.b, bCol.a);
    }

    bracket(bMargin, bMargin, 1, 1);
    bracket(size - 1 - bMargin, bMargin, -1, 1);
    bracket(bMargin, size - 1 - bMargin, 1, -1);
    bracket(size - 1 - bMargin, size - 1 - bMargin, -1, -1);
  }

  /* ================================================================
     EXPORT: Buffer → Jimp → PNG
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
