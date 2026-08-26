// Deterministic scenario comparison over the existing retirement projection:
// both scenarios reuse one validated allocation and one portfolio-level blended
// rate basis. That keeps work bounded by the selected securities plus horizon
// years rather than portfolio cents, at the cost of not modeling holding-level
// drift, rebalancing, or any path more complex than the product-owned sequence
// documented below.

import { buildRetirementPlanBasis, validateRetirementInputs } from './retirement.js';

export const EARLY_DOWNTURN_GROWTH_ADJUSTMENT = -0.20;

function buildScenarioResult({
  investmentAmount,
  desiredAnnualWithdrawal,
  horizonYears,
  inflationRate,
  blendedYield,
  steadyBlendedGrowth,
  growthForYear,
  scenario
}) {
  const years = [];
  let balance = investmentAmount;
  let depletionYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    const startingBalance = balance;
    const blendedGrowth = growthForYear(year);
    const blendedTotalReturn = blendedYield + blendedGrowth;
    const withdrawalRequested = desiredAnnualWithdrawal * Math.pow(1 + inflationRate, year - 1);
    const dividendIncome = startingBalance * blendedYield;
    const growthAmount = startingBalance * blendedGrowth;
    const grownBalance = startingBalance * (1 + blendedTotalReturn);
    const endingBalance = grownBalance - withdrawalRequested;

    if (endingBalance < 0) {
      const withdrawalPaid = Math.max(0, grownBalance);
      const dividendPortion = Math.min(dividendIncome, withdrawalPaid);
      years.push({
        year,
        scenario,
        startingBalance,
        blendedYield,
        blendedGrowth,
        blendedTotalReturn,
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
      scenario,
      startingBalance,
      blendedYield,
      blendedGrowth,
      blendedTotalReturn,
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
    scenario,
    steadyBlendedYield: blendedYield,
    steadyBlendedGrowth,
    endingBalance: balance,
    depletionYear,
    lastsFullHorizon: depletionYear === null,
    status: depletionYear === null ? 'full-horizon' : 'depleted',
    years
  };
}

/**
 * @param {{investmentAmount: number, desiredAnnualWithdrawal: number, horizonYears: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 */
export function computeRetirementScenarios(input, securities) {
  const validated = validateRetirementInputs(input, securities);
  if (!validated.ok) return validated;

  const { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate } = validated;
  const basis = buildRetirementPlanBasis(validated, securities);

  const steady = buildScenarioResult({
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    inflationRate,
    blendedYield: basis.blendedYield,
    steadyBlendedGrowth: basis.blendedGrowth,
    growthForYear: () => basis.blendedGrowth,
    scenario: 'steady'
  });

  const earlyDownturn = buildScenarioResult({
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    inflationRate,
    blendedYield: basis.blendedYield,
    steadyBlendedGrowth: basis.blendedGrowth,
    growthForYear: (year) => (year === 1 ? basis.blendedGrowth + EARLY_DOWNTURN_GROWTH_ADJUSTMENT : basis.blendedGrowth),
    scenario: 'earlyDownturn'
  });

  return {
    ok: true,
    investmentAmount,
    desiredAnnualWithdrawal,
    horizonYears,
    inflationRate,
    ...basis,
    disclosures: {
      deterministicIllustration: 'Illustrative deterministic scenarios only; not a forecast or financial advice.',
      portfolioLevelSimplification:
        'Each scenario uses one portfolio-level blended allocation basis instead of tracking holding-level drift or rebalancing.',
      earlyDownturnSequence:
        'Early downturn keeps the steady blended yield in every year, reduces blended growth by exactly 0.20 in year 1 only, then restores steady blended growth from year 2 onward.'
    },
    steady,
    earlyDownturn
  };
}
