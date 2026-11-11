import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
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
    font: `DejaVu Sans ${size}`, fontfile: FONT, width, height, rgba: true, align: 'left', spacing: 10,
  } }).png().toBuffer();
  return rendered;
}

// Each card preserves the entire vehicle photograph; only the card transitions
// move. No warping, invented backgrounds or generated details of the car.
export async function instagramVideoCard(item, photograph, scene = 0) {
  const details = instagramVideoDetails(item);
  if (!Buffer.isBuffer(photograph) || !photograph.length || photograph.length > 8 * 1024 * 1024) throw fail('video_invalid_photo');
  const photo = await sharp(photograph, { limitInputPixels: 20_000_000, failOn: 'error' }).rotate()
    .resize({ width: 980, height: 790, fit: 'contain', background: '#111c2b' }).jpeg({ quality: 92 }).toBuffer();
  const accents = Buffer.from(`<svg width="1080" height="1920"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#102538"/><stop offset="1" stop-color="#080e18"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><rect x="70" y="200" width="120" height="8" rx="4" fill="#ff9b36"/><rect x="50" y="570" width="980" height="790" rx="24" fill="#111c2b"/><rect x="70" y="1607" width="940" height="2" fill="#314455"/></svg>`);
  const eyebrow = ['NOVA VIATURA', 'CONHECE OS DETALHES', 'MARCA A TUA VISITA'][scene % 3];
  const subtitle = scene === 1 && details.description ? details.description : scene === 2 ? 'Fala connosco para saber mais.' : 'Disponível na AutoValorPT';
  const overlays = [
    { input: await textLayer('AutoValorPT', 46, '#ffffff', 940, 62, 'bold'), left: 70, top: 105 },
    { input: await textLayer(eyebrow, 26, '#ffb566', 940, 42, 'bold'), left: 70, top: 239 },
    { input: await textLayer(details.title, 62, '#ffffff', 940, 235, 'bold'), left: 70, top: 305 },
    { input: photo, left: 50, top: 570 },
    { input: await textLayer(details.price, 80, '#ffad50', 940, 112, 'bold'), left: 70, top: 1404 },
    { input: await textLayer(subtitle, 30, '#d1dce4', 940, 100), left: 70, top: 1520 },
    { input: await textLayer('+351 965 637 736', 42, '#ffffff', 940, 64, 'bold'), left: 70, top: 1648 },
    { input: await textLayer('@autovalorpt', 31, '#aebdca', 940, 48), left: 70, top: 1722 },
  ];
  return sharp(accents).composite(overlays).png().toBuffer();
}

// A small, deterministic original instrumental bed. No downloaded recording or
// commercial song is used. Gentle sine pads, plucked arpeggios and soft bass.
export function originalInstagramAudio() {
  const rate = 44100; const samples = rate * DURATION; const pcm = Buffer.alloc(samples * 2);
  const notes = [220, 329.6276, 440, 261.6256, 220, 329.6276, 523.2511, 329.6276];
  for (let index = 0; index < samples; index++) {
    const t = index / rate;
    const fade = Math.min(1, t / 1.5, (DURATION - t) / 3);
    const pad = 0.16 * (Math.sin(2 * Math.PI * 110 * t) + 0.35 * Math.sin(2 * Math.PI * 164.8138 * t) +
      0.24 * Math.sin(2 * Math.PI * 261.6256 * t)) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.13 * t));
    const beat = t % 0.75; const note = notes[Math.floor(t / 0.75) % notes.length];
    const pluck = 0.13 * Math.sin(2 * Math.PI * note * beat) * Math.min(1, beat / 0.025) * Math.exp(-beat * 5.5);
    const thumpTime = t % 3;
    const bass = 0.15 * Math.sin(2 * Math.PI * 55 * thumpTime) * Math.min(1, thumpTime / 0.02) * Math.exp(-thumpTime * 6);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (pad + pluck + bass) * fade)) * 32767), index * 2);
  }
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
  for (const source of details.sources.slice(0, 3)) {
    ensureBudget();
    photographs.push(await fetchInstagramImage(source, boundedFetch));
  }
  const folder = await mkdtemp(join(tmpdir(), 'autovalorpt-video-'));
  try {
    for (let scene = 0; scene < 3; scene++) {
      ensureBudget();
      await writeFile(join(folder, `scene-${scene}.png`), await instagramVideoCard(item, photographs[scene % photographs.length], scene));
    }
    await writeFile(join(folder, 'music.wav'), originalInstagramAudio());
    const binary = options.ffmpegPath || (await import('ffmpeg-static')).default;
    if (typeof binary !== 'string' || !binary) throw fail('video_encoder_unavailable');
    const output = join(folder, 'advert.mp4');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1'];
    for (let scene = 0; scene < 3; scene++) args.push('-loop', '1', '-framerate', '25', '-t', '10.5', '-i', join(folder, `scene-${scene}.png`));
    args.push('-i', join(folder, 'music.wav'), '-filter_complex',
      '[0:v]format=yuv420p,settb=AVTB[v0];[1:v]format=yuv420p,settb=AVTB[v1];[2:v]format=yuv420p,settb=AVTB[v2];' +
      '[v0][v1]xfade=transition=smoothleft:duration=0.75:offset=9.75[x1];' +
      '[x1][v2]xfade=transition=smoothright:duration=0.75:offset=19.5,fade=t=in:st=0:d=0.6,fade=t=out:st=29.4:d=0.6[v]',
      '-map', '[v]', '-map', '3:a:0', '-t', '30', '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-maxrate', '3500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-b:a', '128k',
      '-ar', '44100', '-ac', '2', '-movflags', '+faststart', output);
    await encode(binary, args, Math.max(0, deadline - Date.now()));
    const info = await stat(output);
    if (info.size < 1024 || info.size > MAX_OUTPUT) throw fail('video_output_size_invalid');
    return { buffer: await readFile(output), mimeType: 'video/mp4', duration: DURATION, width: WIDTH, height: HEIGHT };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
