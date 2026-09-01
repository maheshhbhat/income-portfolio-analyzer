import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeRetirementHorizonComparison } from '../src/lib/retirementHorizonComparison.js';
import { SECURITIES } from '../src/data/securities.js';

class MockElement {
  constructor(tagName = 'div', { hidden = false, value = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.textContent = '';
    this._hidden = hidden;
    this._innerHTML = '';
    this.value = value;
    this.listeners = new Map();
    this.className = '';
    this.disabled = false;
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(value) {
    this._hidden = value;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= () => {
      event.defaultPrevented = true;
    };
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

async function loadDocument() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();

  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const [, tagName, beforeId, id, afterId] = match;
    const attrs = `${beforeId} ${afterId}`;
    const element = new MockElement(tagName, {
      hidden: /\bhidden\b/i.test(attrs),
      value: attrs.match(/\bvalue="([^"]*)"/i)?.[1] || ''
    });
    const staticTextMatch = html.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
    if (staticTextMatch) {
      element.textContent = staticTextMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
    }
    elements.set(id, element);
  }

  return {
    createElement: (tagName) => new MockElement(tagName),
    getElementById: (id) => elements.get(id)
  };
}

async function withApp(assertions) {
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  globalThis.document = await loadDocument();
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    throw new Error(`unexpected fetch in horizon comparison test: ${String(url)}`);
  };

  try {
    await import(`../app.js?horizon-comparison-display=${Date.now()}-${Math.random()}`);
    await assertions((id) => globalThis.document.getElementById(id), () => fetchCalls);
  } finally {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  }
}

test('OE-SCALE-1, OE-PROVIDER-1, and OE-DEGRADE-1: the horizon browser flow renders the fixed trio from curated securities, ignores provider selection, and clears stale output before refusal', async () => {
  const expected = computeRetirementHorizonComparison({
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 40000,
    inflationRate: 0.03
  }, SECURITIES);
  assert.equal(expected.ok, true);

  await withApp(async (get, getFetchCalls) => {
    get('provider-select').value = 'fidelity';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('inflation-rate').value = '3';

    get('horizon-comparison-submit').click();

    assert.equal(getFetchCalls(), 0, 'provider-backed fetches must not run in the illustrative horizon flow');
    assert.equal(get('horizon-comparison-results').hidden, false);
    assert.equal(get('horizon-comparison-error').hidden, true);
    assert.equal(get('horizon-comparison-summary').children.length, 3);
    assert.equal(get('horizon-comparison-projections').children.length, 3);
    assert.deepEqual(
      get('horizon-comparison-summary').children.map((card) => card.children[0].textContent),
      expected.scenarios.map((scenario) => scenario.label)
    );
    assert.deepEqual(
      get('horizon-comparison-projections').children.map((section) => section.children[0].textContent),
      expected.scenarios.map((scenario) => `${scenario.label} year-by-year projection`)
    );
    assert.deepEqual(
      get('horizon-comparison-projections').children.map((section) => section.children[1].children[0].children.length),
      expected.scenarios.map((scenario) => scenario.result.years.length)
    );
    assert.match(get('horizon-comparison-disclosure').textContent, /illustrative comparison only/i);
    assert.match(get('horizon-comparison-disclosure').textContent, /curated securities set/i);
    assert.match(get('horizon-comparison-disclosure').textContent, /not financial advice/i);

    const standardCard = get('horizon-comparison-summary').children[1];
    assert.equal(
      standardCard.children[1].children[3].textContent,
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(expected.scenarios[1].result.endingBalance)
    );

    get('investment-amount').value = '0';

    let refusalShownAfterClear = false;
    const error = get('horizon-comparison-error');
    let hidden = error.hidden;
    Object.defineProperty(error, 'hidden', {
      configurable: true,
      get: () => hidden,
      set(value) {
        if (value === false) {
          refusalShownAfterClear = get('horizon-comparison-results').hidden
            && get('horizon-comparison-summary').children.length === 0
            && get('horizon-comparison-projections').children.length === 0
            && get('horizon-comparison-summary').innerHTML === ''
            && get('horizon-comparison-projections').innerHTML === '';
        }
        hidden = value;
      }
    });

    get('horizon-comparison-submit').click();

    assert.equal(refusalShownAfterClear, true);
    assert.equal(get('horizon-comparison-results').hidden, true);
    assert.equal(get('horizon-comparison-summary').children.length, 0);
    assert.equal(get('horizon-comparison-projections').children.length, 0);
    assert.match(get('horizon-comparison-error').textContent, /investment amount greater than \$0/i);
    assert.equal(get('horizon-comparison-disclosure').hidden, false);
    assert.match(get('horizon-comparison-disclosure').textContent, /not a forecast/i);
  });
});
