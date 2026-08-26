// Maximum sustainable first-year annual withdrawal, in integer cents, for a
// FIXED starting portfolio, horizon, and inflation rate, verified against the
// repository's illustrative curated securities only (src/data/securities.js
// or an equivalent list passed by the caller).
//
// The hard requirement (per the project ADR) is that the returned cent value
// is not a guess from a monotonicity assumption: it must be the verified
// global maximum across every reachable allocation regime this engine can
// produce for the given portfolio, and the module must prove that one more
// cent fails before returning ok:true.
//
// Simplifications (disclosed, each with its price):
//
// 1. Allocation-regime structure. bracketAndBlend selects a target rate
//    (withdrawal / portfolio) and blends the neighboring "above" and "below"
//    metric clusters to hit that rate exactly whenever it is reachable. As
//    the withdrawal changes, the target rate changes, and the specific set
//    of securities that fall in each cluster only changes at a finite set of
//    breakpoints - one per distinct yield+growthRate value in the curated
//    list, plus the single point past which the target exceeds every
//    security's metric ("unreachable": the allocation collapses to a fixed
//    top-cluster blend and stops moving with the withdrawal at all). Between
//    two consecutive breakpoints the blended rate varies continuously with
//    the withdrawal but the cluster membership itself is constant; exactly
//    AT a breakpoint the membership can jump. This is the "bracket-boundary"
//    hazard the ADR calls out: a naive single monotone search over the whole
//    withdrawal range can miss a higher survivable withdrawal on the far
//    side of a jump. Price: the search below treats each breakpoint interval
//    as its own regime and evaluates every breakpoint (and its immediate
//    cent neighbors) explicitly, rather than trusting one global sweep.
//
// 2. Verified, not closed-form, per-candidate answers. Every candidate this
//    module ever considers is checked by actually building the allocation
//    (bracketAndBlend) and running the real year-by-year simulation
//    (simulateWithdrawals) from retirement.js - the same functions
//    computeRetirementPlan uses - never a formula guess. Within a regime,
//    the search narrows toward the highest surviving cent value with a
//    bounded number of evaluations (a coarse sample pass to anchor the
//    search, then a fixed-iteration bisection). This assumes at most one
//    survive/fail transition strictly inside a single regime; the explicit
//    per-breakpoint checks (1) exist precisely to catch the case where that
//    assumption would otherwise hide a jump. Price: pathological curated
//    data with more than one transition inside a single regime could in
//    principle be missed by the coarse sample pass; this is mitigated, not
//    eliminated, by widening the sample count.
//
// 3. Final proof gate, not a claim. Whatever candidate the search settles
//    on, the module always re-verifies that candidate cent survives the
//    full horizon AND that candidate + 1 cent fails before the horizon. If
//    the +1-cent check ever unexpectedly still survives, the module keeps
//    advancing the candidate (bounded) rather than ever return a number it
//    has not itself just disproved at the next cent. If the bound is
//    exhausted without a disproof, it refuses with reason
//    'no-verified-result' instead of guessing.
//
// 4. The "unreachable" tail beyond the highest curated metric uses one
//    constant blended rate (the allocation stops changing once the target
//    exceeds every security's metric). For a fixed rate, every additional
//    cent of first-year withdrawal strictly increases every later year's
//    withdrawal by the same proportion while leaving that year's growth
//    unchanged, so survival is provably monotonic non-increasing there; the
//    domain searched is bounded generously past the highest curated metric
//    so that tail's far end always fails and can be bisected safely.
//
// Pure module: no DOM, no network, no clock, no filesystem, no randomness;
// every input arrives as an argument. Money is integer cents at this
// module's boundary (investmentAmountCents in, maxAnnualWithdrawalCents
// out); dollars appear only at the call boundary into the existing
// dollar-based bracketAndBlend / simulateWithdrawals layer.

import { simulateWithdrawals, bracketAndBlend } from './retirement.js';

// Bounded iteration counts - every loop below terminates by construction.
const SAMPLE_POINTS_PER_REGIME = 16;
const REGIME_BISECTION_ROUNDS = 50;
const MAX_CENT_REFINEMENT_ROUNDS = 500;

