import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMaxSustainableWithdrawal } from '../src/lib/maxSustainableWithdrawal.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

// Independent cross-check: computeRetirementPlan is the repository's already
// tested, unmodified projection engine. Every claim this module's search
// makes about a specific cent value surviving or failing is re-verified here
// by feeding that exact cent value back through computeRetirementPlan,
// rather than trusting any number this test file might otherwise hardcode.
function planAtWithdrawalCents(investmentAmountCents, withdrawalCents, horizonYears, inflationRate, securities) {
  return computeRetirementPlan(
    {
      investmentAmount: investmentAmountCents / 100,
      desiredAnnualWithdrawal: withdrawalCents / 100,
      horizonYears,
      inflationRate
    },
    securities
  );
}

const REPRESENTATIVE_GRID = [];
for (const investmentAmountCents of [50000000, 100000000]) {
  for (const horizonYears of [10, 25]) {
    for (const inflationRate of [0, 0.02, 0.03]) {
      REPRESENTATIVE_GRID.push({ investmentAmountCents, horizonYears, inflationRate });
    }
  }
}

test('representative valid inputs: the returned maximum survives and one cent more is independently disproved', () => {
  assert.ok(REPRESENTATIVE_GRID.length >= 12);
  for (const input of REPRESENTATIVE_GRID) {
    const result = computeMaxSustainableWithdrawal(input, SECURITIES);
    assert.equal(result.ok, true, `expected ok:true for ${JSON.stringify(input)}`);
    assert.ok(Number.isInteger(result.maxAnnualWithdrawalCents), 'maxAnnualWithdrawalCents must be an integer');
    assert.ok(result.maxAnnualWithdrawalCents >= 0);

    // The module's own claim about the returned maximum.
    assert.equal(result.projection.lastsFullHorizon, true);
    assert.equal(result.nextCentProjection.lastsFullHorizon, false);

    // Independent re-verification via the existing, separately tested engine.
    const atMax = planAtWithdrawalCents(
      input.investmentAmountCents,
      result.maxAnnualWithdrawalCents,
      input.horizonYears,
      input.inflationRate,
      SECURITIES
    );
    assert.equal(atMax.ok, true);
    assert.equal(atMax.lastsFullHorizon, true, `max failed independent re-check for ${JSON.stringify(input)}`);

    const atMaxPlusOne = planAtWithdrawalCents(
      input.investmentAmountCents,
      result.maxAnnualWithdrawalCents + 1,
      input.horizonYears,
      input.inflationRate,
      SECURITIES
    );
    assert.equal(atMaxPlusOne.ok, true);
    assert.equal(
      atMaxPlusOne.lastsFullHorizon,
      false,
      `max + 1 cent unexpectedly survived independent re-check for ${JSON.stringify(input)}`
    );

    // Allocation is drawn from the curated list and sums to no more than the portfolio.
    const curatedSymbols = new Set(SECURITIES.map((s) => s.symbol));
    let sumCents = 0;
    for (const line of result.allocation) {
      assert.ok(curatedSymbols.has(line.symbol));
      assert.ok(Number.isInteger(line.amountCents) && line.amountCents > 0);
      sumCents += line.amountCents;
    }
    if (result.maxAnnualWithdrawalCents > 0) {
      assert.ok(sumCents > 0);
    }
  }
});

test('a tiny portfolio against a long, harsh horizon: max is still verified, including the zero-withdrawal boundary', () => {
  const input = { investmentAmountCents: 100, horizonYears: 40, inflationRate: 0.5 };
  const result = computeMaxSustainableWithdrawal(input, SECURITIES);
  assert.equal(result.ok, true);
  assert.ok(result.maxAnnualWithdrawalCents >= 0);

  // Withdrawing nothing must always be within the verified-survivable set.
  const zeroPlan = planAtWithdrawalCents(input.investmentAmountCents, 0, input.horizonYears, input.inflationRate, SECURITIES);
  assert.equal(zeroPlan.lastsFullHorizon, true);

  const atMax = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents,
    input.horizonYears,
    input.inflationRate,
    SECURITIES
  );
  assert.equal(atMax.lastsFullHorizon, true);

  const atMaxPlusOne = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents + 1,
    input.horizonYears,
    input.inflationRate,
    SECURITIES
  );
  assert.equal(atMaxPlusOne.lastsFullHorizon, false);
});

