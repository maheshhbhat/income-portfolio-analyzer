import test from 'node:test';
import assert from 'node:assert/strict';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { validateProviderSnapshot } from '../src/lib/providerFacts.js';

function assertInvalid(result, symbol, fact) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.entry === symbol && error.field === fact), JSON.stringify(result.errors));
}

test('Fidelity seed snapshot is a complete verified, fail-closed provider snapshot', () => {
  assert.deepEqual(validateProviderSnapshot(FIDELITY_SNAPSHOT), { ok: true });

  const missingIdentity = structuredClone(FIDELITY_SNAPSHOT);
  delete missingIdentity.entries[0].facts.name;
  assertInvalid(validateProviderSnapshot(missingIdentity), 'SPAXX', 'name');

  const downgradedYield = structuredClone(FIDELITY_SNAPSHOT);
  downgradedYield.entries[0].facts.trailingYield.status = 'illustrative-estimate';
  assertInvalid(validateProviderSnapshot(downgradedYield), 'SPAXX', 'trailingYield');
});

test('Fidelity seed facts have official dated provenance and illustrative growth only', () => {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  assert.match(FIDELITY_SNAPSHOT.asOf, datePattern);
  for (const entry of FIDELITY_SNAPSHOT.entries) {
    for (const factName of ['name', 'ticker', 'trailingYield']) {
      const fact = entry.facts[factName];
      const source = new URL(fact.sourceUrl);
      assert.equal(fact.status, 'verified');
      assert.equal(source.protocol, 'https:');
      assert.ok(source.hostname === 'fidelity.com' || source.hostname.endsWith('.fidelity.com'));
      assert.match(fact.asOf, datePattern);
      assert.equal(new Date(`${fact.asOf}T00:00:00Z`).toISOString().slice(0, 10), fact.asOf);
    }
    assert.equal(entry.facts.growth.status, 'illustrative-estimate');
  }
});

test('Fidelity seed set is a bounded, diversified yield set', () => {
  const { entries } = FIDELITY_SNAPSHOT;
  assert.ok(entries.length >= 8 && entries.length <= 15);
  assert.equal(new Set(entries.map((entry) => entry.symbol)).size, entries.length);
  assert.ok(entries.every((entry) => entry.yield > 0 && entry.yield < 0.2));
  assert.ok(entries.some((entry) => entry.yield >= 0.03));
  assert.ok(entries.some((entry) => entry.yield <= 0.02));
});
