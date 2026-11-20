import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Build-time only. The runtime reads this verified local artifact and never fetches
// models. Pin both the rembg-published MD5 and our independently recorded SHA-256.
const source = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const target = fileURLToPath(new URL('../assets/models/u2netp.onnx', import.meta.url));
const expected = {
  bytes: 4574861,
  md5: '8e83ca70e441ab06c318d82300c84806',
  sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
};
const valid = data => data.length === expected.bytes && ['md5', 'sha256'].every(
  algorithm => createHash(algorithm).update(data).digest('hex') === expected[algorithm],
);

async function main() {
  const existing = await readFile(target).catch(() => null);
  if (existing && valid(existing)) { console.log('U2NetP model verified (cached).'); return; }
  const response = await fetch(source, { signal: AbortSignal.timeout(45_000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`U2NetP download failed: ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > expected.bytes) throw new Error('U2NetP download exceeds pinned size');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const model = Buffer.concat(chunks);
  if (!valid(model)) throw new Error('U2NetP model checksum mismatch');
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try { await writeFile(temporary, model); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  console.log(`U2NetP model downloaded and verified (${expected.bytes} bytes).`);
}

await main();
