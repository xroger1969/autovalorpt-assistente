import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../catalogo.js', import.meta.url), 'utf8');

async function dashboard(report, options = {}) {
  const elements = new Map(); const calls = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', children: [], hidden: ['dashboard', 'differencePanel'].includes(id), listeners: {},
        addEventListener(event, handler) { this.listeners[event] = handler; },
        replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } });
      return elements.get(id);
    },
    createElement() { return {}; },
  };
  vm.runInNewContext(script, { document, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method });
      const response = await options.respond?.(url, init);
      if (typeof response?.json === 'function') return response;
      return { ok: true, status: 200, json: async () => response || { lastResult: report, configuration: options.configuration } };
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

const untestedAuthorization = { ready: false, source: 'none', catalogManagementGranted: null };

test('checking a v2 snapshot before syncing can recover its full v3 galleries', async () => {
  let version = 2; let lastResult = null;
  const configuration = { enabled: true, production: true };
  const text = await dashboard(null, {
    respond: url => {
      if (url.endsWith('action=check')) {
        assert.equal(version, 2);
        lastResult = { status: 'source_invalid', reason: 'stock_source_changed', sourceCount: null,
          expectedCount: null, actualCount: null, authorization: untestedAuthorization, catalogConfirmed: false };
        return lastResult;
      }
      if (url.endsWith('action=run')) {
        assert.equal(version, 2);
        version = 3;
        lastResult = { status: 'catalog_matches', sourceCount: 9, expectedCount: 9, actualCount: 9,
          authorization: { ready: true, source: 'dedicated', catalogManagementGranted: null },
          imagesVerified: true, catalogConfirmed: true };
        return lastResult;
      }
      return { configuration, lastResult };
    },
  });
  assert.equal(text.element('syncButton').disabled, false);
  await text.click('checkButton');
  assert.equal(text('stateBadge'), 'Stock e galerias por atualizar');
  assert.match(text('stateText'), /Sincronizar agora.*galerias completas/);
  for (const id of ['sourceCount', 'feedCount', 'metaCount']) assert.equal(text(id), '—');
  assert.equal(text.element('syncButton').disabled, false);

  await text.click('syncButton');
  assert.equal(version, 3);
  assert.equal(text('stateBadge'), 'Stock, preços e imagens confirmados na Meta');
  for (const id of ['sourceCount', 'feedCount', 'metaCount']) assert.equal(text(id), '9');
  assert.deepEqual(text.calls.map(call => [call.url.split('action=')[1], call.method]), [
    ['status', 'GET'], ['check', 'POST'], ['status', 'GET'], ['run', 'POST'], ['status', 'GET'],
  ]);
});

test('stale and missing snapshots have a recovery message distinct from unreadable sources', async () => {
  for (const reason of ['stock_source_changed', 'stock_not_synchronized']) {
    const text = await dashboard({ status: 'source_invalid', reason, authorization: untestedAuthorization },
      { configuration: { enabled: true } });
    assert.equal(text('stateBadge'), 'Stock e galerias por atualizar');
    assert.match(text('stateText'), /Sincronizar agora/);
    assert.equal(text.element('syncButton').disabled, false);
  }
  for (const reason of ['source_incomplete_inventory', 'source_gallery_unavailable', 'source_gallery_mismatch']) {
    const text = await dashboard({ status: 'source_invalid', reason, authorization: untestedAuthorization },
      { configuration: { enabled: true } });
    assert.equal(text('stateBadge'), 'Origem por confirmar');
    assert.match(text('stateText'), /Não foi possível ler e validar/);
    assert.match(text('stateText'), /último catálogo válido foi preservado/);
  }
});

test('unknown Meta authorization permits an authenticated recovery but an explicit refusal does not', async () => {
  for (const authorization of [undefined, untestedAuthorization]) {
    const text = await dashboard({ status: 'source_invalid', reason: 'stock_source_changed', authorization },
      { configuration: { enabled: true } });
    assert.equal(text.element('syncButton').disabled, false);
  }
  for (const report of [
    { authorization: { ready: false } },
    { authorization: { ...untestedAuthorization, reason: 'catalog_authorization_required' } },
    { authorization: { ready: false, source: 'existing_facebook_probe', catalogManagementGranted: false } },
    { authorization: untestedAuthorization, permissionRequired: true },
    { status: 'authorization_required', authorization: untestedAuthorization },
    { authorization: untestedAuthorization, reason: 'meta_catalog_permissions_incomplete' },
  ]) {
    const text = await dashboard({ status: 'source_invalid', reason: 'stock_source_changed', ...report },
      { configuration: { enabled: true } });
    assert.equal(text.element('syncButton').disabled, true);
    await text.click('syncButton');
    assert.equal(text.calls.length, 1);
  }
});

test('disabled or missing configuration cannot request recovery with an untested Meta authorization', async () => {
  for (const configuration of [undefined, {}, { enabled: false }]) {
    const text = await dashboard({ status: 'source_invalid', reason: 'stock_source_changed', authorization: untestedAuthorization },
      { configuration });
    assert.equal(text.element('syncButton').disabled, true);
    assert.match(text('stateText'), /sincronização está desativada/);
    await text.click('syncButton');
    assert.equal(text.calls.length, 1);
  }
});

test('an unauthenticated page cannot check or sync even through its action handlers', async () => {
  const text = await dashboard(null, {
    configuration: { enabled: true },
    respond: () => ({ ok: false, status: 401, json: async () => ({ error: 'private_access_required' }) }),
  });
  assert.equal(text.element('dashboard').hidden, true);
  assert.equal(text.element('accessView').hidden, false);
  assert.equal(text.element('checkButton').disabled, true);
  assert.equal(text.element('syncButton').disabled, true);
  await text.click('checkButton'); await text.click('syncButton');
  assert.equal(text.calls.length, 1);
});

test('loss of private access disables recovery after a previously authorized status', async () => {
  for (const status of [401, 403]) {
    const text = await dashboard({ status: 'source_invalid', reason: 'stock_source_changed', authorization: untestedAuthorization }, {
      configuration: { enabled: true },
      respond: url => url.endsWith('action=run')
        ? { ok: false, status, json: async () => ({ error: 'private_access_required' }) } : null,
    });
    assert.equal(text.element('syncButton').disabled, false);
    await text.click('syncButton');
    assert.equal(text.element('dashboard').hidden, true);
    assert.equal(text.element('syncButton').disabled, true);
    await text.click('syncButton'); await text.click('checkButton');
    assert.equal(text.calls.length, 2);
  }
});

test('a recovery already in progress disables all actions and cannot be duplicated', async () => {
  let resolveRun;
  const runResponse = new Promise(resolve => { resolveRun = resolve; });
  const text = await dashboard({ status: 'source_invalid', reason: 'stock_source_changed', authorization: untestedAuthorization }, {
    configuration: { enabled: true },
    respond: url => url.endsWith('action=run') ? runResponse : null,
  });
  const running = text.click('syncButton');
  for (const id of ['refreshButton', 'checkButton', 'syncButton']) {
    assert.equal(text.element(id).disabled, true);
    await text.click(id);
  }
  assert.deepEqual(text.calls.map(call => call.url.split('action=')[1]), ['status', 'run']);
  resolveRun({ status: 'source_invalid', reason: 'source_gallery_unavailable', catalogConfirmed: false });
  await running;
  assert.equal(text.element('syncButton').disabled, false);
  assert.equal(text('stateBadge'), 'Origem por confirmar');
  assert.equal(text.calls.length, 2);
});
