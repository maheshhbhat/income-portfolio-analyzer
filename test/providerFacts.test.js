import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProviderSnapshot } from '../src/lib/providerFacts.js';

function snapshot() {
  const asOf = '2026-08-01';
  return {
    providerId: 'vanguard',
    asOf,
    entries: [{
      symbol: 'VTI',
      name: 'Vanguard Total Stock Market ETF',
      type: 'etf',
      yield: 0.013,
      growthRate: 0.075,
      facts: {
        name: { value: 'Vanguard Total Stock Market ETF', status: 'verified', sourceUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti', asOf },
        ticker: { value: 'VTI', status: 'verified', sourceUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti', asOf },
        trailingYield: { value: 0.013, status: 'verified', sourceUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti', asOf },
        growth: { value: 0.075, status: 'illustrative-estimate' }
      }
    }]
  };
}

function assertError(result, entry, field) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.entry === entry && error.field === field), JSON.stringify(result.errors));
}

test('accepts a well-formed provider snapshot deterministically', () => {
  const input = snapshot();
  assert.deepEqual(validateProviderSnapshot(input), { ok: true });
  assert.deepEqual(validateProviderSnapshot(input), validateProviderSnapshot(input));
});

test('fails closed for identity and yield provenance', () => {
  for (const field of ['name', 'ticker', 'trailingYield']) {
    const input = snapshot();
    input.entries[0].facts[field].status = 'illustrative-estimate';
    assertError(validateProviderSnapshot(input), 'VTI', field);
  }
});

test('requires provenance, matching values, valid official HTTPS URLs, and valid fact dates', () => {
  const missing = snapshot();
  delete missing.entries[0].facts.name;
  assertError(validateProviderSnapshot(missing), 'VTI', 'name');

  const mismatch = snapshot();
  mismatch.entries[0].facts.ticker.value = 'VOO';
  assertError(validateProviderSnapshot(mismatch), 'VTI', 'ticker');

  const insecure = snapshot();
  insecure.entries[0].facts.trailingYield.sourceUrl = 'http://investor.vanguard.com/fund';
  assertError(validateProviderSnapshot(insecure), 'VTI', 'trailingYield');

  const unofficial = snapshot();
  unofficial.entries[0].facts.name.sourceUrl = 'https://vanguard.example.com/fund';
  assertError(validateProviderSnapshot(unofficial), 'VTI', 'name');

  const unlistedSubdomain = snapshot();
  unlistedSubdomain.entries[0].facts.name.sourceUrl = 'https://untrusted.investor.vanguard.com/fund';
  assertError(validateProviderSnapshot(unlistedSubdomain), 'VTI', 'name');

  const badDate = snapshot();
  badDate.entries[0].facts.ticker.asOf = '2026-02-30';
  assertError(validateProviderSnapshot(badDate), 'VTI', 'ticker');
});

test('rejects verified growth and growth mismatched with the engine entry', () => {
  const verified = snapshot();
  verified.entries[0].facts.growth.status = 'verified';
  assertError(validateProviderSnapshot(verified), 'VTI', 'growth');

  const mismatch = snapshot();
  mismatch.entries[0].facts.growth.value = 0.02;
  assertError(validateProviderSnapshot(mismatch), 'VTI', 'growth');
});

test('rejects malformed snapshots, duplicate symbols, empty sets, and missing engine fields without throwing', () => {
  assert.doesNotThrow(() => validateProviderSnapshot(null));
  assertError(validateProviderSnapshot({ providerId: 'unknown', asOf: 'August 1', entries: [] }), 'snapshot', 'providerId');

  for (const providerId of ['unknown', null]) {
    const malformedProvider = snapshot();
    malformedProvider.providerId = providerId;
    assert.doesNotThrow(() => validateProviderSnapshot(malformedProvider));
    assertError(validateProviderSnapshot(malformedProvider), 'snapshot', 'providerId');
  }

  const duplicate = snapshot();
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assertError(validateProviderSnapshot(duplicate), 'VTI', 'symbol');

  const missing = snapshot();
  delete missing.entries[0].type;
  assertError(validateProviderSnapshot(missing), 'VTI', 'type');
});

test('module remains a pure validation core', () => {
  const source = readFileSync(new URL('../src/lib/providerFacts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(import\s+.+\s+from|require\s*\(|fetch\s*\(|XMLHttpRequest|document\b|window\b|process\b|Math\.random|Date\.now|fs\b)/);
});
