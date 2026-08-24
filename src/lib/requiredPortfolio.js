// Closed-form minimal starting portfolio, in integer cents, for FIXED blended
// rates: given a desired first-year withdrawal in integer cents, a horizon in
// whole years, an inflation rate, and a blended yield/growth pair, return the
// smallest starting portfolio (integer cents) whose deterministic withdrawal
// simulation lasts the full horizon at exactly those rates.
//
// Simplifications (disclosed, each with its price):
//
// 1. Portfolio-level constant blended rates. The blended yield and growth are
//    treated as constant annual rates for every year of the horizon, exactly
//    as retirement.js does. Price: no per-holding drift, rebalancing, or
//    year-over-year rate variation is modelled, so the answer is only as
//    meaningful as the constant-rate assumption behind it.
//
// 2. Float internals with integer-cent edges. The growing-annuity closed form
//    (including its rate-equals-inflation edge case) and the verifying
//    simulation both run in float arithmetic, following the disclosed
//    precedent in retirement.js; this module's own API carries money only as
//    integer cents, and cents convert to dollars solely at the call boundary
//    into the existing dollar-float simulation layer. Price: float rounding
//    can leave the closed-form candidate a hair below the true requirement,
//    so the candidate is rounded UP to whole cents, verified against
//    simulateWithdrawals at exactly the given rates, and stepped up one cent
//    at a time - each step re-verified - within a fixed 100-cent bound.
//    Exhausting the bound returns an explicit refusal, never an unverified
//    number.
//
// 3. Minimality is pinned to the given rates. "Minimal" means minimal for
//    this exact yield/growth/inflation combination. Price: a different
//    allocation, with different blended rates, could sustain the same plan
//    from a smaller portfolio; no global minimum across allocations is
//    claimed here.
//
// Pure module: no DOM, no network, no clock, no filesystem; every input
// arrives as an argument.

import { simulateWithdrawals } from './retirement.js';

// Fixed verification bound: how many one-cent steps above the closed-form
// candidate may be tried before refusing with 'no-verified-result'.
const MAX_STEP_UP_CENTS = 100;

/**
 * Smallest starting portfolio, in integer cents, that sustains the withdrawal
 * plan for the full horizon at exactly the given blended rates.
 *
 * @param {{
 *   desiredAnnualWithdrawalCents: number,
 *   horizonYears: number,
 *   inflationRate: number,
 *   blendedYield: number,
 *   blendedGrowth: number
 * }} input desiredAnnualWithdrawalCents is an integer number of cents.
 * @returns {{ok: true, requiredPortfolioCents: number}
 *   | {ok: false, reason: 'no-verified-result', error: string}}
 */
export function requiredPortfolioForRatesCents({
  desiredAnnualWithdrawalCents,
  horizonYears,
  inflationRate,
  blendedYield,
  blendedGrowth
}) {
  // Withdrawing nothing requires nothing; short-circuit before any float math.
  if (desiredAnnualWithdrawalCents === 0) {
    return { ok: true, requiredPortfolioCents: 0 };
  }

  const withdrawalDollars = desiredAnnualWithdrawalCents / 100;
  const totalReturn = blendedYield + blendedGrowth;
  const growthFactor = Math.pow(1 + totalReturn, horizonYears);

  // Future value, at the horizon, of the inflation-growing withdrawal stream
  // (the growing-annuity closed form, with the rate-equals-inflation edge
  // case handled separately). The minimal starting balance is the one whose
  // compounded value exactly covers that stream.
  const withdrawalsFutureValue =
    totalReturn === inflationRate
      ? withdrawalDollars * horizonYears * Math.pow(1 + totalReturn, horizonYears - 1)
      : (withdrawalDollars * (growthFactor - Math.pow(1 + inflationRate, horizonYears))) /
        (totalReturn - inflationRate);
  const closedFormDollars = withdrawalsFutureValue / growthFactor;

  // Round UP to whole cents, then verify; float noise in the closed form is
  // absorbed by re-verified one-cent steps within the fixed bound.
  const startCents = Math.ceil(closedFormDollars * 100);

  for (let stepUp = 0; stepUp <= MAX_STEP_UP_CENTS; stepUp++) {
    const candidateCents = startCents + stepUp;
    if (!Number.isFinite(candidateCents)) {
      // A non-finite closed form (e.g. a total return at or beyond -100%)
      // can never step to an integer-cent answer; fall through to refusal.
      break;
    }
    if (!Number.isInteger(candidateCents) || candidateCents < 0) {
      // Only a non-negative whole number of cents is a portfolio; anything
      // else fails this step's verification by definition.
      continue;
    }
    const simulation = simulateWithdrawals({
      investmentAmount: candidateCents / 100,
      desiredAnnualWithdrawal: withdrawalDollars,
      horizonYears,
      blendedYield,
      blendedGrowth,
      inflationRate
    });
    if (simulation.lastsFullHorizon) {
      return { ok: true, requiredPortfolioCents: candidateCents };
    }
  }

  return {
    ok: false,
    reason: 'no-verified-result',
    error:
      'No candidate within 100 cents of the closed-form estimate survived the ' +
      'withdrawal simulation at these rates, so no verified required portfolio ' +
      'can be reported. Re-check the blended yield, blended growth, inflation ' +
      'rate, and horizon, then try again; an unverified figure is never returned.'
  };
}
