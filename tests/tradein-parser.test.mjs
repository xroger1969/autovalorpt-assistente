import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../ios-keyboard-fix.js', import.meta.url), 'utf8');

function setupTradeInFlow({ pendingIntent = 'retoma', finished = false } = {}) {
  const domReadyListeners = [];
  const bubbles = [];
  const confirmations = [];
  const placeholders = [];
  const input = { value: '' };
  const chatTitle = { textContent: '' };
  let advances = 0;
  let removedPanels = 0;
  let fallbackCalls = 0;

  const context = {
    document: {
      addEventListener(name, listener) {
        if (name === 'DOMContentLoaded') domReadyListeners.push(listener);
      },
      getElementById(id) {
        if (id === 'messageInput') return input;
        if (id === 'chatTitle') return chatTitle;
        return null;
      },
      querySelector() {
        return null;
      }
    },
    window: {},
    state: {
      busy: false,
      pendingIntent,
      finished,
      lead: { retoma: '', matricula: '' }
    },
    INTENTS: {
      retoma: { short: 'Retoma' },
      matricula: {
        short: 'Matrícula da retoma',
        retry: 'Não consegui validar a matrícula. Escreva, por exemplo: AA-00-AA.',
        placeholder: 'Ex.: AA-00-AA'
      }
    },
    async sendMessage() {
      fallbackCalls += 1;
    },
    resetState() {},
    selectVehicle() {},
    removeActionPanels() {
      removedPanels += 1;
    },
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
    },
    get fallbackCalls() {
      return fallbackCalls;
    },
    get removedPanels() {
      return removedPanels;
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
  assert.equal(flow.context.state.pendingIntent, 'matricula');
  assert.deepEqual(flow.confirmations, ['retoma']);
  assert.equal(flow.advances, 0);
  assert.equal(
    flow.bubbles.some(({ text }) => /Falta só indicar quantos quilómetros/i.test(text)),
    false
  );

  await flow.context.sendMessage('aa00bb');

  assert.equal(flow.context.state.lead.matricula, 'AA-00-BB');
  assert.equal(flow.context.state.pendingIntent, '');
  assert.deepEqual(flow.confirmations, ['retoma', 'matricula']);
  assert.equal(flow.advances, 1);
});

test('routes a free question about trade-in into the structured flow', async () => {
  const flow = setupTradeInFlow({ pendingIntent: '', finished: true });

  await flow.context.sendMessage('Aceitam retoma?');

  assert.equal(flow.context.state.finished, false);
  assert.equal(flow.context.state.pendingIntent, 'retoma');
  assert.equal(flow.context.document.getElementById('chatTitle').textContent, 'Retoma');
  assert.equal(flow.context.state.lead.retoma, '');
  assert.equal(flow.removedPanels, 1);
  assert.equal(flow.fallbackCalls, 0);
  assert.deepEqual(
    flow.bubbles.map(({ role }) => role),
    ['user', 'bot']
  );
  assert.match(flow.bubbles.at(-1).text, /^Sim, aceitamos retomas\./);
  assert.equal(flow.placeholders.at(-1), 'Ex.: Renault Clio, 2019, 85 000 km');

  await flow.context.sendMessage('Renault Clio 2010 diesel 234000');

  assert.equal(
    flow.context.state.lead.retoma,
    `Renault Clio Diesel, 2010, ${formattedMileage(234000)}`
  );
  assert.equal(flow.context.state.pendingIntent, 'matricula');
  assert.deepEqual(flow.confirmations, ['retoma']);
  assert.equal(flow.advances, 0);
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
    assert.equal(flow.context.state.pendingIntent, 'matricula');
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
  assert.equal(flow.context.state.pendingIntent, 'matricula');
});

test('rejects an invalid registration and keeps asking for it', async () => {
  const flow = setupTradeInFlow({ pendingIntent: 'matricula' });

  await flow.context.sendMessage('123456');

  assert.equal(flow.context.state.lead.matricula, '');
  assert.equal(flow.context.state.pendingIntent, 'matricula');
  assert.match(flow.bubbles.at(-1).text, /Não consegui validar a matrícula/i);

  await flow.context.sendMessage('12-ab-34');

  assert.equal(flow.context.state.lead.matricula, '12-AB-34');
  assert.equal(flow.context.state.pendingIntent, '');
  assert.deepEqual(flow.confirmations, ['matricula']);
  assert.equal(flow.advances, 1);
});
