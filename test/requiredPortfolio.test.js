import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiredPortfolioForRatesCents } from '../src/lib/requiredPortfolio.js';
import { simulateWithdrawals } from '../src/lib/retirement.js';

// Same closed form as test/retirement.test.js: future value of a growing
// annuity (n withdrawals of W, W*(1+g), ... compounded forward to year n at
// rate r), used to independently cross-check the solver.
function growingAnnuityFutureValue(withdrawal, rate, growth, n) {
  if (n === 0) return 0;
  if (rate === growth) return withdrawal * n * Math.pow(1 + rate, n - 1);
  return (withdrawal * (Math.pow(1 + rate, n) - Math.pow(1 + growth, n))) / (rate - growth);
}

// Exact minimal starting balance in dollars: the portfolio whose compounded
// value at the horizon exactly covers the withdrawal stream's future value.
function closedFormRequiredDollars({ withdrawalDollars, horizonYears, inflationRate, totalReturn }) {
  return (
    growingAnnuityFutureValue(withdrawalDollars, totalReturn, inflationRate, horizonYears) /
    Math.pow(1 + totalReturn, horizonYears)
  );
}

// A representative sustained-withdrawal case: $40,000/yr for 30 years at 3%
// inflation against a 3% yield + 4% growth blend.
const CASE_A = {
  desiredAnnualWithdrawalCents: 4000000,
  horizonYears: 30,
  inflationRate: 0.03,
  blendedYield: 0.03,
  blendedGrowth: 0.04
};

// Rate-equals-inflation edge case: inflation forced to exactly the blended
// total return, mirroring the r == g test in test/retirement.test.js.
const EQUAL_RATES_TOTAL = 0.03 + 0.02;
const CASE_EQUAL_RATES = {
  desiredAnnualWithdrawalCents: 600000,
  horizonYears: 12,
  inflationRate: EQUAL_RATES_TOTAL,
  blendedYield: 0.03,
  blendedGrowth: 0.02
};

function simulateAtCase(input, portfolioDollars) {
  return simulateWithdrawals({
    investmentAmount: portfolioDollars,
    desiredAnnualWithdrawal: input.desiredAnnualWithdrawalCents / 100,
    horizonYears: input.horizonYears,
    blendedYield: input.blendedYield,
    blendedGrowth: input.blendedGrowth,
    inflationRate: input.inflationRate
  });
}

test('success result carries exactly {ok, requiredPortfolioCents} with an integer cent value - no dollar float in the API', () => {
  for (const input of [CASE_A, CASE_EQUAL_RATES]) {
    const result = requiredPortfolioForRatesCents(input);
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'requiredPortfolioCents']);
    assert.ok(Number.isInteger(result.requiredPortfolioCents), `expected integer cents, got ${result.requiredPortfolioCents}`);
    assert.ok(result.requiredPortfolioCents > 0);
  }
});

test('the returned portfolio survives the full horizon when re-simulated at exactly the same rates', () => {
  for (const input of [CASE_A, CASE_EQUAL_RATES]) {
    const result = requiredPortfolioForRatesCents(input);
    assert.equal(result.ok, true);
    const simulation = simulateAtCase(input, result.requiredPortfolioCents / 100);
    assert.equal(simulation.lastsFullHorizon, true);
  }
});

test('reducing the returned portfolio by 0.5% depletes before the horizon ends (minimality at these rates)', () => {
  for (const input of [CASE_A, CASE_EQUAL_RATES]) {
    const result = requiredPortfolioForRatesCents(input);
    assert.equal(result.ok, true);
    const reducedDollars = Math.round(result.requiredPortfolioCents * 0.995) / 100;
    const simulation = simulateAtCase(input, reducedDollars);
    assert.equal(simulation.lastsFullHorizon, false, 'a 0.5% smaller portfolio should not survive');
    assert.ok(simulation.depletionYear >= 1 && simulation.depletionYear <= input.horizonYears);
  }
});

test('a desired annual withdrawal of 0 cents returns ok:true with requiredPortfolioCents exactly 0', () => {
  const result = requiredPortfolioForRatesCents({
    desiredAnnualWithdrawalCents: 0,
    horizonYears: 25,
    inflationRate: 0.03,
    blendedYield: 0.03,
    blendedGrowth: 0.04
  });
  assert.deepEqual(result, { ok: true, requiredPortfolioCents: 0 });
});

