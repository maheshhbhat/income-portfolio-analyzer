// Adversarial edge tests for the bounded five-round verified solver
// (computeRequiredPortfolio). These tests attack the solver where the risks
// live - very long horizons, double-digit inflation, a 1-cent withdrawal, and
// withdrawal scenarios pinned at curated securities' exact total returns so
// bracket membership shifts right at a round boundary - and assert, for every
// point of a broad input grid, that the outcome has one of exactly two shapes:
//
//   1. a verified result: integer requiredPortfolioCents, rounds at most 5, a
//      feed-back simulation lasting the full horizon, deep-equal output on a
//      second identical call, and an integer-cent allocation summing to the
//      portfolio with zero cent drift; or
//   2. the explicit { ok: false, reason: 'no-verified-result' } refusal.
//
// Never an unverified number, never a third shape. The refusal count over the
// grid is reported in the test output so refusal frequency on ordinary inputs
// is visible at acceptance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRequiredPortfolio } from '../src/lib/requiredPortfolio.js';
import { computeRetirementPlan, simulateWithdrawals, bracketAndBlend } from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

const CURATED_SYMBOLS = new Set(SECURITIES.map((s) => s.symbol));
const metricOf = (s) => s.yield + s.growthRate;

/**
 * Assert the solver outcome for a valid input has exactly one of the two
 * allowed shapes, calling the computation twice and asserting deep equality.
 * Returns true when the outcome is the explicit refusal, false when verified.
 */
function assertTwoShapeOutcome(input, label) {
  const first = computeRequiredPortfolio(input, SECURITIES);
  const second = computeRequiredPortfolio({ ...input }, SECURITIES);

  // Determinism: a second identical call is deep-equal to the first.
  assert.deepEqual(first, second, `second identical call diverged for ${label}`);

  if (first.ok === true) {
    // Shape 1: a fully verified result.
    assert.ok(
      Number.isInteger(first.requiredPortfolioCents) && first.requiredPortfolioCents >= 0,
      `requiredPortfolioCents must be a non-negative integer for ${label}`
    );
    assert.ok(
      Number.isInteger(first.rounds) && first.rounds >= 0 && first.rounds <= 5,
      `rounds ${first.rounds} outside the hard five-round bound for ${label}`
    );

    // Allocation: integer cents, curated symbols only, zero cent drift.
    assert.ok(Array.isArray(first.allocation), `allocation missing for ${label}`);
    let sumCents = 0;
    for (const line of first.allocation) {
      assert.ok(
        Number.isInteger(line.amountCents) && line.amountCents > 0,
        `non-integer or non-positive cents for ${line.symbol} in ${label}`
      );
      assert.ok(CURATED_SYMBOLS.has(line.symbol), `${line.symbol} not curated in ${label}`);
      sumCents += line.amountCents;
    }
    assert.equal(
      sumCents,
      first.requiredPortfolioCents,
      `allocation drifted from the portfolio by ${sumCents - first.requiredPortfolioCents} cents for ${label}`
    );

    if (first.requiredPortfolioCents > 0) {
      // The bundled verification projection covers every year of the horizon.
      assert.equal(first.projection.lastsFullHorizon, true, `projection depleted for ${label}`);
      assert.equal(
        first.projection.years.length,
        input.horizonYears,
        `projection did not simulate the full horizon for ${label}`
      );

      // Feed-back: the verified portfolio, fed into the existing retirement
      // projection (dollars only at this call boundary), lasts the horizon.
      const plan = computeRetirementPlan(
        {
          investmentAmount: first.requiredPortfolioCents / 100,
          desiredAnnualWithdrawal: input.desiredAnnualWithdrawalCents / 100,
          horizonYears: input.horizonYears,
          inflationRate: input.inflationRate
        },
        SECURITIES
      );
      assert.equal(plan.ok, true, `feed-back plan rejected for ${label}`);
      assert.equal(plan.lastsFullHorizon, true, `feed-back plan depleted for ${label}`);

      // And the settled rates themselves sustain the plan for the horizon.
      const feedback = simulateWithdrawals({
        investmentAmount: first.requiredPortfolioCents / 100,
        desiredAnnualWithdrawal: input.desiredAnnualWithdrawalCents / 100,
        horizonYears: input.horizonYears,
        blendedYield: first.blendedYield,
        blendedGrowth: first.blendedGrowth,
        inflationRate: input.inflationRate
      });
      assert.equal(feedback.lastsFullHorizon, true, `settled-rate feed-back depleted for ${label}`);
      assert.equal(feedback.years.length, input.horizonYears, `settled-rate feed-back cut short for ${label}`);
    }
    return false;
  }

  // Shape 2: the explicit refusal - and nothing else. Any other reason (for a
  // valid input) or any leaked number is the forbidden third shape.
  assert.equal(first.ok, false, `outcome is neither verified nor a refusal for ${label}`);
  assert.equal(first.reason, 'no-verified-result', `unexpected reason '${first.reason}' for ${label}`);
  assert.equal(typeof first.error, 'string', `refusal missing an error message for ${label}`);
  assert.ok(first.error.length > 0, `refusal error message empty for ${label}`);
  assert.ok(!('requiredPortfolioCents' in first), `refusal leaked a portfolio figure for ${label}`);
  assert.ok(!('allocation' in first), `refusal leaked an allocation for ${label}`);
  assert.ok(
    Object.values(first).every((value) => typeof value !== 'number'),
    `refusal carried an unverified number for ${label}`
  );
  return true;
}

