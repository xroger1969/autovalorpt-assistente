import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../catalogo.js', import.meta.url), 'utf8');

async function dashboard(report) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', children: [], hidden: false,
        addEventListener() {}, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } });
      return elements.get(id);
    },
    createElement() { return {}; },
  };
  vm.runInNewContext(script, { document, AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ lastResult: report }) }) });
  await new Promise(resolve => setImmediate(resolve));
  return id => elements.get(id).textContent;
}

test('dashboard shows independent Samucar, feed and Meta counts', async () => {
  const text = await dashboard({ status: 'source_invalid', sourceCount: 9, expectedCount: 7, actualCount: 6 });
  assert.equal(text('sourceCount'), '9');
  assert.equal(text('feedCount'), '7');
  assert.equal(text('metaCount'), '6');
});

test('dashboard leaves missing, legacy and invalid source counts unknown', async () => {
  for (const sourceCount of [undefined, null, -1, '9']) {
    const text = await dashboard({ status: 'source_invalid', sourceCount, expectedCount: 7 });
    assert.equal(text('sourceCount'), '—');
    assert.equal(text('feedCount'), '7');
  }
});
