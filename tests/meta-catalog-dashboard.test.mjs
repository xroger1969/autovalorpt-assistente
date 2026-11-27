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

const publishedGalleryReport = {
  status: 'products_pending', imagesVerified: true, catalogConfirmed: false, sourceValid: true, catalogValidated: true,
  sourceCount: 8, expectedCount: 8, actualCount: 8, authorization: { ready: true, source: 'dedicated' },
  pendingReviewIds: ['ID8Q19HN', 'ID8Q1hSv', 'ID8Q1lYB', 'ID8Q1myC', 'ID8Q1n7N', 'ID8Q1nvd', 'ID8Q1pLS', 'ID8Q1pSL'],
  notPublishedIds: [], rejectedIds: [], imageMismatchIds: [], imageUnverifiedIds: [], imagePendingIds: [],
  imageDiagnostics: ['ID8Q1nvd', 'ID8Q1pLS', 'ID8Q1pSL'].map(id => ({ id, status: 'unchanged' })),
  import: { latest: { status: 'completed', errorCount: 0, invalidCount: 0, persistedCount: 8, deletedCount: 0 },
    pending: false, unverified: false },
};

test('verified galleries and published articles distinguish unconfirmed WhatsApp approval without claiming a review queue', async () => {
  const report = structuredClone(publishedGalleryReport);
  const text = await dashboard(report, { configuration: { enabled: true } });
  assert.equal(text('stateBadge'), 'Fotografias sincronizadas · WhatsApp por confirmar');
  assert.equal(text('stateText'), 'Os artigos estão publicados no catálogo e as fotografias e galerias foram verificadas. A aprovação e a apresentação no WhatsApp continuam por confirmar.');
  assert.equal(text.element('stateBadge').className, 'badge pending');
  assert.equal(report.catalogConfirmed, false);
  assert.equal(text('photoStatus'), 'Fotografias principais e galerias das viaturas verificadas na Meta.');
  assert.equal(text.element('photoCounts').children.length, 0, 'three unchanged vehicles are not a count of imported photos');
  assert.doesNotMatch(text('photoStatus') + text('photoNote'), /\d|fila|em revisão/i);
  for (const id of ['sourceCount', 'feedCount', 'metaCount']) assert.equal(text(id), '8');
  assert.equal(text.element('syncButton').disabled, false);
  assert.deepEqual(text.calls.map(call => [call.url.split('action=')[1], call.method]), [['status', 'GET']]);
});

test('incomplete or invalid review arrays cannot imply that articles are already published', async () => {
  for (const variant of [
    { notPublishedIds: undefined }, { notPublishedIds: null }, { notPublishedIds: '' },
    { pendingReviewIds: undefined }, { pendingReviewIds: null }, { pendingReviewIds: [] },
    { pendingReviewIds: ['invalid'] }, { pendingReviewIds: ['ID8Q19HN', null] },
  ]) {
    const text = await dashboard({ ...publishedGalleryReport, ...variant });
    assert.equal(text('stateBadge'), 'Artigos ainda por publicar');
    assert.doesNotMatch(text('stateText'), /artigos estão publicados/i);
    assert.doesNotMatch(text('photoStatus'), /galerias.*verificadas/i);
  }
});

test('legacy or unverified images cannot gain a gallery synchronization claim from review and visibility arrays', async () => {
  for (const imagesVerified of [undefined, null, false, 'true']) {
    const text = await dashboard({ ...publishedGalleryReport, imagesVerified });
    assert.equal(text('stateBadge'), 'Artigos ainda por publicar');
    assert.doesNotMatch(text('stateText'), /galerias foram verificadas/);
    assert.doesNotMatch(text('photoStatus'), /galerias.*verificadas/i);
    assert.equal(text.element('stateBadge').className, 'badge pending');
  }
});

test('articles not confirmed as published keep the conservative publication message', async () => {
  const text = await dashboard({ ...publishedGalleryReport, notPublishedIds: ['ID8Q19HN'] });
  assert.equal(text('stateBadge'), 'Artigos ainda por publicar');
  assert.equal(text('stateText'), 'Há artigos com aprovação ou publicação pendente. A contagem no catálogo não confirma a apresentação no WhatsApp.');
  assert.equal(text.element('stateBadge').className, 'badge pending');
});

test('rejections, mismatches and review failures retain their own status even with verified images', async () => {
  for (const [status, label] of [['products_rejected', 'Artigos rejeitados pela Meta'],
    ['catalog_mismatch', 'Diferença encontrada'], ['review_required', 'Resultado a rever']]) {
    const text = await dashboard({ ...publishedGalleryReport, status });
    assert.equal(text('stateBadge'), label);
    assert.doesNotMatch(text('stateText'), /artigos estão publicados/i);
    assert.equal(text.element('stateBadge').className, 'badge pending');
  }
});

