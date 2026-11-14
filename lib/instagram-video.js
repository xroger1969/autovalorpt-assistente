import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchInstagramGallery } from './instagram-video-gallery.js';
import { fetchInstagramImage, validInstagramImageSource } from './instagram-image.js';

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

// Eight short, beat-aligned scenes; whole photographs remain visible.
// Motion is a restrained camera move over the layout, never invented vehicle motion.
export const INSTAGRAM_VIDEO_STYLE = 'energy-128-v2';
export const INSTAGRAM_VIDEO_SCENES = 8;
const SCENE_SECONDS = 3.75;
const TRANSITION = 0.16;

function campaignCopy(details, scene) {
  const title = details.title.split(/\s+\|\s+/)[0];
  const words = title.split(' ');
  const shortTitle = words.slice(0, 3).join(' ');
  const variant = words.slice(3).join(' ');
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
  const backdrop = await picture.clone().resize(WIDTH, HEIGHT, { fit: 'cover' }).blur(32).modulate({ brightness: 0.32, saturation: 0.55 }).png().toBuffer();
  const photo = await picture.clone().resize({ width: 1080, height: 1440, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const isEnd = scene % 8 === 7;
  const accents = Buffer.from(`<svg width="1080" height="1920"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#060b12" stop-opacity="1"/><stop offset=".27" stop-color="#060b12" stop-opacity=".88"/><stop offset=".39" stop-color="#060b12" stop-opacity="0"/><stop offset=".68" stop-color="#060b12" stop-opacity="0"/><stop offset=".79" stop-color="#060b12" stop-opacity=".92"/><stop offset="1" stop-color="#060b12" stop-opacity="1"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#shade)"/><rect x="84" y="215" width="96" height="7" fill="#ff7c28"/><rect x="84" y="1746" width="912" height="4" fill="#3e4650"/><rect x="84" y="1746" width="${114 * ((scene % 8) + 1)}" height="4" fill="#ff7c28"/></svg>`);
  const hero = scene % 8 === 2 && copy.label !== 'OLHA MAIS DE PERTO' ? copy.label : isEnd ? 'MARCA A TUA\nVISITA.' : copy.shortTitle;
  const overlays = [
    { input: photo.data, left: Math.round((WIDTH - photo.info.width) / 2), top: Math.round(260 + (1440 - photo.info.height) / 2) },
    { input: accents, left: 0, top: 0 },
    { input: await textLayer('AutoValorPT', 39, '#ffffff', 760, 54, 'bold'), left: 84, top: 132 },
    { input: await textLayer(isEnd ? copy.shortTitle.toUpperCase() : copy.label, 31, '#ff943e', 912, 52, 'bold'), left: 84, top: 257 },
    { input: await textLayer(hero, 87, '#ffffff', 912, 214, 'bold'), left: 80, top: 324 },
    { input: await textLayer(copy.variant, 32, '#dce2ea', 912, 78), left: 84, top: 550 },
    { input: await textLayer(isEnd ? 'ESTÁ NA HORA.' : copy.facts || 'DISPONÍVEL NA AUTOVALORPT', 28, '#dce2ea', 912, 46, 'bold'), left: 84, top: 1407 },
    { input: await textLayer(details.price, 112, '#ffffff', 912, 148, 'bold'), left: 78, top: 1464 },
    { input: await textLayer(isEnd ? '+351 965 637 736' : 'Mais informações por WhatsApp', isEnd ? 46 : 32, '#ff943e', 912, 72, 'bold'), left: 84, top: 1630 },
    { input: await textLayer(isEnd ? '@autovalorpt' : '+351 965 637 736  ·  @autovalorpt', 26, '#c8d0db', 912, 48), left: 84, top: 1778 },
  ];
  return sharp(backdrop).composite(overlays).png().toBuffer();
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

export async function renderInstagramVideo(item, options = {}) {
  const details = instagramVideoDetails(item);
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 180_000);
  const ensureBudget = () => { if (Date.now() + 1000 >= deadline) throw fail('video_budget_exhausted'); };
  ensureBudget();
  const photographs = [];
  const boundedFetch = (url, init = {}) => (options.fetchImpl || fetch)(url, { ...init,
    signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]),
  });
  const gallery = details.sources.length === 1 ? await fetchInstagramGallery(item, boundedFetch) : [];
  const sources = gallery.length ? gallery : details.sources;
  for (const source of sources.slice(0, 5)) {
    ensureBudget();
    try { photographs.push(await fetchInstagramImage(source, boundedFetch)); }
    catch (error) { if (!photographs.length) throw error; }
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
    // One-frame image inputs keep memory bounded. zoompan supplies the timeline.
    for (let scene = 0; scene < INSTAGRAM_VIDEO_SCENES; scene++) args.push('-i', join(folder, `scene-${scene}.png`));
    args.push('-i', join(folder, 'music.wav'));
    const filters = [];
    for (let scene = 0; scene < INSTAGRAM_VIDEO_SCENES; scene++) {
      const frames = Math.ceil((SCENE_SECONDS + TRANSITION) * 25);
      const zoom = scene % 2 ? '1.045-0.0004*on' : '1.005+0.0004*on';
      filters.push(`[${scene}:v]zoompan=z='${zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=1080x1920:fps=25,format=yuv420p,settb=AVTB[v${scene}]`);
    }
    let prior = 'v0';
    for (let scene = 1; scene < INSTAGRAM_VIDEO_SCENES; scene++) {
      const out = `x${scene}`;
      const transition = scene % 3 === 0 ? 'fade' : scene % 2 ? 'wipeleft' : 'wiperight';
      filters.push(`[${prior}][v${scene}]xfade=transition=${transition}:duration=${TRANSITION}:offset=${SCENE_SECONDS * scene}[${out}]`);
      prior = out;
    }
    filters.push(`[${prior}]fade=t=out:st=29.65:d=0.35[v]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', `${INSTAGRAM_VIDEO_SCENES}:a:0`,
      '-t', '30', '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-maxrate', '4500k', '-bufsize', '6000k', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-b:a', '160k',
      '-ar', '44100', '-ac', '2', '-movflags', '+faststart', output);
    await encode(binary, args, Math.max(0, deadline - Date.now()));
    const info = await stat(output);
    if (info.size < 1024 || info.size > MAX_OUTPUT) throw fail('video_output_size_invalid');
    return { buffer: await readFile(output), mimeType: 'video/mp4', duration: DURATION, width: WIDTH, height: HEIGHT };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
