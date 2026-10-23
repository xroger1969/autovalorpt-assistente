import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import previewHandler from '../api/preview-image.js';

const expectedImageUrl = 'https://autovalorpt-assistente.vercel.app/api/preview-image?v=6';

test('welcome page exposes the generic social metadata', async () => {
  const html = await readFile(new URL('../welcome.html', import.meta.url), 'utf8');

  assert.match(html, /<title>Assistente do Carlos<\/title>/);
  assert.match(html, /<meta name="description" content="Informações sobre viaturas, financiamento e retoma\. Deixe o seu pedido para o Carlos lhe ligar\.">/);
  assert.match(html, /<meta property="og:title" content="Assistente do Carlos">/);
  assert.match(html, /<meta property="og:description" content="Informações sobre viaturas, financiamento e retoma\. Deixe o seu pedido para o Carlos lhe ligar\.">/);
  assert.equal(html.includes(expectedImageUrl), true);
  assert.equal(html.includes('Avaliação da sua viatura'), false);
});

test('preview endpoint returns the square image selected for WhatsApp', () => {
  const headers = new Map();
  let body;
  let statusCode;
  const response = {
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    status(code) {
      statusCode = code;
      return this;
    },
    send(value) {
      body = value;
      return this;
    }
  };

  previewHandler({}, response);

  assert.equal(statusCode, 200);
  assert.equal(headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.isBuffer(body), true);
  assert.deepEqual([...body.subarray(0, 3)], [255, 216, 255]);
});


test('root entry redirects to the welcome document without a self-redirect loop', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'The root entry contains a redirect.');
  for (const [search, hash, expected] of [
    ['', '', '/welcome.html'],
    ['?v=3', '', '/welcome.html?v=3'],
    ['?utm_source=whatsapp', '#inicio', '/welcome.html?utm_source=whatsapp#inicio']
  ]) {
    let destination;
    vm.runInNewContext(script, { window: { location: { search, hash, replace(value) { destination = value; } } } });
    assert.equal(destination, expected);
    assert.notEqual(destination, `/${search}${hash}`);
  }
  assert.match(html, /href="\/welcome\.html"/);
  assert.match(html, /<title>Assistente do Carlos<\/title>/);
  assert.equal(html.includes(expectedImageUrl), true);
  assert.equal(html.includes('Avaliação da sua viatura'), false);
});