test('two calls with identical inputs return deep-equal results', () => {
  const inputs = [
    CASE_A,
    CASE_EQUAL_RATES,
    { desiredAnnualWithdrawalCents: 0, horizonYears: 10, inflationRate: 0, blendedYield: 0.02, blendedGrowth: 0.03 },
    { desiredAnnualWithdrawalCents: 1000000, horizonYears: 5, inflationRate: 0, blendedYield: 0, blendedGrowth: -2 }
  ];
  for (const input of inputs) {
    assert.deepEqual(requiredPortfolioForRatesCents(input), requiredPortfolioForRatesCents({ ...input }));
  }
});

test('rate-equals-inflation edge case: result matches the growing-annuity closed form from test/retirement.test.js', () => {
  const result = requiredPortfolioForRatesCents(CASE_EQUAL_RATES);
  assert.equal(result.ok, true);

  // r == g must hold exactly for the edge-case branch to be the one under test.
  assert.equal(CASE_EQUAL_RATES.blendedYield + CASE_EQUAL_RATES.blendedGrowth, CASE_EQUAL_RATES.inflationRate);

  const exactDollars = closedFormRequiredDollars({
    withdrawalDollars: CASE_EQUAL_RATES.desiredAnnualWithdrawalCents / 100,
    horizonYears: CASE_EQUAL_RATES.horizonYears,
    inflationRate: CASE_EQUAL_RATES.inflationRate,
    totalReturn: EQUAL_RATES_TOTAL
  });
  // In the r == g case the closed form collapses to W * n / (1 + r).
  const collapsed = (CASE_EQUAL_RATES.desiredAnnualWithdrawalCents / 100) * CASE_EQUAL_RATES.horizonYears / (1 + EQUAL_RATES_TOTAL);
  assert.ok(Math.abs(exactDollars - collapsed) < 0.01);

  assert.ok(
    Math.abs(result.requiredPortfolioCents - exactDollars * 100) <= 5,
    `requiredPortfolioCents ${result.requiredPortfolioCents} !~ closed-form ${exactDollars * 100} cents`
  );
});

test('general case: result stays within the ceil-plus-step-up envelope of the growing-annuity closed form', () => {
  const result = requiredPortfolioForRatesCents(CASE_A);
  assert.equal(result.ok, true);
  const exactDollars = closedFormRequiredDollars({
    withdrawalDollars: CASE_A.desiredAnnualWithdrawalCents / 100,
    horizonYears: CASE_A.horizonYears,
    inflationRate: CASE_A.inflationRate,
    totalReturn: CASE_A.blendedYield + CASE_A.blendedGrowth
  });
  assert.ok(
    Math.abs(result.requiredPortfolioCents - exactDollars * 100) <= 5,
    `requiredPortfolioCents ${result.requiredPortfolioCents} !~ closed-form ${exactDollars * 100} cents`
  );
});

test('exhausted 100-cent step-up bound: a -200% blended total return refuses with no-verified-result and no numeric value', () => {
  // At a total return of -200% every positive balance flips sign each year,
  // so no candidate - the closed-form seed or any of the 100 one-cent steps
  // above it - can survive the horizon. The solver must exhaust its bound
  // and refuse rather than return an unverified number.
  const result = requiredPortfolioForRatesCents({
    desiredAnnualWithdrawalCents: 1000000,
    horizonYears: 5,
    inflationRate: 0,
    blendedYield: 0,
    blendedGrowth: -2
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-verified-result');
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0, 'the refusal must carry an actionable message');
  assert.ok(!('requiredPortfolioCents' in result));
  assert.ok(
    Object.values(result).every((value) => typeof value !== 'number'),
    'a refusal must carry no numeric portfolio value'
  );
});

test('a non-finite closed form (total return of exactly -100%) also refuses with no-verified-result', () => {
  const result = requiredPortfolioForRatesCents({
    desiredAnnualWithdrawalCents: 500000,
    horizonYears: 5,
    inflationRate: 0,
    blendedYield: 0,
    blendedGrowth: -1
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-verified-result');
  assert.ok(!('requiredPortfolioCents' in result));
});

test('module purity: imports only from src/lib/** and references no DOM, network, clock, or filesystem API', () => {
  const source = readFileSync(new URL('../src/lib/requiredPortfolio.js', import.meta.url), 'utf8');

  const importSpecifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(importSpecifiers.length >= 1);
  for (const specifier of importSpecifiers) {
    assert.equal(specifier, './retirement.js', `unexpected import: ${specifier}`);
  }

  const banned = /\b(window|document|globalThis|XMLHttpRequest|fetch|localStorage|sessionStorage|setTimeout|setInterval|Math\.random|Date|require\s*\(|process\.)\b|node:/;
  const match = source.match(banned);
  assert.equal(match, null, `impure reference in requiredPortfolio.js: ${match && match[0]}`);
});
