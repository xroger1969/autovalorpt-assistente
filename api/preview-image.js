import { deflateSync } from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 630;
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 255);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 4;
  pixels[index] = r;
  pixels[index + 1] = g;
  pixels[index + 2] = b;
  pixels[index + 3] = a;
}

function rect(x, y, width, height, color, radius = 0) {
  const [r, g, b] = color;
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      if (radius > 0) {
        const cx = px < x + radius
          ? x + radius
          : px >= x + width - radius
            ? x + width - radius - 1
            : px;
        const cy = py < y + radius
          ? y + radius
          : py >= y + height - radius
            ? y + height - radius - 1
            : py;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      setPixel(px, py, r, g, b);
    }
  }
}

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

function textWidth(value, scale) {
  return Math.max(0, value.length * 6 * scale - scale);
}

function text(value, x, y, scale, color) {
  const [r, g, b] = color;
  let cursor = x;
  for (const raw of value.toUpperCase()) {
    const char = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const glyph = FONT[char] || FONT[' '];
    glyph.forEach((row, glyphY) => {
      [...row].forEach((bit, glyphX) => {
        if (bit === '1') {
          rect(cursor + glyphX * scale, y + glyphY * scale, scale, scale, [r, g, b]);
        }
      });
    });
    cursor += 6 * scale;
  }
}

function centeredText(value, y, scale, color) {
  const x = Math.floor((WIDTH - textWidth(value, scale)) / 2);
  text(value, x, y, scale, color);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function png() {
  rect(0, 0, WIDTH, HEIGHT, [246, 249, 254]);
  rect(70, 55, 1060, 520, [216, 229, 248], 32);
  rect(72, 57, 1056, 516, [255, 255, 255], 30);

  centeredText('AUTOVALORPT', 118, 8, [11, 111, 245]);
  centeredText('ENCONTRE A', 240, 10, [11, 31, 58]);
  centeredText('VIATURA CERTA', 330, 10, [11, 31, 58]);

  rect(240, 455, 720, 86, [11, 111, 245], 22);
  centeredText('ENTRAR NO ASSISTENTE', 480, 5, [255, 255, 255]);

  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const rowStart = y * (WIDTH * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.status(200).send(png());
}
