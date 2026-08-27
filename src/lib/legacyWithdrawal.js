import {
  applyCanonicalReturnRate,
  canonicalizeReturnRate,
  projectLegacyWithdrawal
} from './legacyWithdrawalProjection.js';

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
}

function noVerifiedResult(error) {
  return { ok: false, reason: 'no-verified-result', error };
}

function metricOf(security) {
  return security.yield + security.growthRate;
}

function validateSecurity(security) {
  return Boolean(
    security &&
    typeof security.symbol === 'string' &&
    security.symbol.trim() &&
    typeof security.name === 'string' &&
    security.name.trim() &&
    typeof security.type === 'string' &&
    security.type.trim() &&
    Number.isFinite(security.yield) &&
    Number.isFinite(security.growthRate)
  );
}

function compareSecurity(a, b) {
  return a.symbol.localeCompare(b.symbol) || a.name.localeCompare(b.name);
}

function buildEqualSplitAllocation(investmentAmountCents, securities, canonicalReturnRate) {
  const sorted = securities.slice().sort(compareSecurity);
  const base = Math.floor(investmentAmountCents / sorted.length);
  const remainder = investmentAmountCents - base * sorted.length;

  return sorted.map((security, index) => {
    const amountCents = base + (index < remainder ? 1 : 0);
    return {
      symbol: security.symbol,
      name: security.name,
      type: security.type,
      yield: security.yield,
      growthRate: security.growthRate,
      canonicalReturnRate,
      amountCents,
      percentOfPortfolio: amountCents / investmentAmountCents
    };
  }).filter((line) => line.amountCents > 0);
}

export function buildLegacyWithdrawalCatalog(securities, investmentAmountCents) {
  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    throw new TypeError('investmentAmountCents must be a safe integer greater than zero.');
  }
  if (!Array.isArray(securities) || securities.length < 1 || !securities.every(validateSecurity)) {
    throw new TypeError('securities must be a non-empty array of valid curated securities.');
  }

  const byCanonicalRate = new Map();
  for (const security of securities) {
    const canonicalReturnRate = canonicalizeReturnRate(metricOf(security));
    const existing = byCanonicalRate.get(canonicalReturnRate) ?? [];
    existing.push(security);
    byCanonicalRate.set(canonicalReturnRate, existing);
  }

  return [...byCanonicalRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([canonicalReturnRate, group]) => ({
      canonicalReturnRate,
      totalReturn: canonicalReturnRate / 1000,
      securities: group.slice().sort(compareSecurity).map((security) => ({
        symbol: security.symbol,
        name: security.name,
        type: security.type,
        yield: security.yield,
        growthRate: security.growthRate
      })),
      allocation: buildEqualSplitAllocation(investmentAmountCents, group, canonicalReturnRate)
    }));
}

export function computeLegacyWithdrawalUpperBound(investmentAmountCents, catalogEntry) {
  const yearOneReturnCents = applyCanonicalReturnRate(investmentAmountCents, catalogEntry.canonicalReturnRate);
  const upperBoundCents = investmentAmountCents + yearOneReturnCents;
  return Math.max(0, upperBoundCents);
}

function verifyFixedAllocation({
  investmentAmountCents,
  annualWithdrawalCents,
  horizonYears,
  inflationRate,
  endingBalanceFloorCents,
  catalogEntry
}) {
  const projection = projectLegacyWithdrawal({
    investmentAmountCents,
    annualWithdrawalCents,
    horizonYears,
    inflationRate,
    endingBalanceFloorCents,
    catalogEntry
  });

  if (!projection.ok) {
    return projection;
  }

  return {
    ok: true,
    annualWithdrawalCents,
    catalogEntry,
    projection,
    verified: projection.meetsEndingBalanceFloor
  };
}

