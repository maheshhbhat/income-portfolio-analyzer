import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bracketAndBlendCents } from '../src/lib/allocation.js';
import { SECURITIES } from '../src/data/securities.js';
import { computeSpendingGuardrail, SPENDING_GUARDRAIL_RATE_SCALE } from '../src/lib/spendingGuardrail.js';

function zeroReturnSecurities() {
  return [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0, growthRate: 0 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: 0 }
  ];
}

function countWork(result) {
  return result.securityCount + result.allocationItemCount + result.yearCount + result.allocationCallCount;
}

test('bracketAndBlendCents returns positive safe-integer cents with the original security objects and an exact sum', () => {
  const securities = [
    { symbol: 'A', name: 'A', type: 'etf', yield: 0.01, growthRate: 0.01 },
    { symbol: 'B', name: 'B', type: 'etf', yield: 0.02, growthRate: 0.02 }
  ];

  const result = bracketAndBlendCents(3, securities, 0.015, (security) => security.yield);

  assert.deepEqual(Object.keys(result).sort(), ['bestAchievableMetric', 'items', 'unreachable']);
  assert.equal(result.unreachable, false);
  assert.equal(result.items.reduce((sum, item) => sum + item.amountCents, 0), 3);

  for (const item of result.items) {
    assert.deepEqual(Object.keys(item).sort(), ['amountCents', 'percentOfPortfolio', 'security']);
    assert.ok(Number.isSafeInteger(item.amountCents));
    assert.ok(item.amountCents > 0);
    assert.ok(securities.includes(item.security));
  }
});

