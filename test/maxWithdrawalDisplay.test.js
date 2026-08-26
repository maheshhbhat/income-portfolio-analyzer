import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function mockElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(), children: [], textContent: '', hidden: false,
    innerHTML: '', value: 'illustrative', listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function appDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner', 'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated', 'allocation-body', 'projection-body', 'provider-select', 'refresh-data', 'provider-status', 'provider-error',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message', 'required-retry', 'required-results', 'required-banner', 'required-portfolio-value', 'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body',
    'maximum-withdrawal-form', 'maximum-withdrawal-error', 'maximum-withdrawal-refusal', 'maximum-withdrawal-results', 'maximum-withdrawal-banner', 'maximum-withdrawal-value', 'maximum-total-return', 'maximum-allocation-body', 'maximum-projection-body',
    'maximum-portfolio', 'maximum-horizon', 'maximum-inflation'
  ];
  const elements = new Map(ids.map((id) => [id, mockElement()]));
  return { createElement: mockElement, getElementById: (id) => elements.get(id) };
}

test('maximum-withdrawal browser flow renders only a verified curated result and clears stale output on invalid input', async () => {
  const savedDocument = globalThis.document;
  globalThis.document = appDocument();
  try {
    await import(`../app.js?maximum-withdrawal-display=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);
    get('maximum-portfolio').value = '10.00';
    get('maximum-horizon').value = '10';
    get('maximum-inflation').value = '2';

    get('maximum-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('maximum-withdrawal-results').hidden, false);
    assert.match(get('maximum-withdrawal-banner').textContent, /highest verified first-year annual withdrawal/i);
    assert.match(get('maximum-withdrawal-banner').textContent, /\$0\.01 fails/i);
    assert.match(get('maximum-withdrawal-value').textContent, /^\$/);
    assert.ok(get('maximum-allocation-body').children.length > 0, 'supporting allocation is rendered');
    assert.equal(get('maximum-projection-body').children.length, 10, 'full supporting projection is rendered');

    get('maximum-portfolio').value = '0';
    get('maximum-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('maximum-withdrawal-results').hidden, true, 'stale verified result is hidden');
    assert.equal(get('maximum-allocation-body').innerHTML, '');
    assert.equal(get('maximum-projection-body').innerHTML, '');
    assert.match(get('maximum-withdrawal-error').textContent, /starting portfolio/i);
    assert.equal(get('maximum-withdrawal-refusal').hidden, true, 'invalid input does not show a number or refusal result');
  } finally {
    globalThis.document = savedDocument;
  }
});

test('maximum-withdrawal markup discloses the curated illustrative model and no provider state', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(/<section class="maximum-withdrawal"[\s\S]*?<\/section>\s*<section class="required-portfolio">/)[0];
  assert.match(section, /repository's curated securities/i);
  assert.match(section, /illustrative model result/i);
  assert.match(section, /not financial advice/i);
  assert.doesNotMatch(section, /provider|snapshot|refresh/i);
});
