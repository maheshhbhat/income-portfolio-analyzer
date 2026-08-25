import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRequiredPortfolio } from '../src/lib/requiredPortfolio.js';
import { computeRetirementPlan, simulateWithdrawals } from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

// Grid of 24 input combinations. Horizons and inflation rates are chosen in
// the region where the five-round search settles (the implied withdrawal
// rate saturates above the curated list's highest blended total return), so
// every combination must produce a verified ok:true result. The withdrawal
// amount scales out of the rate iteration entirely, so it is varied freely.
const GRID = [];
for (const desiredAnnualWithdrawalCents of [1200000, 4000000]) {
  for (const horizonYears of [5, 8, 10, 12]) {
    for (const inflationRate of [0, 0.02, 0.03]) {
      GRID.push({ desiredAnnualWithdrawalCents, horizonYears, inflationRate });
    }
  }
}

const CURATED_SYMBOLS = new Set(SECURITIES.map((s) => s.symbol));

test('grid of 24 combinations: every result is verified ok:true with an exact integer-cent allocation and a round count of at most 5', () => {
  assert.ok(GRID.length >= 20, 'acceptance requires a grid of at least 20 combinations');
  for (const input of GRID) {
    const result = computeRequiredPortfolio(input, SECURITIES);
    assert.equal(result.ok, true, `expected ok:true for ${JSON.stringify(input)}, got ${JSON.stringify(result.reason)}`);
    assert.ok(Number.isInteger(result.requiredPortfolioCents), 'requiredPortfolioCents must be an integer');
    assert.ok(result.requiredPortfolioCents > 0);

    assert.ok(Number.isInteger(result.rounds), 'rounds must be present as an integer');
    assert.ok(result.rounds >= 1 && result.rounds <= 5, `rounds ${result.rounds} out of bound for ${JSON.stringify(input)}`);

    // Allocation: integer cents summing exactly to the portfolio, zero drift,
    // and every symbol drawn from the supplied curated list.
    assert.ok(result.allocation.length >= 1);
    let sumCents = 0;
    for (const line of result.allocation) {
      assert.ok(Number.isInteger(line.amountCents) && line.amountCents > 0, `non-integer cents for ${line.symbol}`);
      assert.ok(CURATED_SYMBOLS.has(line.symbol), `${line.symbol} is not in the curated list`);
      sumCents += line.amountCents;
    }
    assert.equal(sumCents, result.requiredPortfolioCents, `allocation drift for ${JSON.stringify(input)}`);

    // The verification projection is included and survives the horizon.
    assert.equal(result.projection.lastsFullHorizon, true);
  }
});

test('feeding requiredPortfolioCents back into computeRetirementPlan (dollars only at the call boundary) lasts the full horizon for every grid case', () => {
  for (const input of GRID) {
    const result = computeRequiredPortfolio(input, SECURITIES);
    assert.equal(result.ok, true);
    const plan = computeRetirementPlan(
      {
        investmentAmount: result.requiredPortfolioCents / 100,
        desiredAnnualWithdrawal: input.desiredAnnualWithdrawalCents / 100,
        horizonYears: input.horizonYears,
        inflationRate: input.inflationRate
      },
      SECURITIES
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.lastsFullHorizon, true, `round-trip depleted for ${JSON.stringify(input)}`);
  }
});

test('reducing the verified portfolio by 0.5% depletes before the horizon at the settled blended rates', () => {
  for (const input of GRID) {
    const result = computeRequiredPortfolio(input, SECURITIES);
    assert.equal(result.ok, true);
    const reducedDollars = Math.round(result.requiredPortfolioCents * 0.995) / 100;
    const simulation = simulateWithdrawals({
      investmentAmount: reducedDollars,
      desiredAnnualWithdrawal: input.desiredAnnualWithdrawalCents / 100,
      horizonYears: input.horizonYears,
      blendedYield: result.blendedYield,
      blendedGrowth: result.blendedGrowth,
      inflationRate: input.inflationRate
    });
    assert.equal(simulation.lastsFullHorizon, false, `0.5% smaller portfolio survived for ${JSON.stringify(input)}`);
  }
});

