import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVICE_START_DATE, ADVICE_DAILY_COUNT, ADVICE_EXTRA_COUNT, adviceFor } from '../lib/editorial-advice-content.js';

const date = offset => new Date(Date.parse(ADVICE_START_DATE) + offset * 86400000).toISOString().slice(0, 10);
const all = (extra, count) => Array.from({ length: count }, (_, i) => adviceFor(date(i), extra));
const daily = all(false, ADVICE_DAILY_COUNT), extra = all(true, ADVICE_EXTRA_COUNT);

test('editorial advice rotates distinct evergreen daily and exclusive extra banks without 30-day repeats', () => {
  assert.ok(daily.length >= 30); assert.ok(extra.length >= 32);
  const cards = [...daily, ...extra];
  for (const get of [c => c.id, c => c.title, c => c.body, c => c.alternative.title]) {
    assert.equal(new Set(cards.map(get)).size, cards.length);
  }
  for (const [additional, bank] of [[false, daily], [true, extra]]) {
    const wrap = [...bank.slice(-29), ...all(additional, 30)];
    for (let start = 0; start <= 29; start++) {
      assert.equal(new Set(wrap.slice(start, start + 30).map(c => c.id)).size, 30);
    }
    assert.equal(adviceFor(date(bank.length), additional).id, bank[0].id);
    assert.equal(adviceFor(date(9), additional, 2).id, bank[2].id);
  }
});

test('every advice visual supplies bounded factual copy and same-unit numerical data for its plotted comparison', () => {
  for (const bank of [daily, extra]) {
    assert.deepEqual(new Set(bank.map(c => c.visual.kind)), new Set(['metric', 'compare', 'checklist']));
    for (const card of bank) {
      const { id, title, body, takeaway, category, facts, visual, alternative } = card;
      assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      for (const [text, min, max] of [[title, 15, 58], [body, 45, 175], [takeaway, 25, 105], [category, 5, 25],
        [alternative.title, 12, 80]]) {
        assert.ok(text.length >= min && text.length <= max, id + ' length ' + text.length);
        assert.ok(!/[<>]/.test(text));
      }
      assert.equal(facts[0], body); assert.ok(facts.length >= 2);
      assert.equal(alternative.cta, takeaway);
      assert.ok(!('options' in card));
      assert.ok(visual.items.length >= 1 && visual.items.length <= 3);
      for (const row of visual.items) {
        assert.ok(row.label.length >= 2 && row.label.length <= 26, id + ' label');
        assert.ok(row.value.length >= 2 && row.value.length <= 24, id + ' value');
      }
      if (visual.kind === 'compare') {
        assert.ok(visual.unit.length && visual.items.length >= 2);
        for (const row of visual.items) {
          assert.ok(Number.isFinite(row.amount) && row.amount >= 0);
          assert.equal(Number(row.value.split(/[^0-9,]/)[0].replace(',', '.')), row.amount);
        }
      }
      if (visual.kind === 'metric') {
        assert.equal(card.metric, visual.items[0].value);
        assert.equal(card.metricLabel, visual.items[0].label);
      }
    }
  }
});

test('first examples use metered electricity and rounded comparable money at the stated distances', () => {
  const first = daily[0], commute = extra[0];
  assert.match(first.body, /18 kWh\/100 km medidos na tomada/);
  assert.equal((6 * 1.65 / 18).toFixed(2), '0.55');
  assert.match(first.body, /0,55 €\/kWh/);
  assert.deepEqual(first.visual.items.map(x => x.amount), [Number((18 * 0.22).toFixed(2)), Number((6 * 1.65).toFixed(2))]);
  const km = 42 * 20;
  const electric = 18 * 0.22 * km / 100, fuel = 6 * 1.70 * km / 100;
  assert.deepEqual(commute.visual.items.map(x => x.amount), [Number(electric.toFixed(2)), Number(fuel.toFixed(2))]);
  assert.ok(commute.body.includes((fuel - electric).toFixed(2).replace('.', ',') + ' €'));
});

test('advice lookup validates dates and ordinals and isolates mutable caller output', () => {
  for (const value of ['2026-11-25', '2027-02-29', '2027-01-01T00:00:00Z', null]) assert.throws(() => adviceFor(value));
  for (const value of [-1, 2.5, '1']) assert.throws(() => adviceFor(ADVICE_START_DATE, false, value));
  const copy = adviceFor(ADVICE_START_DATE); copy.visual.items[0].value = 'stale'; copy.facts.pop();
  assert.deepEqual(adviceFor(ADVICE_START_DATE), daily[0]);
});

test('the revised cost comparison identifies the dated fuel reference and the example home tariff', () => {
  const revised = adviceFor('2026-11-27', false, 0);
  assert.equal(revised.id, daily[0].id);
  assert.match(revised.body, /13 kWh na tomada e 6 L/);
  assert.match(revised.body, /tarifa de casa é ilustrativa/);
  assert.match(revised.body, /DGEG em Portugal continental, 26\/11\/2026/);
  assert.ok(revised.body.length <= 175 && revised.takeaway.length <= 105);
  for (const [index, label, cost] of [
    [0, 'Casa a 0,22 €/kWh', 13 * 0.22],
    [1, 'Gasolina 95 a 1,851 €/L', 6 * 1.851],
    [2, 'Gasóleo a 2,035 €/L', 6 * 2.035],
  ]) {
    const row = revised.visual.items[index];
    assert.equal(row.label, label);
    assert.equal(row.amount, Number(cost.toFixed(2)));
    assert.equal(row.value, cost.toFixed(2).replace('.', ',') + ' €');
  }
  for (const price of [1.851, 2.035]) {
    assert.ok(revised.takeaway.includes((6 * price / 13).toFixed(2).replace('.', ',') + ' €/kWh'));
  }
});