test('computeSpendingGuardrail returns safe-integer money fields for representative valid input', () => {
  const result = computeSpendingGuardrail(
    {
      investmentAmountCents: 100000000,
      desiredAnnualWithdrawalCents: 4000000,
      horizonYears: 30,
      inflationRate: 0.03,
      safetyFloorCents: 20000000,
      withdrawalReductionRate: 0.1
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(result.inflationRatePpm, 30000);
  assert.equal(result.withdrawalReductionRatePpm, 100000);

  for (const item of result.allocation.items) {
    assert.ok(Number.isSafeInteger(item.amountCents));
    assert.ok(item.amountCents > 0);
  }

  for (const path of [result.steady, result.guardrail]) {
    assert.ok(Number.isSafeInteger(path.totalWithdrawalsPaidCents));
    assert.ok(Number.isSafeInteger(path.endingBalanceCents));
    assert.equal(path.rows.length, 30);

    for (const row of path.rows) {
      assert.ok(Number.isSafeInteger(row.startingBalanceCents));
      assert.ok(Number.isSafeInteger(row.dividendIncomeCents));
      assert.ok(Number.isSafeInteger(row.growthAmountCents));
      assert.ok(Number.isSafeInteger(row.totalReturnCents));
      assert.ok(Number.isSafeInteger(row.withdrawalRequestedCents));
      assert.ok(Number.isSafeInteger(row.withdrawalPaidCents));
      assert.ok(Number.isSafeInteger(row.endingBalanceCents));
    }
  }
});

test('unreachable allocation preserves best-achievable metadata for the UI', () => {
  const result = computeSpendingGuardrail(
    {
      investmentAmountCents: 10000,
      desiredAnnualWithdrawalCents: 5000,
      horizonYears: 5,
      inflationRate: 0,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(result.allocation.unreachable, true);
  assert.equal(typeof result.allocation.bestAchievableMetric, 'number');
  assert.ok(result.allocation.items.length >= 1);
});

test('post-trigger reduction covers 0%, 100%, and half-cent tie rounding with BigInt half-up arithmetic', () => {
  const securities = zeroReturnSecurities();

  const none = computeSpendingGuardrail(
    {
      investmentAmountCents: 10,
      desiredAnnualWithdrawalCents: 1,
      horizonYears: 1,
      inflationRate: 0,
      safetyFloorCents: 10,
      withdrawalReductionRate: 0
    },
    securities
  );
  assert.equal(none.ok, true);
  assert.equal(none.guardrail.triggerYear, 1);
  assert.equal(none.guardrail.rows[0].withdrawalRequestedCents, 1);
  assert.equal(none.guardrail.rows[0].withdrawalPaidCents, 1);

  const full = computeSpendingGuardrail(
    {
      investmentAmountCents: 10,
      desiredAnnualWithdrawalCents: 1,
      horizonYears: 1,
      inflationRate: 0,
      safetyFloorCents: 10,
      withdrawalReductionRate: 1
    },
    securities
  );
  assert.equal(full.ok, true);
  assert.equal(full.guardrail.rows[0].withdrawalRequestedCents, 0);
  assert.equal(full.guardrail.rows[0].withdrawalPaidCents, 0);

  const halfTie = computeSpendingGuardrail(
    {
      investmentAmountCents: 10,
      desiredAnnualWithdrawalCents: 1,
      horizonYears: 1,
      inflationRate: 0,
      safetyFloorCents: 10,
      withdrawalReductionRate: 0.5
    },
    securities
  );
  assert.equal(halfTie.ok, true);
  assert.equal(halfTie.guardrail.rows[0].withdrawalRequestedCents, 1);
  assert.equal(halfTie.withdrawalReductionRatePpm, SPENDING_GUARDRAIL_RATE_SCALE / 2);
});

test('depletion keeps the depletion row, emits post-depletion zero rows, and can first trigger on year N+1', () => {
  const result = computeSpendingGuardrail(
    {
      investmentAmountCents: 100,
      desiredAnnualWithdrawalCents: 60,
      horizonYears: 4,
      inflationRate: 0,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    zeroReturnSecurities()
  );

  assert.equal(result.ok, true);
  assert.equal(result.guardrail.triggerYear, 3);
  assert.equal(result.guardrail.floorReached, true);
  assert.equal(result.guardrail.rows.length, 4);
  assert.equal(result.guardrail.rows[1].endingBalanceCents, 0);
  assert.equal(result.guardrail.rows[1].withdrawalPaidCents, 40);
  assert.equal(result.guardrail.rows[1].withdrawalPaidCents < result.guardrail.rows[1].withdrawalRequestedCents, true);

  for (const row of result.guardrail.rows.slice(2)) {
    assert.equal(row.startingBalanceCents, 0);
    assert.equal(row.totalReturnCents, 0);
    assert.equal(row.withdrawalPaidCents, 0);
    assert.equal(row.endingBalanceCents, 0);
  }
});

test('final-horizon depletion without an earlier trigger reports floor not reached', () => {
  const result = computeSpendingGuardrail(
    {
      investmentAmountCents: 100,
      desiredAnnualWithdrawalCents: 60,
      horizonYears: 2,
      inflationRate: 0,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    zeroReturnSecurities()
  );

  assert.equal(result.ok, true);
  assert.equal(result.guardrail.triggerYear, null);
  assert.equal(result.guardrail.floorReached, false);
  assert.equal(result.guardrail.rows.length, 2);
  assert.equal(result.guardrail.rows[1].endingBalanceCents, 0);
});

test('two separate valid calls serialize identically', () => {
  const input = {
    investmentAmountCents: 50000000,
    desiredAnnualWithdrawalCents: 2500000,
    horizonYears: 20,
    inflationRate: 0.03,
    safetyFloorCents: 10000000,
    withdrawalReductionRate: 0.2
  };

  const first = computeSpendingGuardrail(input, SECURITIES);
  const second = computeSpendingGuardrail(input, SECURITIES);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('off-scale inflation and curated rates are refused without leaking any money result', () => {
  const offScaleInflation = computeSpendingGuardrail(
    {
      investmentAmountCents: 10000,
      desiredAnnualWithdrawalCents: 500,
      horizonYears: 5,
      inflationRate: 0.0000001,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    zeroReturnSecurities()
  );

  assert.equal(offScaleInflation.ok, false);
  assert.equal(offScaleInflation.reason, 'safe-arithmetic-refusal');
  assert.equal('allocation' in offScaleInflation, false);
  assert.equal('steady' in offScaleInflation, false);
  assert.equal('guardrail' in offScaleInflation, false);

  const offScaleSecurity = computeSpendingGuardrail(
    {
      investmentAmountCents: 10000,
      desiredAnnualWithdrawalCents: 500,
      horizonYears: 5,
      inflationRate: 0,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    [
      { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0.0000001, growthRate: 0 },
      { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0, growthRate: 0 }
    ]
  );

  assert.equal(offScaleSecurity.ok, false);
  assert.equal(offScaleSecurity.reason, 'safe-arithmetic-refusal');
  assert.equal('allocation' in offScaleSecurity, false);
  assert.equal('steady' in offScaleSecurity, false);
  assert.equal('guardrail' in offScaleSecurity, false);
});

test('unsafe monetary intermediates are refused without allocation rows, yearly rows, totals, ending balances, or trigger output', () => {
  const result = computeSpendingGuardrail(
    {
      investmentAmountCents: Number.MAX_SAFE_INTEGER,
      desiredAnnualWithdrawalCents: 0,
      horizonYears: 2,
      inflationRate: 0,
      safetyFloorCents: 0,
      withdrawalReductionRate: 0
    },
    [
      { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 1, growthRate: 1 },
      { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 1, growthRate: 1 }
    ]
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'safe-arithmetic-refusal');
  assert.equal('allocation' in result, false);
  assert.equal('steady' in result, false);
  assert.equal('guardrail' in result, false);
});

test('source scan rejects provider, DOM, fetch, clock, randomness, and filesystem references in the pure core paths', () => {
  const allocationSource = readFileSync(new URL('../src/lib/allocation.js', import.meta.url), 'utf8');
  const guardrailSource = readFileSync(new URL('../src/lib/spendingGuardrail.js', import.meta.url), 'utf8');
  const combined = `${allocationSource}\n${guardrailSource}`;
  const forbidden = [
    /\bfetch\b/,
    /\bdocument\b/,
    /\bwindow\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bselectedSecurities\b/,
    /\bselectProvider\b/,
    /\bproviderSelect\b/,
    /\bactiveProviderSnapshot\b/,
    /\bMath\.random\b/,
    /\bDate\s*\(/,
    /\bDate\./,
    /\bperformance\b/,
    /\breadFile\b/,
    /\bwriteFile\b/,
    /\bmkdir\b/
  ];

  for (const pattern of forbidden) {
    assert.equal(pattern.test(combined), false, `forbidden dependency matched ${pattern}`);
  }
});

test('instrumentation proves work stays within a horizon-and-security-derived bound and does not scale with portfolio cents', () => {
  const securities = [
    { symbol: 'AAA', name: 'Alpha', type: 'etf', yield: 0.02, growthRate: 0.01 },
    { symbol: 'BBB', name: 'Beta', type: 'etf', yield: 0.03, growthRate: 0.01 },
    { symbol: 'CCC', name: 'Gamma', type: 'etf', yield: 0.01, growthRate: 0.04 }
  ];

  function run(investmentAmountCents) {
    const counters = {
      allocationCallCount: 0,
      securityCount: 0,
      allocationItemCount: 0,
      yearCount: 0
    };

    const result = computeSpendingGuardrail(
      {
        investmentAmountCents,
        desiredAnnualWithdrawalCents: 15000,
        horizonYears: 30,
        inflationRate: 0.03,
        safetyFloorCents: 100000,
        withdrawalReductionRate: 0.1
      },
      securities,
      {
        instrumentation: {
          onAllocation() {
            counters.allocationCallCount += 1;
          },
          onSecurity() {
            counters.securityCount += 1;
          },
          onAllocationItem() {
            counters.allocationItemCount += 1;
          },
          onYear() {
            counters.yearCount += 1;
          }
        }
      }
    );

    assert.equal(result.ok, true);
    return counters;
  }

  const lowPortfolio = run(50000000);
  const highPortfolio = run(100000000);
  const horizonYears = 30;
  const bound = (2 * horizonYears) + (2 * securities.length) + 1;

  for (const counters of [lowPortfolio, highPortfolio]) {
    assert.equal(counters.allocationCallCount, 1);
    assert.equal(counters.securityCount, securities.length);
    assert.equal(counters.yearCount, 2 * horizonYears);
    assert.ok(counters.allocationItemCount <= securities.length);
    assert.ok(countWork(counters) <= bound, `observed work ${countWork(counters)} exceeded bound ${bound}`);
  }

  assert.deepEqual(lowPortfolio, highPortfolio);
});