function metricOf(security) {
  return security.yield + security.growthRate;
}

function blendedRatesOf(items, totalDollars) {
  if (items.length === 0 || totalDollars === 0) {
    return { blendedYield: 0, blendedGrowth: 0 };
  }
  const blendedYield = items.reduce((sum, item) => sum + item.amount * item.security.yield, 0) / totalDollars;
  const blendedGrowth = items.reduce((sum, item) => sum + item.amount * item.security.growthRate, 0) / totalDollars;
  return { blendedYield, blendedGrowth };
}

// Build and simulate the allocation for one candidate first-year withdrawal,
// in integer cents. This is the sole oracle the search below ever consults.
function evaluateWithdrawalCents(withdrawalCents, investmentAmountDollars, investmentAmountCents, horizonYears, inflationRate, securities) {
  const withdrawalDollars = withdrawalCents / 100;
  const targetRate = withdrawalCents / investmentAmountCents;
  const bracket = bracketAndBlend(investmentAmountDollars, securities, targetRate, metricOf);
  const { blendedYield, blendedGrowth } = blendedRatesOf(bracket.items, investmentAmountDollars);
  const simulation = simulateWithdrawals({
    investmentAmount: investmentAmountDollars,
    desiredAnnualWithdrawal: withdrawalDollars,
    horizonYears,
    blendedYield,
    blendedGrowth,
    inflationRate
  });
  return { survives: simulation.lastsFullHorizon, simulation, bracket, blendedYield, blendedGrowth };
}

/**
 * @param {{investmentAmountCents: number, horizonYears: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 * @returns {{ok: true, investmentAmountCents: number, horizonYears: number, inflationRate: number,
 *   maxAnnualWithdrawalCents: number, blendedYield: number, blendedGrowth: number,
 *   blendedTotalReturn: number, allocation: Array<object>, projection: object,
 *   nextCentFails: true, nextCentProjection: object}
 *   | {ok: false, reason: 'invalid-input'|'no-verified-result', error: string}}
 */
