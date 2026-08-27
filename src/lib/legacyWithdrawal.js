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

function fixedRateEndingBalanceCents({
  startingPortfolioCents,
  withdrawalCents,
  horizonYears,
  inflationRate,
  totalReturnRate
}) {
  const grownPrincipal = startingPortfolioCents * Math.pow(1 + totalReturnRate, horizonYears);

  if (totalReturnRate === inflationRate) {
    const stream = withdrawalCents * horizonYears * Math.pow(1 + totalReturnRate, horizonYears - 1);
    return grownPrincipal - stream;
  }

  const stream =
    (withdrawalCents * (Math.pow(1 + totalReturnRate, horizonYears) - Math.pow(1 + inflationRate, horizonYears))) /
    (totalReturnRate - inflationRate);

  return grownPrincipal - stream;
}

function solveFixedRateCandidateCents({
  startingPortfolioCents,
  horizonYears,
  inflationRate,
  desiredEndingBalanceCents,
  totalReturnRate
}) {
  if (totalReturnRate === inflationRate) {
    const denominator = horizonYears * Math.pow(1 + totalReturnRate, horizonYears - 1);
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    return (startingPortfolioCents * Math.pow(1 + totalReturnRate, horizonYears) - desiredEndingBalanceCents) / denominator;
  }

  const numerator = startingPortfolioCents * Math.pow(1 + totalReturnRate, horizonYears) - desiredEndingBalanceCents;
  const denominator =
    (Math.pow(1 + totalReturnRate, horizonYears) - Math.pow(1 + inflationRate, horizonYears)) /
    (totalReturnRate - inflationRate);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function solveReachableRegimeCandidateCents({
  startingPortfolioCents,
  horizonYears,
  inflationRate,
  desiredEndingBalanceCents,
  minRate,
  maxRate
}) {
  const epsilon = 1 / (startingPortfolioCents * 10);
  const lowerRate = Math.max(0, minRate);
  const upperRate = Math.max(lowerRate, maxRate - epsilon);
  const lowerWithdrawal = lowerRate * startingPortfolioCents;
  const upperWithdrawal = upperRate * startingPortfolioCents;

  const lowerEnding = fixedRateEndingBalanceCents({
    startingPortfolioCents,
    withdrawalCents: lowerWithdrawal,
    horizonYears,
    inflationRate,
    totalReturnRate: lowerRate
  });
  const upperEnding = fixedRateEndingBalanceCents({
    startingPortfolioCents,
    withdrawalCents: upperWithdrawal,
    horizonYears,
    inflationRate,
    totalReturnRate: upperRate
  });

  if (!Number.isFinite(lowerEnding) || lowerEnding < desiredEndingBalanceCents) {
    return null;
  }
  if (Number.isFinite(upperEnding) && upperEnding >= desiredEndingBalanceCents) {
    return upperWithdrawal;
  }

  let left = lowerRate;
  let right = upperRate;
  for (let step = 0; step < 80; step++) {
    const middle = (left + right) / 2;
    const middleWithdrawal = middle * startingPortfolioCents;
    const middleEnding = fixedRateEndingBalanceCents({
      startingPortfolioCents,
      withdrawalCents: middleWithdrawal,
      horizonYears,
      inflationRate,
      totalReturnRate: middle
    });

    if (!Number.isFinite(middleEnding) || middleEnding < desiredEndingBalanceCents) {
      right = middle;
    } else {
      left = middle;
    }
  }

  return left * startingPortfolioCents;
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

function evaluateRegimeCandidate(candidateFloat, input, securities, regimeStats, bounds) {
  if (!Number.isFinite(candidateFloat)) return null;

  const clamped = Math.min(bounds.maxCents, Math.max(bounds.minCents, candidateFloat));
  const floorCandidate = Math.floor(clamped);
  const ceilCandidate = Math.ceil(clamped);
  const candidates = [floorCandidate, ceilCandidate]
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter((candidate) => candidate >= bounds.minCents && candidate <= bounds.maxCents);

  let best = null;
  for (const candidate of candidates) {
    const result = verifyCandidateCents(candidate, input, securities, regimeStats);
    if (result?.verified && (best === null || result.candidateCents > best.candidateCents)) {
      best = result;
    }
  }

  if (best === null) return null;

  const nextCandidate = best.candidateCents + 1;
  if (nextCandidate < bounds.minCents || nextCandidate > bounds.maxCents) {
    return { ...best, nextCentVerified: false, nextCentProjection: null };
  }

  const next = verifyCandidateCents(nextCandidate, input, securities, regimeStats);
  return {
    ...best,
    nextCentVerified: next?.verified === true,
    nextCentProjection: next?.projection ?? null
  };
}

function buildRegimeBounds(breakpointsMilli, startingPortfolioCents) {
  const bounds = [];

  bounds.push({
    index: 0,
    kind: 'constant-low',
    minCents: 0,
    maxCents: Math.floor((breakpointsMilli[0] * startingPortfolioCents) / 1000),
    minRate: 0,
    maxRate: breakpointsMilli[0] / 1000
  });

  for (let index = 0; index < breakpointsMilli.length - 1; index++) {
    const lowerMilli = breakpointsMilli[index];
    const upperMilli = breakpointsMilli[index + 1];
    bounds.push({
      index: index + 1,
      kind: 'reachable',
      minCents: Math.floor((lowerMilli * startingPortfolioCents) / 1000) + 1,
      maxCents: Math.floor((upperMilli * startingPortfolioCents) / 1000),
      minRate: lowerMilli / 1000,
      maxRate: upperMilli / 1000
    });
  }

  bounds.push({
    index: breakpointsMilli.length,
    kind: 'constant-high',
    minCents: Math.floor((breakpointsMilli[breakpointsMilli.length - 1] * startingPortfolioCents) / 1000) + 1,
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
      verificationProjections: 0
    };
    instrumentation.regimeStats.push(regimeStats);

    let candidateFloat = null;
    if (bounds.kind === 'reachable') {
      candidateFloat = solveReachableRegimeCandidateCents({
        startingPortfolioCents,
        horizonYears,
        inflationRate,
        desiredEndingBalanceCents,
        minRate: bounds.minRate,
        maxRate: bounds.maxRate
      });
    } else {
      const representativeRate =
        bounds.kind === 'constant-low'
          ? Math.max(0, bounds.maxRate - 0.001)
          : bounds.minRate + 0.001;
      const shape = getClusterShape(securities, representativeRate);
      candidateFloat = solveFixedRateCandidateCents({
        startingPortfolioCents,
        horizonYears,
        inflationRate,
        desiredEndingBalanceCents,
        totalReturnRate: shape.fixedTotalRate
      });
    }

    const verified = evaluateRegimeCandidate(candidateFloat, input, securities, regimeStats, bounds);
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

  const nextCentCheck = verifyCandidateCents(
    best.candidateCents + 1,
    input,
    securities,
    { verificationProjections: 0 }
  );
  if (nextCentCheck?.verified) {
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
    nextCentProjection: nextCentCheck?.projection ?? best.nextCentProjection
  };

  if (options.instrument) {
    result.instrumentation = instrumentation;
  }

  return result;
}
