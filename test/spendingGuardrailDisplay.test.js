import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class MockElement {
  constructor(tagName = 'div', { hidden = false, value = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.textContent = '';
    this._hidden = hidden;
    this._innerHTML = '';
    this.value = value;
    this.listeners = new Map();
  }

  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = value; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; this._innerHTML = ''; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }
}

async function loadDocument() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const [, tagName, beforeId, id, afterId] = match;
    const attrs = `${beforeId} ${afterId}`;
    elements.set(id, new MockElement(tagName, {
      hidden: /\bhidden\b/i.test(attrs),
      value: attrs.match(/\bvalue="([^"]*)"/i)?.[1] || ''
    }));
  }
  return { createElement: (tagName) => new MockElement(tagName), getElementById: (id) => elements.get(id) };
}

async function withApp(assertions) {
  const priorDocument = globalThis.document;
  globalThis.document = await loadDocument();
  try {
    await import(`../app.js?spending-guardrail-display=${Date.now()}-${Math.random()}`);
    await assertions((id) => globalThis.document.getElementById(id));
  } finally {
    globalThis.document = priorDocument;
  }
}

function submit(get) {
  get('spending-guardrail-form').dispatchEvent({ type: 'submit' });
}

function fillRepresentative(get) {
  get('spending-guardrail-portfolio').value = '1000000';
  get('spending-guardrail-withdrawal').value = '40000';
  get('spending-guardrail-horizon').value = '30';
  get('spending-guardrail-inflation').value = '3';
  get('spending-guardrail-floor').value = '200000';
  get('spending-guardrail-reduction').value = '10';
}

test('OE-SCALE-1 and OE-PROVIDER-2: the isolated guardrail UI renders two 30-row plans with summaries and trigger state', async () => {
  await withApp(async (get) => {
    fillRepresentative(get);
    submit(get);

    assert.equal(get('spending-guardrail-results').hidden, false);
    assert.equal(get('spending-guardrail-error').hidden, true);
    assert.equal(get('spending-guardrail-summary').children.length, 2);
    assert.equal(get('spending-guardrail-steady-body').children.length, 30);
    assert.equal(get('spending-guardrail-guardrail-body').children.length, 30);
    assert.equal(get('spending-guardrail-summary').children[0].children[0].textContent, 'Steady plan');
    assert.equal(get('spending-guardrail-summary').children[1].children[0].textContent, 'Spending guardrail plan');
    assert.match(get('spending-guardrail-trigger').textContent, /(triggered in year|not reached)/);
  });
});

test('OE-PROVIDER-2: guardrail compare-and-render implementation is isolated from provider and network state', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const flow = source.slice(
    source.indexOf('function runSpendingGuardrailComparison()'),
    source.indexOf("spendingGuardrailForm?.addEventListener", source.indexOf('function runSpendingGuardrailComparison()'))
  );
  assert.doesNotMatch(flow, /\b(fetch|selectedSecurities|selectProvider|providerSelect|activeProviderSnapshot)\b/);
  assert.match(flow, /computeSpendingGuardrail\([\s\S]*SECURITIES/);
});

test('OE-DEGRADE-1: invalid input clears all prior guardrail comparison output before refusal', async () => {
  await withApp(async (get) => {
    fillRepresentative(get);
    submit(get);
    get('spending-guardrail-portfolio').value = '1,000,000';

    let errorShownAfterClear = false;
    const error = get('spending-guardrail-error');
    let hidden = error.hidden;
    Object.defineProperty(error, 'hidden', {
      configurable: true,
      get: () => hidden,
      set(value) {
        if (value === false) {
          errorShownAfterClear = get('spending-guardrail-results').hidden
            && get('spending-guardrail-summary').children.length === 0
            && get('spending-guardrail-steady-body').children.length === 0
            && get('spending-guardrail-guardrail-body').children.length === 0
            && get('spending-guardrail-trigger').textContent === '';
        }
        hidden = value;
      }
    });
    submit(get);

    assert.equal(errorShownAfterClear, true);
    assert.match(error.textContent, /plain dollar amount/i);
  });
});

test('OE-DEGRADE-3: a safe-arithmetic refusal clears prior comparison money output', async () => {
  await withApp(async (get) => {
    fillRepresentative(get);
    submit(get);
    get('spending-guardrail-portfolio').value = '90071992547409.91';
    get('spending-guardrail-withdrawal').value = '0';

    submit(get);

    assert.equal(get('spending-guardrail-results').hidden, true);
    assert.equal(get('spending-guardrail-summary').children.length, 0);
    assert.equal(get('spending-guardrail-steady-body').children.length, 0);
    assert.equal(get('spending-guardrail-guardrail-body').children.length, 0);
    assert.equal(get('spending-guardrail-trigger').textContent, '');
    assert.match(get('spending-guardrail-error').textContent, /safe arithmetic range/i);
  });
});

test('money and inflation parsing retain cents and refuse unsupported precision', async () => {
  await withApp(async (get) => {
    fillRepresentative(get);
    get('spending-guardrail-portfolio').value = '0.29';
    get('spending-guardrail-withdrawal').value = '0.01';
    get('spending-guardrail-horizon').value = '1';
    submit(get);
    assert.equal(get('spending-guardrail-results').hidden, false);
    assert.match(get('spending-guardrail-steady-body').children[0].children[1].textContent, /\$0\.29/);

    get('spending-guardrail-inflation').value = '3.00001';
    submit(get);
    assert.match(get('spending-guardrail-error').textContent, /supported 0\.000001 rate scale/i);
  });
});
