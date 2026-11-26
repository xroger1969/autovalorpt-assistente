import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { fetchInstagramImage, instagramCompatibleJpeg, signInstagramImageUrl, verifyInstagramImageQuery } from '../lib/instagram-image.js';
import { createInstagramImageHandler } from '../lib/instagram-image-handler.js';
import { renderInstagramStockImage } from '../lib/instagram-stock-image.js';

const env = { ADMIN_SESSION_SECRET: 'synthetic-secret-with-at-least-32-characters', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app' };
const source = 'https://ireland.apollo.olxcdn.com/v1/files/synthetic/image;q=100;s=600x0';

test('signatures expire, bind to the exact OLX image and cannot authorize another host', () => {
  const now = 1794000000000; const url = new URL(signInstagramImageUrl(source, env, now)); const query = Object.fromEntries(url.searchParams);
  assert.equal(verifyInstagramImageQuery(query, env, now), source);
  assert.equal(verifyInstagramImageQuery(query, env, now + 7201_000), '');
  assert.equal(verifyInstagramImageQuery({ ...query, src: source.replace('synthetic','different') }, env, now), '');
  assert.equal(verifyInstagramImageQuery({ ...query, src: 'https://127.0.0.1/private' }, env, now), '');
});

test('portrait 600x800 becomes JPEG 640x800 by padding without cropping', async () => {
  const original = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 200, g: 90, b: 10 } } }).png().toBuffer();
  const result = await instagramCompatibleJpeg(original); const meta = await sharp(result).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 640); assert.equal(meta.height, 800); assert.equal(meta.space, 'srgb');
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] < 30); assert.ok(data[30 * info.channels] > 180); assert.ok(result.length < 8 * 1024 * 1024);
});

test('large landscape and narrow portrait remain within API dimensions and ratios', async () => {
  for (const [width, height] of [[2000,500],[100,1000]]) {
    const original = await sharp({ create: { width, height, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const result = await instagramCompatibleJpeg(original); const meta = await sharp(result).metadata();
    assert.ok(meta.width >= 320 && meta.width <= 1440); assert.ok(meta.width/meta.height >= .8); assert.ok(meta.width/meta.height <= 1.91);
  }
});

test('image retrieval rejects redirects/non-image content and overlarge responses', async () => {
  await assert.rejects(fetchInstagramImage('https://evil.example/image', async () => { throw new Error('must not fetch'); }), { code: 'image_source_not_allowed' });
  await assert.rejects(fetchInstagramImage(source, async (_, opts) => { assert.equal(opts.redirect, 'error'); return new Response('<html>', { headers: { 'content-type': 'text/html' } }); }), { code: 'image_unavailable' });
  await assert.rejects(fetchInstagramImage(source, async () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' } })), { code: 'image_too_large' });
});


test('new image signatures bind the visual version while existing signed originals remain valid', () => {
  const now = 1794000000000;
  const current = Object.fromEntries(new URL(signInstagramImageUrl(source, env, now)).searchParams);
  assert.equal(current.style, 'premium1');
  for (const style of [undefined, 'premium2', ['premium1'], ''])
    assert.equal(verifyInstagramImageQuery({ ...current, style }, env, now), '');
  const legacy = { src: source, expires: current.expires,
    signature: createHmac('sha256', env.ADMIN_SESSION_SECRET)
      .update(`autovalorpt:instagram-image:v1\n${current.expires}\n${source}`).digest('base64url') };
  assert.equal(verifyInstagramImageQuery(legacy, env, now), source);
  assert.equal(verifyInstagramImageQuery({ ...legacy, style: 'premium1' }, env, now), '');
});

test('signed delivery frames new stock photos at 4:5 and preserves legacy output dimensions', async () => {
  const now = 1794000000000;
  const current = Object.fromEntries(new URL(signInstagramImageUrl(source, env, now)).searchParams);
  const legacy = { src: source, expires: current.expires,
    signature: createHmac('sha256', env.ADMIN_SESSION_SECRET)
      .update(`autovalorpt:instagram-image:v1\n${current.expires}\n${source}`).digest('base64url') };
  const original = await sharp({ create: { width: 640, height: 400, channels: 3, background: '#5281a7' } }).jpeg().toBuffer();
  let fetches = 0;
  const handler = createInstagramImageHandler({ env, now: () => now,
    fetchImpl: async () => { fetches++; return new Response(original, { headers: { 'content-type': 'image/jpeg' } }); } });
  async function request(query) {
    const result = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; },
      json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query }, result);
    return result;
  }
  const framed = await request(current); const prior = await request(legacy);
  assert.equal(framed.statusCode, 200); assert.equal(prior.statusCode, 200);
  const a = await sharp(framed.body).metadata(); const b = await sharp(prior.body).metadata();
  assert.deepEqual([a.width, a.height], [1080, 1350]);
  assert.deepEqual([b.width, b.height], [640, 400]);
  assert.equal((await request({ ...current, style: 'premium2' })).statusCode, 403);
  assert.equal(fetches, 2, 'unverified artwork variants never fetch a photo');
});

test('premium frame retains both extreme edges of portrait and wide original photos', async () => {
  for (const [width, height] of [[300, 800], [1500, 400]]) {
    const portrait = height > width;
    const red = await sharp({ create: { width: portrait ? width : 40, height: portrait ? 40 : height,
      channels: 3, background: '#f00000' } }).png().toBuffer();
    // Use literal colours so marker detection is independent of branding colours.
    const markerGreen = await sharp({ create: { width: portrait ? width : 40, height: portrait ? 40 : height,
      channels: 3, background: '#00e000' } }).png().toBuffer();
    const original = await sharp({ create: { width, height, channels: 3, background: '#5178a2' } })
      .composite([{ input: red, left: 0, top: 0 },
        { input: markerGreen, left: portrait ? 0 : width - 40, top: portrait ? height - 40 : 0 }]).png().toBuffer();
    const output = await renderInstagramStockImage(original);
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    let reds = 0, greens = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      if (pixels[i] > 180 && pixels[i + 1] < 55 && pixels[i + 2] < 55) reds++;
      if (pixels[i] < 55 && pixels[i + 1] > 150 && pixels[i + 2] < 55) greens++;
    }
    assert.ok(reds > 100 && greens > 100, 'neither original edge can be cropped or covered');
  }
});
