import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledEditorialPlan as planned } from '../lib/electric-editorial-calendar.js';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
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

test('an AI edition preserves the checked calculation and the simulator, and reports its origin', async () => {
  const p = adviceEditorialPlan('2026-11-26');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      hook: 'Qual é o preço da tua carga?', body: '{{F1}}\nCompara o preço da tua carga.', question: 'Quanto pagas pela energia em casa?',
    }) }] }] });
  };
  const result = await prepareElectricEdition(p, { env: { OPENAI_API_KEY: 'fixture' }, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.copyOrigin, 'ai');
  assert.equal(result.copyModel, 'gpt-6.2-astra');
  assert.ok(result.caption.startsWith('Qual é o preço da tua carga?'));
  assert.ok(result.caption.includes(p.slides[0].body));
  assert.ok(result.caption.includes(p.simulatorUrl));
  const fallback = await prepareElectricEdition(p, { env: {}, fetchImpl });
  assert.equal(fallback.caption, p.caption);
  assert.equal(fallback.copyOrigin, 'editorial');
  assert.equal(calls, 1);
});

test('the new calendar uses all 32 topics in each lane and keeps the approved Reel and source editions', () => {
  const daily = new Map(), extra = new Map();
  const ordinary = new Set();
  for (let i = 0; i < 170; i++) {
    for (const [isExtra, seen] of [[false, daily], [true, extra]]) {
      const p = adviceEditorialPlan(day(i), isExtra);
      if (p.format === 'REELS') { assert.equal(i, 3); assert.equal(isExtra, false); continue; }
      assert.equal(p.version, 'v3');
      assert.equal(p.extra === true, isExtra);
      if (seen.has(p.topicId)) assert.ok(i - seen.get(p.topicId) >= 30, p.topicId);
      seen.set(p.topicId, i);
      if (!isExtra && p.electric === 'tip') ordinary.add(p.topicId);
    }
  }
  assert.equal(ordinary.size, 32);
  assert.equal(extra.size, 32);
  assert.equal([...extra.keys()].filter(k => daily.has(k)).length, 0);
  assert.equal(adviceEditorialPlan(day(7)).electric, 'grant');
  assert.equal(adviceEditorialPlan(day(9)).electric, 'news');
});
