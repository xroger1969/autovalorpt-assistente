import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AUTOVALOR_BRAND } from './autovalor-brand.js';

const FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
const { width: WIDTH, height: HEIGHT } = AUTOVALOR_BRAND.feed;
const C = AUTOVALOR_BRAND.colors;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fail = code => Object.assign(new Error(code), { code });

// A signed stock-photo delivery gets this frame. The shared photo normalizer
// stays unbranded, so videos and catalogues still receive the original photo.
// No price, title or vehicle attribute is accepted from a public query string.
export async function renderInstagramStockImage(photograph) {
  if (!Buffer.isBuffer(photograph) || !photograph.length || photograph.length > 8 * 1024 * 1024) throw fail('image_size_invalid');
  const photo = await sharp(photograph, { limitInputPixels: 20_000_000, failOn: 'error', animated: false })
    .rotate().resize({ width: 984, height: 860, fit: 'inside' }).toColorspace('srgb').png().toBuffer({ resolveWithObject: true });
  const layers = [{ input: photo.data, left: Math.round((WIDTH - photo.info.width) / 2),
    top: 220 + Math.round((860 - photo.info.height) / 2) }];
  async function text(value, left, top, width, size, color, bold = false) {
    const input = await sharp({ text: {
      text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escape(value)}</span>`,
      font: `DejaVu Sans ${size}`, fontfile: FONT, width, rgba: true,
    } }).png().toBuffer();
    layers.push({ input, left, top });
  }
  const canvas = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${C.navy}"/>
    <rect x="48" y="220" width="984" height="860" fill="${C.deep}"/>
    <path d="M72 175H1008M72 1122H1008" stroke="${C.line}" stroke-width="2"/>
    <path d="M72 175H160" stroke="${C.gold}" stroke-width="5"/>
    </svg>`);
  await text(AUTOVALOR_BRAND.name, 72, 76, 650, 45, C.white, true);
  await text('STOCK', 878, 93, 135, 24, C.gold, true);
  await text('O teu próximo carro.', 72, 1160, 936, 48, C.white, true);
  await text('Mais informações na legenda.', 72, 1230, 936, 30, C.muted);
  await text(AUTOVALOR_BRAND.handle, 72, 1291, 650, 23, C.gold);
  return sharp(canvas).composite(layers).toColorspace('srgb')
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
}
