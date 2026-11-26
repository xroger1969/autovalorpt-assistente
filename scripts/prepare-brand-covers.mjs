// Rebuild the download-ready Instagram highlight covers from original vectors.
// This creates local assets only; it never publishes or changes a profile.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AUTOVALOR_BRAND } from '../lib/autovalor-brand.js';

const directory = new URL('../assets/brand/', import.meta.url);
const { navy, gold } = AUTOVALOR_BRAND.colors;
const covers = [
  ['eletricos', 'Elétricos', '<path d="M57 8 25 55h24l-7 37 34-48H52Z"/>'],
  ['hibridos', 'Híbridos', '<path d="M80 17C39 12 17 32 20 59c2 20 22 29 40 19 17-10 23-33 20-61Z"/><path d="M19 88 65 38M35 69l-1-19M50 55h19"/>'],
  ['stock', 'Stock', '<path d="m20 41 8-22h44l8 22M14 44l9-6h54l9 6v30H14ZM21 74v12h14V74m30 0v12h14V74M22 54h14m28 0h14M43 63h14"/>'],
  ['guias', 'Guias', '<path d="M36 19H23v70h54V19H64M37 12h26v15H37ZM32 45l5 5 9-11M54 44h13M32 66l5 5 9-11M54 65h13"/>'],
  ['simulador', 'Simulador', '<rect x="24" y="12" width="52" height="76" rx="8"/><path d="M34 25h32v15H34ZM35 55h4m12 0h4m10 0h1M35 68h4m12 0h4m10 0h1M35 79h4m12 0h4m10 0h1"/>'],
  ['sobre-nos', 'Sobre nós', '<circle cx="50" cy="30" r="14"/><path d="M23 85V74c0-14 12-24 27-24s27 10 27 24v11M80 18a13 13 0 0 1 0 26M85 53c8 4 12 11 12 21M20 18a13 13 0 0 0 0 26M15 53C7 57 3 64 3 74"/>'],
];

await mkdir(directory, { recursive: true });
for (const [name, label, icon] of covers) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><title>AutoValorPT — ${label}</title><rect width="1080" height="1080" fill="${navy}"/><circle cx="540" cy="540" r="366" fill="none" stroke="${gold}" stroke-width="5"/><circle cx="540" cy="540" r="343" fill="none" stroke="${gold}" stroke-opacity=".15" stroke-width="2"/><g transform="translate(315 315) scale(4.5)" fill="none" stroke="${gold}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${icon}</g></svg>\n`;
  await writeFile(new URL(name + '.svg', directory), svg);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(name + '.png', directory)));
}
console.log('Prepared six AutoValorPT highlight covers (PNG and SVG).');