export function searchLegacyWithdrawalCatalogEntry(input, catalogEntry, instrumentation) {
  const { investmentAmountCents, horizonYears, inflationRate, endingBalanceFloorCents } = input;
  const upperBoundCents = computeLegacyWithdrawalUpperBound(investmentAmountCents, catalogEntry);
  const evaluations = new Map();

  instrumentation?.onEntry?.({
    canonicalReturnRate: catalogEntry.canonicalReturnRate,
    upperBoundCents
  });

  const evaluate = (annualWithdrawalCents) => {
    const key = annualWithdrawalCents;
    if (!evaluations.has(key)) {
      instrumentation?.onEvaluate?.({
        canonicalReturnRate: catalogEntry.canonicalReturnRate,
        annualWithdrawalCents
      });
      evaluations.set(key, verifyFixedAllocation({
        investmentAmountCents,
        annualWithdrawalCents,
        horizonYears,
        inflationRate,
        endingBalanceFloorCents,
        catalogEntry
      }));
    }

    return evaluations.get(key);
  };

  let low = 0;
  let high = upperBoundCents;
  let best = null;

  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    instrumentation?.onProbe?.({
      canonicalReturnRate: catalogEntry.canonicalReturnRate,
      low,
      high,
      mid
    });
    const result = evaluate(mid);
    if (!result.ok) {
      return result;
    }

    if (result.verified) {
      best = result;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const bestWithdrawalCents = best?.annualWithdrawalCents ?? 0;
  const bestVerification = evaluate(bestWithdrawalCents);
  if (!bestVerification.ok) {
    return bestVerification;
  }

  const nextVerification = evaluate(bestWithdrawalCents + 1);
  if (!nextVerification.ok) {
    return nextVerification;
  }

  instrumentation?.onVerified?.({
    canonicalReturnRate: catalogEntry.canonicalReturnRate,
    bestWithdrawalCents,
    nextWithdrawalCents: bestWithdrawalCents + 1,
    bestVerified: bestVerification.verified,
    nextVerified: nextVerification.verified,
    evaluationCount: evaluations.size
  });

  return {
    ok: true,
    catalogEntry,
    upperBoundCents,
    maxAnnualWithdrawalCents: bestWithdrawalCents,
    projection: bestVerification.projection,
    nextCentProjection: nextVerification.projection,
    verified: bestVerification.verified,
    nextCentVerified: nextVerification.verified,
    evaluationCount: evaluations.size
  };
}

export function computeLegacyWithdrawal(input, securities, options = {}) {
  const { investmentAmountCents, horizonYears, inflationRate, endingBalanceFloorCents = 0 } = input || {};

  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    return invalid('Enter a starting portfolio as a safe whole number of cents greater than $0.');
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    return invalid('Enter a retirement horizon of at least 1 whole year.');
  }
  if (!Number.isFinite(inflationRate) || inflationRate < 0) {
    return invalid('Enter an inflation rate of 0% or more.');
  }
  if (!Number.isSafeInteger(endingBalanceFloorCents) || endingBalanceFloorCents < 0) {
    return invalid('Enter a desired ending balance as a safe whole number of cents of $0 or more.');
  }
  if (!Array.isArray(securities) || securities.length < 2 || !securities.every(validateSecurity)) {
    return invalid('No valid curated securities are available to build the fixed allocation catalog.');
  }

  const catalog = buildLegacyWithdrawalCatalog(securities, investmentAmountCents);
  const instrumentation = options.instrumentation;
  let winner = null;
  const contenders = [];

  for (const catalogEntry of catalog) {
    const candidate = searchLegacyWithdrawalCatalogEntry(
      { investmentAmountCents, horizonYears, inflationRate, endingBalanceFloorCents },
      catalogEntry,
      instrumentation
    );
    if (!candidate.ok) {
      return candidate;
    }

    contenders.push(candidate);
    if (candidate.verified && !candidate.nextCentVerified) {
      if (winner === null || candidate.maxAnnualWithdrawalCents > winner.maxAnnualWithdrawalCents) {
        winner = candidate;
      }
    }
  }

  if (winner === null) {
    return noVerifiedResult('No catalog allocation could verify the requested ending-balance floor. No unverified withdrawal is shown.');
  }

  return {
    ok: true,
    investmentAmountCents,
    horizonYears,
    inflationRate,
    endingBalanceFloorCents,
    maxAnnualWithdrawalCents: winner.maxAnnualWithdrawalCents,
    allocation: winner.catalogEntry.allocation,
    catalogEntry: {
      canonicalReturnRate: winner.catalogEntry.canonicalReturnRate,
      totalReturn: winner.catalogEntry.totalReturn,
      securities: winner.catalogEntry.securities
    },
    projection: winner.projection,
    nextCentProjection: winner.nextCentProjection,
    catalogSize: catalog.length,
    contenders: options.includeContenders ? contenders.map((candidate) => ({
      canonicalReturnRate: candidate.catalogEntry.canonicalReturnRate,
      totalReturn: candidate.catalogEntry.totalReturn,
      maxAnnualWithdrawalCents: candidate.maxAnnualWithdrawalCents,
      verified: candidate.verified,
      nextCentVerified: candidate.nextCentVerified,
      upperBoundCents: candidate.upperBoundCents,
      evaluationCount: candidate.evaluationCount
    })) : undefined
  };
}
