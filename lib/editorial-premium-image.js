import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AUTOVALOR_BRAND } from './autovalor-brand.js';
import { simulatorQr } from './editorial-advice-image.js';

const { colors: C } = AUTOVALOR_BRAND;
const FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
const W = 1080, H = 1350, X = 72, INNER = 936;
const fail = code => Object.assign(new Error(code), { code });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rect = (x, y, width, height, fill, radius = 0) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;

// Text is measured with the same bundled font in development and production.
// Never clip a number, unit or qualification to make an authored card fit.
async function type(layers, value, x, y, width, height, size, min, { color = C.white, bold = false, right = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw fail('editorial_premium_text_invalid');
  for (let pt = size; pt >= min; pt -= 2) {
    const rendered = await sharp({ text: {
      text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escape(value.trim())}</span>`,
      font: `DejaVu Sans ${pt}`, fontfile: FONT, rgba: true, width, align: right ? 'right' : 'left',
      spacing: Math.round(pt * .13), wrap: 'word-char',
    } }).png().toBuffer({ resolveWithObject: true });
    if (rendered.info.height > height || rendered.info.width > width) continue;
    layers.push({ input: rendered.data, left: x + (right ? width - rendered.info.width : 0), top: y });
    return rendered.info.height;
  }
  throw fail('editorial_premium_text_overflow');
}

async function introduction(layers, slide) {
  for (const titleHeight of [248, 214, 184]) {
    const text = [];
    try {
      const used = await type(text, slide.title, X - 3, 237, INNER + 3, titleHeight, 76, 50, { bold: true });
      const y = 273 + used;
      await type(text, slide.body, X, y, INNER, 663 - y, 35, 29, { color: C.muted });
      layers.push(...text); return;
    } catch (error) {
      if (error.code !== 'editorial_premium_text_overflow' || titleHeight === 184) throw error;
    }
  }
}

async function adviceVisual(layers, shapes, slide) {
  const visual = slide.visual;
  if (!visual || !['compare', 'metric', 'checklist'].includes(visual.kind) ||
      !Array.isArray(visual.items) || visual.items.length < 1 || visual.items.length > 3) throw fail('editorial_advice_visual_invalid');
  shapes.push(rect(48, 699, 984, 358, C.navyLight, 22), rect(48, 730, 5, 63, C.gold, 2));
  const unit = visual.unit;
  let top = 729, bottom = visual.note ? 985 : 1027;
  if (unit) {
    await type(layers, unit, X + 8, top, INNER - 16, 35, 27, 25, { color: C.gold, bold: true });
    top += 57;
  }
  if (visual.note) await type(layers, visual.note, X + 8, 998, INNER - 16, 43, 23, 21, { color: C.muted });
  if (visual.kind === 'metric' && visual.items.length === 1) {
    const { label, value } = visual.items[0];
    await type(layers, label, X + 8, top + 18, INNER - 16, 75, 32, 28, { color: C.muted });
    await type(layers, value, X + 3, top + 112, INNER - 11, bottom - top - 113, 106, 62, { color: C.gold, bold: true });
    return;
  }
  const comparable = visual.kind === 'compare' && unit && visual.items.length > 1 &&
    visual.items.every(item => Number.isFinite(item.amount) && item.amount >= 0);
  const maximum = comparable ? Math.max(...visual.items.map(item => item.amount)) : 0;
  const step = Math.floor((bottom - top) / visual.items.length);
  for (const [index, item] of visual.items.entries()) {
    const y = top + step * index;
    const leftWidth = comparable ? 560 : 365;
    const gap = comparable ? 40 : 36;
    const rightX = X + 8 + leftWidth + gap;
    const rightWidth = 1000 - rightX;
    await type(layers, item.label, X + 8, y + 7, leftWidth, step - (comparable ? 31 : 18), 32, 26, { color: C.muted });
    await type(layers, item.value, rightX, y + 3, rightWidth, step - (comparable ? 28 : 14), comparable ? 57 : 37,
      comparable ? 35 : 29, { color: index === 0 ? C.gold : C.white, bold: true, right: comparable });
    if (comparable) {
      const barY = y + step - 15;
      shapes.push(rect(X + 8, barY, INNER - 16, 5, C.line, 2));
      if (maximum > 0 && item.amount > 0)
        shapes.push(rect(X + 8, barY, Math.round((INNER - 16) * item.amount / maximum), 5, index === 0 ? C.gold : C.muted, 2));
    } else if (index < visual.items.length - 1) shapes.push(rect(X + 8, y + step - 9, INNER - 16, 1, C.line));
  }
}

async function generalVisual(layers, shapes, slide) {
  if (Array.isArray(slide.options) && slide.options.length) {
    const rows = slide.options.slice(0, 3), step = 100;
    for (const [index, value] of rows.entries()) {
      const y = 710 + index * step;
      shapes.push(rect(56, y, 968, 80, C.navyLight, 14));
      await type(layers, String(index + 1).padStart(2, '0'), X + 8, y + 22, 64, 40, 26, 26, { color: C.gold, bold: true });
      await type(layers, value, X + 94, y + 20, 818, 50, 35, 29, { bold: true });
    }
    return;
  }
  // A decorative line drawing is generic; no stock vehicle or equipment is invented.
  shapes.push(`<g transform="translate(120 800) scale(2.1)" fill="none" stroke="${C.gold}" stroke-width="2.2" opacity=".8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 88 28 59 84 48 125 16 244 16 298 51 350 62 369 88 365 108 327 108M91 108H276M40 108H15V88"/><path d="M106 48 137 27H229L262 48ZM174 27V48"/><circle cx="65" cy="108" r="26"/><circle cx="302" cy="108" r="26"/></g>`);
}

export async function renderPremiumEditorialImage(plan, index = 0) {
  const slide = plan?.slides?.[index];
  if (!slide) throw fail('editorial_slide_invalid');
  const shapes = [
    `<defs><linearGradient id="premium" x2=".8" y2="1"><stop stop-color="${C.navy}"/><stop offset="1" stop-color="${C.deep}"/></linearGradient></defs>`,
    rect(0, 0, W, H, 'url(#premium)'),
    `<path d="M680 1350 1080 950M795 1350 1080 1065M910 1350 1080 1180" stroke="${C.line}" stroke-width="1" opacity=".45"/>`,
    rect(X, 153, 76, 5, C.gold, 2), rect(X, 1260, INNER, 1, C.line),
  ];
  const layers = [];
  await type(layers, AUTOVALOR_BRAND.name, X, 65, 570, 59, 40, 40, { bold: true });
  await type(layers, plan.format === 'REELS' ? 'EM VÍDEO' : 'ESCOLHER MELHOR', 682, 80, 326, 38, 21, 21, { color: C.gold, right: true, bold: true });
  await type(layers, slide.category || slide.label || plan.topic || 'GUIA DE COMPRA', X, 187, INNER, 37, 25, 21, { color: C.gold, bold: true });
  await introduction(layers, slide);
  if (slide.visual) await adviceVisual(layers, shapes, slide);
  else await generalVisual(layers, shapes, slide);

  if (plan.feedTool) {
    const qr = simulatorQr(plan.feedTool.url);
    if (!qr) throw fail('editorial_simulator_invalid');
    const qrX = 1008 - qr.size;
    // Preserve the approved QR's native module size and full quiet zone.
    layers.push({ input: qr.path, left: qrX, top: 1068 });
    const width = qrX - X - 24;
    await type(layers, plan.feedTool.title, X, 1091, width, 82, 38, 30, { color: C.gold, bold: true });
    await type(layers, 'Link no perfil @autovalorpt', X, 1181, width, 43, 29, 25);
    await type(layers, plan.feedTool.url.replace('https://', '').replace(/\/$/, ''), X, 1283, INNER, 37, 24, 22, { color: C.muted });
  } else {
    const cta = slide.takeaway || slide.cta || 'Vê o vídeo e guarda esta dica.';
    await type(layers, cta, X, 1102, INNER, 137, 36, 28, { bold: true });
    await type(layers, AUTOVALOR_BRAND.handle, X, 1283, 640, 37, 25, 25, { color: C.muted });
    await type(layers, plan.slides.length > 1 ? `${String(index + 1).padStart(2, '0')} / ${String(plan.slides.length).padStart(2, '0')}` : 'ALMADA',
      782, 1285, 226, 34, 22, 22, { color: C.muted, right: true });
  }
  const canvas = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join('')}</svg>`);
  const result = await sharp(canvas).composite(layers).toColorspace('srgb')
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
  if (result.length > 8 * 1024 * 1024) throw fail('editorial_image_too_large');
  return result;
}

export async function renderPremiumReelCover(image) {
  // The headline and content stay inside the centre square crop as well as 4:5.
  return sharp(image).extend({ top: 285, bottom: 285, background: C.navy })
    .toColorspace('srgb').jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
}
