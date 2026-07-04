/**
 * Generate the Handshake Agent PWA icon set as PNGs — self-contained, no deps.
 *
 * Why hand-rolled: the constraint is "icons generated locally, no external calls
 * at runtime" and we do not want to add `sharp`/a rasteriser to the web workspace
 * just for a one-shot asset build. This encodes 8-bit RGBA PNGs with Node's
 * built-in `zlib` and a small CRC32, drawing the canonical brand mark (an orange
 * squircle with a deep-green centre on a deep-green tile) at 4x supersampling for
 * smooth edges. Run: `node scripts/generate-pwa-icons.mjs`. Outputs → public/icons.
 *
 * The mark geometry mirrors components/shared/brand-mark.tsx; the hexes mirror the
 * oklch tokens in app/globals.css (see lib/site.ts BRAND).
 */
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons")

// ─── Brand palette (hex → rgb) ───────────────────────────────────────────────
const GREEN_DEEP = [0x0e, 0x24, 0x1c] // tile background + mark centre
const ACCENT = [0xf5, 0xa6, 0x23] // orange gradient top
const ACCENT_DEEP = [0xe8, 0x96, 0x1a] // orange gradient bottom

// ─── Geometry helpers ────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t
const lerpRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** 1 when (px,py) is inside a rounded rect, 0 outside (continuous coords). */
function insideRoundedRect(px, py, x0, y0, w, h, r) {
  const x1 = x0 + w
  const y1 = y0 + h
  if (px < x0 || px > x1 || py < y0 || py > y1) return false
  // Corner regions: point must be within radius of the corner centre.
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * Colour at continuous coords for the brand mark.
 * `markRatio` sizes the orange tile relative to the icon (smaller = more padding,
 * used for maskable safe-zone). Returns [r,g,b] (fully opaque — tiles never
 * transparent, which keeps maskable + apple-touch valid).
 */
function sampleColor(x, y, size, markRatio) {
  const markSize = size * markRatio
  const markX = (size - markSize) / 2
  const markY = (size - markSize) / 2
  const markRadius = markSize * 0.31 // brand-mark OUTER_RADIUS_RATIO
  const centreSize = markSize * 0.38 // CENTRE_SIZE_RATIO
  const centreX = (size - centreSize) / 2
  const centreY = (size - centreSize) / 2
  const centreRadius = markSize * 0.12 // CENTRE_RADIUS_RATIO

  if (insideRoundedRect(x, y, centreX, centreY, centreSize, centreSize, centreRadius)) {
    return GREEN_DEEP
  }
  if (insideRoundedRect(x, y, markX, markY, markSize, markSize, markRadius)) {
    const t = (y - markY) / markSize // vertical gradient across the tile
    return lerpRgb(ACCENT, ACCENT_DEEP, Math.max(0, Math.min(1, t)))
  }
  return GREEN_DEEP
}

/** Render an icon to a raw RGBA buffer (row-major), 4x supersampled. */
function renderRgba(size, markRatio) {
  const SS = 4
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb] = sampleColor(
            x + (sx + 0.5) / SS,
            y + (sy + 0.5) / SS,
            size,
            markRatio
          )
          r += sr
          g += sg
          b += sb
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      buf[i] = Math.round(r / n)
      buf[i + 1] = Math.round(g / n)
      buf[i + 2] = Math.round(b / n)
      buf[i + 3] = 255
    }
  }
  return buf
}

// ─── PNG encoder ─────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, "ascii")
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  // Prepend filter byte (0 = none) to each scanline.
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// ─── Emit the icon set ───────────────────────────────────────────────────────
// markRatio 0.64 (any/apple — tighter, corners of the tile visible) vs 0.52
// (maskable — extra margin so the mark stays inside the platform safe zone).
const ICONS = [
  { file: "icon-192.png", size: 192, markRatio: 0.64 },
  { file: "icon-512.png", size: 512, markRatio: 0.64 },
  { file: "icon-192-maskable.png", size: 192, markRatio: 0.52 },
  { file: "icon-512-maskable.png", size: 512, markRatio: 0.52 },
  { file: "apple-touch-icon.png", size: 180, markRatio: 0.6 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const { file, size, markRatio } of ICONS) {
  const png = encodePng(size, renderRgba(size, markRatio))
  writeFileSync(join(OUT_DIR, file), png)
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`)
}
