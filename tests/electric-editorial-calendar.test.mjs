import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledEditorialPlan as planned } from '../lib/electric-editorial-calendar.js';
import { editorialPlan } from '../lib/editorial-content.js';
import { prepareElectricEdition } from '../lib/electric-editorial-edition.js';
import { renderEditorialImage } from '../lib/editorial-image.js';

const day = offset => new Date(Date.UTC(2026, 10, 26 + offset)).toISOString().slice(0, 10);

test('launch promotes the customer simulators, preserves the approved Reel and rotates all banks without consecutive-month duplicates', () => {
  assert.deepEqual(planned('2026-11-25'), editorialPlan('2026-11-25'));
  const week = Array.from({ length: 7 }, (_, index) => planned(day(index)));
  assert.deepEqual(week.map(p => p.topicId), ['eletrico-custo-cem-km', 'eletrico-poupanca-anual', 'eletrico-casa-posto-custo',
    'reel-test-drive', 'eletrico-usado-orcamento', 'eletrico-custo-trajeto', 'eletrico-plug-in-custos']);
  assert.deepEqual(week[3], editorialPlan(day(3)));
  for (const plan of week.filter(p => p.electric)) {
    assert.equal(plan.simulatorUrl, 'https://carregador.vercel.app/');
    assert.ok(plan.caption.includes(plan.simulatorUrl) && plan.caption.includes('perfil @autovalorpt'));
    assert.equal(Boolean(plan.creditSimulatorUrl), plan.topicId === 'eletrico-usado-orcamento');
  }
  assert.equal(planned(day(7)).electric, 'grant');
  assert.equal(planned(day(9)).electric, 'news');
  const last = new Map(), old = new Set(), special = new Set();
  for (let i = -5; i < 420; i++) {
    const p = planned(day(i));
    if (last.has(p.topicId)) assert.ok(i - last.get(p.topicId) >= 30, p.topicId);
    last.set(p.topicId, i);
    if (p.electric) special.add(p.topicId);
    else if (p.format !== 'REELS') old.add(p.topicId);
  }
  assert.equal(old.size, 42);
  assert.equal(special.size, 20);
});

test('all electric cards render at Instagram size within the original layout', async () => {
  const dates = new Map();
  for (let i = 0; dates.size < 20 && i < 90; i++) {
    const post = planned(day(i));
    if (post.electric && !dates.has(post.topicId)) dates.set(post.topicId, post);
  }
  const { default: sharp } = await import('sharp');
  for (const p of dates.values()) {
    const data = await renderEditorialImage(p);
    const image = await sharp(data).metadata();
    assert.deepEqual([image.width, image.height], [1080, 1350], p.topicId);
  }
});

test('optional angle selection changes only copy and keeps the verified calls to action', async () => {
  const p = planned('2026-11-30');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"index":1}' }] }] });
  };
  const alternate = await prepareElectricEdition(p, { env: { OPENAI_API_KEY: 'fixture' }, fetchImpl });
  assert.equal(calls, 1);
  assert.ok(alternate.caption.startsWith(p.alternative.title));
  assert.ok(alternate.caption.includes(p.slides[0].body) && alternate.caption.includes(p.alternative.cta));
  for (const link of [p.simulatorUrl, p.creditSimulatorUrl]) assert.ok(alternate.caption.includes(link));
  assert.deepEqual(alternate.sources, []);
  assert.deepEqual((await prepareElectricEdition(p, { env: {}, fetchImpl })).caption, p.caption);
  assert.equal(calls, 1);
});