// Broad adversarial grid: 3 withdrawals x 4 horizons x 3 inflation rates = 36
// points, covering a 1-cent withdrawal, horizons of 60 and 80 years, and 10%
// inflation. Every point must land in one of the two allowed shapes.
const GRID = [];
for (const desiredAnnualWithdrawalCents of [1, 4000000, 25000000]) {
  for (const horizonYears of [1, 10, 60, 80]) {
    for (const inflationRate of [0, 0.03, 0.1]) {
      GRID.push({ desiredAnnualWithdrawalCents, horizonYears, inflationRate });
    }
  }
}

test('adversarial grid of 36 points: every outcome is verified or the explicit refusal, never a third shape', (t) => {
  assert.ok(GRID.length >= 30, 'the story requires a grid of at least 30 points');
  assert.ok(GRID.some((p) => p.horizonYears >= 60), 'grid must include a horizon of at least 60 years');
  assert.ok(GRID.some((p) => p.inflationRate >= 0.1), 'grid must include inflation of at least 10%');
  assert.ok(GRID.some((p) => p.desiredAnnualWithdrawalCents === 1), 'grid must include a 1-cent withdrawal');

  let refusals = 0;
  for (const input of GRID) {
    const label = JSON.stringify(input);
    if (assertTwoShapeOutcome(input, label)) refusals++;
  }

  // Report refusal frequency so it is visible at acceptance.
  t.diagnostic(`refusal frequency: ${refusals} of ${GRID.length} grid points returned no-verified-result`);
  console.log(`[adversarial grid] ${refusals} of ${GRID.length} grid points refused with no-verified-result`);
  assert.ok(refusals >= 0 && refusals <= GRID.length);
});

test('extreme single edges: 60+ year horizon with 25% inflation, and a 1-cent withdrawal over 60 years, still yield only the two shapes', () => {
  const edges = [
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 60, inflationRate: 0.25 },
    { desiredAnnualWithdrawalCents: 4000000, horizonYears: 100, inflationRate: 0.1 },
    { desiredAnnualWithdrawalCents: 1, horizonYears: 60, inflationRate: 0.1 },
    { desiredAnnualWithdrawalCents: 1, horizonYears: 1, inflationRate: 0 }
  ];
  for (const input of edges) {
    assertTwoShapeOutcome(input, JSON.stringify(input));
  }
});

