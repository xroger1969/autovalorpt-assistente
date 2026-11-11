import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { instagramVideoDetails, instagramVideoCard, originalInstagramAudio, renderInstagramVideo } from '../lib/instagram-video.js';

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
    if (i >= 29 * 44100) ending += value * value;
  }
  assert.ok(maximum > 1000 && maximum < 32000);
  assert.ok(ending < middle / 8);
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
