import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITIES } from '../src/data/securities.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { selectProvider } from '../src/data/providers/index.js';
import { computeAllocation } from '../src/lib/allocation.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';

test('omitted provider preserves the original illustrative array by identity', () => {
  const selection = selectProvider();
  assert.equal(selection.ok, true);
  assert.equal(selection.securities, SECURITIES);
});

test('provider calculations allocate only selected snapshot entries at several target rates', () => {
  for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
    const selection = selectProvider(snapshot.providerId);
    const symbols = new Set(snapshot.entries.map((entry) => entry.symbol));
    for (const targetRate of [0.01, 0.035, 0.07]) {
      const allocation = computeAllocation({ investmentAmount: 100000, desiredAnnualIncome: 100000 * targetRate }, selection.securities);
      const retirement = computeRetirementPlan({ investmentAmount: 100000, desiredAnnualWithdrawal: 100000 * targetRate, horizonYears: 20, inflationRate: 0.02 }, selection.securities);
      assert.ok(allocation.allocations.every((line) => symbols.has(line.symbol)));
      assert.ok(retirement.allocations.every((line) => symbols.has(line.symbol)));
    }
  }
});

test('unknown, empty, and null providers return actionable errors without throwing', () => {
  for (const providerId of ['other', '', null]) {
    const result = selectProvider(providerId);
    assert.equal(result.ok, false);
    assert.match(result.error, /illustrative, vanguard, fidelity/);
  }
});
