import test from 'node:test';
import assert from 'node:assert/strict';

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
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    if (typeof event.preventDefault !== 'function') {
      event.defaultPrevented = false;
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

async function loadAppDocument() {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();

  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const [, tagName, beforeId, id, afterId] = match;
    const attrs = `${beforeId} ${afterId}`;
    const hidden = /\bhidden\b/i.test(attrs);
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/i);
    elements.set(id, new MockElement(tagName, { hidden, value: valueMatch?.[1] || '' }));
  }

  return {
    createElement: (tagName) => new MockElement(tagName),
    getElementById: (id) => elements.get(id)
  };
}

test('OE-DEGRADE-1: scenario comparison uses curated illustrative securities only, preserves allocation submit flow, and clears stale output on invalid input', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const savedConsoleError = console.error;
  const consoleErrors = [];
  globalThis.document = await loadAppDocument();
  globalThis.fetch = async (url) => {
    throw new Error(`unexpected fetch in scenario comparison test: ${String(url)}`);
  };
  console.error = (...args) => {
    consoleErrors.push(args.map((value) => String(value)).join(' '));
  };

  try {
    const appModule = await import(`../app.js?scenario-comparison-display=${Date.now()}`);
    const retirementScenarioModule = await import('../src/lib/retirementScenarios.js');
    const { SECURITIES } = await import('../src/data/securities.js');
    const get = (id) => globalThis.document.getElementById(id);

    get('provider-select').value = 'illustrative';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('horizon-years').value = '30';
    get('inflation-rate').value = '3';

    get('allocation-form').dispatchEvent({ type: 'submit' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(get('results').hidden, false, 'existing projection flow still renders the main allocation results');

    const expected = retirementScenarioModule.computeRetirementScenarios({
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 40000,
      horizonYears: 30,
      inflationRate: 0.03
    }, SECURITIES);

    get('provider-select').value = 'vanguard';
    get('scenario-comparison-submit').click();

    assert.equal(get('scenario-comparison-results').hidden, false);
    assert.equal(get('scenario-comparison-error').hidden, true);
    assert.equal(get('scenario-comparison-summary').children.length, 2, 'renders steady and early-downturn summaries only');
    assert.equal(get('scenario-comparison-projections').children.length, 2, 'renders one year-by-year table per scenario');
    assert.deepEqual(
      get('scenario-comparison-summary').children.map((card) => card.children[0].textContent),
      ['Steady scenario', 'Early downturn scenario']
    );
    assert.deepEqual(
      get('scenario-comparison-projections').children.map((section) => section.children[0].textContent),
      ['Steady scenario year-by-year table', 'Early downturn scenario year-by-year table']
    );
    assert.equal(get('scenario-comparison-projections').children[0].children[1].children[0].children.length, expected.steady.years.length);
    assert.equal(get('scenario-comparison-projections').children[1].children[1].children[0].children.length, expected.earlyDownturn.years.length);
    assert.match(get('scenario-deterministic-disclosure').textContent, /not a forecast|not financial advice/i);
    assert.match(get('scenario-simplification-disclosure').textContent, /portfolio-level blended allocation basis/i);
    assert.match(get('scenario-sequence-disclosure').textContent, /exactly 0\.20 in year 1 only/i);

    const steadyEndingBalance = get('scenario-comparison-summary').children[0].children[1].children[3].textContent;
    const earlyDownturnEndingBalance = get('scenario-comparison-summary').children[1].children[1].children[3].textContent;
    assert.equal(steadyEndingBalance, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(expected.steady.endingBalance));
    assert.equal(earlyDownturnEndingBalance, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(expected.earlyDownturn.endingBalance));

    get('investment-amount').value = '0';
    const scenarioError = get('scenario-comparison-error');
    let errorWasShownAfterClear = false;
    let hiddenValue = scenarioError.hidden;
    Object.defineProperty(scenarioError, 'hidden', {
      configurable: true,
      get: () => hiddenValue,
      set: (value) => {
        if (value === false) {
          errorWasShownAfterClear = get('scenario-comparison-results').hidden
            && get('scenario-comparison-summary').children.length === 0
            && get('scenario-comparison-projections').children.length === 0;
        }
        hiddenValue = value;
      }
    });

    get('scenario-comparison-submit').click();

    assert.equal(errorWasShownAfterClear, true);
    assert.equal(get('scenario-comparison-results').hidden, true);
    assert.equal(get('scenario-comparison-summary').children.length, 0);
    assert.equal(get('scenario-comparison-projections').children.length, 0);
    assert.equal(get('scenario-comparison-summary').innerHTML, '');
    assert.equal(get('scenario-comparison-projections').innerHTML, '');
    assert.equal(get('scenario-deterministic-disclosure').textContent, '');
    assert.equal(get('scenario-simplification-disclosure').textContent, '');
    assert.equal(get('scenario-sequence-disclosure').textContent, '');
    assert.match(get('scenario-comparison-error').textContent, /investment amount greater than \$0/i);
    assert.deepEqual(consoleErrors, []);

    void appModule;
  } finally {
    globalThis.document = savedDocument;
    globalThis.fetch = savedFetch;
    console.error = savedConsoleError;
  }
});
