import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECURITIES } from '../src/data/securities.js';
import { computeLegacyWithdrawal } from '../src/lib/legacyWithdrawal.js';
import { getCanonicalBreakpoints } from '../src/lib/legacyWithdrawalProjection.js';

test('representative $1,000,000 / 30-year / 3% case returns one verified cent-maximum whose next cent fails the ending floor', () => {
  const result = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 100000000,
      horizonYears: 30,
      inflationRate: 0.03,
      desiredEndingBalanceCents: 10000000
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.ok(Number.isInteger(result.maxAnnualWithdrawalCents));
  assert.equal(result.projection.lastsFullHorizon, true);
  assert.equal(result.projection.meetsEndingBalanceFloor, true);
  assert.ok(result.projection.endingBalanceCents >= 10000000);
  assert.equal(result.nextCentProjection?.meetsEndingBalanceFloor, false);
});

test('negative desired ending balances reject actionably, while a supported ending balance above the starting portfolio is accepted', () => {
  const invalid = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 100000,
      horizonYears: 1,
      inflationRate: 0.03,
      desiredEndingBalanceCents: -1
    },
    SECURITIES
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-input');
  assert.match(invalid.error, /desired ending balance/i);

  const growthOnly = [
    { symbol: 'A', name: 'A', type: 'etf', yield: 0, growthRate: 0.2 },
    { symbol: 'B', name: 'B', type: 'etf', yield: 0, growthRate: 0.2 }
  ];
  const accepted = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 100000,
      horizonYears: 1,
      inflationRate: 0,
      desiredEndingBalanceCents: 110000
    },
    growthOnly
  );

  assert.equal(accepted.ok, true);
  assert.equal(accepted.maxAnnualWithdrawalCents, 10000);
  assert.equal(accepted.projection.endingBalanceCents, 110000);
  assert.equal(accepted.nextCentProjection?.meetsEndingBalanceFloor, false);
});

test('rounding-aware candidate selection proves the exact winner instead of refusing below it', () => {
  const input = {
    startingPortfolioCents: 100,
    horizonYears: 10,
    inflationRate: 0.03,
    desiredEndingBalanceCents: 10
  };
  const result = computeLegacyWithdrawal(input, SECURITIES, { instrument: true });

  assert.equal(result.ok, true);
  assert.equal(result.maxAnnualWithdrawalCents, 16);
  assert.equal(result.projection.meetsEndingBalanceFloor, true);
  assert.equal(result.nextCentProjection?.meetsEndingBalanceFloor, false);
  for (const regime of result.instrumentation.regimeStats) {
    assert.ok(regime.verificationProjections <= 4, `too many verifications in regime ${regime.index}`);
  }
});

test('instrumentation pins canonical breakpoint handling, 23 unique breakpoints, 24 regimes, and at most four verification projections per regime', () => {
  const breakpoints = getCanonicalBreakpoints(SECURITIES);
  assert.equal(breakpoints.length, 23);

  const result = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 100000000,
      horizonYears: 30,
      inflationRate: 0.03,
      desiredEndingBalanceCents: 10000000
    },
    SECURITIES,
    { instrument: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.instrumentation.canonicalBreakpointCount, 23);
  assert.equal(result.instrumentation.regimeCount, 24);
  assert.equal(result.instrumentation.usedPerCentSweep, false);
  const boundaryRegimes = result.instrumentation.regimeStats.filter((regime) => regime.boundaryCents !== null);
  assert.equal(boundaryRegimes.length, 23);
  for (const regime of boundaryRegimes) {
    assert.equal(
      regime.boundaryVerificationProjections,
      1,
      `breakpoint cent ${regime.boundaryCents} must be verified in regime ${regime.index}`
    );
  }
  for (const regime of result.instrumentation.regimeStats) {
    assert.ok(regime.verificationProjections <= 4, `too many verifications in regime ${regime.index}`);
  }
});

test('the accepted path keeps money in integer cents throughout allocation and projection and imports no DOM, IO, provider, clock, or randomness dependency', () => {
  const result = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 100000000,
      horizonYears: 30,
      inflationRate: 0.03,
      desiredEndingBalanceCents: 10000000
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.allocation.reduce((sum, item) => sum + item.amountCents, 0),
    100000000
  );
  for (const item of result.allocation) {
    assert.ok(Number.isInteger(item.amountCents));
  }
  for (const year of result.projection.years) {
    for (const key of [
      'startingBalanceCents',
      'dividendIncomeCents',
      'growthAmountCents',
      'withdrawalRequestedCents',
      'withdrawalPaidCents',
      'dividendPortionCents',
      'sharesSoldPortionCents',
      'endingBalanceCents'
    ]) {
      assert.ok(Number.isInteger(year[key]), `${key} must stay integer cents`);
    }
  }

  const source = readFileSync(new URL('../src/lib/legacyWithdrawal.js', import.meta.url), 'utf8');
  const projectionSource = readFileSync(new URL('../src/lib/legacyWithdrawalProjection.js', import.meta.url), 'utf8');
  const banned = /\b(window|document|fetch|XMLHttpRequest|localStorage|sessionStorage|Math\.random|Date|process\.)\b|node:/;
  assert.equal(source.match(banned), null);
  assert.equal(projectionSource.match(banned), null);
});

test('an unverified case refuses with ok:false and no numeric withdrawal result', () => {
  const hopeless = [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0, growthRate: -2 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: -2 }
  ];

  const result = computeLegacyWithdrawal(
    {
      startingPortfolioCents: 1000,
      horizonYears: 10,
      inflationRate: 0.02,
      desiredEndingBalanceCents: 0
    },
    hopeless,
    { instrument: true }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-verified-result');
  assert.ok(!('maxAnnualWithdrawalCents' in result));
  assert.equal(result.instrumentation.usedPerCentSweep, false);
});
