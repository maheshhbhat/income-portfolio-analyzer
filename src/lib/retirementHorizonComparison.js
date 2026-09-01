// Deterministic illustrative retirement-horizon comparison over one product-
// owned fixed trio of horizons. Each scenario delegates to the existing
// retirement-plan engine, so this module adds no second calculation path and
// keeps work fixed at exactly three plan computations.

import { computeRetirementPlan } from './retirement.js';

export const RETIREMENT_HORIZON_COMPARISON_SCENARIOS = Object.freeze([
  Object.freeze({ label: 'Short horizon (20 years)', horizonYears: 20 }),
  Object.freeze({ label: 'Standard horizon (30 years)', horizonYears: 30 }),
  Object.freeze({ label: 'Long horizon (40 years)', horizonYears: 40 })
]);

/**
 * @param {{investmentAmount: number, desiredAnnualWithdrawal: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 * @param {(input: {investmentAmount: number, desiredAnnualWithdrawal: number, horizonYears: number, inflationRate: number}, securities: Array<object>) => object} [computePlan]
 */
export function computeRetirementHorizonComparison(input, securities, computePlan = computeRetirementPlan) {
  const scenarios = [];

  for (const scenario of RETIREMENT_HORIZON_COMPARISON_SCENARIOS) {
    const result = computePlan(
      {
        ...input,
        horizonYears: scenario.horizonYears
      },
      securities
    );

    if (!result?.ok) {
      return result;
    }

    scenarios.push({
      label: scenario.label,
      horizonYears: scenario.horizonYears,
      result
    });
  }

  return {
    ok: true,
    scenarios
  };
}
