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

function circle(cx, cy, radius, color) {
  const [r, g, b] = color;
  const rr = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rr) setPixel(x, y, r, g, b);
    }
  }
}

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
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

function carIcon(x, y) {
  const blue = [19, 106, 232];
  const navy = [17, 31, 52];
  const pale = [231, 240, 255];

  rect(x + 20, y + 46, 250, 68, blue, 25);
  rect(x + 68, y + 10, 150, 62, blue, 24);
  rect(x + 91, y + 22, 48, 35, pale, 9);
  rect(x + 149, y + 22, 48, 35, pale, 9);
  circle(x + 78, y + 112, 27, navy);
  circle(x + 216, y + 112, 27, navy);
  circle(x + 78, y + 112, 12, [255, 255, 255]);
  circle(x + 216, y + 112, 12, [255, 255, 255]);
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
  const navy = [17, 31, 52];
  const blue = [19, 106, 232];
  const muted = [92, 109, 132];
  const pale = [245, 248, 253];

  rect(0, 0, WIDTH, HEIGHT, pale);
  rect(46, 42, 1108, 546, [255, 255, 255], 36);
  rect(46, 42, 16, 546, blue, 8);

  rect(92, 83, 385, 58, [232, 241, 255], 29);
  text('ASSISTENTE DO CARLOS', 126, 101, 4, blue);

  text('AVALIACAO DA SUA', 95, 190, 8, navy);
  text('VIATURA', 95, 277, 8, navy);
  text('DEMORA MENOS DE UM MINUTO', 98, 390, 4, muted);
  text('ENVIE OS DADOS E RESPONDO RAPIDAMENTE', 98, 440, 3, muted);

  rect(96, 504, 420, 58, blue, 18);
  centeredText('CONTINUAR', 520, 4, [255, 255, 255]);

  carIcon(790, 214);

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
