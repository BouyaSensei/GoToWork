// Dependency-free icon generator for GoToWork.
// Produces build/icon.png (256x256) and build/icon.ico (256x256, PNG-compressed entry).
// Design: dark rounded square (#0b0e14) with a cyan forward chevron (#2dd4bf) —
// "momentum / going to work". No fonts, no canvas deps: raw pixels + zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'build');
mkdirSync(OUT_DIR, { recursive: true });

const S = 256;
const BG = [11, 14, 20, 255];      // #0b0e14
const ACCENT = [45, 212, 191, 255]; // #2dd4bf

// Rounded-rect coverage (with AA) for a full-bleed square, corner radius r.
function roundedRectCoverage(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy) - r; // signed distance (negative inside)
  return clamp01(0.5 - d);
}

// Distance from point P to segment AB.
function distToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const len2 = abx * abx + aby * aby || 1e-6;
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

// Chevron ">" : A(top-left) -> B(mid-right) -> C(bottom-left), stroke radius R.
function chevronCoverage(x, y) {
  const A = [92, 70], B = [158, 128], C = [92, 186];
  const d = Math.min(distToSeg(x, y, ...A, ...B), distToSeg(x, y, ...B, ...C));
  const R = 27;
  return clamp01(0.5 - (d - R));
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Compose one pixel via 3x3 supersampling for smooth edges.
const px = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    const N = 3;
    for (let sy = 0; sy < N; sy++) {
      for (let sx = 0; sx < N; sx++) {
        const xx = x + (sx + 0.5) / N;
        const yy = y + (sy + 0.5) / N;
        const bgCov = roundedRectCoverage(xx, yy, S, 52);
        if (bgCov <= 0) continue;
        const acc = chevronCoverage(xx, yy);
        // Blend accent over background by coverage.
        const rr = BG[0] * (1 - acc) + ACCENT[0] * acc;
        const gg = BG[1] * (1 - acc) + ACCENT[1] * acc;
        const bb = BG[2] * (1 - acc) + ACCENT[2] * acc;
        r += rr * bgCov; g += gg * bgCov; b += bb * bgCov; a += 255 * bgCov;
      }
    }
    const n = N * N;
    const i = (y * S + x) * 4;
    px[i] = Math.round(r / n);
    px[i + 1] = Math.round(g / n);
    px[i + 2] = Math.round(b / n);
    px[i + 3] = Math.round(a / n);
  }
}

/* ----------------------------- PNG encoder ---------------------------- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  // Prepend a filter byte (0 = None) to each scanline.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const png = encodePNG(S, S, px);
writeFileSync(join(OUT_DIR, 'icon.png'), png);

/* ------------------------------ ICO wrapper --------------------------- */
// ICONDIR + ICONDIRENTRY + PNG payload (256x256 entries are width/height 0).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;         // width/height = 256 (encoded as 0)
entry[2] = 0; entry[3] = 0;         // palette/reserved
entry.writeUInt16LE(1, 4);          // planes
entry.writeUInt16LE(32, 6);         // bpp
entry.writeUInt32LE(png.length, 8); // payload size
entry.writeUInt32LE(22, 12);        // offset (6 + 16)
writeFileSync(join(OUT_DIR, 'icon.ico'), Buffer.concat([header, entry, png]));

console.log(`Wrote ${join(OUT_DIR, 'icon.png')} (${png.length} bytes)`);
console.log(`Wrote ${join(OUT_DIR, 'icon.ico')} (${png.length + 22} bytes)`);
