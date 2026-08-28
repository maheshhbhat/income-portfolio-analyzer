import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLegacyWithdrawal } from '../src/lib/legacyWithdrawal.js';
import { projectLegacyWithdrawal } from '../src/lib/legacyWithdrawalProjection.js';
import { SECURITIES } from '../src/data/securities.js';

function formatUsdCents(cents) {
  const dollars = Math.floor(Math.abs(cents) / 100).toLocaleString('en-US');
  const remainder = `${Math.abs(cents) % 100}`.padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${dollars}.${remainder}`;
}

function mockElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(), children: [], textContent: '', hidden: false, innerHTML: '', value: 'illustrative', listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = [...children]; this.innerHTML = ''; this.textContent = ''; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function chromeStyleDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner', 'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated', 'allocation-body', 'projection-body', 'provider-select', 'refresh-data', 'provider-status', 'provider-error',
    'comparison-submit', 'comparison-error', 'comparison-results', 'comparison-summary', 'comparison-projections',
    'scenario-comparison-submit', 'scenario-comparison-error', 'scenario-comparison-results', 'scenario-comparison-summary', 'scenario-comparison-projections', 'scenario-deterministic-disclosure', 'scenario-simplification-disclosure', 'scenario-sequence-disclosure',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message', 'required-retry', 'required-results', 'required-banner', 'required-portfolio-value', 'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body',
    'maximum-withdrawal-form', 'maximum-withdrawal-error', 'maximum-withdrawal-refusal', 'maximum-withdrawal-results', 'maximum-withdrawal-banner', 'maximum-withdrawal-value', 'maximum-total-return', 'maximum-allocation-body', 'maximum-projection-body', 'maximum-portfolio', 'maximum-horizon', 'maximum-inflation',
    'legacy-withdrawal-form', 'legacy-withdrawal-error', 'legacy-withdrawal-refusal', 'legacy-withdrawal-results', 'legacy-withdrawal-banner', 'legacy-withdrawal-value', 'legacy-ending-balance', 'legacy-catalog-return', 'legacy-allocation-body', 'legacy-projection-body', 'legacy-portfolio', 'legacy-horizon', 'legacy-inflation', 'legacy-ending-balance-floor'
  ];
  const elements = new Map(ids.map((id) => [id, mockElement()]));
  return { createElement: mockElement, getElementById: (id) => elements.get(id) ?? null };
}

test('OE-RESP-1: Chrome-style $1,000,000 click-to-render flow completes below one second and proves the next cent fails', async () => {
  const input = {
    investmentAmountCents: 100_000_000,
    horizonYears: 30,
    inflationRate: 0.03,
    endingBalanceFloorCents: 10_000_000
  };
  const expected = computeLegacyWithdrawal(input, SECURITIES);
  assert.equal(expected.ok, true);
  const savedDocument = globalThis.document;
  globalThis.document = chromeStyleDocument();
  try {
    await import('../app.js?legacy-withdrawal-chrome');
    const get = (id) => globalThis.document.getElementById(id);
    get('legacy-portfolio').value = '1000000';
    get('legacy-horizon').value = '30';
    get('legacy-inflation').value = '3';
    get('legacy-ending-balance-floor').value = '100000';

    const startedAt = performance.now();
    get('legacy-withdrawal-form').listeners.submit({ preventDefault() {} });
    const elapsedMilliseconds = performance.now() - startedAt;

    assert.ok(elapsedMilliseconds < 1_000, `click-to-render took ${elapsedMilliseconds.toFixed(2)} ms`);
    assert.equal(get('legacy-withdrawal-results').hidden, false);
    assert.match(get('legacy-withdrawal-banner').textContent, /highest verified first-year annual withdrawal across the displayed fixed allocation catalog/i);
    assert.match(get('legacy-withdrawal-banner').textContent, /displayed winning allocation/i);
    assert.match(get('legacy-withdrawal-banner').textContent, /increasing that withdrawal by \$0\.01 fails the requested ending-balance floor/i);
    assert.equal(get('legacy-withdrawal-value').textContent, formatUsdCents(expected.maxAnnualWithdrawalCents));
    assert.ok(get('legacy-catalog-return').textContent.endsWith('%'));
    assert.ok(get('legacy-allocation-body').children.length > 0, 'supporting allocation is rendered');
    assert.equal(get('legacy-projection-body').children.length, 30, 'complete projection is rendered');

    const nextCent = projectLegacyWithdrawal({
      ...input,
      annualWithdrawalCents: expected.maxAnnualWithdrawalCents + 1,
      catalogEntry: { ...expected.catalogEntry, allocation: expected.allocation }
    });
    assert.equal(nextCent.ok, true);
    assert.equal(nextCent.meetsEndingBalanceFloor, false, 'displayed winning allocation must fail at the next cent');
  } finally {
    globalThis.document = savedDocument;
  }
});
