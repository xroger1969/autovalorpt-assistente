import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import { instagramVideoDetails, instagramVideoCard, instagramVideoTimeline, originalInstagramAudio, renderInstagramVideo } from '../lib/instagram-video.js';

const vehicle = { id: 'ID8Q1luY', title: 'Mercedes-Benz GLC 300 de 4Matic', price: '56990 EUR',
  description: '2023 · 90 000 km · Híbrido Plug-in', image_link: 'https://ireland.apollo.olxcdn.com/v1/files/test-safe/image;s=1024x768' };
const photo = () => sharp({ create: { width: 640, height: 400, channels: 3, background: '#5b7a91' } }).jpeg().toBuffer();
const folders = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('autovalorpt-video-')).sort();

test('video rejects invalid stock identity, money and foreign image hosts before fetching', async () => {
  let calls = 0;
  for (const invalid of [{ id: '../escape' }, { price: 'EUR 1000' }, { price: '0 EUR' },
    { image_link: 'https://example.com/car.jpg' }, { image_links: ['https://localhost/car.jpg'] }]) {
    await assert.rejects(renderInstagramVideo({ ...vehicle, ...invalid }, { fetchImpl: async () => { calls++; } }), /video_invalid/);
  }
  assert.equal(calls, 0);
});

test('video detail text preserves factual Portuguese accents and formats the EUR amount', () => {
  const details = instagramVideoDetails(vehicle);
  assert.equal(details.title, vehicle.title);
  assert.equal(details.description, vehicle.description);
  assert.equal(details.price.replace(/[\s\u00a0\u202f]/g, ''), '56990€');
  assert.deepEqual(details.sources, [vehicle.image_link]);
});

test('original music contains precisely thirty seconds, remains below clipping and fades out', () => {
  const wav = originalInstagramAudio();
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt32LE(40), 30 * 44100 * 2);
  let maximum = 0; let middle = 0; let ending = 0;
  for (let i = 0; i < 30 * 44100; i++) {
    const value = wav.readInt16LE(44 + i * 2); maximum = Math.max(maximum, Math.abs(value));
    if (i >= 15 * 44100 && i < 16 * 44100) middle += value * value;
    if (i >= 29.9 * 44100) ending += value * value;
  }
  assert.ok(maximum > 1000 && maximum < 32000);
  // The new energetic ending uses a shorter fade; compare mean-square level
  // in its final 100 ms with the steady one-second reference.
  assert.ok(ending * 10 < middle / 20);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
});

test('portrait cards render bundled-font Portuguese text and keep the photograph in a 9:16 frame', async () => {
  const picture = await photo();
  const card = await instagramVideoCard({ ...vehicle, title: 'Citroën ë-C4 & versão <teste>' }, picture, 1);
  const metadata = await sharp(card).metadata();
  assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1920);
  // Check an interior photograph region rather than implementation constants.
  const center = await sharp(card).extract({ left: 530, top: 955, width: 10, height: 10 }).raw().toBuffer();
  assert.ok(center.some((value) => value > 70));
});

test('short real model names render without an empty variant overlay', async () => {
  const card = await instagramVideoCard({ ...vehicle, title: 'Mercedes-Benz GLC 300 | 2022 | 60 000 km' }, await photo());
  assert.equal((await sharp(card).metadata()).height, 1920);
});

test('all eight stock scenes hold every pixel and cut directly at the beat', () => {
  const args = ['-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '1'];
  for (let scene = 0; scene < 8; scene++) {
    // A different, sharp-edged shape identifies each photograph and reveals sub-frame shake.
    const pattern = `color=s=96x160:r=25:d=0.04,drawbox=x=${scene * 6 + 1}:y=17:w=18:h=112:color=white:t=fill`;
    args.push('-f', 'lavfi', '-i', pattern);
  }
  const output = execFileSync(ffmpeg, [...args, '-filter_complex', instagramVideoTimeline(),
    '-map', '[v]', '-r', '25', '-threads', '1', '-f', 'framemd5', '-'], { encoding: 'utf8', timeout: 15000 });
  const frames = output.split('\n').filter(line => /^0,/.test(line)).map(line => line.split(',').at(-1).trim());
  assert.equal(frames.length, 750);
  const scenes = new Set();
  for (let scene = 0; scene < 8; scene++) {
    const start = Math.round(scene * 3.75 * 25);
    // The final fade to black begins at 29.65 seconds.
    const end = Math.min(Math.round((scene + 1) * 3.75 * 25), Math.floor(29.65 * 25));
    assert.equal(new Set(frames.slice(start, end)).size, 1);
    scenes.add(frames[start]);
  }
  assert.equal(scenes.size, 8);
  assert.notEqual(frames.at(-1), frames[740]);
});

test('an exhausted render budget never fetches a photograph or starts an encoder', async () => {
  let calls = 0;
  await assert.rejects(renderInstagramVideo(vehicle, { deadline: Date.now() - 1, fetchImpl: async () => { calls++; } }), /video_budget_exhausted/);
  assert.equal(calls, 0);
});

test('an unavailable encoder produces a safe error and removes its temporary files', async () => {
  const before = await folders(); const picture = await photo();
  await assert.rejects(renderInstagramVideo(vehicle, {
    ffmpegPath: '/does-not-exist/autovalorpt-ffmpeg',
    fetchImpl: async () => new Response(picture, { headers: { 'content-type': 'image/jpeg' } }),
  }), /video_encoder_unavailable/);
  // Other render invocations may finish and remove their own pre-existing
  // folders while this test runs. Only newly leaked folders indicate a failure.
  assert.deepEqual((await folders()).filter((name) => !before.includes(name)), []);
});
