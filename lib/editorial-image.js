import { fileURLToPath } from 'node:url';
import { ADVICE_IMAGE_VERSION, adviceEditorialPlan } from './editorial-advice-calendar.js';
import { renderAdviceImage } from './editorial-advice-image.js';
import sharp from 'sharp';
import { editorialPlan, extraEditorialPlan, EDITORIAL_VERSION } from './editorial-content.js';
import { ELECTRIC_IMAGE_VERSION, scheduledEditorialPlan } from './electric-editorial-calendar.js';

export const EDITORIAL_IMAGE_WIDTH = 1080;
export const EDITORIAL_IMAGE_HEIGHT = 1350;
const FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
const C = { navy: '#092735', deep: '#061B27', teal: '#174656', gold: '#E7BE69', paper: '#F4F1E9', white: '#FFFFFF', muted: '#C4D2D6', ink: '#24434D' };
const fail = (code) => Object.assign(new Error(code), { code });
const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function textLayer(text, { width = 920, height, size, min = size - 12, color = C.white, bold = false, align = 'left' }) {
  for (let fontSize = size; fontSize >= min; fontSize -= 2) {
    const result = await sharp({ text: {
      text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escape(text)}</span>`,
      font: `DejaVu Sans ${fontSize}`, fontfile: FONT, width, rgba: true, align, spacing: Math.round(fontSize * 0.17),
    } }).png().toBuffer({ resolveWithObject: true });
    if (result.info.height <= height && result.info.width <= width) return result.data;
  }
  // Content is authored and tested as a complete bank. Do not silently clip or shrink to illegibility.
  throw fail('editorial_text_overflow');
}

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">${body}</svg>`);
const car = (x, y, scale = 1, color = C.gold, opacity = '.7') => `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="4" opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"><path d="M12 88 28 59 84 48 125 16 244 16 298 51 350 62 369 88 365 108 327 108M91 108H276M40 108H15V88"/><path d="M106 48 137 27H229L262 48ZM174 27V48"/><circle cx="65" cy="108" r="26"/><circle cx="302" cy="108" r="26"/><path d="M28 72H53M328 74H351"/></g>`;

function background(slide, count, index) {
  const dark = (slide.kind === 'cover' && slide.layout !== 1) || (slide.kind === 'question' && slide.layout === 1) || (slide.kind === 'detail' && slide.layout === 2);
  let body = `<rect width="1080" height="1350" fill="${dark ? C.deep : C.paper}"/>`;
  if (slide.kind === 'cover') {
    body += `<rect x="80" y="239" width="92" height="7" rx="3" fill="${C.gold}"/>`;
    if (slide.layout === 1) {
      body += `<path d="M1080 250V590L740 250Z" fill="#E9E1D2" opacity=".6"/><rect x="80" y="902" width="920" height="240" rx="20" fill="${C.navy}"/><path d="M790 902h210v240H550Z" fill="${C.teal}"/>`;
      body += car(120, 933, 1.35, C.gold, '.9');
    } else if (slide.layout === 2) {
      body += `<path d="M590 1350 1080 730V1350Z" fill="${C.teal}" opacity=".8"/><path d="M80 986H800M80 1044H890M80 1102H980" stroke="${C.gold}" stroke-width="3" opacity=".3"/><circle cx="850" cy="880" r="130" fill="none" stroke="${C.teal}" stroke-width="2"/>`;
      body += car(294, 916, 1.7, C.gold, '.9');
    } else {
      body += `<path d="M510 1350 1080 780V1350Z" fill="${C.teal}" opacity=".38"/><circle cx="1080" cy="1050" r="390" fill="none" stroke="${C.teal}" stroke-width="2"/><circle cx="1080" cy="1050" r="310" fill="none" stroke="${C.teal}" stroke-width="2"/>`;
      body += car(105, 908, 1.5);
    }
    body += `<path d="M80 1142H1000" stroke="${dark ? C.teal : '#D3CCBF'}" stroke-width="2"/>`;
  } else if (slide.kind === 'question') {
    body += `<circle cx="982" cy="430" r="200" fill="${dark ? C.teal : '#EAE3D5'}" opacity=".55"/><path d="M804 430h198M903 331v198" stroke="${dark ? C.gold : '#C7AD7C'}" stroke-width="2" opacity=".5"/>`;
    body += `<rect x="80" y="226" width="70" height="7" rx="3" fill="${C.gold}"/>`;
    slide.options.forEach((_, i) => {
      body += `<rect x="80" y="${784 + i * 92}" width="920" height="72" rx="36" fill="${dark ? C.teal : '#FFFFFF'}"/><circle cx="117" cy="${820 + i * 92}" r="7" fill="${dark ? C.gold : C.navy}"/>`;
    });
  } else {
    body += `<rect x="0" y="0" width="1080" height="188" fill="${C.navy}"/><path d="M80 526H1000" stroke="${dark ? C.teal : '#D5CDBE'}" stroke-width="2"/>`;
    body += `<circle cx="925" cy="333" r="140" fill="${dark ? C.teal : '#E9E1D2'}"/>`;
    for (let n = 1; n <= 3; n++) body += `<rect x="${80 + (n - 1) * 62}" y="1008" width="46" height="7" rx="3" fill="${n <= slide.number ? (dark ? C.gold : C.navy) : (dark ? C.teal : '#D9D3C7')}"/>`;
    body += car(755, 1116, .55, dark ? C.gold : C.navy, '.45');
  }
  body += `<path d="M80 1248H1000" stroke="${dark ? C.teal : '#D3CCBF'}" stroke-width="2"/>`;
  return { buffer: svg(body), dark };
}

// Only the canonical, authored plan is rendered. Query data cannot inject SVG/text or remote media.
export async function renderEditorialImage(plan, slideIndex = 0) {
  if (!plan || ![EDITORIAL_VERSION, ELECTRIC_IMAGE_VERSION, ADVICE_IMAGE_VERSION].includes(plan.version) || typeof plan.date !== 'string') throw fail('editorial_plan_invalid');
  const canonical = plan.version === ADVICE_IMAGE_VERSION ? adviceEditorialPlan(plan.date, plan.extra === true) : plan.extra === true ? extraEditorialPlan(plan.date) : plan.version === ELECTRIC_IMAGE_VERSION ? scheduledEditorialPlan(plan.date) : editorialPlan(plan.date);
  if (plan.id !== canonical.id || plan.version !== canonical.version) throw fail('editorial_plan_invalid');
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= canonical.slides.length) throw fail('editorial_slide_invalid');
  if (canonical.version === ADVICE_IMAGE_VERSION) return renderAdviceImage(canonical, slideIndex);
  const slide = canonical.slides[slideIndex];
  const { buffer, dark } = background(slide, canonical.slides.length, slideIndex);
  const primary = dark ? C.white : C.navy;
  const secondary = dark ? C.muted : C.ink;
  const layers = [];
  const add = async (text, left, top, settings) => layers.push({ input: await textLayer(text, settings), left, top });
  await add('AutoValorPT', 80, 74, { width: 620, height: 64, size: 41, min: 41, bold: true, color: slide.kind === 'detail' || dark ? C.white : C.navy });
  await add('ALMADA', 800, 86, { width: 200, height: 42, size: 22, min: 22, align: 'right', color: slide.kind === 'detail' || dark ? C.gold : C.ink });

  if (slide.kind === 'cover') {
    await add(slide.label, 80, 184, { width: 920, height: 44, size: 25, min: 23, bold: true, color: dark ? C.gold : C.ink });
    await add(slide.title, 76, 298, { width: 918, height: 360, size: 84, min: 68, bold: true, color: primary });
    await add(slide.body, 80, 704, { width: 830, height: 172, size: 37, min: 33, color: secondary });
    await add(slide.cta, 80, 1179, { width: 830, height: 47, size: 27, min: 25, color: dark ? C.gold : C.ink });
  } else if (slide.kind === 'question') {
    await add(slide.label, 80, 178, { width: 920, height: 42, size: 24, min: 22, bold: true, color: dark ? C.gold : C.ink });
    await add(slide.title, 76, 280, { width: 900, height: 300, size: 75, min: 63, bold: true, color: primary });
    await add(slide.body, 80, canonical.electric ? 595 : 605,
      { width: 860, height: canonical.electric ? 175 : 142, size: 34, min: 30, color: secondary });
    for (const [i, option] of slide.options.entries()) {
      await add(option, 145, 802 + i * 92, { width: 800, height: 45, size: 30, min: 28, color: primary, bold: true });
    }
    await add(slide.cta, 80, 1115, { width: 900, height: 101, size: 32, min: 29, bold: true, color: primary });
  } else {
    await add(slide.label, 80, 147, { width: 920, height: 35, size: 21, min: 20, color: C.gold });
    await add(String(slide.number).padStart(2, '0'), 794, 262, { width: 220, height: 148, size: 104, min: 104, color: dark ? C.gold : C.navy, bold: true });
    await add(slide.title, 76, 281, { width: 684, height: 210, size: 65, min: 53, color: primary, bold: true });
    await add(slide.body, 80, 590, { width: 905, height: 333, size: 43, min: 37, color: secondary });
    if (slide.cta) await add(slide.cta, 80, 1073, { width: 640, height: 137, size: 31, min: 27, color: primary, bold: true });
    else await add('Continua a deslizar.', 80, 1082, { width: 640, height: 58, size: 28, min: 26, color: secondary });
  }

  await add(canonical.electric ? '@autovalorpt  ·  carregador.vercel.app' : '@autovalorpt', 80, 1280,
    { width: 700, height: 40, size: 23, min: 23, color: secondary });
  await add(`${String(slideIndex + 1).padStart(2, '0')} / ${String(canonical.slides.length).padStart(2, '0')}`, 810, 1280, { width: 190, height: 40, size: 23, min: 23, align: 'right', color: secondary });
  const output = await sharp(buffer).composite(layers).flatten({ background: C.paper }).toColorspace('srgb').jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  if (output.length > 8 * 1024 * 1024) throw fail('editorial_image_too_large');
  return output;
}
