// Cent-exact allocation and projection helpers for the legacy withdrawal
// solver.
//
// Simplifications (disclosed, with their price):
//
// 1. Portfolio-level fixed blended rates. The projection keeps the initial
//    exact-cent allocation weights fixed for the full horizon and applies one
//    blended yield rate and one blended growth rate to the whole portfolio
//    each year. Price: no per-holding drift, rebalancing, or changing rates
//    are modelled.
//
// 2. Product-owned thousandth-decimal rates. Each security's yield and growth
//    literal is canonicalized to a whole number of thousandths before any
//    breakpoint or blend math. Price: if the curated dataset later needs finer
//    precision, this module and its pinned tests must change deliberately.
//
// 3. Integer cents throughout the accepted path. All balances, allocations,
//    withdrawals, dividends, and growth amounts are stored as whole cents, and
//    every rate application is rounded to the nearest cent immediately. Price:
//    cent rounding can shift the projection by a few cents relative to an
//    unrounded float model, so verification is always done against this exact
//    cent path.

export const CANONICAL_RATE_SCALE = 1000;

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToNearestCent(value) {
  return Math.round(value);
}

function allocateCluster(cluster, totalCents) {
  if (cluster.length === 0 || totalCents <= 0) return [];

  const base = Math.floor(totalCents / cluster.length);
  const remainder = totalCents - base * cluster.length;

  return cluster.map((security, index) => ({
    security,
    amountCents: base + (index < remainder ? 1 : 0)
  }));
}

function sortByMetricAscending(securities) {
  return securities.slice().sort((left, right) => {
    if (left.totalReturnMilli !== right.totalReturnMilli) {
      return left.totalReturnMilli - right.totalReturnMilli;
    }
    return left.symbol.localeCompare(right.symbol);
  });
}

function sortByMetricDescending(securities) {
  return securities.slice().sort((left, right) => {
    if (left.totalReturnMilli !== right.totalReturnMilli) {
      return right.totalReturnMilli - left.totalReturnMilli;
    }
    return left.symbol.localeCompare(right.symbol);
  });
}

export function canonicalizeRate(rate) {
  return Math.round(rate * CANONICAL_RATE_SCALE);
}

export function canonicalizeSecurity(security) {
  return Object.freeze({
    ...security,
    yieldMilli: canonicalizeRate(security.yield),
    growthMilli: canonicalizeRate(security.growthRate),
    totalReturnMilli: canonicalizeRate(security.yield) + canonicalizeRate(security.growthRate)
  });
}

export function getCanonicalBreakpoints(securities) {
  return [...new Set(securities.map((security) => canonicalizeSecurity(security).totalReturnMilli))].sort((a, b) => a - b);
}

export function getClusterShape(securities, targetRate) {
  const canonicalSecurities = securities.map(canonicalizeSecurity);
  const clusterSize = Math.max(1, Math.min(5, Math.floor(canonicalSecurities.length / 2)));
  const targetMilli = targetRate * CANONICAL_RATE_SCALE;

  const ascending = sortByMetricAscending(canonicalSecurities);
  const descending = sortByMetricDescending(canonicalSecurities);
  const nearAbove = ascending
    .filter((security) => security.totalReturnMilli >= targetMilli)
    .slice(0, clusterSize);
  const nearBelow = descending
    .filter((security) => security.totalReturnMilli < targetMilli)
    .slice(0, clusterSize);

  if (nearAbove.length === 0) {
    const fixedTotalMilli = average(nearBelow.map((security) => security.totalReturnMilli));
    return {
      kind: 'constant-high',
      highCluster: [],
      lowCluster: nearBelow,
      highWeight: 0,
      fixedTotalRate: fixedTotalMilli / CANONICAL_RATE_SCALE,
      lowerBoundMilli: nearBelow.length === 0 ? -Infinity : nearBelow[0].totalReturnMilli,
      upperBoundMilli: Infinity
    };
  }

  if (nearBelow.length === 0) {
    const fixedTotalMilli = average(nearAbove.map((security) => security.totalReturnMilli));
    return {
      kind: 'constant-low',
      highCluster: nearAbove,
      lowCluster: [],
      highWeight: 1,
      fixedTotalRate: fixedTotalMilli / CANONICAL_RATE_SCALE,
      lowerBoundMilli: -Infinity,
      upperBoundMilli: nearAbove[0].totalReturnMilli
    };
  }

  const highAverageTotalMilli = average(nearAbove.map((security) => security.totalReturnMilli));
  const lowAverageTotalMilli = average(nearBelow.map((security) => security.totalReturnMilli));
  const highWeight =
    highAverageTotalMilli === lowAverageTotalMilli
      ? 1
      : Math.min(1, Math.max(0, (targetMilli - lowAverageTotalMilli) / (highAverageTotalMilli - lowAverageTotalMilli)));

  return {
    kind: 'reachable',
    highCluster: nearAbove,
    lowCluster: nearBelow,
    highWeight,
    fixedTotalRate: null,
    lowerBoundMilli: lowAverageTotalMilli,
    upperBoundMilli: highAverageTotalMilli
  };
}

