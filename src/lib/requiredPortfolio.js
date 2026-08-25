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
// 4. Bounded five-round verified search for the rate circularity. The
//    allocation engine picks securities from the withdrawal rate, but here
//    the portfolio is the unknown, so the blended rates and the answer
//    depend on each other. computeRequiredPortfolio resolves this with at
//    most five rounds, each producing a candidate that is only returned if
//    an end-to-end re-allocation and simulation survives the full horizon.
//    Price: some inputs whose rate iteration does not settle within five
//    rounds get an explicit no-verified-result refusal even though a
//    sustainable portfolio exists; an unverified number is never returned.
//
// 5. Blended rates at a withdrawal rate are read from a fixed $1,000,000
//    notional allocation, since a rate alone does not size an allocation.
//    Price: integer-cent splitting at a different portfolio size can move
//    the blended rates by a sub-basis-point amount; the end-to-end
//    verification step absorbs this by simulating at the candidate's own
//    allocation rates.
//
// Pure module: no DOM, no network, no clock, no filesystem; every input
// arrives as an argument.

import { simulateWithdrawals, bracketAndBlend } from './retirement.js';

// Hard bound on the number of allocate/solve/verify rounds (owner directive).
const ROUND_LIMIT = 5;

// Notional dollar amount used only to read blended rates at a withdrawal
// rate; divisible enough that the cluster split has no remainder cents.
const RATE_PROBE_DOLLARS = 1000000;

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

// Blended annual rates of an allocation, computed exactly the way
// computeRetirementPlan does, so the verification simulation here matches a
// later re-run of the existing projection bit for bit.
function blendedRatesOf(items, totalDollars) {
  const blendedYield =
    items.reduce((sum, item) => sum + item.amount * item.security.yield, 0) / totalDollars;
  const blendedGrowth =
    items.reduce((sum, item) => sum + item.amount * item.security.growthRate, 0) / totalDollars;
  return { blendedYield, blendedGrowth };
}

/**
 * Bounded five-round verified solver for the required starting portfolio,
 * resolving the withdrawal-rate/allocation circularity per the revised ADR.
 *
 * All monetary values in this API are integer cents; dollars appear only at
 * the call boundaries into the existing dollar-based functions
 * (bracketAndBlend, simulateWithdrawals).
 *
 * @param {{desiredAnnualWithdrawalCents: number, horizonYears: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 * @returns {{ok: true, requiredPortfolioCents: number, blendedYield: number,
 *   blendedGrowth: number, blendedTotalReturn: number, rounds: number,
 *   allocation: Array<object>, projection: object|null}
 *   | {ok: false, reason: 'invalid-input'|'no-verified-result', error: string}}
 */
export function computeRequiredPortfolio(input, securities) {
  const { desiredAnnualWithdrawalCents, horizonYears, inflationRate } = input || {};

  if (
    typeof desiredAnnualWithdrawalCents !== 'number' ||
    !Number.isInteger(desiredAnnualWithdrawalCents) ||
    desiredAnnualWithdrawalCents < 0
  ) {
    return {
      ok: false,
      reason: 'invalid-input',
      error: 'Enter a desired annual withdrawal as a whole number of cents, $0 or more.'
    };
  }
  if (typeof horizonYears !== 'number' || !Number.isInteger(horizonYears) || horizonYears < 1) {
    return {
      ok: false,
      reason: 'invalid-input',
      error: 'Enter a retirement horizon of at least 1 whole year.'
    };
  }
  if (typeof inflationRate !== 'number' || !Number.isFinite(inflationRate) || inflationRate < 0) {
    return {
      ok: false,
      reason: 'invalid-input',
      error: 'Enter an inflation rate of 0% or more.'
    };
  }
  if (!Array.isArray(securities) || securities.length < 2) {
    return {
      ok: false,
      reason: 'invalid-input',
      error: 'No curated securities are available to build an allocation.'
    };
  }

  // Withdrawing nothing requires nothing: verified trivially, zero rounds.
  if (desiredAnnualWithdrawalCents === 0) {
    return {
      ok: true,
      requiredPortfolioCents: 0,
      blendedYield: 0,
      blendedGrowth: 0,
      blendedTotalReturn: 0,
      rounds: 0,
      allocation: [],
      projection: null
    };
  }

  const metricOf = (s) => s.yield + s.growthRate;
  const withdrawalDollars = desiredAnnualWithdrawalCents / 100;

  // Seed: the curated list's highest blended total return.
  let rate = securities.reduce((best, s) => Math.max(best, metricOf(s)), -Infinity);

  for (let round = 1; round <= ROUND_LIMIT; round++) {
    // Read the blended rates the engine would produce at this withdrawal
    // rate, using the fixed notional (simplification 5 in the header).
    const probe = bracketAndBlend(RATE_PROBE_DOLLARS, securities, rate, metricOf);
    const probeRates = blendedRatesOf(probe.items, RATE_PROBE_DOLLARS);

    const candidate = requiredPortfolioForRatesCents({
      desiredAnnualWithdrawalCents,
      horizonYears,
      inflationRate,
      blendedYield: probeRates.blendedYield,
      blendedGrowth: probeRates.blendedGrowth
    });
    if (!candidate.ok || candidate.requiredPortfolioCents <= 0) {
      // No candidate exists at these rates; the rate is unchanged, so
      // remaining rounds repeat deterministically and the loop falls
      // through to the explicit refusal below.
      continue;
    }
    const candidateCents = candidate.requiredPortfolioCents;
    const candidateDollars = candidateCents / 100;

    // Verify end-to-end: re-allocate at the candidate's implied withdrawal
    // rate and simulate the candidate at that allocation's blended rates.
    const impliedRate = withdrawalDollars / candidateDollars;
    const check = bracketAndBlend(candidateDollars, securities, impliedRate, metricOf);
    const settled = blendedRatesOf(check.items, candidateDollars);
    const projection = simulateWithdrawals({
      investmentAmount: candidateDollars,
      desiredAnnualWithdrawal: withdrawalDollars,
      horizonYears,
      blendedYield: settled.blendedYield,
      blendedGrowth: settled.blendedGrowth,
      inflationRate
    });

    if (projection.lastsFullHorizon) {
      const allocation = check.items.map((item) => ({
        symbol: item.security.symbol,
        name: item.security.name,
        type: item.security.type,
        yield: item.security.yield,
        growthRate: item.security.growthRate,
        totalReturn: metricOf(item.security),
        amountCents: Math.round(item.amount * 100),
        percentOfPortfolio: item.percentOfPortfolio
      }));
      return {
        ok: true,
        requiredPortfolioCents: candidateCents,
        blendedYield: settled.blendedYield,
        blendedGrowth: settled.blendedGrowth,
        blendedTotalReturn: settled.blendedYield + settled.blendedGrowth,
        rounds: round,
        allocation,
        projection
      };
    }

    // Unverified: the candidate's implied rate seeds the next round.
    rate = impliedRate;
  }

  return {
    ok: false,
    reason: 'no-verified-result',
    error:
      'A verified required portfolio could not be calculated within five ' +
      'rounds for these inputs. No unverified figure is ever shown; you can ' +
      'try again, or adjust the withdrawal, horizon, or inflation rate.'
  };
}
