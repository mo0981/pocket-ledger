const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- minimal PNG encoder ---------- */

let _tbl = null;
function crcTable() {
  if (_tbl) return _tbl;
  _tbl = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    _tbl[n] = c;
  }
  return _tbl;
}

function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- drawing ---------- */

function inRoundRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  let dx = 0, dy = 0;
  if (x < rx + r) dx = rx + r - x;
  else if (x > rx + rw - r) dx = x - (rx + rw - r);
  if (y < ry + r) dy = ry + r - y;
  else if (y > ry + rh - r) dy = y - (ry + rh - r);
  return dx * dx + dy * dy <= r * r;
}

const BG = [15, 110, 86, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function makeIcon(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const k = size / 512;
  const s = maskable ? 0.66 : 1.0;

  const bgRadius = maskable ? 0 : 112 * k;

  const cardW = 232 * s;
  const cardH = 292 * s;
  const cardX = 256 - cardW / 2;
  const cardY = 256 - cardH / 2;
  const cardR = 32 * s;

  const barH = 17 * s;
  const barYs = [
    cardY + cardH * 0.20,
    cardY + cardH * 0.46,
    cardY + cardH * 0.72
  ];
  const barX0 = cardX + cardW * 0.17;
  const barX1 = cardX + cardW * 0.83;
  const barX1Short = cardX + cardW * 0.62;

  for (let y = 0; y < size; y++) {
    const ly = y / k + 0.5 / k;
    for (let x = 0; x < size; x++) {
      const lx = x / k + 0.5 / k;
      let col = CLEAR;

      const insideBg = maskable ? true : inRoundRect(lx, ly, 0, 0, 512, 512, 112);
      if (!insideBg) { col = CLEAR; }
      else {
        col = BG;
        if (inRoundRect(lx, ly, cardX, cardY, cardW, cardH, cardR)) {
          col = WHITE;
          let inBar = false;
          for (let i = 0; i < 3; i++) {
            const y0 = barYs[i];
            const xEnd = i === 2 ? barX1Short : barX1;
            if (ly >= y0 && ly < y0 + barH && lx >= barX0 && lx < xEnd) inBar = true;
          }
          if (inBar) col = BG;
        }
      }

      const o = (y * size + x) * 4;
      buf[o] = col[0];
      buf[o + 1] = col[1];
      buf[o + 2] = col[2];
      buf[o + 3] = col[3];
    }
  }
  return encodePNG(size, size, buf);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false]
];

for (const [name, size, maskable] of jobs) {
  const png = makeIcon(size, maskable);
  fs.writeFileSync(path.join(dir, name), png);
  console.log(`✓ ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
