import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFixedInflationComparison,
  computeRetirementPlan,
  FIXED_INFLATION_COMPARISON_SCENARIOS,
  simulateWithdrawals
} from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

const CENT = 0.01;

// Closed-form future value of a growing annuity (n level-growing withdrawals of
// W, W*(1+g), W*(1+g)^2, ... compounded forward to year n at rate r), used to
// independently cross-check the iterative simulation.
function growingAnnuityFutureValue(withdrawal, rate, growth, n) {
  if (n === 0) return 0;
  if (rate === growth) return withdrawal * n * Math.pow(1 + rate, n - 1);
  return (withdrawal * (Math.pow(1 + rate, n) - Math.pow(1 + growth, n))) / (rate - growth);
}

test('rejects a non-positive investment amount', () => {
  const result = computeRetirementPlan({ investmentAmount: 0, desiredAnnualWithdrawal: 1000, horizonYears: 10 }, SECURITIES);
  assert.equal(result.ok, false);
  assert.match(result.error, /investment amount/i);
});

test('rejects a negative desired withdrawal', () => {
  const result = computeRetirementPlan({ investmentAmount: 100000, desiredAnnualWithdrawal: -1, horizonYears: 10 }, SECURITIES);
  assert.equal(result.ok, false);
  assert.match(result.error, /withdrawal/i);
});

test('rejects a non-integer or non-positive horizon', () => {
  const fractional = computeRetirementPlan({ investmentAmount: 100000, desiredAnnualWithdrawal: 4000, horizonYears: 10.5, inflationRate: 0.03 }, SECURITIES);
  assert.equal(fractional.ok, false);
  assert.match(fractional.error, /horizon/i);

  const zero = computeRetirementPlan({ investmentAmount: 100000, desiredAnnualWithdrawal: 4000, horizonYears: 0, inflationRate: 0.03 }, SECURITIES);
  assert.equal(zero.ok, false);
  assert.match(zero.error, /horizon/i);
});

test('rejects a missing or negative inflation rate', () => {
  const missing = computeRetirementPlan({ investmentAmount: 100000, desiredAnnualWithdrawal: 4000, horizonYears: 10 }, SECURITIES);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /inflation/i);

  const negative = computeRetirementPlan(
    { investmentAmount: 100000, desiredAnnualWithdrawal: 4000, horizonYears: 10, inflationRate: -0.01 },
    SECURITIES
  );
  assert.equal(negative.ok, false);
  assert.match(negative.error, /inflation/i);
});

test('allocation sums exactly to the investment amount', () => {
  const investmentAmount = 200000;
  const result = computeRetirementPlan({ investmentAmount, desiredAnnualWithdrawal: 8000, horizonYears: 20, inflationRate: 0.03 }, SECURITIES);
  assert.equal(result.ok, true);
  assert.ok(result.allocations.length >= 1);
  assert.ok(Math.abs(result.totalAllocated - investmentAmount) < CENT);
});

test('zero withdrawal: lasts the full horizon and grows by the exact compound total-return formula, regardless of inflation', () => {
  const investmentAmount = 100000;
  const horizonYears = 15;
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal: 0, horizonYears, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.lastsFullHorizon, true);
  assert.equal(result.depletionYear, null);
  assert.equal(result.years.length, horizonYears);

  const expectedEndingBalance = investmentAmount * Math.pow(1 + result.blendedTotalReturn, horizonYears);
  assert.ok(
    Math.abs(result.endingBalance - expectedEndingBalance) < CENT,
    `endingBalance ${result.endingBalance} !~ closed-form ${expectedEndingBalance}`
  );

  // 0% of 0 stays 0 every year no matter how it's compounded.
  for (const row of result.years) {
    assert.equal(row.withdrawalRequested, 0);
    assert.equal(row.withdrawalPaid, 0);
    assert.equal(row.sharesSoldPortion, 0);
  }
});

test('horizon of 1 year: ending balance matches the single-year closed-form exactly (inflation has no effect in year 1)', () => {
  const investmentAmount = 50000;
  const desiredAnnualWithdrawal = 2000;
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 1, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.years.length, 1);
  assert.equal(result.years[0].withdrawalRequested, desiredAnnualWithdrawal, 'year 1 withdrawal is unadjusted');

  const expected = investmentAmount * (1 + result.blendedTotalReturn) - desiredAnnualWithdrawal;
  assert.ok(Math.abs(result.years[0].endingBalance - expected) < CENT);
  assert.ok(Math.abs(result.endingBalance - expected) < CENT);
  assert.equal(result.lastsFullHorizon, expected >= 0);
});

