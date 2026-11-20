import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../catalogo.js', import.meta.url), 'utf8');

async function dashboard(report, options = {}) {
  const elements = new Map(); const calls = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', children: [], hidden: false, listeners: {},
        addEventListener(event, handler) { this.listeners[event] = handler; },
        replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } });
      return elements.get(id);
    },
    createElement() { return {}; },
  };
  vm.runInNewContext(script, { document, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method });
      return { ok: true, json: async () => options.respond?.(url, init) || { lastResult: report, configuration: options.configuration } };
    } });
  await new Promise(resolve => setImmediate(resolve));
  const text = id => elements.get(id).textContent;
  text.click = id => elements.get(id).listeners.click();
  text.element = id => elements.get(id);
  text.calls = calls;
  return text;
}

test('dashboard shows independent Standvirtual, feed and Meta counts', async () => {
  const text = await dashboard({ status: 'source_invalid', sourceCount: 9, expectedCount: 7, actualCount: 6 });
  assert.equal(text('sourceCount'), '9');
  assert.equal(text('feedCount'), '7');
  assert.equal(text('metaCount'), '6');
});

test('failed stock refresh remains visible instead of showing a previous confirmed catalogue', async () => {
  const previous = { status: 'catalog_matches', sourceCount: 9, expectedCount: 9, actualCount: 9,
    authorization: { ready: true }, catalogConfirmed: true, checkedAt: '2026-11-20T08:00:00.000Z' };
  const text = await dashboard(previous, {
    configuration: { enabled: true },
    respond: url => url.endsWith('action=run') ? {
      ok: false, status: 'source_invalid', reason: 'source_incomplete_inventory',
      sourceValid: false, catalogConfirmed: false, checkedAt: '2026-11-20T10:00:00.000Z'
    } : null,
  });
  assert.equal(text('stateBadge'), 'Stock e preços confirmados na Meta');
  await text.click('syncButton');
  assert.equal(text('stateBadge'), 'Origem por confirmar');
  assert.equal(text('actionStatus'), 'Atualização suspensa. O último catálogo válido foi preservado.');
  assert.equal(text('sourceCount'), '—');
  assert.equal(text.element('syncButton').disabled, false);
  assert.deepEqual(text.calls.map(call => [call.url.split('action=')[1], call.method]), [['status', 'GET'], ['run', 'POST']]);
});

test('dashboard leaves missing, legacy and invalid source counts unknown', async () => {
  for (const sourceCount of [undefined, null, -1, '9']) {
    const text = await dashboard({ status: 'source_invalid', sourceCount, expectedCount: 7 });
    assert.equal(text('sourceCount'), '—');
    assert.equal(text('feedCount'), '7');
  }
});
