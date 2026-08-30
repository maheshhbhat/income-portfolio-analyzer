// Core allocation engine: pure functions, no DOM/IO dependencies, so the same
// module can run in the browser and under the Node test runner.

/**
 * Bracket the investor's target rate with the securities in the curated list
 * whose metric (e.g. yield, or yield+growth) sits closest to it on either
 * side, then blend those two neighboring clusters in whatever proportion hits
 * the target exactly. Unlike a fixed "top N / bottom N by global metric"
 * split, the clusters here move with the target, so ANY curated security -
 * including metrics in the mid-range - can be selected whenever it fits the
 * blend. The same mechanism naturally produces the "best achievable"
 * allocation when the target exceeds every metric value in the list (there is
 * nothing to bracket it from above, so the nearest-below cluster is used at
 * 100%).
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function validatePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

function allocateCluster(cluster, totalCents) {
  if (cluster.length === 0) return [];
  const n = cluster.length;
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return cluster.map((security, i) => ({
    security,
    cents: base + (i < remainder ? 1 : 0)
  }));
}

function resolveBracketAndBlend(securities, targetRate, metricOf) {
  const clusterSize = Math.max(1, Math.min(5, Math.floor(securities.length / 2)));

  const ascByMetric = securities.slice().sort((a, b) => metricOf(a) - metricOf(b));
  const descByMetric = securities.slice().sort((a, b) => metricOf(b) - metricOf(a));

  const nearAbove = ascByMetric.filter((s) => metricOf(s) >= targetRate).slice(0, clusterSize);
  const nearBelow = descByMetric.filter((s) => metricOf(s) < targetRate).slice(0, clusterSize);

  const bestAchievableMetric = average(descByMetric.slice(0, clusterSize).map(metricOf));
  const unreachable = nearAbove.length === 0;

  let highCluster;
  let lowCluster;
  let w;
  if (unreachable) {
    highCluster = [];
    lowCluster = nearBelow;
    w = 0;
  } else if (nearBelow.length === 0) {
    highCluster = nearAbove;
    lowCluster = [];
    w = 1;
  } else {
    highCluster = nearAbove;
    lowCluster = nearBelow;
    const highAvg = average(highCluster.map(metricOf));
    const lowAvg = average(lowCluster.map(metricOf));
    w = highAvg === lowAvg ? 1 : clamp((targetRate - lowAvg) / (highAvg - lowAvg), 0, 1);
  }

  return {
    highCluster,
    lowCluster,
    w,
    unreachable,
    bestAchievableMetric
  };
}

export function bracketAndBlendCents(investmentAmountCents, securities, targetRate, metricOf) {
  validatePositiveSafeInteger(investmentAmountCents, 'investmentAmountCents');

  const { highCluster, lowCluster, w, unreachable, bestAchievableMetric } = resolveBracketAndBlend(
    securities,
    targetRate,
    metricOf
  );

  const highTotalCents = Math.round(investmentAmountCents * w);
  const lowTotalCents = investmentAmountCents - highTotalCents;

  const items = [
    ...allocateCluster(highCluster, highTotalCents),
    ...allocateCluster(lowCluster, lowTotalCents)
  ]
    .filter((a) => a.cents > 0)
    .map((a) => ({
      security: a.security,
      amountCents: a.cents,
      percentOfPortfolio: a.cents / investmentAmountCents
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  return { items, unreachable, bestAchievableMetric };
}

/**
 * Metric-agnostic bracket-and-blend core shared by the income allocation and
 * the total-return-based retirement allocation.
 *
 * @param {Array<object>} securities curated list
 * @param {number} targetRate the rate (as a decimal) to hit with the blend
 * @param {(security: object) => number} metricOf extracts the metric to bracket on
 * @returns {{
 *   items: Array<{security: object, amount: number, percentOfPortfolio: number}>,
 *   unreachable: boolean,
 *   bestAchievableMetric: number
 * }}
 */
export function bracketAndBlend(investmentAmount, securities, targetRate, metricOf) {
  const { highCluster, lowCluster, w, unreachable, bestAchievableMetric } = resolveBracketAndBlend(
    securities,
    targetRate,
    metricOf
  );

  const investmentCents = Math.round(investmentAmount * 100);
  const highTotalCents = Math.round(investmentCents * w);
  const lowTotalCents = investmentCents - highTotalCents;

  const combined = [
    ...allocateCluster(highCluster, highTotalCents),
    ...allocateCluster(lowCluster, lowTotalCents)
  ].filter((a) => a.cents > 0);

  const items = combined
    .map((a) => ({
      security: a.security,
      amount: a.cents / 100,
      percentOfPortfolio: a.cents / investmentCents
    }))
    .sort((a, b) => b.amount - a.amount);

  return { items, unreachable, bestAchievableMetric };
}

/**
 * @param {{investmentAmount: number, desiredAnnualIncome: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number}>} securities
 * @returns {object} result with `ok: false` and an `error` message, or `ok: true`
 *   plus the proposed allocation.
 */
export function computeAllocation(input, securities) {
  const { investmentAmount, desiredAnnualIncome } = input || {};

  if (typeof investmentAmount !== 'number' || !Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    return { ok: false, error: 'Enter an investment amount greater than $0.' };
  }
  if (typeof desiredAnnualIncome !== 'number' || !Number.isFinite(desiredAnnualIncome) || desiredAnnualIncome < 0) {
    return { ok: false, error: 'Enter a desired annual income of $0 or more.' };
  }
  if (!Array.isArray(securities) || securities.length < 2) {
    return { ok: false, error: 'No curated securities are available to build an allocation.' };
  }

  const targetYield = desiredAnnualIncome / investmentAmount;
  const { items, unreachable, bestAchievableMetric } = bracketAndBlend(
    investmentAmount,
    securities,
    targetYield,
    (s) => s.yield
  );

  const allocations = items.map((item) => ({
    symbol: item.security.symbol,
    name: item.security.name,
    type: item.security.type,
    yield: item.security.yield,
    amount: item.amount,
    percentOfPortfolio: item.percentOfPortfolio,
    annualIncome: item.amount * item.security.yield
  }));

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const estimatedAnnualIncome = allocations.reduce((sum, a) => sum + a.annualIncome, 0);
  const effectiveYield = estimatedAnnualIncome / investmentAmount;

  return {
    ok: true,
    unreachable,
    targetYield,
    investmentAmount,
    desiredAnnualIncome,
    allocations,
    totalAllocated,
    estimatedAnnualIncome,
    effectiveYield,
    bestAchievableYield: bestAchievableMetric
  };
}
