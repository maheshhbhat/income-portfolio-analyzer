// Verified maximum first-year legacy withdrawal with an ending-balance floor.
//
// Simplifications (disclosed, with their price):
//
// 1. The proof works against the same portfolio-level fixed-blend model used by
//    the matching projection module. Price: no per-holding drift, rebalancing,
//    or changing annual rates are modelled.
//
// 2. Regimes come from canonical thousandth-decimal security totals, not raw
//    JavaScript binary floats. Price: the pinned breakpoint count is only valid
//    for the current curated dataset and canonicalization rule.
//
// 3. Each regime contributes one analytic candidate and up to three cent checks
//    (floor, ceil, next-cent disproof). Price: if no regime yields a verified
//    winner under that bounded process, this module refuses with
//    `ok:false`/`reason:'no-verified-result'` instead of returning a guess.

import {
  buildLegacyAllocation,
  getCanonicalBreakpoints,
  getClusterShape,
  projectLegacyWithdrawal
} from './legacyWithdrawalProjection.js';

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
}

function noVerified(error, instrumentation) {
  return instrumentation
    ? { ok: false, reason: 'no-verified-result', error, instrumentation }
    : { ok: false, reason: 'no-verified-result', error };
}

const RATE_SCALE = 1000;

function canonicalRateMilli(rate) {
  return Math.round(rate * RATE_SCALE);
}

function power(base, exponent) {
  let value = 1n;
  let factor = base;
  let remaining = BigInt(exponent);
  while (remaining > 0n) {
    if (remaining % 2n === 1n) value *= factor;
    factor *= factor;
    remaining /= 2n;
  }
  return value;
}

function roundRateApplication(cents, rateMilli) {
  return Number((BigInt(cents) * BigInt(RATE_SCALE + rateMilli) * 2n + BigInt(RATE_SCALE)) / (BigInt(RATE_SCALE) * 2n));
}

function withdrawalSchedule(firstYearWithdrawalCents, horizonYears, inflationMilli) {
  const schedule = [];
  let withdrawalCents = firstYearWithdrawalCents;
  for (let year = 0; year < horizonYears; year++) {
    schedule.push(withdrawalCents);
    withdrawalCents = roundRateApplication(withdrawalCents, inflationMilli);
  }
  return schedule;
}

// This is a rational, unrounded closed form used only to choose the one
// candidate for a regime. Verification remains the rounded cent projection.
function fixedRateEndingNumerator({ startingPortfolioCents, withdrawalCents, horizonYears, inflationMilli, totalReturnMilli }) {
  const scale = BigInt(RATE_SCALE);
  const growth = scale + BigInt(totalReturnMilli);
  let numerator = BigInt(startingPortfolioCents) * power(growth, horizonYears);
  const schedule = withdrawalSchedule(withdrawalCents, horizonYears, inflationMilli);
  for (let year = 0; year < horizonYears; year++) {
    numerator -= BigInt(schedule[year]) * power(growth, horizonYears - year - 1) * power(scale, year + 1);
  }
  return numerator;
}

function solveFixedRateCandidateCents({
  startingPortfolioCents,
  horizonYears,
  inflationRate,
  desiredEndingBalanceCents,
  totalReturnRate
}) {
  const totalReturnMilli = canonicalRateMilli(totalReturnRate);
  const inflationMilli = canonicalRateMilli(inflationRate);
  const target = BigInt(desiredEndingBalanceCents) * power(BigInt(RATE_SCALE), horizonYears);
  const principal = BigInt(startingPortfolioCents) * power(BigInt(RATE_SCALE + totalReturnMilli), horizonYears);
  const unitCost = -fixedRateEndingNumerator({
    startingPortfolioCents: 0,
    withdrawalCents: 1,
    horizonYears,
    inflationMilli,
    totalReturnMilli
  });
  if (unitCost <= 0n || principal < target) return null;

  let candidate = Number((principal - target) / unitCost);
  // Rounded annual withdrawals can differ materially from a continuous
  // growing-annuity estimate at small cent values. Two fixed corrections use
  // rational cent schedules, never a cent-by-cent search or a projection.
  for (let correction = 0; correction < 2; correction++) {
    const ending = fixedRateEndingNumerator({
      startingPortfolioCents,
      withdrawalCents: candidate,
      horizonYears,
      inflationMilli,
      totalReturnMilli
    });
    const nextEnding = fixedRateEndingNumerator({
      startingPortfolioCents,
      withdrawalCents: candidate + 1,
      horizonYears,
      inflationMilli,
      totalReturnMilli
    });
    const centCost = ending - nextEnding;
    if (centCost <= 0n) break;
    candidate += Number((ending - target) / centCost);
  }
  if (!Number.isSafeInteger(candidate)) return null;
  return { floorCandidate: candidate, ceilCandidate: candidate + 1 };
}

