'use strict';

/* =====================================================================
   desktop/make-icon.js — Sinh biểu tượng devtrace.ico.

   Không tải gì từ mạng và không cần thư viện ngoài: tệp này tự vẽ hình,
   tự nén PNG bằng zlib có sẵn của Node, rồi tự đóng gói thành tệp .ico.

   Hình là biểu tượng của DevTrace: nền mực đêm, viền đồng đỏ, và đường
   gấp khúc trắng như dấu vết để lại.

   Chạy lại khi muốn đổi hình:  node desktop/make-icon.js
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_FILE = path.join(__dirname, 'devtrace.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const INK = [0x16, 0x10, 0x0d];
const RUST = [0xc8, 0x54, 0x3c];
const PAPER = [0xe9, 0xd9, 0xc6];

// Dấu vết, theo hệ toạ độ 32x32 giống biểu tượng trên thanh địa chỉ.
const TRACE = [[6, 22], [12, 10], [16, 19], [20, 13], [26, 22]];

/* --- Vẽ: một khung đệm alpha nhân trước, vẽ ở cỡ phóng to rồi thu nhỏ --- */

function makeCanvas(w, h) {
  return { w: w, h: h, px: new Float32Array(w * h * 4) };
}

function blend(c, x, y, rgb, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const inv = 1 - a;
  c.px[i] = rgb[0] * a + c.px[i] * inv;
  c.px[i + 1] = rgb[1] * a + c.px[i + 1] * inv;
  c.px[i + 2] = rgb[2] * a + c.px[i + 2] * inv;
  c.px[i + 3] = a + c.px[i + 3] * inv;
}

function insideRoundRect(x, y, left, top, w, h, r) {
  if (x < left || y < top || x > left + w || y > top + h) return false;
  const cx = Math.min(Math.max(x, left + r), left + w - r);
  const cy = Math.min(Math.max(y, top + r), top + h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundRect(c, left, top, w, h, r, rgb, alpha) {
  const a = alpha === undefined ? 1 : alpha;
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(c.w - 1, Math.ceil(left + w));
  const y1 = Math.min(c.h - 1, Math.ceil(top + h));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (insideRoundRect(x + 0.5, y + 0.5, left, top, w, h, r)) blend(c, x, y, rgb, a);
    }
  }
}

function strokeRoundRect(c, left, top, w, h, r, thickness, rgb) {
  const inner = { left: left + thickness, top: top + thickness, w: w - thickness * 2, h: h - thickness * 2 };
  const x0 = Math.max(0, Math.floor(left - 1));
  const y0 = Math.max(0, Math.floor(top - 1));
  const x1 = Math.min(c.w - 1, Math.ceil(left + w + 1));
  const y1 = Math.min(c.h - 1, Math.ceil(top + h + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!insideRoundRect(px, py, left, top, w, h, r)) continue;
      if (inner.w > 0 && inner.h > 0 &&
          insideRoundRect(px, py, inner.left, inner.top, inner.w, inner.h, Math.max(0, r - thickness))) continue;
      blend(c, x, y, rgb, 1);
    }
  }
}

function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
}

function strokeSegment(c, x1, y1, x2, y2, halfWidth, rgb) {
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - halfWidth - 1));
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - halfWidth - 1));
  const x1e = Math.min(c.w - 1, Math.ceil(Math.max(x1, x2) + halfWidth + 1));
  const y1e = Math.min(c.h - 1, Math.ceil(Math.max(y1, y2) + halfWidth + 1));
  for (let y = y0; y <= y1e; y++) {
    for (let x = x0; x <= x1e; x++) {
      if (segmentDistance(x + 0.5, y + 0.5, x1, y1, x2, y2) <= halfWidth) blend(c, x, y, rgb, 1);
    }
  }
}

/* --- Vẽ một cỡ, ở độ phóng đại rồi thu nhỏ (để có viền mượt) ---------- */

const SUPERSAMPLE = 4;

function paint(size) {
  const S = size * SUPERSAMPLE;
  const c = makeCanvas(S, S);
  const unit = S / 32;
  fillRoundRect(c, unit * 1.2, unit * 1.2, S - unit * 2.4, S - unit * 2.4, unit * 7.5, INK);
  strokeRoundRect(c, unit * 3.4, unit * 3.4, S - unit * 6.8, S - unit * 6.8,
    unit * 5.6, Math.max(unit * 0.9, 1.1), RUST);
  const width = Math.max(unit * (size <= 20 ? 2.9 : 2.2), 1.6) / 2;
  for (let i = 0; i < TRACE.length - 1; i++) {
    strokeSegment(c, TRACE[i][0] * unit, TRACE[i][1] * unit,
      TRACE[i + 1][0] * unit, TRACE[i + 1][1] * unit, width, PAPER);
  }
  return c;
}

function downsample(c, size) {
  const out = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const i = ((y * SUPERSAMPLE + sy) * c.w + (x * SUPERSAMPLE + sx)) * 4;
          r += c.px[i]; g += c.px[i + 1]; b += c.px[i + 2]; a += c.px[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.min(255, Math.round(r / a));
        out[o + 1] = Math.min(255, Math.round(g / a));
        out[o + 2] = Math.min(255, Math.round(b / a));
      }
      out[o + 3] = Math.min(255, Math.round(a / n * 255));
    }
  }
  return out;
}

/* --- Gói PNG -------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* --- Gói ICO -------------------------------------------------------- */

function render(size) {
  return encodePng(size, size, downsample(paint(size), size));
}

// Windows Vista trở lên đọc được ảnh PNG nằm trong tệp .ico, nên mỗi cỡ
// chỉ cần một ảnh PNG. Cỡ 256 ghi là 0 theo đúng quy ước của định dạng.
function icon(sizes) {
  const list = (sizes || SIZES).slice().sort((a, b) => a - b);
  const images = list.map((size) => ({ size: size, data: render(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = [];
  const bodies = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size;
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    bodies.push(img.data);
    offset += img.data.length;
  }
  return Buffer.concat([header].concat(entries, bodies));
}

// Đọc lược đồ tệp .ico để bên kiểm thử soi lại được.
function readIcon(buffer) {
  if (!buffer || buffer.length < 6) return null;
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + 16 * i;
    if (base + 16 > buffer.length) return null;
    const size = buffer[base] === 0 ? 256 : buffer[base];
    const bytes = buffer.readUInt32LE(base + 8);
    const offset = buffer.readUInt32LE(base + 12);
    const body = buffer.slice(offset, offset + bytes);
    entries.push({
      size: size,
      bytes: bytes,
      offset: offset,
      png: body.length > 4 && body[0] === 0x89 && body.slice(1, 4).toString('ascii') === 'PNG'
    });
  }
  return { count: count, entries: entries };
}

function writeIcon(file) {
  const target = file || OUT_FILE;
  fs.writeFileSync(target, icon());
  return target;
}

if (require.main === module) {
  const target = writeIcon(process.argv[2]);
  process.stdout.write('Đã ghi ' + target + ' (' + SIZES.join(', ') + ' px)\n');
}

module.exports = {
  OUT_FILE: OUT_FILE,
  SIZES: SIZES,
  paint: paint,
  downsample: downsample,
  encodePng: encodePng,
  render: render,
  icon: icon,
  readIcon: readIcon,
  writeIcon: writeIcon
};
