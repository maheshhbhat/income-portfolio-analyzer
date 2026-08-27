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
    for (const listener of this.listeners.get(event.type) || []) {
      listener(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

async function loadAppDocument() {
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

test('OE-DEGRADE-1: comparison flow clears stale output and renders only the exact 2%, 3%, and 4% scenarios', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const savedConsoleError = console.error;
  const consoleErrors = [];
  globalThis.document = await loadAppDocument();
  globalThis.fetch = async () => {
    throw new Error('comparison flow must not fetch provider snapshots');
  };
  console.error = (...args) => {
    consoleErrors.push(args);
  };

  try {
    await import(`../app.js?comparison-display=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);

    get('provider-select').value = 'vanguard';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('horizon-years').value = '30';
    get('inflation-rate').value = '3';

    const startedAt = performance.now();
    get('comparison-submit').click();
    const elapsedMs = performance.now() - startedAt;

    assert.equal(get('comparison-results').hidden, false);
    assert.equal(get('comparison-error').hidden, true);
    assert.equal(get('comparison-summary').children.length, 3, 'renders exactly three scenario summaries');
    assert.equal(get('comparison-projections').children.length, 3, 'renders exactly three scenario projections');
    assert.ok(elapsedMs < 1000, `representative $1,000,000/30-year comparison rendered in ${elapsedMs.toFixed(2)}ms`);

    assert.deepEqual(
      get('comparison-summary').children.map((card) => card.children[0].textContent),
      ['2%', '3%', '4%'],
      'summary cards use only the required scenario labels'
    );
    assert.deepEqual(
      get('comparison-projections').children.map((section) => section.children[0].textContent),
      ['2% year-by-year projection', '3% year-by-year projection', '4% year-by-year projection'],
      'projection headings use only the required scenario labels'
    );

    for (const projection of get('comparison-projections').children) {
      const table = projection.children[1];
      const body = table.children[0];
      assert.equal(body.children.length, 30, 'each rendered projection has one row per requested year');
    }
    assert.deepEqual(consoleErrors, [], 'the valid flow produces no page-console errors');

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

    get('comparison-submit').click();

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
