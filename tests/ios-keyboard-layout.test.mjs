import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../ios-keyboard-fix.js', import.meta.url), 'utf8');

function createClassList() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    remove(name) {
      values.delete(name);
    },
    contains(name) {
      return values.has(name);
    }
  };
}

function createStyle() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(name, value);
    },
    removeProperty(name) {
      values.delete(name);
    },
    getPropertyValue(name) {
      return values.get(name) || '';
    }
  };
}

function setupKeyboardFix({ appleMobile = true } = {}) {
  const documentListeners = new Map();
  const inputListeners = new Map();
  const viewportListeners = new Map();
  const styles = [];

  const input = {
    addEventListener(name, listener) {
      inputListeners.set(name, listener);
    },
    focusOptions: null,
    focus(options) {
      this.focusOptions = options;
    }
  };
  const inputRow = {};
  const privacy = {};
  const freeBox = {};
  const messages = { scrollHeight: 900, scrollTop: 0 };
  const composer = {
    classList: createClassList(),
    style: createStyle(),
    querySelector(selector) {
      if (selector === '.input-row') return inputRow;
      if (selector === '.privacy') return privacy;
      return null;
    },
    insertBefore() {}
  };

  const document = {
    activeElement: input,
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, []);
      documentListeners.get(name).push(listener);
    },
    createElement() {
      const style = { textContent: '' };
      styles.push(style);
      return style;
    },
    getElementById(id) {
      return {
        composer,
        freeQuestionBox: freeBox,
        messageInput: input,
        messages
      }[id] || null;
    },
    head: { appendChild() {} }
  };

  const visualViewport = {
    height: 500,
    offsetTop: 50,
    addEventListener(name, listener) {
      viewportListeners.set(name, listener);
    }
  };

  const navigator = appleMobile
    ? {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5
      }
    : {
        userAgent: 'Mozilla/5.0 (Linux; Android 16)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5
      };
  const context = {
    document,
    window: { innerWidth: 390, innerHeight: 800, visualViewport, navigator },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    Intl,
    console
  };
  vm.runInNewContext(source, context);
  documentListeners.get('DOMContentLoaded')[0]();

  return { composer, input, inputListeners, messages, styles, viewportListeners };
}

test('keeps the instruction box visible while the iPhone keyboard is open', () => {
  const { styles } = setupKeyboardFix();
  assert.match(styles[0].textContent, /#composer\.keyboard-open #freeQuestionBox\{display:block!important\}/);
  assert.doesNotMatch(styles[0].textContent, /#composer\.keyboard-open #freeQuestionBox,\s*#composer\.keyboard-open #quickSendPartial\{display:none/);
});

test('keeps the composer above the iPhone keyboard accessory bar without scrolling the page', () => {
  const { composer, input, inputListeners, messages } = setupKeyboardFix();

  inputListeners.get('focus')();

  assert.equal(composer.classList.contains('keyboard-open'), true);
  assert.equal(composer.style.getPropertyValue('--keyboard-translate-y'), '-314px');
  assert.equal(composer.style.getPropertyValue('--visual-viewport-height'), '500px');
  assert.equal(composer.style.getPropertyValue('--keyboard-accessory-clearance'), '64px');
  assert.equal(messages.scrollTop, messages.scrollHeight);
  assert.equal(input.focusOptions?.preventScroll, true);
});

test('does not add iOS keyboard clearance on other mobile platforms', () => {
  const { composer, inputListeners } = setupKeyboardFix({ appleMobile: false });

  inputListeners.get('focus')();

  assert.equal(composer.style.getPropertyValue('--keyboard-translate-y'), '-250px');
  assert.equal(composer.style.getPropertyValue('--keyboard-accessory-clearance'), '0px');
});

test('clears temporary viewport positioning when the keyboard closes', () => {
  const { composer, inputListeners } = setupKeyboardFix();

  inputListeners.get('focus')();
  inputListeners.get('blur')();

  assert.equal(composer.classList.contains('keyboard-open'), false);
  assert.equal(composer.style.getPropertyValue('--keyboard-translate-y'), '');
  assert.equal(composer.style.getPropertyValue('--visual-viewport-height'), '');
  assert.equal(composer.style.getPropertyValue('--keyboard-accessory-clearance'), '');
});