export function buildLegacyAllocation({ portfolioCents, withdrawalCents }, securities) {
  const targetRate = portfolioCents === 0 ? 0 : withdrawalCents / portfolioCents;
  const shape = getClusterShape(securities, targetRate);
  const highTotalCents = roundToNearestCent(portfolioCents * shape.highWeight);
  const lowTotalCents = portfolioCents - highTotalCents;

  const combined = [
    ...allocateCluster(shape.highCluster, highTotalCents),
    ...allocateCluster(shape.lowCluster, lowTotalCents)
  ]
    .filter((item) => item.amountCents > 0)
    .sort((left, right) => right.amountCents - left.amountCents || left.security.symbol.localeCompare(right.security.symbol));

  const blendedYieldNumerator = combined.reduce(
    (sum, item) => sum + item.amountCents * item.security.yieldMilli,
    0
  );
  const blendedGrowthNumerator = combined.reduce(
    (sum, item) => sum + item.amountCents * item.security.growthMilli,
    0
  );
  const denominator = portfolioCents * CANONICAL_RATE_SCALE;

  return {
    items: combined.map((item) => ({
      symbol: item.security.symbol,
      name: item.security.name,
      type: item.security.type,
      yield: item.security.yield,
      growthRate: item.security.growthRate,
      totalReturn: item.security.totalReturnMilli / CANONICAL_RATE_SCALE,
      amountCents: item.amountCents,
      percentOfPortfolio: portfolioCents === 0 ? 0 : item.amountCents / portfolioCents
    })),
    blendedYieldRate: denominator === 0 ? 0 : blendedYieldNumerator / denominator,
    blendedGrowthRate: denominator === 0 ? 0 : blendedGrowthNumerator / denominator,
    blendedTotalReturnRate: denominator === 0 ? 0 : (blendedYieldNumerator + blendedGrowthNumerator) / denominator
  };
}

export function projectLegacyWithdrawal(input, allocation) {
  const {
    startingPortfolioCents,
    firstYearWithdrawalCents,
    horizonYears,
    inflationRate,
    desiredEndingBalanceCents = 0
  } = input;

  const yearlyInflationFactor = 1 + inflationRate;
  const years = [];
  let balanceCents = startingPortfolioCents;
  let withdrawalCents = firstYearWithdrawalCents;
  let depletionYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    const dividendIncomeCents = roundToNearestCent(balanceCents * allocation.blendedYieldRate);
    const growthAmountCents = roundToNearestCent(balanceCents * allocation.blendedGrowthRate);
    const grownBalanceCents = balanceCents + dividendIncomeCents + growthAmountCents;

    if (grownBalanceCents < withdrawalCents) {
      const withdrawalPaidCents = Math.max(0, grownBalanceCents);
      const dividendPortionCents = Math.min(dividendIncomeCents, withdrawalPaidCents);
      years.push({
        year,
        startingBalanceCents: balanceCents,
        dividendIncomeCents,
        growthAmountCents,
        withdrawalRequestedCents: withdrawalCents,
        withdrawalPaidCents,
        dividendPortionCents,
        sharesSoldPortionCents: withdrawalPaidCents - dividendPortionCents,
        endingBalanceCents: 0
      });
      depletionYear = year;
      balanceCents = 0;
      break;
    }

    const endingBalanceCents = grownBalanceCents - withdrawalCents;
    const dividendPortionCents = Math.min(dividendIncomeCents, withdrawalCents);
    years.push({
      year,
      startingBalanceCents: balanceCents,
      dividendIncomeCents,
      growthAmountCents,
      withdrawalRequestedCents: withdrawalCents,
      withdrawalPaidCents: withdrawalCents,
      dividendPortionCents,
      sharesSoldPortionCents: withdrawalCents - dividendPortionCents,
      endingBalanceCents
    });

    balanceCents = endingBalanceCents;
    withdrawalCents = roundToNearestCent(withdrawalCents * yearlyInflationFactor);
  }

  return {
    years,
    depletionYear,
    endingBalanceCents: balanceCents,
    lastsFullHorizon: depletionYear === null,
    meetsEndingBalanceFloor: depletionYear === null && balanceCents >= desiredEndingBalanceCents
  };
}
