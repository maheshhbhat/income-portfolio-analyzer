import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { computeLegacyWithdrawal } from '../src/lib/legacyWithdrawal.js';
import { SECURITIES } from '../src/data/securities.js';

function mockElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent: '',
    hidden: false,
    innerHTML: '',
    value: 'illustrative',
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [...children];
      this.innerHTML = '';
      this.textContent = '';
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
  };
}

function appDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner', 'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated', 'allocation-body', 'projection-body', 'provider-select', 'refresh-data', 'provider-status', 'provider-error',
    'comparison-submit', 'comparison-error', 'comparison-results', 'comparison-summary', 'comparison-projections',
    'scenario-comparison-submit', 'scenario-comparison-error', 'scenario-comparison-results', 'scenario-comparison-summary', 'scenario-comparison-projections', 'scenario-deterministic-disclosure', 'scenario-simplification-disclosure', 'scenario-sequence-disclosure',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message', 'required-retry', 'required-results', 'required-banner', 'required-portfolio-value', 'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body',
    'maximum-withdrawal-form', 'maximum-withdrawal-error', 'maximum-withdrawal-refusal', 'maximum-withdrawal-results', 'maximum-withdrawal-banner', 'maximum-withdrawal-value', 'maximum-total-return', 'maximum-allocation-body', 'maximum-projection-body', 'maximum-portfolio', 'maximum-horizon', 'maximum-inflation',
    'legacy-withdrawal-form', 'legacy-withdrawal-error', 'legacy-withdrawal-refusal', 'legacy-withdrawal-results', 'legacy-withdrawal-banner', 'legacy-withdrawal-value', 'legacy-ending-balance', 'legacy-catalog-return', 'legacy-allocation-body', 'legacy-projection-body', 'legacy-portfolio', 'legacy-horizon', 'legacy-inflation', 'legacy-ending-balance-floor'
  ];
  const elements = new Map(ids.map((id) => [id, mockElement()]));
  return {
    createElement: mockElement,
    getElementById: (id) => elements.get(id) ?? null
  };
}

function formatUsdCents(cents) {
  const absoluteCents = Math.abs(cents);
  const wholeDollars = Math.floor(absoluteCents / 100);
  const centsPart = `${absoluteCents % 100}`.padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${wholeDollars.toLocaleString('en-US')}.${centsPart}`;
}

test('OE-SCALE-1: representative browser flow renders the verified catalog result and clears stale output before refusals', async () => {
  const expected = computeLegacyWithdrawal({
    investmentAmountCents: 50_000_000,
    horizonYears: 30,
    inflationRate: 0.03,
    endingBalanceFloorCents: 10_000_000
  }, SECURITIES);
  assert.equal(expected.ok, true);
  assert.ok(expected.projection.endingBalanceCents >= 10_000_000, 'representative result meets the requested $100,000 floor');

  const savedDocument = globalThis.document;
  globalThis.document = appDocument();
  try {
    await import(`../app.js?legacy-withdrawal-display=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);

    get('legacy-portfolio').value = '500000';
    get('legacy-horizon').value = '30';
    get('legacy-inflation').value = '3';
    get('legacy-ending-balance-floor').value = '100000';

    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('legacy-withdrawal-results').hidden, false);
    assert.match(get('legacy-withdrawal-banner').textContent, /highest verified first-year annual withdrawal across the displayed fixed allocation catalog/i);
    assert.match(get('legacy-withdrawal-banner').textContent, /displayed winning allocation/i);
    assert.match(get('legacy-withdrawal-banner').textContent, /increasing that withdrawal by \$0\.01 fails the requested ending-balance floor/i);
    assert.match(get('legacy-withdrawal-banner').textContent, /deterministic illustrative result is not financial advice/i);
    assert.equal(get('legacy-withdrawal-value').textContent, formatUsdCents(expected.maxAnnualWithdrawalCents));
    assert.equal(get('legacy-ending-balance').textContent, formatUsdCents(expected.projection.endingBalanceCents));
    assert.equal(get('legacy-catalog-return').textContent, `${(expected.catalogEntry.totalReturn * 100).toFixed(2)}%`);
    assert.equal(get('legacy-allocation-body').children.length, expected.allocation.length, 'supporting allocation is rendered');
    assert.equal(get('legacy-projection-body').children.length, 30, 'full 30-row projection is rendered');

    get('legacy-portfolio').value = '0';
    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('legacy-withdrawal-results').hidden, true, 'stale verified result is hidden on invalid input');
    assert.equal(get('legacy-withdrawal-value').textContent, '—');
    assert.equal(get('legacy-ending-balance').textContent, '—');
    assert.equal(get('legacy-allocation-body').innerHTML, '');
    assert.equal(get('legacy-projection-body').innerHTML, '');
    assert.match(get('legacy-withdrawal-error').textContent, /starting portfolio/i);
    assert.equal(get('legacy-withdrawal-refusal').hidden, true);

    get('legacy-portfolio').value = '500000';
    get('legacy-ending-balance-floor').value = '-1';
    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('legacy-withdrawal-results').hidden, true, 'negative ending balance does not retain stale output');
    assert.equal(get('legacy-withdrawal-value').textContent, '—');
    assert.equal(get('legacy-allocation-body').innerHTML, '');
    assert.equal(get('legacy-projection-body').innerHTML, '');
    assert.match(get('legacy-withdrawal-error').textContent, /desired ending balance must be zero or greater/i);
    assert.equal(get('legacy-withdrawal-refusal').hidden, true);

    get('legacy-portfolio').value = '500000';
    get('legacy-horizon').value = '30';
    get('legacy-inflation').value = '3';
    get('legacy-ending-balance-floor').value = '100000';
    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });
    assert.equal(get('legacy-withdrawal-results').hidden, false);

    get('legacy-portfolio').value = '10';
    get('legacy-horizon').value = '1';
    get('legacy-inflation').value = '3';
    get('legacy-ending-balance-floor').value = '11.21';
    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });

    assert.equal(get('legacy-withdrawal-results').hidden, true, 'stale verified result is hidden on no-verified-result refusal');
    assert.equal(get('legacy-withdrawal-value').textContent, '—');
    assert.equal(get('legacy-ending-balance').textContent, '—');
    assert.equal(get('legacy-allocation-body').innerHTML, '');
    assert.equal(get('legacy-projection-body').innerHTML, '');
    assert.match(get('legacy-withdrawal-refusal').textContent, /no verified result could be calculated/i);
    assert.equal(get('legacy-withdrawal-error').hidden, true);
  } finally {
    globalThis.document = savedDocument;
  }
});

test('legacy-withdrawal markup stays illustrative-only and discloses the catalog bound', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(/<section class="legacy-withdrawal"[\s\S]*?<\/section>\s*<section class="maximum-withdrawal"[\s\S]*?>/)[0];
  assert.match(section, /displayed fixed allocation catalog/i);
  assert.match(section, /deterministic/i);
  assert.match(section, /illustrative/i);
  assert.match(section, /not financial advice/i);
  assert.doesNotMatch(section, /provider|snapshot|refresh/i);
});