test('a long 40-year horizon settles to a verified result within the five-round bound', () => {
  const input = { desiredAnnualWithdrawalCents: 4000000, horizonYears: 40, inflationRate: 0.03 };
  const result = computeRequiredPortfolio(input, SECURITIES);
  assert.equal(result.ok, true);
  assert.ok(result.rounds >= 1 && result.rounds <= 5);
  assert.ok(Number.isInteger(result.requiredPortfolioCents) && result.requiredPortfolioCents > 0);
  const sumCents = result.allocation.reduce((sum, line) => sum + line.amountCents, 0);
  assert.equal(sumCents, result.requiredPortfolioCents);
  const plan = computeRetirementPlan(
    {
      investmentAmount: result.requiredPortfolioCents / 100,
      desiredAnnualWithdrawal: 40000,
      horizonYears: 40,
      inflationRate: 0.03
    },
    SECURITIES
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.lastsFullHorizon, true);
});

test('identical inputs produce deep-equal results, including refusal and validation outcomes', () => {
  const inputs = [
    GRID[0],
    GRID[13],
    { desiredAnnualWithdrawalCents: 0, horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: -5, horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 40, inflationRate: 0.03 }
  ];
  for (const input of inputs) {
    assert.deepEqual(
      computeRequiredPortfolio(input, SECURITIES),
      computeRequiredPortfolio({ ...input }, SECURITIES)
    );
  }
});

test('a withdrawal of 0 cents is valid: ok:true, requiredPortfolioCents 0, allocation summing to 0', () => {
  const result = computeRequiredPortfolio(
    { desiredAnnualWithdrawalCents: 0, horizonYears: 25, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.requiredPortfolioCents, 0);
  assert.ok(Number.isInteger(result.rounds) && result.rounds <= 5);
  assert.equal(result.allocation.reduce((sum, line) => sum + line.amountCents, 0), 0);
});

test('invalid inputs return ok:false with reason invalid-input and an actionable message, never an exception', () => {
  const invalidInputs = [
    { desiredAnnualWithdrawalCents: '4000', horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: NaN, horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: 1234.5, horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: -100, horizonYears: 10, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 10.5, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 0, inflationRate: 0.02 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 10, inflationRate: -0.01 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 10, inflationRate: Infinity },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 10 }
  ];
  for (const input of invalidInputs) {
    const result = computeRequiredPortfolio(input, SECURITIES);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(input)}`);
    assert.equal(result.reason, 'invalid-input');
    assert.notEqual(result.reason, 'no-verified-result');
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0, 'rejection must carry an actionable message');
  }

  const noSecurities = computeRequiredPortfolio(
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 10, inflationRate: 0.02 },
    []
  );
  assert.equal(noSecurities.ok, false);
  assert.equal(noSecurities.reason, 'invalid-input');
});

test('five fruitless rounds return ok:false with reason no-verified-result and no numeric portfolio', () => {
  // Every security carries a -200% total return, so no candidate can ever
  // survive its own verification: the solver must exhaust its five rounds
  // and refuse rather than expose an unverified number.
  const hopeless = [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0, growthRate: -2 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: -2 }
  ];
  const result = computeRequiredPortfolio(
    { desiredAnnualWithdrawalCents: 1000000, horizonYears: 5, inflationRate: 0 },
    hopeless
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-verified-result');
  assert.notEqual(result.reason, 'invalid-input');
  assert.equal(typeof result.error, 'string');
  assert.match(result.error, /verified/i);
  assert.ok(!('requiredPortfolioCents' in result));
  assert.ok(
    Object.values(result).every((value) => typeof value !== 'number'),
    'a refusal must carry no numeric portfolio value'
  );
});
