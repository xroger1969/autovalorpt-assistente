import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
const W = 1080, H = 1350, X = 72, INNER = W - 2 * X;
const C = { ink: '#092735', muted: '#41606A', paper: '#F4F1E9', line: '#CDD4CD', teal: '#174656',
  dark: '#082A38', darkLine: '#41626A', light: '#FAF7EE', soft: '#C4D6D6', gold: '#E7BE69' };
const fail = code => Object.assign(new Error(code), { code });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// The image handler resolves a canonical authored plan before passing it here.
// Text is measured using the bundled font. Overlong future cards fail closed
// instead of displaying clipped prices or truncating a financial condition.
async function type(layers, value, x, y, width, height, size, min, { color = C.ink, bold = false, right = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw fail('editorial_advice_text_invalid');
  for (let pt = size; pt >= min; pt -= 2) {
    const glyphs = await sharp({ text: {
      text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escape(value.trim())}</span>`,
      font: `DejaVu Sans ${pt}`, fontfile: FONT, rgba: true, width, align: right ? 'right' : 'left',
      spacing: Math.round(pt * 0.10), wrap: 'word-char',
    } }).png().toBuffer({ resolveWithObject: true });
    if (glyphs.info.height > height || glyphs.info.width > width) continue;
    layers.push({ input: glyphs.data, left: x + (right ? width - glyphs.info.width : 0), top: y });
    return glyphs.info.height;
  }
  throw fail('editorial_advice_text_overflow');
}

const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const light = { color: C.light, bold: true };
const gold = { color: C.gold, bold: true };

async function introduction(layers, slide) {
  for (const headingBudget of [186, 152, 126]) {
    const text = [];
    try {
      const headingHeight = await type(text, slide.title, X - 2, 166, INNER, headingBudget, 72, 48, { bold: true });
      const introY = 192 + headingHeight;
      await type(text, slide.body, X, introY, INNER, 479 - introY, 35, 27, { color: C.muted });
      layers.push(...text);
      return;
    } catch (error) {
      if (error.code !== 'editorial_advice_text_overflow' || headingBudget === 126) throw error;
    }
  }
}

async function comparison(layers, shapes, visual, top, height) {
  const { items, unit } = visual;
  const comparable = unit && items.length > 1 && items.every(row => Number.isFinite(row.amount) && row.amount >= 0);
  if (comparable) {
    const max = Math.max(...items.map(row => row.amount));
    const step = Math.floor(height / items.length);
    for (const [i, item] of items.entries()) {
      const y = top + i * step;
      const labelH = await type(layers, item.label, X, y + 13, 425, step - 43, 36, 28, { color: C.soft });
      const valueH = await type(layers, item.value, X + 445, y + 6, INNER - 445, step - 36, 66, 38, { ...light, right: true });
      const ruleY = y + Math.max(13 + labelH, 6 + valueH) + 18;
      shapes.push(rect(X, ruleY, INNER, 7, C.darkLine));
      if (max > 0 && item.amount > 0) shapes.push(rect(X, ruleY - 3, Math.round(INNER * item.amount / max), 13, i === 0 ? C.gold : C.soft));
    }
    return;
  }
  // Costs with different units and qualitative comparisons have no shared axis.
  const gap = 38, width = Math.floor((INNER - (items.length - 1) * gap) / items.length);
  for (const [i, item] of items.entries()) {
    const x = X + i * (width + gap);
    if (i) shapes.push(rect(x - gap / 2, top, 2, height - 15, C.darkLine));
    const labelHeight = await type(layers, item.label, x, top + 6, width, 89, 35, 27, { color: C.soft });
    await type(layers, item.value, x, top + 43 + labelHeight, width, height - labelHeight - 55, 69, 35, i ? light : gold);
  }
}

async function metric(layers, shapes, slide, visual, top, height) {
  const hasMetric = typeof slide.metric === 'string' && slide.metric.trim();
  const main = hasMetric ? { value: slide.metric, label: slide.metricLabel } : visual.items[0];
  const rest = visual.items.filter(row => row !== main && (row.value !== main.value || row.label !== main.label));
  if (!rest.length) {
    const offset = Math.max(0, Math.floor((height - 218) / 2));
    if (main.label) await type(layers, main.label, X, top + offset, INNER, 57, 37, 29, { color: C.soft });
    await type(layers, main.value, X - 4, top + offset + 66, INNER, 155, 148, 74, gold);
    return;
  }
  if (main.label) await type(layers, main.label, X, top, INNER, 45, 33, 27, { color: C.soft });
  const valueY = top + (main.label ? 60 : 10);
  const valueHeight = await type(layers, main.value, X - 3, valueY, INNER, 130, 108, 54, gold);
  const factsY = Math.max(top + 174, valueY + valueHeight + 24);
  shapes.push(rect(X, factsY, INNER, 2, C.darkLine));
  const gap = 34, width = Math.floor((INNER - gap * (rest.length - 1)) / rest.length);
  for (const [i, item] of rest.entries()) {
    const x = X + i * (width + gap);
    const labelHeight = await type(layers, item.label, x, factsY + 22, width, 60, 28, 24, { color: C.soft });
    const y = factsY + 35 + labelHeight;
    await type(layers, item.value, x, y, width, top + height - y, 43, 29, light);
  }
}

async function checklist(layers, shapes, items, top, height) {
  const step = Math.floor(height / items.length);
  for (const [i, item] of items.entries()) {
    const y = top + i * step;
    if (i) shapes.push(rect(X, y - 9, INNER, 2, C.darkLine));
    await type(layers, item.label, X, y + 9, 404, step - 28, 36, 28, { color: C.soft });
    await type(layers, item.value, X + 440, y + 5, INNER - 440, step - 25, 44, 30, light);
  }
}

export async function renderAdviceImage(plan, index = 0) {
  if (!Number.isInteger(index) || !plan?.slides?.[index]) throw fail('editorial_slide_invalid');
  const slide = plan.slides[index], visual = slide.visual;
  if (!visual || !['compare', 'metric', 'checklist'].includes(visual.kind) || !Array.isArray(visual.items) ||
      visual.items.length < 1 || visual.items.length > 3) throw fail('editorial_advice_visual_invalid');
  const layers = [], shapes = [rect(0, 0, W, H, C.paper), rect(X, 129, INNER, 2, C.line),
    rect(0, 504, W, 508, C.dark), rect(0, 504, 14, 508, C.gold), rect(X, 1257, INNER, 2, C.line)];

  await type(layers, 'AutoValorPT', X, 62, 410, 50, 38, 38, { bold: true });
  await type(layers, (slide.category || slide.label).toLocaleUpperCase('pt-PT'), X + 420, 70, INNER - 420, 50, 25, 21, { right: true, color: C.muted, bold: true });
  await introduction(layers, slide);

  let top = 553, bottom = 965;
  if (visual.kind === 'compare' && visual.unit) {
    await type(layers, visual.unit, X, 542, INNER, 43, 30, 26, { color: C.gold, bold: true });
    top = 606;
  }
  if (visual.note) {
    await type(layers, visual.note, X, 916, INNER, 68, 28, 24, { color: C.soft });
    bottom = 895;
  }
  if (visual.kind === 'compare') await comparison(layers, shapes, visual, top, bottom - top);
  if (visual.kind === 'metric') await metric(layers, shapes, slide, visual, top, bottom - top);
  if (visual.kind === 'checklist') await checklist(layers, shapes, visual.items, top, bottom - top);

  shapes.push(rect(X, 1061, 49, 6, C.teal));
  await type(layers, 'NA PRÁTICA', X + 65, 1049, 450, 36, 25, 25, { color: C.teal, bold: true });
  await type(layers, slide.takeaway || slide.cta, X, 1100, INNER, 141, 43, 33, { bold: true });
  await type(layers, '@autovalorpt', X, 1284, 560, 39, 26, 26, { color: C.muted });
  await type(layers, 'ALMADA', X + 640, 1286, INNER - 640, 36, 23, 23, { color: C.muted, right: true });

  const canvas = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join('')}</svg>`);
  return sharp(canvas).composite(layers).flatten({ background: C.paper }).toColorspace('srgb')
    .jpeg({ quality: 91, chromaSubsampling: '4:4:4' }).toBuffer();
}
