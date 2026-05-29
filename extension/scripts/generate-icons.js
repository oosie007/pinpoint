const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, '..', 'icons');

const INDIGO = { r: 99, g: 102, b: 241 };
const WHITE = { r: 255, g: 255, b: 255 };

function crc32(buf) {
  let c = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  const crcData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function roundedRect(px, x, y, w, h, r, color) {
  for (let py = 0; py < h; py++) {
    for (let pxX = 0; pxX < w; pxX++) {
      const cx = pxX + 0.5;
      const cy = py + 0.5;
      let inside = true;
      if (cx < r && cy < r && dist(cx, cy, r, r) > r) inside = false;
      if (cx > w - r && cy < r && dist(cx, cy, w - r, r) > r) inside = false;
      if (cx < r && cy > h - r && dist(cx, cy, r, h - r) > r) inside = false;
      if (cx > w - r && cy > h - r && dist(cx, cy, w - r, h - r) > r) inside = false;
      if (inside) {
        const i = (py * w + pxX) * 4;
        px[i] = color.r;
        px[i + 1] = color.g;
        px[i + 2] = color.b;
        px[i + 3] = 255;
      }
    }
  }
}

function circle(px, size, cx, cy, radius, color) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (dist(x + 0.5, y + 0.5, cx, cy) <= radius) {
        const i = (y * size + x) * 4;
        px[i] = color.r;
        px[i + 1] = color.g;
        px[i + 2] = color.b;
        px[i + 3] = 255;
      }
    }
  }
}

function createPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pixels = Buffer.alloc(size * size * 4, 0);

  const radius = size * 0.2;
  roundedRect(pixels, 0, 0, size, size, radius, INDIGO);
  circle(pixels, size, size / 2, size / 2, size * 0.22, WHITE);

  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[offset++] = pixels[i];
      raw[offset++] = pixels[i + 1];
      raw[offset++] = pixels[i + 2];
      raw[offset++] = pixels[i + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

sizes.forEach((size) => {
  const png = createPng(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Wrote icon${size}.png`);
});