test('withdrawals grow year over year by exactly the inflation rate', () => {
  const investmentAmount = 500000;
  const desiredAnnualWithdrawal = 15000;
  const inflationRate = 0.03;
  const horizonYears = 10;
  const result = computeRetirementPlan({ investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.years.length, horizonYears);

  for (const row of result.years) {
    const expectedWithdrawal = desiredAnnualWithdrawal * Math.pow(1 + inflationRate, row.year - 1);
    assert.ok(
      Math.abs(row.withdrawalRequested - expectedWithdrawal) < CENT,
      `year ${row.year}: withdrawalRequested ${row.withdrawalRequested} !~ ${expectedWithdrawal}`
    );
  }
  // Strictly increasing.
  for (let i = 1; i < result.years.length; i++) {
    assert.ok(result.years[i].withdrawalRequested > result.years[i - 1].withdrawalRequested);
  }
});

test('growing-annuity closed form: ending balance matches exactly when total return != inflation rate', () => {
  const investmentAmount = 300000;
  const desiredAnnualWithdrawal = 12000;
  const inflationRate = 0.03;
  const horizonYears = 20;
  const result = computeRetirementPlan({ investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.lastsFullHorizon, true);
  assert.notEqual(result.blendedTotalReturn, inflationRate);

  const grownPrincipal = investmentAmount * Math.pow(1 + result.blendedTotalReturn, horizonYears);
  const withdrawalsFutureValue = growingAnnuityFutureValue(desiredAnnualWithdrawal, result.blendedTotalReturn, inflationRate, horizonYears);
  const expectedEndingBalance = grownPrincipal - withdrawalsFutureValue;

  assert.ok(
    Math.abs(result.endingBalance - expectedEndingBalance) < CENT,
    `endingBalance ${result.endingBalance} !~ growing-annuity closed form ${expectedEndingBalance}`
  );
});

test('growing-annuity closed form: r == g edge case matches the n * (1+r)^(n-1) formula', () => {
  const investmentAmount = 200000;
  const horizonYears = 12;
  const blendedYield = 0.03;
  const blendedGrowth = 0.02;
  const totalReturn = blendedYield + blendedGrowth; // 0.05
  const desiredAnnualWithdrawal = 6000;

  const result = simulateWithdrawals({
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    blendedYield,
    blendedGrowth,
    inflationRate: totalReturn // force r == g
  });

  assert.equal(result.lastsFullHorizon, true);
  const grownPrincipal = investmentAmount * Math.pow(1 + totalReturn, horizonYears);
  const withdrawalsFutureValue = desiredAnnualWithdrawal * horizonYears * Math.pow(1 + totalReturn, horizonYears - 1);
  const expected = grownPrincipal - withdrawalsFutureValue;

  assert.ok(Math.abs(result.endingBalance - expected) < CENT, `endingBalance ${result.endingBalance} !~ ${expected}`);
});

test('guaranteed depletion: an oversized withdrawal empties the portfolio before the horizon ends', () => {
  const investmentAmount = 10000;
  const desiredAnnualWithdrawal = 8000; // far larger than any achievable blended total return
  const horizonYears = 10;
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.lastsFullHorizon, false);
  assert.ok(result.depletionYear >= 1 && result.depletionYear <= horizonYears);
  assert.equal(result.years.length, result.depletionYear, 'simulation should stop at the depletion year');
  assert.equal(result.endingBalance, 0);

  const lastRow = result.years[result.years.length - 1];
  assert.equal(lastRow.endingBalance, 0);
  assert.ok(lastRow.withdrawalPaid < lastRow.withdrawalRequested, 'the final year should only partially fund the withdrawal');
});

test('a growing withdrawal depletes no later than an equivalent flat withdrawal (harder or equal burden)', () => {
  const investmentAmount = 150000;
  const desiredAnnualWithdrawal = 25000; // ~16.7% rate - exceeds every achievable blended total return, guaranteeing depletion either way
  const horizonYears = 30;

  const flat = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate: 0 },
    SECURITIES
  );
  const growing = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate: 0.03 },
    SECURITIES
  );

  assert.equal(flat.ok, true);
  assert.equal(growing.ok, true);
  assert.equal(flat.lastsFullHorizon, false, 'test setup expects the flat case to also deplete');
  assert.equal(growing.lastsFullHorizon, false);
  assert.ok(
    growing.depletionYear <= flat.depletionYear,
    `expected growing withdrawal (depletes year ${growing.depletionYear}) to deplete no later than flat (year ${flat.depletionYear})`
  );
});

test('year-by-year arithmetic: each row is internally consistent and chains to the next', () => {
  const investmentAmount = 300000;
  const desiredAnnualWithdrawal = 12000;
  const horizonYears = 25;
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);

  let expectedStart = investmentAmount;
  for (const row of result.years) {
    assert.ok(Math.abs(row.startingBalance - expectedStart) < CENT, `year ${row.year} starting balance mismatch`);
    assert.ok(Math.abs(row.dividendIncome - row.startingBalance * result.blendedYield) < CENT);
    assert.ok(Math.abs(row.growthAmount - row.startingBalance * result.blendedGrowth) < CENT);
    assert.ok(Math.abs(row.dividendPortion + row.sharesSoldPortion - row.withdrawalPaid) < CENT);
    const expectedEnding = row.startingBalance * (1 + result.blendedTotalReturn) - row.withdrawalPaid;
    assert.ok(Math.abs(row.endingBalance - Math.max(0, expectedEnding)) < CENT, `year ${row.year} ending balance mismatch`);
    expectedStart = row.endingBalance;
  }
});

