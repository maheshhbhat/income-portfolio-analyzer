import test from 'node:test';
import assert from 'node:assert/strict';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { PROVIDER_OFFICIAL_HOSTS, validateProviderSnapshot } from '../src/lib/providerFacts.js';

function cloneSnapshot() {
  return structuredClone(VANGUARD_SNAPSHOT);
}

test('Vanguard seed snapshot is accepted as a complete verified provider dataset', () => {
  assert.deepEqual(validateProviderSnapshot(VANGUARD_SNAPSHOT), { ok: true });
});

test('Vanguard seed set is a diverse, bounded collection of usable yields', () => {
  const { entries } = VANGUARD_SNAPSHOT;
  assert.ok(entries.length >= 8 && entries.length <= 15);
  assert.equal(new Set(entries.map(({ symbol }) => symbol)).size, entries.length);
  assert.ok(entries.every(({ yield: trailingYield }) => trailingYield > 0 && trailingYield < 0.2));
  assert.ok(entries.some(({ yield: trailingYield }) => trailingYield >= 0.035));
  assert.ok(entries.some(({ yield: trailingYield }) => trailingYield <= 0.02));
});

test('Vanguard factual provenance is dated, official HTTPS, and growth remains illustrative', () => {
  const officialHosts = new Set(PROVIDER_OFFICIAL_HOSTS.vanguard);
  for (const entry of VANGUARD_SNAPSHOT.entries) {
    for (const field of ['name', 'ticker', 'trailingYield']) {
      const fact = entry.facts[field];
      const source = new URL(fact.sourceUrl);
      assert.equal(fact.status, 'verified');
      assert.equal(source.protocol, 'https:');
      assert.ok(officialHosts.has(source.hostname));
      assert.match(fact.asOf, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isFinite(Date.parse(`${fact.asOf}T00:00:00Z`)));
    }
    assert.equal(entry.facts.growth.status, 'illustrative-estimate');
  }
});

test('Vanguard snapshot fails closed when a verified identity or yield fact is removed or downgraded', () => {
  for (const field of ['name', 'ticker', 'trailingYield']) {
    const removed = cloneSnapshot();
    delete removed.entries[0].facts[field];
    assert.equal(validateProviderSnapshot(removed).ok, false, `${field} removal must fail`);

    const downgraded = cloneSnapshot();
    downgraded.entries[0].facts[field].status = 'illustrative-estimate';
    assert.equal(validateProviderSnapshot(downgraded).ok, false, `${field} downgrade must fail`);
  }
});