function solveReachableRegimeCandidateCents({
  startingPortfolioCents,
  horizonYears,
  inflationRate,
  desiredEndingBalanceCents,
  minCents,
  maxCents
}) {
  const midpointRate = ((minCents + maxCents) / 2) / startingPortfolioCents;
  return solveFixedRateCandidateCents({
    startingPortfolioCents,
    horizonYears,
    inflationRate,
    desiredEndingBalanceCents,
    totalReturnRate: midpointRate
  });
}

function verifyCandidateCents(candidateCents, input, securities, regimeStats) {
  if (!Number.isSafeInteger(candidateCents) || candidateCents < 0) return null;

  regimeStats.verificationProjections += 1;
  const allocation = buildLegacyAllocation(
    {
      portfolioCents: input.startingPortfolioCents,
      withdrawalCents: candidateCents
    },
    securities
  );
  const projection = projectLegacyWithdrawal(
    {
      ...input,
      firstYearWithdrawalCents: candidateCents
    },
    allocation
  );

  return {
    candidateCents,
    allocation,
    projection,
    verified: projection.meetsEndingBalanceFloor
  };
}

function evaluateRegimeCandidate(candidate, input, securities, regimeStats, bounds) {
  const candidates = [
    ...(candidate === null
      ? []
      : [
          Math.min(bounds.maxCents, Math.max(bounds.minCents, candidate.floorCandidate)),
          Math.min(bounds.maxCents, Math.max(bounds.minCents, candidate.ceilCandidate))
        ]),
    bounds.boundaryCents
  ]
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter((candidate) => candidate >= bounds.minCents && candidate <= bounds.maxCents);

  let best = null;
  for (const candidate of candidates) {
    const result = verifyCandidateCents(candidate, input, securities, regimeStats);
    if (candidate === bounds.boundaryCents) {
      regimeStats.boundaryVerificationProjections += 1;
    }
    if (result?.verified && (best === null || result.candidateCents > best.candidateCents)) {
      best = result;
    }
  }

  if (best === null) return null;

  const nextCandidate = best.candidateCents + 1;
  if (nextCandidate < bounds.minCents || nextCandidate > bounds.maxCents) {
    return { ...best, regimeStats, nextCentVerified: false, nextCentProjection: null };
  }

  const next = verifyCandidateCents(nextCandidate, input, securities, regimeStats);
  return {
    ...best,
    regimeStats,
    nextCentVerified: next?.verified === true,
    nextCentProjection: next?.projection ?? null
  };
}

function buildRegimeBounds(breakpointsMilli, startingPortfolioCents) {
  const bounds = [];
  const breakpointCents = breakpointsMilli.map((breakpointMilli) =>
    Math.floor((breakpointMilli * startingPortfolioCents) / 1000)
  );

  bounds.push({
    index: 0,
    kind: 'constant-low',
    minCents: 0,
    maxCents: breakpointCents[0],
    boundaryCents: breakpointCents[0],
    minRate: 0,
    maxRate: breakpointsMilli[0] / 1000
  });

  for (let index = 0; index < breakpointsMilli.length - 1; index++) {
    const lowerMilli = breakpointsMilli[index];
    const upperMilli = breakpointsMilli[index + 1];
    bounds.push({
      index: index + 1,
      kind: 'reachable',
      minCents: breakpointCents[index] + 1,
      maxCents: breakpointCents[index + 1],
      boundaryCents: breakpointCents[index + 1],
      minRate: lowerMilli / 1000,
      maxRate: upperMilli / 1000
    });
  }

  bounds.push({
    index: breakpointsMilli.length,
    kind: 'constant-high',
    maxCents: Number.MAX_SAFE_INTEGER,
    minCents: breakpointCents[breakpointsMilli.length - 1] + 1,
    maxCents: Number.MAX_SAFE_INTEGER,
    boundaryCents: null,
    maxCents: Number.MAX_SAFE_INTEGER,
    minRate: breakpointsMilli[breakpointsMilli.length - 1] / 1000,
    maxRate: Infinity
  });

  return bounds;
}