// Withdrawal scenarios pinned at curated securities' exact total returns. The
// reference portfolio is $1,000,000, so the year-1 withdrawal rate equals the
// pinned security's exact yield + growthRate, landing the bracket engine right
// on the metric >= target boundary. Three securities are pinned: the list's
// maximum (QYLD), and two mid-list round-boundary metrics (SCHD, XYLD).
const REFERENCE_PORTFOLIO_CENTS = 100000000; // $1,000,000
const PINNED_SYMBOLS = ['QYLD', 'SCHD', 'XYLD'];

test('three scenarios pinned at curated securities exact total returns keep the two-shape guarantee under bracket shifts', () => {
  assert.ok(PINNED_SYMBOLS.length >= 3);
  for (const symbol of PINNED_SYMBOLS) {
    const security = SECURITIES.find((s) => s.symbol === symbol);
    assert.ok(security, `${symbol} must exist in the curated list`);
    const exactRate = metricOf(security);
    const desiredAnnualWithdrawalCents = Math.round(exactRate * REFERENCE_PORTFOLIO_CENTS);
    assert.ok(Number.isInteger(desiredAnnualWithdrawalCents) && desiredAnnualWithdrawalCents > 0);
    for (const horizonYears of [10, 30, 60]) {
      const input = { desiredAnnualWithdrawalCents, horizonYears, inflationRate: 0.03 };
      assertTwoShapeOutcome(input, `pinned@${symbol} ${JSON.stringify(input)}`);
    }
  }
});

test('bracket membership shifts exactly at a pinned security total return: on-boundary vs epsilon-above allocations differ', () => {
  const probeDollars = 1000000;
  for (const symbol of PINNED_SYMBOLS) {
    const security = SECURITIES.find((s) => s.symbol === symbol);
    const exactRate = metricOf(security);

    // Exactly on the boundary the security satisfies metric >= target, so it
    // belongs to the near-above cluster and receives a positive allocation.
    const onBoundary = bracketAndBlend(probeDollars, SECURITIES, exactRate, metricOf);
    assert.equal(onBoundary.unreachable, false, `${symbol}'s own total return must be reachable`);
    const line = onBoundary.items.find((item) => item.security.symbol === symbol);
    assert.ok(line && line.amount > 0, `${symbol} must be allocated at its own exact total return`);

    // A hair above the boundary the security fails metric >= target and drops
    // to the below cluster, shifting the bracket: the allocations must differ.
    const justAbove = bracketAndBlend(probeDollars, SECURITIES, exactRate + 1e-9, metricOf);
    assert.notDeepEqual(
      justAbove.items,
      onBoundary.items,
      `crossing ${symbol}'s exact total return must shift the bracket allocation`
    );

    // Integer-cent discipline holds on both sides of the shift.
    for (const result of [onBoundary, justAbove]) {
      const totalCents = result.items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
      if (result.items.length > 0) {
        assert.equal(totalCents, probeDollars * 100, `cent drift at the ${symbol} boundary`);
      }
    }
  }
});

test('the curated maximum total return is a hard ceiling: exactly at it allocates, epsilon above is unreachable', () => {
  const maxRate = SECURITIES.reduce((best, s) => Math.max(best, metricOf(s)), -Infinity);
  const top = SECURITIES.filter((s) => metricOf(s) === maxRate);
  assert.ok(top.length >= 1);

  const atMax = bracketAndBlend(1000000, SECURITIES, maxRate, metricOf);
  assert.equal(atMax.unreachable, false);
  for (const item of atMax.items) {
    assert.equal(metricOf(item.security), maxRate, 'at the exact maximum only maximum-metric securities are allocated');
  }

  const aboveMax = bracketAndBlend(1000000, SECURITIES, maxRate + 1e-9, metricOf);
  assert.equal(aboveMax.unreachable, true, 'a target above every curated metric must be unreachable');
});