export function computeMaxSustainableWithdrawal(input, securities) {
  const { investmentAmountCents, horizonYears, inflationRate } = input || {};

  if (
    typeof investmentAmountCents !== 'number' ||
    !Number.isInteger(investmentAmountCents) ||
    investmentAmountCents <= 0
  ) {
    return {
      ok: false,
      reason: 'invalid-input',
      error: 'Enter a starting portfolio as a whole number of cents greater than $0.'
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

  const investmentAmountDollars = investmentAmountCents / 100;

  const evalCache = new Map();
  function evalAt(cents) {
    const c = Math.max(0, Math.round(cents));
    if (evalCache.has(c)) return evalCache.get(c);
    const result = evaluateWithdrawalCents(
      c,
      investmentAmountDollars,
      investmentAmountCents,
      horizonYears,
      inflationRate,
      securities
    );
    evalCache.set(c, result);
    return result;
  }

  // Bracket-regime breakpoints: one per distinct curated metric, converted
  // to the withdrawal-cents value at which target rate == that metric,
  // plus a domain ceiling generously past the highest metric (see
  // simplification 4) so the flat unreachable tail's far end is provably a
  // failure and can be bisected down safely.
  const uniqueMetrics = Array.from(new Set(securities.map(metricOf))).sort((a, b) => a - b);
  const interiorBreakpoints = uniqueMetrics
    .map((m) => Math.round(m * investmentAmountCents))
    .filter((c) => c > 0);
  const maxBreakpoint = interiorBreakpoints.length ? interiorBreakpoints[interiorBreakpoints.length - 1] : 0;
  const domainMaxCents = Math.max(investmentAmountCents * 3, maxBreakpoint + investmentAmountCents, investmentAmountCents + 1);

  const boundaryCents = Array.from(
    new Set([0, ...interiorBreakpoints.filter((c) => c <= domainMaxCents), domainMaxCents])
  ).sort((a, b) => a - b);

  // Withdrawal 0 survives whenever the blended rate at that point is not
  // itself ruinous (a curated total return at or below -100% can collapse
  // the balance from "growth" alone, before any withdrawal - see the
  // no-verified-result refusal path below). It is not assumed to survive.
  let bestCents = 0;
  let bestResult = evalAt(0);
  let anySurvivingCandidate = bestResult.survives;

  // Explicit bracket-boundary checks: every regime breakpoint and its
  // immediate cent neighbors, where cluster membership can jump.
  for (const bp of boundaryCents) {
    for (const probe of [bp - 1, bp, bp + 1]) {
      if (probe < 0) continue;
      const r = evalAt(probe);
      if (r.survives) {
        anySurvivingCandidate = true;
        if (probe > bestCents || !bestResult.survives) {
          bestCents = probe;
          bestResult = r;
        }
      }
    }
  }

  // Per-regime coarse sample pass plus bounded bisection, entirely against
  // the real allocation + simulation engine (never a closed-form guess).
  for (let i = 0; i < boundaryCents.length - 1; i++) {
    const lo = boundaryCents[i];
    const hi = boundaryCents[i + 1];
    if (hi <= lo) continue;

    let sampleSurvive = lo;
    for (let s = 0; s <= SAMPLE_POINTS_PER_REGIME; s++) {
      const cents = lo + Math.round(((hi - lo) * s) / SAMPLE_POINTS_PER_REGIME);
      const r = evalAt(cents);
      if (r.survives && cents > sampleSurvive) sampleSurvive = cents;
    }

    let survivePoint = sampleSurvive;
    let failPoint = hi;
    if (evalAt(hi).survives) {
      // The regime survives up to its upper bound at sample resolution; the
      // next regime (or the final refinement pass below) carries the search
      // forward from there.
      survivePoint = hi;
      failPoint = null;
    }

    if (failPoint !== null) {
      for (let round = 0; round < REGIME_BISECTION_ROUNDS && failPoint - survivePoint > 1; round++) {
        const mid = survivePoint + Math.floor((failPoint - survivePoint) / 2);
        if (evalAt(mid).survives) {
          survivePoint = mid;
        } else {
          failPoint = mid;
        }
      }
    }

    const r = evalAt(survivePoint);
    if (r.survives) {
      anySurvivingCandidate = true;
      if (survivePoint > bestCents || !bestResult.survives) {
        bestCents = survivePoint;
        bestResult = r;
      }
    }
  }

  // No withdrawal at all - not even zero - survives at any cent value this
  // search evaluated: refuse rather than expose a non-surviving "maximum".
  if (!anySurvivingCandidate || !bestResult.survives) {
    return {
      ok: false,
      reason: 'no-verified-result',
      error:
        'No withdrawal, including $0, could be verified to survive the full horizon for ' +
        'these inputs. No unverified figure is ever shown; try again, or adjust the ' +
        'portfolio, horizon, or inflation rate.'
    };
  }

  // Final maximality proof: the returned figure is never shown unless one
  // more cent has just been shown, by direct simulation, to fail.
  let refineRounds = 0;
  while (evalAt(bestCents + 1).survives && refineRounds < MAX_CENT_REFINEMENT_ROUNDS) {
    bestCents += 1;
    bestResult = evalAt(bestCents);
    refineRounds += 1;
  }

  const proofNextCent = evalAt(bestCents + 1);
  if (proofNextCent.survives) {
    return {
      ok: false,
      reason: 'no-verified-result',
      error:
        'A verified maximum sustainable withdrawal could not be established within the ' +
        'bounded search for these inputs. No unverified figure is ever shown; try again, ' +
        'or adjust the portfolio, horizon, or inflation rate.'
    };
  }

  const allocation = bestResult.bracket.items.map((item) => ({
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
    investmentAmountCents,
    horizonYears,
    inflationRate,
    maxAnnualWithdrawalCents: bestCents,
    blendedYield: bestResult.blendedYield,
    blendedGrowth: bestResult.blendedGrowth,
    blendedTotalReturn: bestResult.blendedYield + bestResult.blendedGrowth,
    allocation,
    projection: bestResult.simulation,
    nextCentFails: true,
    nextCentProjection: proofNextCent.simulation
  };
}