test('bracket-boundary regime: a withdrawal landing exactly at a curated metric breakpoint still returns a proven maximum', () => {
  // At investmentAmountCents = 100,000,000, the withdrawal-cents value at
  // which target rate == a given security's yield+growthRate lands on a
  // breakpoint this module's regime search must handle explicitly (see
  // module header, simplification 1) rather than only sampling around it.
  for (const security of SECURITIES) {
    const investmentAmountCents = 100000000;
    const metric = security.yield + security.growthRate;
    const breakpointCents = Math.round(metric * investmentAmountCents);
    if (breakpointCents <= 0 || breakpointCents >= investmentAmountCents) continue;

    const input = { investmentAmountCents, horizonYears: 15, inflationRate: 0.02 };
    const result = computeMaxSustainableWithdrawal(input, SECURITIES);
    assert.equal(result.ok, true);

    // The regime search must never settle below what is directly known to
    // survive at the breakpoint itself.
    const atBreakpoint = planAtWithdrawalCents(investmentAmountCents, breakpointCents, 15, 0.02, SECURITIES);
    if (atBreakpoint.lastsFullHorizon) {
      assert.ok(
        result.maxAnnualWithdrawalCents >= breakpointCents,
        `regime search missed a surviving breakpoint at ${breakpointCents} cents (security ${security.symbol})`
      );
    }
  }
});

test('two adjacent curated securities with a deliberately large metric gap create a sharp bracket-boundary regime jump', () => {
  // A crafted two-regime list: one very high total-return security and one
  // much lower one, with nothing in between. Crossing the breakpoint between
  // them changes the blended allocation discontinuously, which is exactly
  // the shape a naive single monotone search over the whole range can get
  // wrong.
  const sharpJump = [
    { symbol: 'HIGH', name: 'High Return', type: 'etf', yield: 0.02, growthRate: 0.2 },
    { symbol: 'LOW', name: 'Low Return', type: 'etf', yield: 0.01, growthRate: 0.02 }
  ];
  const input = { investmentAmountCents: 100000000, horizonYears: 20, inflationRate: 0.02 };
  const result = computeMaxSustainableWithdrawal(input, sharpJump);
  assert.equal(result.ok, true);

  const atMax = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents,
    input.horizonYears,
    input.inflationRate,
    sharpJump
  );
  assert.equal(atMax.lastsFullHorizon, true);

  const atMaxPlusOne = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents + 1,
    input.horizonYears,
    input.inflationRate,
    sharpJump
  );
  assert.equal(atMaxPlusOne.lastsFullHorizon, false);
});

test('identical inputs produce deterministic deep-equal results', () => {
  const inputs = [
    REPRESENTATIVE_GRID[0],
    REPRESENTATIVE_GRID[5],
    { investmentAmountCents: 100, horizonYears: 40, inflationRate: 0.5 },
    { investmentAmountCents: -100, horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: 1000000, horizonYears: 10, inflationRate: 0.02 }
  ];
  for (const input of inputs) {
    assert.deepEqual(
      computeMaxSustainableWithdrawal(input, SECURITIES),
      computeMaxSustainableWithdrawal({ ...input }, SECURITIES)
    );
  }
});

