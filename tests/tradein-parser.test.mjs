import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../ios-keyboard-fix.js', import.meta.url), 'utf8');

function setupTradeInFlow() {
  const domReadyListeners = [];
  const bubbles = [];
  const confirmations = [];
  const placeholders = [];
  const input = { value: '' };
  let advances = 0;

  const context = {
    document: {
      addEventListener(name, listener) {
        if (name === 'DOMContentLoaded') domReadyListeners.push(listener);
      },
      getElementById(id) {
        return id === 'messageInput' ? input : null;
      },
      querySelector() {
        return null;
      }
    },
    window: {},
    state: {
      busy: false,
      pendingIntent: 'retoma',
      lead: { retoma: '' }
    },
    async sendMessage() {},
    resetState() {},
    selectVehicle() {},
    addBubble(text, role) {
      bubbles.push({ text, role });
    },
    renderSummary() {},
    renderSelected() {},
    addConfirmation(intent) {
      confirmations.push(intent);
    },
    advanceIntent() {
      advances += 1;
    },
    setComposer(placeholder) {
      placeholders.push(placeholder);
    },
    Intl,
    console
  };

  vm.runInNewContext(source, context);
  assert.equal(domReadyListeners.length, 2);
  domReadyListeners[1]();

  return {
    bubbles,
    confirmations,
    context,
    placeholders,
    get advances() {
      return advances;
    }
  };
}

function formattedMileage(value) {
  return `${new Intl.NumberFormat('pt-PT').format(value)} km`;
}

test('infers bare six-digit mileage in a complete trade-in answer', async () => {
  const flow = setupTradeInFlow();

  await flow.context.sendMessage('Nissan micra 2022 124000');

  assert.equal(
    flow.context.state.lead.retoma,
    `Nissan Micra, 2022, ${formattedMileage(124000)}`
  );
  assert.equal(flow.context.state.pendingIntent, '');
  assert.deepEqual(flow.confirmations, ['retoma']);
  assert.equal(flow.advances, 1);
  assert.equal(
    flow.bubbles.some(({ text }) => /Falta só indicar quantos quilómetros/i.test(text)),
    false
  );
});

test('infers mileage with a space or dot and accepts fields in different orders', async () => {
  for (const answer of [
    'Nissan Micra 2022 124 000',
    '2022 Nissan Micra 124.000'
  ]) {
    const flow = setupTradeInFlow();

    await flow.context.sendMessage(answer);

    assert.equal(
      flow.context.state.lead.retoma,
      `Nissan Micra, 2022, ${formattedMileage(124000)}`
    );
    assert.equal(flow.context.state.pendingIntent, '');
  }
});

test('does not confuse a numeric vehicle model with mileage', async () => {
  const flow = setupTradeInFlow();

  await flow.context.sendMessage('Peugeot 2008 2022');

  assert.equal(flow.context.state.lead.retoma, 'Peugeot 2008, 2022');
  assert.equal(flow.context.state.pendingIntent, 'retoma');
  assert.match(flow.bubbles.at(-1).text, /Falta só indicar quantos quilómetros/i);

  await flow.context.sendMessage('24000');

  assert.equal(
    flow.context.state.lead.retoma,
    `Peugeot 2008, 2022, ${formattedMileage(24000)}`
  );
  assert.equal(flow.context.state.pendingIntent, '');
});
