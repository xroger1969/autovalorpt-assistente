import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { renderAdviceImage } from '../lib/editorial-advice-image.js';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
import { ADVICE_START_DATE, ADVICE_DAILY_COUNT, ADVICE_EXTRA_COUNT } from '../lib/editorial-advice-content.js';

const slide = { title: 'Quanto custam 100 km?', category: 'Custo de utilização',
  body: 'Multiplica o consumo em 100 km pelo preço da energia.', takeaway: 'Faz a conta com o teu consumo habitual.',
  visual: { kind: 'compare', unit: '€/100 km', items: [{ label: 'Elétrico', value: '3,60 €', amount: 3.6 },
    { label: 'Gasolina', value: '10,20 €', amount: 10.2 }], note: 'Exemplo ilustrativo.' } };

test('advice chart gives both costs a shared zero and preserves the numerical ratio on the image', async () => {
  const image = await renderAdviceImage({ slides: [slide] });
  const { width, height, format } = await sharp(image).metadata();
  assert.deepEqual([width, height, format], [1080, 1350, 'jpeg']);
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  function widthOfBar(y, matches) {
    let count = 0;
    for (let x = 72; x < 1008; x++) {
      const offset = (y * info.width + x) * 3;
      if (matches(...data.subarray(offset, offset + 3))) count++;
    }
    return count;
  }
  const rows = Array.from({ length: 144 }, (_, i) => 606 + i);
  const electric = Math.max(...rows.map(y => widthOfBar(y, (r, g, b) => r > 200 && g > 160 && b < 150)));
  const petrol = Math.max(...rows.map(y => widthOfBar(y + 144, (r, g, b) => r > 170 && g > 180 && b > 180)));
  assert.ok(petrol >= 930);
  assert.ok(Math.abs(electric / petrol - 3.6 / 10.2) < 0.01);
});

test('non-comparable quantities and procedural checks use text without fabricated numerical data', async () => {
  const items = [{ label: 'Candidatura', value: 'Aviso em vigor' }, { label: 'Viatura', value: 'Condições do aviso' }];
  for (const kind of ['checklist', 'metric', 'compare']) {
    const image = await renderAdviceImage({ slides: [{ ...slide, visual: { kind, items } }] });
    assert.ok(image.length > 25000);
  }
  await assert.rejects(() => renderAdviceImage({ slides: [slide] }, 1), /editorial_slide_invalid/);
  await assert.rejects(() => renderAdviceImage({ slides: [{ ...slide, visual: { kind: 'compare', items: [] } }] }), /editorial_advice_visual_invalid/);
});

test('every authored advice card, including grant and news editions, fits the portrait layout', async () => {
  const plans = new Map();
  for (let day = 0; day < 75; day++) {
    const date = new Date(Date.parse(ADVICE_START_DATE) + day * 86_400_000).toISOString().slice(0, 10);
    for (const extra of [false, true]) {
      const plan = adviceEditorialPlan(date, extra);
      if (plan.version === 'v3') plans.set(plan.topicId, plan);
    }
  }
  assert.equal(plans.size, ADVICE_DAILY_COUNT + ADVICE_EXTRA_COUNT + 4);
  for (const plan of plans.values()) {
    await assert.doesNotReject(() => renderAdviceImage(plan), 'Cartão: ' + plan.topicId);
  }
});