test('unreachable withdrawal rate still returns a best-achievable allocation that sums to the investment', () => {
  const investmentAmount = 10000;
  const desiredAnnualWithdrawal = 5000; // 50% rate - exceeds every curated total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 5, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, true);
  assert.ok(result.allocations.length >= 1);
  assert.ok(Math.abs(result.totalAllocated - investmentAmount) < CENT);
});

test('total-return target near VOO surfaces VOO in the proposed allocation', () => {
  const investmentAmount = 100000;
  const voo = SECURITIES.find((s) => s.symbol === 'VOO');
  const desiredAnnualWithdrawal = investmentAmount * (voo.yield + voo.growthRate); // exactly VOO's blended total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 10, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const symbols = result.allocations.map((a) => a.symbol);
  assert.ok(symbols.includes('VOO'), `expected VOO in allocation, got ${symbols.join(', ')}`);
});

test('total-return target near QQQ surfaces QQQ in the proposed allocation', () => {
  const investmentAmount = 100000;
  const qqq = SECURITIES.find((s) => s.symbol === 'QQQ');
  const desiredAnnualWithdrawal = investmentAmount * (qqq.yield + qqq.growthRate); // exactly QQQ's blended total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 10, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const symbols = result.allocations.map((a) => a.symbol);
  assert.ok(symbols.includes('QQQ'), `expected QQQ in allocation, got ${symbols.join(', ')}`);
});

test('total-return target near DIVO surfaces DIVO (CTO callout confirmation)', () => {
  const investmentAmount = 100000;
  const divo = SECURITIES.find((s) => s.symbol === 'DIVO');
  const desiredAnnualWithdrawal = investmentAmount * (divo.yield + divo.growthRate); // exactly DIVO's blended total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 15, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const symbols = result.allocations.map((a) => a.symbol);
  assert.ok(symbols.includes('DIVO'), `expected DIVO in allocation, got ${symbols.join(', ')}`);
});

test('a very low total-return target surfaces BND, the curated bond ETF', () => {
  const investmentAmount = 100000;
  const bnd = SECURITIES.find((s) => s.symbol === 'BND');
  const desiredAnnualWithdrawal = investmentAmount * (bnd.yield + bnd.growthRate); // exactly BND's blended total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 15, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const symbols = result.allocations.map((a) => a.symbol);
  assert.ok(symbols.includes('BND'), `expected BND in allocation, got ${symbols.join(', ')}`);
});

test('total-return target near VUG surfaces VUG in the proposed allocation', () => {
  const investmentAmount = 100000;
  const vug = SECURITIES.find((s) => s.symbol === 'VUG');
  const desiredAnnualWithdrawal = investmentAmount * (vug.yield + vug.growthRate); // exactly VUG's blended total return
  const result = computeRetirementPlan(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears: 10, inflationRate: 0.03 },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const symbols = result.allocations.map((a) => a.symbol);
  assert.ok(symbols.includes('VUG'), `expected VUG in allocation, got ${symbols.join(', ')}`);
});

test('simulateWithdrawals is a pure function usable independently of the allocation step, and defaults to flat (0%) inflation', () => {
  const result = simulateWithdrawals({
    investmentAmount: 100000,
    desiredAnnualWithdrawal: 5000,
    horizonYears: 3,
    blendedYield: 0.04,
    blendedGrowth: 0.02
  });
  assert.equal(result.years.length, 3);
  assert.equal(result.lastsFullHorizon, true);
  const expected = 100000 * Math.pow(1.06, 3) - 5000 * (Math.pow(1.06, 2) + Math.pow(1.06, 1) + Math.pow(1.06, 0));
  assert.ok(Math.abs(result.endingBalance - expected) < CENT);
});

test('fixed-inflation comparison returns exactly the ordered 2%, 3%, and 4% scenarios', () => {
  const input = {
    investmentAmount: 500000,
    desiredAnnualWithdrawal: 15000,
    horizonYears: 10
  };

  const result = computeFixedInflationComparison(input, SECURITIES);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.scenarios.map((scenario) => ({
      label: scenario.label,
      inflationRate: scenario.inflationRate
    })),
    FIXED_INFLATION_COMPARISON_SCENARIOS
  );

  for (const scenario of result.scenarios) {
    assert.equal(scenario.result.ok, true);
    assert.equal(scenario.result.inflationRate, scenario.inflationRate);
  }
});

test('fixed-inflation comparison returns the existing actionable refusal shape and no partial scenarios for invalid input', () => {
  const input = {
    investmentAmount: 500000,
    desiredAnnualWithdrawal: 15000,
    horizonYears: 0
  };

  const singlePlanRefusal = computeRetirementPlan(input, SECURITIES);
  const comparisonRefusal = computeFixedInflationComparison(input, SECURITIES);

  assert.deepEqual(comparisonRefusal, singlePlanRefusal);
  assert.equal(comparisonRefusal.ok, false);
  assert.equal('scenarios' in comparisonRefusal, false);
});
