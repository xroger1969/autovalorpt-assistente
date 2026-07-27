import { deflateSync } from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 630;
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 255);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function rect(x, y, w, h, color, radius = 0) {
  const [r, g, b] = color;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (radius > 0) {
        const cx = px < x + radius ? x + radius : px >= x + w - radius ? x + w - radius - 1 : px;
        const cy = py < y + radius ? y + radius : py >= y + h - radius ? y + h - radius - 1 : py;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      setPixel(px, py, r, g, b);
    }
  }
}

const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'], I:['11111','00100','00100','00100','00100','00100','11111'],
  L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'], O:['01110','10001','10001','10001','10001','10001','01110'],
  R:['11110','10001','10001','11110','10100','10010','10001'], S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'], U:['10001','10001','10001','10001','10001','10001','01110'],
  V:['10001','10001','10001','10001','10001','01010','00100'], ' ':['00000','00000','00000','00000','00000','00000','00000']
};

function text(value, x, y, scale, color) {
  const [r,g,b] = color;
  let cursor = x;
  for (const raw of value.toUpperCase()) {
    const char = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const glyph = FONT[char] || FONT[' '];
    glyph.forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit === '1') rect(cursor + gx * scale, y + gy * scale, scale, scale, [r,g,b]);
    }));
    cursor += 6 * scale;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function png() {
  rect(0, 0, WIDTH, HEIGHT, [248, 250, 252]);
  rect(72, 72, 1056, 486, [255, 255, 255], 28);

  // Ícone simples de automóvel.
  rect(112, 126, 132, 58, [35, 86, 190], 18);
  rect(136, 100, 84, 52, [35, 86, 190], 14);
  rect(128, 184, 28, 28, [17, 24, 39], 14);
  rect(200, 184, 28, 28, [17, 24, 39], 14);

  text('AUTOVALORPT', 286, 112, 12, [17, 24, 39]);
  text('DESCUBRA O VALOR', 118, 264, 12, [17, 24, 39]);
  text('DO SEU AUTOMOVEL', 118, 360, 12, [35, 86, 190]);

  rect(720, 414, 384, 94, [35, 86, 190], 24);
  text('ENTRAR NO ASSISTENTE', 755, 444, 7, [255, 255, 255]);

  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const rowStart = y * (WIDTH * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.status(200).send(png());
}
