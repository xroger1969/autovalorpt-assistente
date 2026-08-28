import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import previewHandler from '../api/preview-image.js';

const expectedImageUrl = 'https://autovalorpt-assistente.vercel.app/api/preview-image?v=6';

test('welcome page exposes the generic social metadata', async () => {
  const html = await readFile(new URL('../welcome.html', import.meta.url), 'utf8');

  assert.match(html, /<title>Assistente do Carlos<\/title>/);
  assert.match(html, /<meta name="description" content="Vou dar seguimento ao seu pedido em 1 minuto\.">/);
  assert.match(html, /<meta property="og:title" content="Assistente do Carlos">/);
  assert.match(html, /<meta property="og:description" content="Vou dar seguimento ao seu pedido em 1 minuto\.">/);
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
