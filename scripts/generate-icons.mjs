// Generates PWA/app icons (PNG) without any image dependencies.
// Design: white heart on pink. Re-run via `npm run icons`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const SS = 3; // supersampling factor for smooth edges
  const px = Buffer.alloc(size * size * 3);
  const bg = [244, 114, 182]; // #f472b6
  const fg = [255, 255, 255];
  const r = size * 0.3; // heart scale
  const cx = size / 2;
  const cy = size * 0.5 + r * 0.08;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS - cx) / r;
          const v = (cy - (y + (sy + 0.5) / SS)) / r; // v positive = up
          const f = (u * u + v * v - 1) ** 3 - u * u * v * v * v;
          if (f <= 0) inside++;
        }
      }
      const cov = inside / (SS * SS);
      const o = (y * size + x) * 3;
      px[o] = bg[0] + (fg[0] - bg[0]) * cov;
      px[o + 1] = bg[1] + (fg[1] - bg[1]) * cov;
      px[o + 2] = bg[2] + (fg[2] - bg[2]) * cov;
    }
  }
  return png(size, size, px);
}

mkdirSync(outDir, { recursive: true });
for (const [name, size] of [
  ['pwa-512.png', 512],
  ['pwa-192.png', 192],
  ['apple-touch-icon.png', 180],
  ['favicon.png', 32],
]) {
  writeFileSync(join(outDir, name), drawIcon(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
