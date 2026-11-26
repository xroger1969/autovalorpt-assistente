import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('./source-build3.json', import.meta.url), 'utf8'));
const appRoot = new URL('../../', import.meta.url);
assert.equal(manifest.sourceCommit, '877654a24a86b4fad319683c20b12bb7881a5566');
for (const [path, expected] of Object.entries(manifest.sha256)) {
  assert(!path.startsWith('/') && !path.split('/').includes('..'), 'Invalid manifest path');
  const actual = createHash('sha256').update(await readFile(new URL(path, appRoot))).digest('hex');
  assert.equal(actual, expected, `Build 3 source differs: ${path}`);
}
console.log(`Verified ${Object.keys(manifest.sha256).length} application files against ${manifest.sourceCommit}`);
console.log(`Expo app root: ${fileURLToPath(appRoot)}`);
