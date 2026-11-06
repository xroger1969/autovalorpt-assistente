import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fetchInstagramImage, instagramCompatibleJpeg, signInstagramImageUrl, verifyInstagramImageQuery } from '../lib/instagram-image.js';

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
