// Verified maximum sustainable first-year withdrawal for the illustrative
// curated set. Money enters and leaves this module as integer cents.
//
// Proof method: every cent from $0 through YEAR_ONE_UPPER_BOUND is simulated.
// No allocation can have a total return greater than the greatest curated
// yield + growthRate, so a withdrawal above portfolio * (1 + that return)
// depletes in year one. No cent outside the enumerated domain can survive.
// Allocation breakpoints explicitly partition the enumeration, but no
// monotonicity assumption, sampling, or bisection is used within a partition.
// This bounded proof can be expensive for very large portfolios; that is the
// price of refusing to return an unverified figure. Pure: no IO, clock,
// randomness, DOM, or provider state.

import { simulateWithdrawals, bracketAndBlend } from './retirement.js';

function metricOf(security) {
  return security.yield + security.growthRate;
}

function blendedRatesOf(items, totalDollars) {
  return {
    blendedYield: items.reduce((sum, item) => sum + item.amount * item.security.yield, 0) / totalDollars,
    blendedGrowth: items.reduce((sum, item) => sum + item.amount * item.security.growthRate, 0) / totalDollars
  };
}

function evaluateWithdrawalCents(cents, dollars, portfolioCents, horizonYears, inflationRate, securities) {
  const bracket = bracketAndBlend(dollars, securities, cents / portfolioCents, metricOf);
  const { blendedYield, blendedGrowth } = blendedRatesOf(bracket.items, dollars);
  const simulation = simulateWithdrawals({
    investmentAmount: dollars,
    desiredAnnualWithdrawal: cents / 100,
    horizonYears,
    blendedYield,
    blendedGrowth,
    inflationRate
  });
  return { survives: simulation.lastsFullHorizon, simulation, bracket, blendedYield, blendedGrowth };
}

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
}

/**
 * @param {{investmentAmountCents: number, horizonYears: number, inflationRate: number}} input
 * @param {Array<{symbol: string, name: string, type: string, yield: number, growthRate: number}>} securities
 */
export function computeMaxSustainableWithdrawal(input, securities) {
  const { investmentAmountCents, horizonYears, inflationRate } = input || {};
  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    return invalid('Enter a starting portfolio as a safe whole number of cents greater than $0.');
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) return invalid('Enter a retirement horizon of at least 1 whole year.');
  if (!Number.isFinite(inflationRate) || inflationRate < 0) return invalid('Enter an inflation rate of 0% or more.');
  if (!Array.isArray(securities) || securities.length < 2 || securities.some((s) => !s || !Number.isFinite(s.yield) || !Number.isFinite(s.growthRate))) {
    return invalid('No valid curated securities are available to build an allocation.');
  }

  const greatestTotalReturn = Math.max(...securities.map(metricOf));
  const yearOneLimit = investmentAmountCents * (1 + greatestTotalReturn);
  if (!Number.isFinite(yearOneLimit) || yearOneLimit > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: 'no-verified-result', error: 'A safe finite verification domain could not be established, so no unverified figure is shown.' };
  }
  // Inclusive ceiling may contain an extra failing cent, but cannot omit a survivor.
  const domainMaxCents = Math.max(0, Math.ceil(yearOneLimit));
  const dollars = investmentAmountCents / 100;
  const cache = new Map();
  const evaluate = (cents) => {
    if (!cache.has(cents)) cache.set(cents, evaluateWithdrawalCents(cents, dollars, investmentAmountCents, horizonYears, inflationRate, securities));
    return cache.get(cents);
  };

  // Exact/floor/ceil boundaries make the regime treatment visible, including
  // fractional-cent metric crossings caused by the fixed portfolio size.
  const boundaries = new Set([0, domainMaxCents]);
  for (const metric of new Set(securities.map(metricOf))) {
    const crossing = metric * investmentAmountCents;
    for (const point of [Math.floor(crossing), Math.ceil(crossing)]) {
      if (Number.isSafeInteger(point) && point >= 0 && point <= domainMaxCents) boundaries.add(point);
    }
  }
  const orderedBoundaries = [...boundaries].sort((a, b) => a - b);

  let bestCents = -1;
  let bestResult = null;
  for (let partition = 0; partition < orderedBoundaries.length; partition++) {
    const start = partition === 0 ? 0 : orderedBoundaries[partition - 1] + 1;
    const end = orderedBoundaries[partition];
    for (let cents = start; cents <= end; cents++) {
      const result = evaluate(cents);
      if (result.survives) {
        bestCents = cents;
        bestResult = result;
      }
    }
  }

  if (bestResult === null) {
    return { ok: false, reason: 'no-verified-result', error: 'No withdrawal, including $0, could be verified to survive the full horizon. No unverified figure is shown.' };
  }
  const next = evaluate(bestCents + 1);
  if (next.survives) {
    return { ok: false, reason: 'no-verified-result', error: 'A global maximum could not be verified, so no unverified figure is shown.' };
  }

  const allocation = bestResult.bracket.items.map((item) => ({
    symbol: item.security.symbol, name: item.security.name, type: item.security.type,
    yield: item.security.yield, growthRate: item.security.growthRate,
    totalReturn: metricOf(item.security), amountCents: Math.round(item.amount * 100),
    percentOfPortfolio: item.percentOfPortfolio
  }));
  return {
    ok: true, investmentAmountCents, horizonYears, inflationRate,
    maxAnnualWithdrawalCents: bestCents,
    blendedYield: bestResult.blendedYield, blendedGrowth: bestResult.blendedGrowth,
    blendedTotalReturn: bestResult.blendedYield + bestResult.blendedGrowth,
    allocation, projection: bestResult.simulation, nextCentFails: true,
    nextCentProjection: next.simulation
  };
}
