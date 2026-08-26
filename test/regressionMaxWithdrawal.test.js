import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeMaxSustainableWithdrawal } from '../src/lib/maxSustainableWithdrawal.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

function planAt(input, withdrawalCents, securities = SECURITIES) {
  return computeRetirementPlan({
    investmentAmount: input.investmentAmountCents / 100,
    desiredAnnualWithdrawal: withdrawalCents / 100,
    horizonYears: input.horizonYears,
    inflationRate: input.inflationRate
  }, securities);
}

function domainMaximumCents(input, securities = SECURITIES) {
  const greatestTotalReturn = Math.max(...securities.map((security) => security.yield + security.growthRate));
  return Math.max(0, Math.ceil(input.investmentAmountCents * (1 + greatestTotalReturn)));
}

// This deliberately does not reuse the maximum-withdrawal module's search,
// partitioning, or cache. It asks the established retirement engine about
// every cent in the mathematically closed year-one domain and returns the
// global survivor, if any, even when feasibility fails and later recovers
// across an allocation-regime boundary.
function exhaustiveMaximum(input, securities = SECURITIES) {
  let bestSurvivorCents = null;
  const limit = domainMaximumCents(input, securities);

  for (let cents = 0; cents <= limit; cents++) {
    if (planAt(input, cents, securities).lastsFullHorizon) bestSurvivorCents = cents;
  }

  return { bestSurvivorCents, limit };
}

function assertNoHigherSurvivor(input, reportedMaximumCents, securities = SECURITIES) {
  for (let cents = reportedMaximumCents + 1; cents <= domainMaximumCents(input, securities); cents++) {
    assert.equal(
      planAt(input, cents, securities).lastsFullHorizon,
      false,
      `found a higher surviving cent (${cents}) above reported maximum ${reportedMaximumCents} for ${JSON.stringify(input)}`
    );
  }
}

test('regression contract: the maximum is a cent-quantized global survivor and the next cent fails', () => {
  const inputs = [
    { investmentAmountCents: 1000, horizonYears: 10, inflationRate: 0 },
    { investmentAmountCents: 2000, horizonYears: 25, inflationRate: 0.03 },
    { investmentAmountCents: 100, horizonYears: 40, inflationRate: 0.5 }
  ];

  for (const input of inputs) {
    const result = computeMaxSustainableWithdrawal(input, SECURITIES);
    const oracle = exhaustiveMaximum(input, SECURITIES);
    assert.equal(result.ok, true, JSON.stringify(input));
    assert.ok(Number.isSafeInteger(result.maxAnnualWithdrawalCents));
    assert.equal(result.maxAnnualWithdrawalCents, oracle.bestSurvivorCents);
    assert.equal(result.nextCentFails, true);
    assert.equal(planAt(input, result.maxAnnualWithdrawalCents).lastsFullHorizon, true);
    assert.equal(planAt(input, result.maxAnnualWithdrawalCents + 1).lastsFullHorizon, false);
    assertNoHigherSurvivor(input, result.maxAnnualWithdrawalCents);
    assert.equal(result.allocation.reduce((sum, line) => sum + line.amountCents, 0), input.investmentAmountCents);
  }
});

test('regression contract: a recovery across an allocation bracket is not discarded by a monotone search', () => {
  // 11 cents fails but 13 cents survives. The high survivor is in the B/C
  // allocation regime, so a search that treats feasibility as monotone would
  // be unable to prove the returned maximum.
  const bracketChangingSet = [
    { symbol: 'A', name: 'A', type: 'etf', yield: 0, growthRate: -2 },
    { symbol: 'B', name: 'B', type: 'etf', yield: 0, growthRate: -1.5 },
    { symbol: 'C', name: 'C', type: 'etf', yield: 0, growthRate: 0.2 }
  ];
  const input = { investmentAmountCents: 103, horizonYears: 20, inflationRate: 0.02 };

  assert.equal(planAt(input, 11, bracketChangingSet).lastsFullHorizon, false);
  assert.equal(planAt(input, 13, bracketChangingSet).lastsFullHorizon, true);

  const result = computeMaxSustainableWithdrawal(input, bracketChangingSet);
  const oracle = exhaustiveMaximum(input, bracketChangingSet);
  assert.equal(result.ok, true);
  assert.equal(result.maxAnnualWithdrawalCents, 13);
  assert.equal(result.maxAnnualWithdrawalCents, oracle.bestSurvivorCents);
  assert.equal(result.nextCentProjection.lastsFullHorizon, false);
  assertNoHigherSurvivor(input, result.maxAnnualWithdrawalCents, bracketChangingSet);
});

test('regression contract: invalid and refusal results remain actionable and never expose a maximum', () => {
  const invalid = computeMaxSustainableWithdrawal(
    { investmentAmountCents: 1000.5, horizonYears: 10, inflationRate: 0.02 },
    SECURITIES
  );
  assert.deepEqual(invalid, {
    ok: false,
    reason: 'invalid-input',
    error: 'Enter a starting portfolio as a safe whole number of cents greater than $0.'
  });

  const impossibleSet = [
    { symbol: 'LOSS1', name: 'Loss 1', type: 'etf', yield: 0, growthRate: -2 },
    { symbol: 'LOSS2', name: 'Loss 2', type: 'etf', yield: 0, growthRate: -2 }
  ];
  const refused = computeMaxSustainableWithdrawal(
    { investmentAmountCents: 1000, horizonYears: 10, inflationRate: 0.02 },
    impossibleSet
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'no-verified-result');
  assert.match(refused.error, /no unverified figure/i);
  assert.equal('maxAnnualWithdrawalCents' in refused, false);
});

test('regression contract: maximum-withdrawal remains deterministic, pure, and isolated from provider state', async () => {
  const input = { investmentAmountCents: 2000, horizonYears: 25, inflationRate: 0.03 };
  assert.deepEqual(
    computeMaxSustainableWithdrawal(input, SECURITIES),
    computeMaxSustainableWithdrawal({ ...input }, SECURITIES)
  );

  const [core, app] = await Promise.all([
    readFile(new URL('../src/lib/maxSustainableWithdrawal.js', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8')
  ]);
  for (const forbidden of ['fetch(', 'Math.random', 'Date.now', 'new Date(', 'document.']) {
    assert.equal(core.includes(forbidden), false, `pure core must not reference ${forbidden}`);
  }
  assert.doesNotMatch(core, /from ['"][^'"]*providers\//, 'pure core must not import provider data');

  const maximumSection = app.slice(app.indexOf('// --- Maximum sustainable withdrawal section ---'));
  assert.match(maximumSection, /computeMaxSustainableWithdrawal\(parsed\.input, SECURITIES\)/);
  for (const forbidden of ['selectedSecurities(', 'fetch(', 'activeProviderSnapshot', 'refreshDataButton']) {
    assert.equal(maximumSection.includes(forbidden), false, `maximum UI must not use ${forbidden}`);
  }
});
