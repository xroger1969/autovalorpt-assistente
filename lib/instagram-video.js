import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchInstagramGallery } from './instagram-video-gallery.js';
import { fetchInstagramImage, validInstagramImageSource } from './instagram-image.js';
import { AUTOVALOR_BRAND } from './autovalor-brand.js';

const WIDTH = 1080; const HEIGHT = 1920; const DURATION = 30;
const MAX_OUTPUT = 30 * 1024 * 1024;
const FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
const fail = (code) => Object.assign(new Error(code), { code });
const clean = (text, limit) => String(text || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const markup = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function instagramVideoDetails(item) {
  if (!/^ID[A-Za-z0-9]{5,30}$/.test(String(item?.id || '')) || !clean(item?.title, 200) ||
      !/^\d{1,7}(?:\.\d{2})? EUR$/.test(String(item?.price || '')) ||
      !(Number(item.price.split(' ')[0]) > 0) || !validInstagramImageSource(item?.image_link)) throw fail('video_invalid_item');
  const sources = Array.isArray(item.image_links) ? item.image_links : [item.image_link];
  if (!sources.length || sources.length > 5 || sources.some((url) => !validInstagramImageSource(url))) throw fail('video_invalid_images');
  return {
    title: clean(item.title, 200), description: clean(item.description, 240),
    price: new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
      .format(Number(item.price.split(' ')[0])),
    sources: [...new Set([item.image_link, ...sources])].slice(0, 5),
  };
}

async function textLayer(text, size, color, width, height, weight = 'normal') {
  const rendered = await sharp({ text: {
    text: `<span foreground="${color}" weight="${weight}">${markup(text)}</span>`,
    font: `DejaVu Sans ${size}`, fontfile: FONT, width, rgba: true, align: 'left', spacing: 10,
  } }).png().toBuffer();
  const metadata = await sharp(rendered).metadata();
  return metadata.height > height ? sharp(rendered).resize({ width, height, fit: 'inside', withoutEnlargement: true }).png().toBuffer() : rendered;
}

// Complete photographs at a fixed position, with cuts on the musical downbeat.
export const INSTAGRAM_VIDEO_STYLE = `${AUTOVALOR_BRAND.version}-energy-128-v4`;
export const INSTAGRAM_VIDEO_SCENES = 8;
const SCENE_SECONDS = 3.75;
const FPS = 25;
const PHOTO_TOP = 480;
const PHOTO_HEIGHT = 924;

function campaignCopy(details, scene) {
  const title = details.title.split(/\s+\|\s+/)[0];
  const words = title.split(' ');
  // Keep parenthetical version details together (for example «(c/ Bateria)»).
  const parenthesis = words.findIndex(word => word.startsWith('('));
  const titleWords = parenthesis > 0 && parenthesis < 3 ? parenthesis : 3;
  const shortTitle = words.slice(0, titleWords).join(' ');
  const variant = words.slice(titleWords).join(' ');
  const year = details.title.match(/\b(?:19|20)\d{2}\b/)?.[0] || details.description.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const km = (details.title + ' ' + details.description).match(/\b[0-9][0-9 \u00a0.]*\s*km\b/i)?.[0]?.trim();
  const fuel = /(?:^|[.·|])\s*Elétrico\s*(?:[.·|]|$)/i.test(details.description) ? '100% ELÉTRICO' : /híbrido.*plug.?in/i.test(details.description) ? 'HÍBRIDO PLUG-IN' : '';
  const labels = ['O TEU PRÓXIMO CARRO', 'EM CADA ÂNGULO', fuel || 'OLHA MAIS DE PERTO', 'CONHECE OS DETALHES', 'OUTRA PERSPETIVA', 'ESCOLHE O TEU PRÓXIMO', 'VEM CONHECÊ-LO', 'MARCA A TUA VISITA'];
  return { shortTitle, variant, label: labels[scene % 8], facts: [year, km].filter(Boolean).join('  /  ') };
}

export async function instagramVideoCard(item, photograph, scene = 0) {
  const details = instagramVideoDetails(item); const copy = campaignCopy(details, scene);
  if (!Buffer.isBuffer(photograph) || !photograph.length || photograph.length > 8 * 1024 * 1024) throw fail('video_invalid_photo');
  const picture = sharp(photograph, { limitInputPixels: 20_000_000, failOn: 'error' }).rotate();
  const C = AUTOVALOR_BRAND.colors;
  // An intact photograph in a graphic frame: no replacement scenery, colour
  // treatment, blur or overlay can change the visible car or its condition.
  const photo = await picture.resize({ width: 968, height: PHOTO_HEIGHT, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const isEnd = scene % 8 === 7;
  const canvas = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <rect width="1080" height="1920" fill="${C.navy}"/>
    <path d="M0 0H1080V188H0ZM0 1772H1080V1920H0Z" fill="${C.deep}"/>
    <rect x="44" y="468" width="992" height="948" fill="${C.deep}"/>
    <path d="M84 312H996M84 1716H996" stroke="${C.line}" stroke-width="2"/>
    <path d="M84 312H180" stroke="${C.gold}" stroke-width="5"/>
    <rect x="84" y="1714" width="${114 * ((scene % 8) + 1)}" height="4" fill="${C.gold}"/>
    </svg>`);
  const hero = scene % 8 === 2 && copy.label !== 'OLHA MAIS DE PERTO' ? copy.label : isEnd ? 'Marca a tua visita.' : copy.shortTitle;
  const overlays = [
    { input: photo.data, left: Math.round((WIDTH - photo.info.width) / 2), top: PHOTO_TOP + Math.round((PHOTO_HEIGHT - photo.info.height) / 2) },
    { input: await textLayer(AUTOVALOR_BRAND.name, 40, C.white, 380, 48, 'bold'), left: 84, top: 248 },
    { input: await textLayer(isEnd ? copy.shortTitle.toUpperCase() : copy.label, 26, C.gold, 494, 48, 'bold'), left: 502, top: 252 },
    { input: await textLayer(hero, 76, C.white, 912, 84, 'bold'), left: 80, top: 329 },
    ...(copy.variant ? [{ input: await textLayer(copy.variant, 30, C.muted, 912, 40), left: 84, top: 418 }] : []),
    { input: await textLayer(copy.facts || 'DISPONÍVEL NA AUTOVALORPT', 27, C.muted, 912, 42, 'bold'), left: 84, top: 1432 },
    { input: await textLayer(details.price, 98, C.white, 912, 100, 'bold'), left: 78, top: 1477 },
    { input: await textLayer(isEnd ? 'Marca a tua visita por WhatsApp' : 'Mais informações por WhatsApp', 30, C.gold, 912, 48, 'bold'), left: 84, top: 1590 },
    { input: await textLayer('+351 965 637 736  ·  ' + AUTOVALOR_BRAND.handle, 27, C.white, 912, 48), left: 84, top: 1651 },
  ];
  return sharp(canvas).composite(overlays).png().toBuffer();
}

// Original 128 BPM electro-pop instrumental, D major, 16 bars / 30 seconds.
// Drum kit, syncopated bass, bright plucks, chord stabs and transition sweeps.
// No third-party recording, vocal, licence-dependent download or paid service.
export function originalInstagramAudio() {
  const rate = 44100; const count = rate * DURATION; const wave = new Float64Array(count);
  const beat = 60 / 128; const roots = [146.8324, 110, 123.4708, 97.9989];
  const thirds = [1.259921, 1.259921, 1.189207, 1.259921];
  const tune = [2, 2.519842, 2.996614, 2.519842, 2, 2.996614, 3.363586, 2.996614];
  let random = 173791; let previousNoise = 0; let maximum = 0;
  const tau = 2 * Math.PI;
  for (let i = 0; i < count; i++) {
    const t = i / rate; const b = t / beat; const section = Math.floor(b / 8);
    const beatTime = t % beat; const eighthTime = t % (beat / 2);
    const chord = Math.floor(b / 4) % 4; const root = roots[chord];
    random = (Math.imul(random, 1664525) + 1013904223) | 0;
    const noise = (random >>> 0) / 2147483648 - 1; const highNoise = noise - previousNoise; previousNoise = noise;
    const kick = 0.63 * Math.sin(tau * (49 * beatTime + 8.5 * (1 - Math.exp(-beatTime * 35)))) * Math.exp(-beatTime * 16);
    const backTime = (t + beat) % (2 * beat);
    const snare = backTime < 0.18 ? (0.22 * highNoise + 0.12 * Math.sin(tau * 180 * backTime)) * Math.exp(-backTime * 25) : 0;
    const hats = 0.095 * highNoise * Math.exp(-eighthTime * (Math.floor(b * 2) % 2 ? 43 : 80));
    const pulse = (Math.floor(b * 2) % 8 === 6) ? root * 2 : root;
    const bassEnvelope = Math.min(1, eighthTime / 0.006) * Math.exp(-eighthTime * 7);
    const bass = 0.19 * (Math.sin(tau * pulse / 2 * eighthTime) + 0.33 * Math.sin(tau * pulse * eighthTime)) * bassEnvelope;
    const sidechain = 0.35 + 0.65 * Math.min(1, beatTime / 0.12);
    const chordEnv = Math.exp(-((t + beat / 2) % beat) * 4.5) * sidechain;
    let chords = 0;
    for (const ratio of [1, thirds[chord], 1.498307]) {
      const f = root * ratio * 2;
      chords += (Math.sin(tau * f * t) + 0.28 * Math.sin(tau * f * 2.002 * t) + 0.12 * Math.sin(tau * f * 3 * t)) * 0.055 * chordEnv;
    }
    const note = root * tune[Math.floor(b * 2) % tune.length];
    const leadEnv = Math.min(1, eighthTime / 0.009) * Math.exp(-eighthTime * 12);
    const lead = 0.11 * (Math.sin(tau * note * eighthTime) + 0.3 * Math.sin(tau * note * 2 * eighthTime)) * leadEnv;
    const sweepTime = t % SCENE_SECONDS;
    const sweep = sweepTime > 3.32 ? highNoise * 0.055 * ((sweepTime - 3.32) / 0.43) ** 2 : highNoise * 0.055 * Math.exp(-sweepTime * 14);
    const lift = section === 4 ? 0.65 : 1;
    const fade = Math.min(1, t / 0.018, Math.max(0, (DURATION - t) / 1.1));
    const value = Math.tanh((kick + snare + hats + bass + chords + lead * (section === 0 ? 0.5 : 1) + sweep) * lift * 1.18) * fade;
    wave[i] = value; maximum = Math.max(maximum, Math.abs(value));
  }
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) pcm.writeInt16LE(Math.round(wave[i] / maximum * 29500), i * 2);
  pcm.writeInt16LE(0, pcm.length - 2);
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function encode(binary, args, timeout) {
  if (timeout < 1000) throw fail('video_budget_exhausted');
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let timedOut = false; let diagnosticBytes = 0;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stderr.on('data', (data) => { diagnosticBytes += data.length; if (diagnosticBytes > 256 * 1024) child.kill('SIGKILL'); });
    child.once('error', () => { clearTimeout(timer); reject(fail('video_encoder_unavailable')); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(fail('video_render_timeout'));
      else if (code !== 0) reject(fail('video_render_failed'));
      else resolve();
    });
  });
}

export function instagramVideoTimeline() {
  const segments = [];
  const labels = [];
  for (let scene = 0; scene < INSTAGRAM_VIDEO_SCENES; scene++) {
    // Rounding boundaries instead of each duration yields exactly 750 frames.
    const frames = Math.round((scene + 1) * SCENE_SECONDS * FPS) - Math.round(scene * SCENE_SECONDS * FPS);
    const label = `[v${scene}]`;
    segments.push(`[${scene}:v]format=yuv420p,loop=loop=${frames - 1}:size=1:start=0,settb=1/${FPS},setpts=N${label}`);
    labels.push(label);
  }
  segments.push(`${labels.join('')}concat=n=${INSTAGRAM_VIDEO_SCENES}:v=1:a=0,fade=t=out:st=29.65:d=0.35[v]`);
  return segments.join(';');
}

export async function renderInstagramVideo(item, options = {}) {
  const details = instagramVideoDetails(item);
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 180_000);
  const ensureBudget = () => { if (Date.now() + 1000 >= deadline) throw fail('video_budget_exhausted'); };
  ensureBudget();
  const photographs = [];
  const boundedFetch = (url, init = {}) => (options.fetchImpl || fetch)(url, { ...init,
    signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]),
  });
  const gallery = !options.galleryChecked && !Array.isArray(item.image_links) && details.sources.length === 1 ? await fetchInstagramGallery(item, boundedFetch) : [];
  const sources = gallery.length ? gallery : details.sources;
  for (const source of sources.slice(0, 5)) {
    ensureBudget();
    try { photographs.push(await fetchInstagramImage(source, boundedFetch)); }
    catch (error) { if (!photographs.length || Array.isArray(item.image_links) && !options.allowPartialGallery) throw error; }
  }
  const folder = await mkdtemp(join(tmpdir(), 'autovalorpt-video-'));
  try {
    for (let scene = 0; scene < INSTAGRAM_VIDEO_SCENES; scene++) {
      ensureBudget();
      const photographIndex = [0, 1, 2, 3, 4, 1, 2, 0][scene] % photographs.length;
      await writeFile(join(folder, `scene-${scene}.png`), await instagramVideoCard(item, photographs[photographIndex], scene));
    }
    await writeFile(join(folder, 'music.wav'), originalInstagramAudio());
    const binary = options.ffmpegPath || (await import('ffmpeg-static')).default;
    if (typeof binary !== 'string' || !binary) throw fail('video_encoder_unavailable');
    const output = join(folder, 'advert.mp4');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1'];
    // Decode each photograph and its lettering once; repeat the same pixels until the cut.
    for (let scene = 0; scene < INSTAGRAM_VIDEO_SCENES; scene++) args.push('-framerate', String(FPS), '-i', join(folder, `scene-${scene}.png`));
    args.push('-i', join(folder, 'music.wav'));
    args.push('-filter_complex', instagramVideoTimeline(), '-map', '[v]', '-map', `${INSTAGRAM_VIDEO_SCENES}:a:0`,
      '-t', String(DURATION), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-maxrate', '4500k', '-bufsize', '6000k', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-b:a', '160k',
      '-ar', '44100', '-ac', '2', '-movflags', '+faststart', output);
    await encode(binary, args, Math.max(0, deadline - Date.now()));
    const info = await stat(output);
    if (info.size < 1024 || info.size > MAX_OUTPUT) throw fail('video_output_size_invalid');
    return { buffer: await readFile(output), mimeType: 'video/mp4', completeGallery: photographs.length === sources.length, duration: DURATION, width: WIDTH, height: HEIGHT };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