export function computeLegacyWithdrawal(input, securities, options = {}) {
  const { startingPortfolioCents, horizonYears, inflationRate, desiredEndingBalanceCents } = input || {};
  const instrumentation = {
    canonicalBreakpointCount: 0,
    regimeCount: 0,
    usedPerCentSweep: false,
    regimeStats: []
  };

  if (!Number.isSafeInteger(startingPortfolioCents) || startingPortfolioCents <= 0) {
    return invalid('Enter a starting portfolio as a safe whole number of cents greater than $0.');
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    return invalid('Enter a retirement horizon of at least 1 whole year.');
  }
  if (!Number.isFinite(inflationRate) || inflationRate < 0) {
    return invalid('Enter an inflation rate of 0% or more.');
  }
  if (!Number.isSafeInteger(desiredEndingBalanceCents)) {
    return invalid('Enter a desired ending balance as a safe whole number of cents.');
  }
  if (desiredEndingBalanceCents < 0) {
    return invalid('Enter a desired ending balance of $0 or more; negative ending balances are not supported.');
  }
  if (!Array.isArray(securities) || securities.length < 2) {
    return invalid('No curated securities are available to build an allocation.');
  }

  const breakpointsMilli = getCanonicalBreakpoints(securities);
  const regimeBounds = buildRegimeBounds(breakpointsMilli, startingPortfolioCents).filter(
    (bounds) => bounds.maxCents >= bounds.minCents
  );

  instrumentation.canonicalBreakpointCount = breakpointsMilli.length;
  instrumentation.regimeCount = regimeBounds.length;

  let best = null;
  for (const bounds of regimeBounds) {
    const regimeStats = {
      index: bounds.index,
      kind: bounds.kind,
      verificationProjections: 0,
      boundaryCents: bounds.boundaryCents,
      boundaryVerificationProjections: 0
    };
    instrumentation.regimeStats.push(regimeStats);

    let candidate = null;
    if (bounds.kind === 'reachable') {
      candidate = solveReachableRegimeCandidateCents({
        startingPortfolioCents,
        horizonYears,
        inflationRate,
        desiredEndingBalanceCents,
        minCents: bounds.minCents,
        maxCents: bounds.maxCents
      });
    } else {
      const representativeRate =
        bounds.kind === 'constant-low'
          ? Math.max(0, bounds.maxRate - 0.001)
          : bounds.minRate + 0.001;
      const shape = getClusterShape(securities, representativeRate);
      candidate = solveFixedRateCandidateCents({
        startingPortfolioCents,
        horizonYears,
        inflationRate,
        desiredEndingBalanceCents,
        totalReturnRate: shape.fixedTotalRate
      });
    }

    const verified = evaluateRegimeCandidate(candidate, input, securities, regimeStats, bounds);
    if (verified === null || verified.nextCentVerified) {
      continue;
    }

    if (best === null || verified.candidateCents > best.candidateCents) {
      best = verified;
    }
  }

  if (best === null) {
    return noVerified(
      'No verified first-year withdrawal satisfied the requested ending-balance floor for these inputs.',
      options.instrument ? instrumentation : undefined
    );
  }

  const nextCentCheck =
    best.nextCentProjection === null
      ? verifyCandidateCents(best.candidateCents + 1, input, securities, best.regimeStats)
      : null;
  const nextCentVerified = nextCentCheck?.verified ?? best.nextCentVerified;
  const nextCentProjection = nextCentCheck?.projection ?? best.nextCentProjection;
  if (nextCentVerified) {
    return noVerified(
      'A verified global maximum could not be established because one cent more also satisfied the ending-balance floor.',
      options.instrument ? instrumentation : undefined
    );
  }

  const result = {
    ok: true,
    startingPortfolioCents,
    horizonYears,
    inflationRate,
    desiredEndingBalanceCents,
    maxAnnualWithdrawalCents: best.candidateCents,
    allocation: best.allocation.items,
    blendedYield: best.allocation.blendedYieldRate,
    blendedGrowth: best.allocation.blendedGrowthRate,
    blendedTotalReturn: best.allocation.blendedTotalReturnRate,
    projection: best.projection,
    nextCentProjection
  };

  if (options.instrument) {
    result.instrumentation = instrumentation;
  }

  return result;
}