test('invalid inputs return ok:false with reason invalid-input and an actionable message, never an exception', () => {
  const invalidInputs = [
    { investmentAmountCents: '5000000', horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: NaN, horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: 1234.5, horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: 0, horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: -500000, horizonYears: 10, inflationRate: 0.02 },
    { investmentAmountCents: 5000000, horizonYears: 10.5, inflationRate: 0.02 },
    { investmentAmountCents: 5000000, horizonYears: 0, inflationRate: 0.02 },
    { investmentAmountCents: 5000000, horizonYears: 10, inflationRate: -0.01 },
    { investmentAmountCents: 5000000, horizonYears: 10, inflationRate: Infinity },
    { investmentAmountCents: 5000000, horizonYears: 10 }
  ];
  for (const input of invalidInputs) {
    const result = computeMaxSustainableWithdrawal(input, SECURITIES);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(input)}`);
    assert.equal(result.reason, 'invalid-input');
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  }

  const noSecurities = computeMaxSustainableWithdrawal(
    { investmentAmountCents: 5000000, horizonYears: 10, inflationRate: 0.02 },
    []
  );
  assert.equal(noSecurities.ok, false);
  assert.equal(noSecurities.reason, 'invalid-input');
});

test('a curated set with a total return at -200% collapses the balance from growth alone and refuses rather than guess', () => {
  // yield + growthRate = -2 (-200%) makes (1 + totalReturn) negative, so even
  // a $0 withdrawal flips the balance negative purely from the "growth" term
  // in year 1 - no withdrawal, not even zero, can be verified to survive.
  const hopeless = [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0, growthRate: -2 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: -2 }
  ];
  const input = { investmentAmountCents: 100000000, horizonYears: 10, inflationRate: 0.02 };
  const result = computeMaxSustainableWithdrawal(input, hopeless);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-verified-result');
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
  assert.ok(!('maxAnnualWithdrawalCents' in result), 'a refusal must carry no numeric maximum');

  const zeroPlan = planAtWithdrawalCents(input.investmentAmountCents, 0, input.horizonYears, input.inflationRate, hopeless);
  assert.equal(zeroPlan.lastsFullHorizon, false, 'test fixture assumption: even $0 must fail for this refusal to be correct');
});

test('a curated set with a modest guaranteed loss still verifies a maximum, with $0 independently confirmed survivable', () => {
  // A total return of -5% is negative but not ruinous: (1 + totalReturn) stays
  // positive, so $0 survives (the balance shrinks but never goes negative
  // absent a withdrawal), unlike the -200% refusal case above.
  const mildLoss = [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0, growthRate: -0.05 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: -0.05 }
  ];
  const input = { investmentAmountCents: 100000000, horizonYears: 10, inflationRate: 0.02 };
  const result = computeMaxSustainableWithdrawal(input, mildLoss);
  assert.equal(result.ok, true);
  assert.ok(result.maxAnnualWithdrawalCents >= 0);
  assert.equal(result.projection.lastsFullHorizon, true);

  const zeroPlan = planAtWithdrawalCents(input.investmentAmountCents, 0, input.horizonYears, input.inflationRate, mildLoss);
  assert.equal(zeroPlan.lastsFullHorizon, true);

  const atMax = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents,
    input.horizonYears,
    input.inflationRate,
    mildLoss
  );
  assert.equal(atMax.lastsFullHorizon, true);

  const atMaxPlusOne = planAtWithdrawalCents(
    input.investmentAmountCents,
    result.maxAnnualWithdrawalCents + 1,
    input.horizonYears,
    input.inflationRate,
    mildLoss
  );
  assert.equal(atMaxPlusOne.lastsFullHorizon, false);
});

test('module never reads DOM, network, filesystem, clock, or randomness directly', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/maxSustainableWithdrawal.js', import.meta.url), 'utf8')
  );
  for (const forbidden of ['document.', 'window.', 'fetch(', 'readFileSync', 'writeFileSync', 'Math.random', 'Date.now', 'new Date(']) {
    assert.ok(!source.includes(forbidden), `module source unexpectedly references ${forbidden}`);
  }
});
