import test from 'node:test';
import assert from 'node:assert/strict';

function mockElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent: '',
    hidden: false,
    innerHTML: '',
    value: 'illustrative',
    listeners: {},
    className: '',
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function appDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner',
    'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated',
    'allocation-body', 'projection-body', 'provider-select', 'refresh-data',
    'provider-status', 'provider-error', 'comparison-submit', 'comparison-error',
    'comparison-results', 'comparison-summary', 'comparison-projections',
    'investment-amount', 'desired-income', 'horizon-years', 'inflation-rate',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message',
    'required-retry', 'required-results', 'required-banner', 'required-portfolio-value',
    'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body',
    'required-withdrawal', 'required-horizon', 'required-inflation',
    'maximum-withdrawal-form', 'maximum-withdrawal-error', 'maximum-withdrawal-refusal',
    'maximum-withdrawal-results', 'maximum-withdrawal-banner', 'maximum-withdrawal-value',
    'maximum-total-return', 'maximum-allocation-body', 'maximum-projection-body',
    'maximum-portfolio', 'maximum-horizon', 'maximum-inflation'
  ];
  const elements = new Map(ids.map((id) => [id, mockElement()]));
  return {
    createElement: mockElement,
    getElementById: (id) => elements.get(id)
  };
}

test('OE-DEGRADE-1: comparison browser flow clears and hides every stale summary and projection on invalid input', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const savedConsoleError = console.error;
  const consoleErrors = [];
  globalThis.document = appDocument();
  globalThis.fetch = async () => { throw new Error('comparison flow must not fetch provider snapshots'); };
  console.error = (...args) => { consoleErrors.push(args); };

  try {
    await import(`../app.js?comparison-display=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);

    get('provider-select').value = 'vanguard';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('horizon-years').value = '30';
    get('inflation-rate').value = '3';

    const startedAt = performance.now();
    get('comparison-submit').listeners.click();
    const elapsedMs = performance.now() - startedAt;

    assert.equal(get('comparison-results').hidden, false);
    assert.equal(get('comparison-summary').children.length, 3, 'renders exactly three scenario summaries');
    assert.equal(get('comparison-projections').children.length, 3, 'renders exactly three scenario projections');
    assert.equal(get('comparison-error').hidden, true);
    assert.ok(elapsedMs < 1000, `representative $1,000,000/30-year comparison rendered in ${elapsedMs.toFixed(2)}ms`);
    for (const projection of get('comparison-projections').children) {
      const table = projection.children[1];
      const body = table.children[0];
      assert.equal(body.children.length, 30, 'each rendered projection has one row per requested year');
    }
    assert.deepEqual(consoleErrors, [], 'the valid browser flow produces no page-console errors');

    get('investment-amount').value = '0';
    const comparisonError = get('comparison-error');
    let errorWasShownAfterClear = false;
    let comparisonErrorHidden = comparisonError.hidden;
    Object.defineProperty(comparisonError, 'hidden', {
      configurable: true,
      get: () => comparisonErrorHidden,
      set: (value) => {
        if (value === false) {
          errorWasShownAfterClear = get('comparison-results').hidden
            && get('comparison-summary').children.length === 0
            && get('comparison-projections').children.length === 0;
        }
        comparisonErrorHidden = value;
      }
    });
    get('comparison-submit').listeners.click();

    assert.equal(errorWasShownAfterClear, true, 'the refusal is shown only after stale output is cleared and hidden');
    assert.equal(get('comparison-results').hidden, true, 'stale comparison results are hidden');
    assert.equal(get('comparison-summary').children.length, 0, 'stale comparison summaries are removed');
    assert.equal(get('comparison-projections').children.length, 0, 'stale comparison projections are removed');
    assert.equal(get('comparison-summary').innerHTML, '', 'stale comparison summaries are cleared');
    assert.equal(get('comparison-projections').innerHTML, '', 'stale comparison projections are cleared');
    assert.match(get('comparison-error').textContent, /investment amount greater than \$0/i);
  } finally {
    globalThis.document = savedDocument;
    globalThis.fetch = savedFetch;
    console.error = savedConsoleError;
  }
});
