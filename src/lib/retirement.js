// Retirement sustainability projection: builds a total-return-based allocation,
// then deterministically simulates annual withdrawals against it, growing each
// year's withdrawal by a static illustrative inflation rate.
//
// Simplification (disclosed): the simulation is run at the portfolio level using
// the allocation's *blended* yield and growth rate as constant annual rates for
// every year of the horizon. It does not track each holding's value drifting
// independently year over year (no per-holding rebalancing or reinvestment
// logic) - this keeps the projection deterministic and easy to verify, at the
// cost of not modeling how the mix would drift if left untouched for decades.

import { bracketAndBlend } from './allocation.js';

// Re-exported so sibling pure modules (requiredPortfolio.js) can reuse the
// allocation engine through a single import boundary.
export { bracketAndBlend };

export const FIXED_INFLATION_COMPARISON_SCENARIOS = Object.freeze([
  Object.freeze({ label: '2%', inflationRate: 0.02 }),
  Object.freeze({ label: '3%', inflationRate: 0.03 }),
  Object.freeze({ label: '4%', inflationRate: 0.04 })
]);

/**
 * @param {{investmentAmount: number, desiredAnnualWithdrawal: number, horizonYears: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 */
export function computeRetirementPlan(input, securities) {
  const { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate } = input || {};

  if (typeof investmentAmount !== 'number' || !Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    return { ok: false, error: 'Enter an investment amount greater than $0.' };
  }
  if (typeof desiredAnnualWithdrawal !== 'number' || !Number.isFinite(desiredAnnualWithdrawal) || desiredAnnualWithdrawal < 0) {
    return { ok: false, error: 'Enter a desired annual withdrawal of $0 or more.' };
  }
  if (typeof horizonYears !== 'number' || !Number.isInteger(horizonYears) || horizonYears < 1) {
    return { ok: false, error: 'Enter a retirement horizon of at least 1 whole year.' };
  }
  if (typeof inflationRate !== 'number' || !Number.isFinite(inflationRate) || inflationRate < 0) {
    return { ok: false, error: 'Enter an inflation rate of 0% or more.' };
  }
  if (!Array.isArray(securities) || securities.length < 2) {
    return { ok: false, error: 'No curated securities are available to build an allocation.' };
  }

  // The initial allocation is chosen against the year-1 (unadjusted) withdrawal
  // rate only - inflation affects the multi-year simulation, not the bracket
  // selection, so the allocation/bracket engine is unchanged by this increment.
  const targetRate = desiredAnnualWithdrawal / investmentAmount;
  const { items, unreachable, bestAchievableMetric } = bracketAndBlend(
    investmentAmount,
    securities,
    targetRate,
    (s) => s.yield + s.growthRate
  );

  const allocations = items.map((item) => ({
    symbol: item.security.symbol,
    name: item.security.name,
    type: item.security.type,
    yield: item.security.yield,
    growthRate: item.security.growthRate,
    totalReturn: item.security.yield + item.security.growthRate,
    amount: item.amount,
    percentOfPortfolio: item.percentOfPortfolio
  }));

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const blendedYield = allocations.reduce((sum, a) => sum + a.amount * a.yield, 0) / investmentAmount;
  const blendedGrowth = allocations.reduce((sum, a) => sum + a.amount * a.growthRate, 0) / investmentAmount;
  const blendedTotalReturn = blendedYield + blendedGrowth;

  const simulation = simulateWithdrawals({
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    blendedYield,
    blendedGrowth,
    inflationRate
  });

  return {
    ok: true,
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    inflationRate,
    targetRate,
    unreachable,
    bestAchievableRate: bestAchievableMetric,
    allocations,
    totalAllocated,
    blendedYield,
    blendedGrowth,
    blendedTotalReturn,
    ...simulation
  };
}

/**
 * Pure deterministic comparison across the fixed illustrative inflation cases.
 *
 * @param {{investmentAmount: number, desiredAnnualWithdrawal: number, horizonYears: number, inflationRate?: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 * @param {(input: {investmentAmount: number, desiredAnnualWithdrawal: number, horizonYears: number, inflationRate: number}, securities: Array<object>) => object} [computePlan]
 */
export function computeFixedInflationComparison(input, securities, computePlan = computeRetirementPlan) {
  const scenarios = [];

  for (const scenario of FIXED_INFLATION_COMPARISON_SCENARIOS) {
    const result = computePlan(
      {
        ...input,
        inflationRate: scenario.inflationRate
      },
      securities
    );

    if (!result?.ok) {
      return result;
    }

    scenarios.push({
      label: scenario.label,
      inflationRate: scenario.inflationRate,
      result
    });
  }

  return {
    ok: true,
    scenarios
  };
}

/**
 * Deterministic year-by-year withdrawal simulation at the portfolio level.
 * Each year: startingBalance grows by (yield + growth); that year's withdrawal
 * (year 1 = the requested amount, year N = the requested amount compounded by
 * inflationRate for N-1 years) is notionally paid from dividends first, then
 * from selling shares (reducing the balance further) if dividends fall short.
 * Algebraically this collapses to
 * `endingBalance = startingBalance * (1 + totalReturn) - withdrawalThisYear`,
 * regardless of the dividend/sale split, which is tracked only for display.
 *
 * @returns {{years: Array<object>, depletionYear: number|null, endingBalance: number, lastsFullHorizon: boolean}}
 */
export function simulateWithdrawals({
  investmentAmount,
  desiredAnnualWithdrawal,
  horizonYears,
  blendedYield,
  blendedGrowth,
  inflationRate = 0
}) {
  const totalReturn = blendedYield + blendedGrowth;
  const years = [];
  let balance = investmentAmount;
  let depletionYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    const startingBalance = balance;
    const withdrawalRequested = desiredAnnualWithdrawal * Math.pow(1 + inflationRate, year - 1);
    const dividendIncome = startingBalance * blendedYield;
    const growthAmount = startingBalance * blendedGrowth;
    const grownBalance = startingBalance * (1 + totalReturn);
    const endingBalance = grownBalance - withdrawalRequested;

    if (endingBalance < 0) {
      const withdrawalPaid = Math.max(0, grownBalance);
      const dividendPortion = Math.min(dividendIncome, withdrawalPaid);
      years.push({
        year,
        startingBalance,
        dividendIncome,
        growthAmount,
        withdrawalRequested,
        withdrawalPaid,
        dividendPortion,
        sharesSoldPortion: withdrawalPaid - dividendPortion,
        endingBalance: 0
      });
      depletionYear = year;
      balance = 0;
      break;
    }

    const dividendPortion = Math.min(dividendIncome, withdrawalRequested);
    years.push({
      year,
      startingBalance,
      dividendIncome,
      growthAmount,
      withdrawalRequested,
      withdrawalPaid: withdrawalRequested,
      dividendPortion,
      sharesSoldPortion: withdrawalRequested - dividendPortion,
      endingBalance
    });
    balance = endingBalance;
  }

  return {
    years,
    depletionYear,
    endingBalance: balance,
    lastsFullHorizon: depletionYear === null
  };
}