const verifiedDataReport = { ...publishedGalleryReport, catalogDataConfirmed: true };

test('confirmed data has a green badge while WhatsApp approval and Meta publication remain separate', async () => {
  const text = await dashboard({ ...verifiedDataReport, status: 'products_rejected',
    pendingReviewIds: ['ID8Q19HN', 'ID8Q1lYB'], rejectedIds: ['ID8Q1n7N'],
    notPublishedIds: ['ID8Q1n7N', 'ID8Q1lYB', 'ID8Q1hSv'] });
  assert.equal(text('stateBadge'), 'Dados conferidos na Meta');
  assert.equal(text.element('stateBadge').className, 'badge good');
  assert.match(text('stateText'), /fotografias e as galerias coincidem/);
  assert.equal(text.element('publicationStatus').hidden, false);
  assert.match(text('publicationStatus'), /Aprovação para WhatsApp por confirmar em 2 artigos/);
  assert.match(text('publicationStatus'), /Aprovação para WhatsApp rejeitada em 1 artigo\./);
  assert.match(text('publicationStatus'), /Publicação no catálogo Meta por confirmar em 3 artigos/);
  assert.match(text('publicationStatus'), /apresentação dos artigos no WhatsApp continua por verificar/);
  assert.equal(text('photoStatus'), 'Fotografias principais e galerias das viaturas verificadas na Meta.');
  assert.equal(text.element('photoCounts').children.length, 0);
});

test('full confirmation by Meta keeps customer visibility on WhatsApp distinct', async () => {
  const text = await dashboard({ ...verifiedDataReport, status: 'catalog_matches', catalogConfirmed: true,
    pendingReviewIds: [] });
  assert.equal(text('stateBadge'), 'Dados conferidos na Meta');
  assert.match(text('publicationStatus'), /aprovação para WhatsApp e a publicação no catálogo foram confirmadas pela Meta/);
  assert.match(text('publicationStatus'), /apresentação dos artigos no WhatsApp continua por verificar/);
});

test('an active import stops a previous green badge and hides historical approval information', async () => {
  let active = null;
  const report = { ...verifiedDataReport, status: 'catalog_matches', catalogConfirmed: true, pendingReviewIds: [] };
  const text = await dashboard(null, { respond: () => ({ lastResult: report, active }) });
  assert.equal(text.element('stateBadge').className, 'badge good');
  assert.equal(text.element('publicationStatus').hidden, false);
  active = { phase: 'submitted' };
  await text.click('refreshButton');
  assert.equal(text('stateBadge'), 'Importação em curso');
  assert.equal(text.element('stateBadge').className, 'badge pending');
  assert.match(text('stateText'), /contagens são do último diagnóstico/);
  assert.equal(text.element('publicationStatus').hidden, true);
  assert.equal(text('publicationStatus'), '');
  active = { phase: 'unknown' };
  await text.click('refreshButton');
  assert.equal(text('stateBadge'), 'Resultado por confirmar');
  assert.equal(text.element('stateBadge').className, 'badge pending');
});

test('equal counts preserve image and authorization warnings and do not provide data confirmation', async () => {
  for (const [variant, expected] of [
    [{ status: 'images_pending', imagesVerified: false }, 'Imagens por confirmar na Meta'],
    [{ status: 'catalog_mismatch' }, 'Diferença encontrada'],
    [{ status: 'authorization_required', authorization: { ready: false } }, 'Autorização do catálogo pendente'],
    [{ status: 'catalog_matches', authorization: { ready: false }, catalogConfirmed: true }, 'Autorização do catálogo pendente'],
    [{ status: 'products_pending', catalogDataConfirmed: 'true' }, 'Fotografias sincronizadas · WhatsApp por confirmar'],
  ]) {
    const text = await dashboard({ ...verifiedDataReport, sourceCount: 10, expectedCount: 10, actualCount: 10, ...variant });
    assert.equal(text('stateBadge'), expected);
    assert.equal(text.element('stateBadge').className, 'badge pending');
    assert.equal(text.element('publicationStatus').hidden, true);
    for (const id of ['sourceCount', 'feedCount', 'metaCount']) assert.equal(text(id), '10');
  }
});

test('new authorization failure remains explicit while an import is unresolved', async () => {
  const text = await dashboard(null, { respond: () => ({ active: { phase: 'unknown' },
    lastResult: { status: 'authorization_required', authorization: { ready: false } } }) });
  assert.equal(text('stateBadge'), 'Autorização do catálogo pendente');
  assert.equal(text.element('stateBadge').className, 'badge pending');
  assert.match(text('stateText'), /importação por confirmar/);
  assert.equal(text.element('publicationStatus').hidden, true);
});
