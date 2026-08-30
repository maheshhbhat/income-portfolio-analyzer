import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSpendingGuardrailComparison,
  validateGuardrailInputs,
  applyPostTriggerReduction
} from '../src/lib/spendingGuardrail.js';
import { bracketAndBlend, bracketAndBlendCents } from '../src/lib/allocation.js';
import { SECURITIES } from '../src/data/securities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two securities sharing an identical yield/growth metric make the blended
// rate a known, hand-computable constant (5% total return), so trigger and
// depletion arithmetic below can be verified by hand rather than trusted.
const FLAT_SECURITIES = [
  { symbol: 'AAA', name: 'Flat Fund A', type: 'etf', yield: 0.05, growthRate: 0 },
  { symbol: 'BBB', name: 'Flat Fund B', type: 'etf', yield: 0.05, growthRate: 0 }
];

function collectMoneyFields(result) {
  const fields = [
    result.investmentAmountCents,
    result.desiredAnnualWithdrawalCents,
    result.safetyFloorCents,
    result.steady.endingBalanceCents,
    result.steady.totalWithdrawalPaidCents,
    result.guardrail.endingBalanceCents,
    result.guardrail.totalWithdrawalPaidCents
  ];
  for (const item of result.allocation.items) fields.push(item.amountCents);
  for (const y of result.steady.years) {
    fields.push(y.startingBalanceCents, y.withdrawalScheduledCents, y.withdrawalPaidCents, y.returnCents, y.endingBalanceCents);
  }
  for (const y of result.guardrail.years) {
    fields.push(y.startingBalanceCents, y.withdrawalScheduledCents, y.withdrawalPaidCents, y.returnCents, y.endingBalanceCents);
  }
  return fields;
}

// --- OE-PROVIDER-1: source-scan ---------------------------------------------

test('OE-PROVIDER-1: neither the guardrail module nor the allocation module reference forbidden externals', () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bdocument\b/,
    /\bwindow\b/,
    /\bDate\s*[.(]/,
    /Math\.random/,
    /providerSelect/i,
    /selectedSecurities/,
    /selectProvider/,
    /activeProviderSnapshot/,
    /require\(\s*['"]fs['"]\s*\)/,
    /from\s+['"]fs['"]/,
    /from\s+['"]node:fs/
  ];

  for (const file of ['spendingGuardrail.js', 'allocation.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source), `${file} unexpectedly matched ${pattern}`);
    }
  }
});

// --- Cents-API item contract & cents-safe allocation ------------------------

test('cents API returns the exact {items, unreachable, bestAchievableMetric} contract with amountCents summing to the input', () => {
  const investmentAmountCents = 123456700;
  const result = computeSpendingGuardrailComparison(
    {
      investmentAmountCents,
      desiredAnnualWithdrawalCents: 4000000,
      horizonYears: 20,
      inflationRate: 0.03,
      safetyFloorCents: 10000000,
      postTriggerReductionPercent: 25
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(typeof result.allocation.unreachable, 'boolean');
  assert.equal(typeof result.allocation.bestAchievableMetric, 'number');
  assert.ok(Array.isArray(result.allocation.items));

  let sum = 0;
  for (const item of result.allocation.items) {
    assert.deepEqual(Object.keys(item).sort(), ['amountCents', 'percentOfPortfolio', 'security'].sort());
    assert.ok(Number.isSafeInteger(item.amountCents));
    assert.ok(item.amountCents > 0);
    assert.ok(SECURITIES.includes(item.security));
    assert.ok(Math.abs(item.percentOfPortfolio - item.amountCents / investmentAmountCents) < 1e-12);
    sum += item.amountCents;
  }
  assert.equal(sum, investmentAmountCents);
});

test('the guardrail module reads yield and growth only through item.security, not a flattened shape', () => {
  const result = computeSpendingGuardrailComparison(
    {
      investmentAmountCents: 5000000,
      desiredAnnualWithdrawalCents: 200000,
      horizonYears: 10,
      inflationRate: 0.02,
      safetyFloorCents: 0,
      postTriggerReductionPercent: 50
    },
    SECURITIES
  );
  assert.equal(result.ok, true);
  for (const item of result.allocation.items) {
    assert.equal(typeof item.security.yield, 'number');
    assert.equal(typeof item.security.growthRate, 'number');
    assert.equal('yield' in item, false);
    assert.equal('growthRate' in item, false);
  }
});

// --- Integer reduction boundaries -------------------------------------------

test('post-trigger reduction: 0% leaves the withdrawal unchanged', () => {
  assert.equal(applyPostTriggerReduction(12345, 0), 12345);
});

test('post-trigger reduction: 100% zeroes the withdrawal', () => {
  assert.equal(applyPostTriggerReduction(12345, 100), 0);
});

test('post-trigger reduction: half-cent ties round up (half-up)', () => {
  // 1 cent at 50% remaining -> 0.5 cent, rounds up to 1.
  assert.equal(applyPostTriggerReduction(1, 50), 1);
  // 3 cents at 50% remaining -> 1.5 cents, rounds up to 2.
  assert.equal(applyPostTriggerReduction(3, 50), 2);
  // 5 cents at 25% reduction (75% remaining) -> 3.75 cents, rounds up to 4.
  assert.equal(applyPostTriggerReduction(5, 25), 4);
});

// --- Single-trigger rule, corrected post-depletion timing -------------------

test('no-trigger case: guardrail matches the steady path exactly and triggerYear is null', () => {
  const input = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 1000,
    horizonYears: 3,
    inflationRate: 0,
    safetyFloorCents: 0,
    postTriggerReductionPercent: 50
  };
  const result = computeSpendingGuardrailComparison(input, FLAT_SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.guardrail.triggerYear, null);
  assert.equal(result.guardrail.floorReached, false);
  assert.equal(result.guardrail.endingBalanceCents, result.steady.endingBalanceCents);
  assert.equal(result.guardrail.totalWithdrawalPaidCents, result.steady.totalWithdrawalPaidCents);
  for (let i = 0; i < result.steady.years.length; i++) {
    const s = result.steady.years[i];
    const g = result.guardrail.years[i];
    assert.equal(g.startingBalanceCents, s.startingBalanceCents);
    assert.equal(g.withdrawalPaidCents, s.withdrawalPaidCents);
    assert.equal(g.endingBalanceCents, s.endingBalanceCents);
  }
});

test('trigger without depletion: triggerYear is the first year whose starting balance is at or below the floor, and the reduced rule applies from then on', () => {
  const input = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 1000,
    horizonYears: 3,
    inflationRate: 0,
    safetyFloorCents: 9000,
    postTriggerReductionPercent: 50
  };
  const result = computeSpendingGuardrailComparison(input, FLAT_SECURITIES);
  assert.equal(result.ok, true);

  // Hand-computed at a flat 5% blended total return:
  // year1: start 10000, return 500,  grown 10500, wd 1000, end 9500 (start > floor, no trigger)
  // year2: start 9500,  return 475,  grown 9975,  wd 1000, end 8975 (start > floor, no trigger)
  // year3: start 8975 <= 9000 -> trigger; wd reduced 50% of 1000 = 500;
  //        return round(8975*0.05)=449, grown 9424, end 8924
  assert.equal(result.guardrail.triggerYear, 3);
  assert.equal(result.guardrail.floorReached, true);
  assert.equal(result.guardrail.depletionYear, null);
  assert.equal(result.guardrail.lastsFullHorizon, true);
  assert.equal(result.guardrail.years[2].startingBalanceCents, 8975);
  assert.equal(result.guardrail.years[2].reduced, true);
  assert.equal(result.guardrail.years[2].withdrawalDueCents, 500);
  assert.equal(result.guardrail.years[2].endingBalanceCents, 8924);
  assert.equal(result.guardrail.endingBalanceCents, 8924);

  // Earlier years are not reduced.
  assert.equal(result.guardrail.years[0].reduced, false);
  assert.equal(result.guardrail.years[1].reduced, false);
});

test('early depletion in year N < horizonYears: triggerYear is N+1, not N', () => {
  const input = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 6000,
    horizonYears: 3,
    inflationRate: 0,
    safetyFloorCents: 0,
    postTriggerReductionPercent: 50
  };
  const result = computeSpendingGuardrailComparison(input, FLAT_SECURITIES);
  assert.equal(result.ok, true);

  // year1: start 10000, return 500, grown 10500, wd 6000, end 4500
  // year2: start 4500,  return 225, grown 4725,  wd 6000 > 4725 -> depletes, paid 4725, end 0 (depletionYear=2)
  // year3: start 0 <= floor(0) -> trigger = 3 (N+1); post-depletion zero row
  assert.equal(result.guardrail.depletionYear, 2);
  assert.equal(result.guardrail.triggerYear, 3);
  assert.equal(result.guardrail.floorReached, true);
  assert.equal(result.guardrail.years[1].endingBalanceCents, 0);
  assert.equal(result.guardrail.years[1].withdrawalPaidCents, 4725);

  const { year, ...postDepletionRow } = result.guardrail.years[2];
  assert.equal(year, 3);
  assert.deepEqual(postDepletionRow, {
    startingBalanceCents: 0,
    withdrawalScheduledCents: 0,
    withdrawalPaidCents: 0,
    returnCents: 0,
    endingBalanceCents: 0,
    reduced: true
  });
});

test('depletion in the final horizon year: no later row exists, triggerYear is null, and the floor was not reached', () => {
  const input = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 6000,
    horizonYears: 2,
    inflationRate: 0,
    safetyFloorCents: 0,
    postTriggerReductionPercent: 50
  };
  const result = computeSpendingGuardrailComparison(input, FLAT_SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.guardrail.depletionYear, 2);
  assert.equal(result.guardrail.years.length, 2);
  assert.equal(result.guardrail.triggerYear, null);
  assert.equal(result.guardrail.floorReached, false);
  assert.equal(result.guardrail.lastsFullHorizon, false);
});

// --- Post-depletion row contract --------------------------------------------

test('post-depletion rows are zeroed and the table always has one row per horizon year', () => {
  const input = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 6000,
    horizonYears: 6,
    inflationRate: 0,
    safetyFloorCents: 0,
    postTriggerReductionPercent: 0
  };
  const result = computeSpendingGuardrailComparison(input, FLAT_SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.steady.years.length, 6);
  assert.equal(result.guardrail.years.length, 6);
  assert.equal(result.steady.depletionYear, 2);
  for (let year = 3; year <= 6; year++) {
    const row = result.steady.years[year - 1];
    assert.equal(row.startingBalanceCents, 0);
    assert.equal(row.withdrawalPaidCents, 0);
    assert.equal(row.returnCents, 0);
    assert.equal(row.endingBalanceCents, 0);
  }
});

// --- Unreachable propagation -------------------------------------------------

test('unreachable target rate still returns the best achievable shared allocation with unreachable=true', () => {
  const result = computeSpendingGuardrailComparison(
    {
      investmentAmountCents: 10000000,
      desiredAnnualWithdrawalCents: 20000000, // 200% target rate, unreachable for this curated list
      horizonYears: 10,
      inflationRate: 0.03,
      safetyFloorCents: 0,
      postTriggerReductionPercent: 50
    },
    SECURITIES
  );
  assert.equal(result.ok, true);
  assert.equal(result.allocation.unreachable, true);
  assert.ok(result.allocation.items.length >= 1);
  const sum = result.allocation.items.reduce((s, i) => s + i.amountCents, 0);
  assert.equal(sum, 10000000);
});

// --- Deterministic serialization --------------------------------------------

test('two separate calls with identical input produce the same deterministic JSON serialization', () => {
  const input = {
    investmentAmountCents: 98765400,
    desiredAnnualWithdrawalCents: 3500000,
    horizonYears: 25,
    inflationRate: 0.025,
    safetyFloorCents: 15000000,
    postTriggerReductionPercent: 40
  };
  const a = computeSpendingGuardrailComparison(input, SECURITIES);
  const b = computeSpendingGuardrailComparison(input, SECURITIES);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// --- OE-WORK-1: bounded work observation ------------------------------------

test('OE-WORK-1: instrumented operation counts are bounded by horizon years and curated-security count, not portfolio cents', () => {
  const horizonYears = 15;
  const withdrawalRate = 0.04;
  const safetyFloorRate = 0.1;

  function run(investmentAmountCents) {
    let yearSteps = 0;
    let allocationItems = 0;
    const result = computeSpendingGuardrailComparison(
      {
        investmentAmountCents,
        desiredAnnualWithdrawalCents: Math.round(investmentAmountCents * withdrawalRate),
        horizonYears,
        inflationRate: 0.03,
        safetyFloorCents: Math.round(investmentAmountCents * safetyFloorRate),
        postTriggerReductionPercent: 50
      },
      SECURITIES,
      {
        instrumentation: {
          onYearStep: () => { yearSteps += 1; },
          onAllocationItem: () => { allocationItems += 1; }
        }
      }
    );
    assert.equal(result.ok, true);
    return { yearSteps, allocationItems };
  }

  const small = run(50_000_000); // $500,000
  const large = run(100_000_000); // $1,000,000 (in cents)

  const bound = 2 * horizonYears + SECURITIES.length;

  assert.ok(small.yearSteps <= bound, `small run used ${small.yearSteps} year-steps, bound ${bound}`);
  assert.ok(large.yearSteps <= bound, `large run used ${large.yearSteps} year-steps, bound ${bound}`);
  assert.equal(small.yearSteps, 2 * horizonYears);
  assert.equal(large.yearSteps, 2 * horizonYears);

  assert.ok(small.allocationItems <= SECURITIES.length);
  assert.ok(large.allocationItems <= SECURITIES.length);

  // Same horizon, same curated set, same withdrawal/floor *rates* -> identical
  // operation counts regardless of the absolute portfolio cents, proving no
  // per-cent search is occurring.
  assert.equal(small.yearSteps, large.yearSteps);
  assert.equal(small.allocationItems, large.allocationItems);
});

// --- Preservation of the existing dollar allocation behavior ----------------

test('the existing dollar-based bracketAndBlend API keeps its exact legacy signature and return shape', () => {
  const investmentAmount = 200000;
  const result = bracketAndBlend(investmentAmount, SECURITIES, 0.05, (s) => s.yield + s.growthRate);
  assert.ok(Array.isArray(result.items));
  assert.equal(typeof result.unreachable, 'boolean');
  assert.equal(typeof result.bestAchievableMetric, 'number');
  for (const item of result.items) {
    assert.deepEqual(Object.keys(item).sort(), ['amount', 'percentOfPortfolio', 'security'].sort());
    assert.equal(typeof item.amount, 'number');
  }
  const total = result.items.reduce((s, i) => s + i.amount, 0);
  assert.ok(Math.abs(total - investmentAmount) < 0.01);
});

test('bracketAndBlendCents mirrors bracketAndBlend on the same input, in cents', () => {
  const investmentAmount = 300000;
  const dollars = bracketAndBlend(investmentAmount, SECURITIES, 0.04, (s) => s.yield + s.growthRate);
  const cents = bracketAndBlendCents(investmentAmount * 100, SECURITIES, 0.04, (s) => s.yield + s.growthRate);

  assert.equal(dollars.unreachable, cents.unreachable);
  assert.equal(dollars.items.length, cents.items.length);
  for (let i = 0; i < dollars.items.length; i++) {
    assert.equal(Math.round(dollars.items[i].amount * 100), cents.items[i].amountCents);
    assert.equal(dollars.items[i].security, cents.items[i].security);
  }
});

// --- Invalid input: rejected without throwing -------------------------------

test('invalid input is rejected as {ok:false, reason:"invalid-input", error} without throwing, for each field', () => {
  const base = {
    investmentAmountCents: 1000000,
    desiredAnnualWithdrawalCents: 40000,
    horizonYears: 10,
    inflationRate: 0.03,
    safetyFloorCents: 100000,
    postTriggerReductionPercent: 50
  };

  const cases = [
    { ...base, investmentAmountCents: 0 },
    { ...base, investmentAmountCents: -100 },
    { ...base, investmentAmountCents: 1.5 },
    { ...base, desiredAnnualWithdrawalCents: -1 },
    { ...base, desiredAnnualWithdrawalCents: 1.5 },
    { ...base, horizonYears: 0 },
    { ...base, horizonYears: 10.5 },
    { ...base, inflationRate: -0.01 },
    { ...base, inflationRate: NaN },
    // Finite but too large to canonicalize safely; previously this reached
    // BigInt conversion during simulation and threw.
    { ...base, inflationRate: Number.MAX_VALUE },
    { ...base, safetyFloorCents: -1 },
    { ...base, safetyFloorCents: 1.5 },
    { ...base, postTriggerReductionPercent: -1 },
    { ...base, postTriggerReductionPercent: 101 },
    { ...base, postTriggerReductionPercent: NaN }
  ];

  for (const input of cases) {
    assert.doesNotThrow(() => {
      const result = validateGuardrailInputs(input, SECURITIES);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'invalid-input');
      assert.equal(typeof result.error, 'string');

      const full = computeSpendingGuardrailComparison(input, SECURITIES);
      assert.equal(full.ok, false);
      assert.equal(full.reason, 'invalid-input');
    });
  }
});

test('rejects too few or malformed curated securities without throwing', () => {
  const input = {
    investmentAmountCents: 1000000,
    desiredAnnualWithdrawalCents: 40000,
    horizonYears: 10,
    inflationRate: 0.03,
    safetyFloorCents: 100000,
    postTriggerReductionPercent: 50
  };
  assert.equal(computeSpendingGuardrailComparison(input, []).ok, false);
  assert.equal(computeSpendingGuardrailComparison(input, [SECURITIES[0]]).ok, false);
  assert.equal(computeSpendingGuardrailComparison(input, [{ symbol: 'X' }, { symbol: 'Y' }]).ok, false);
});

// --- 30+ valid-input matrix: every money field is a safe integer -----------

test('30+ valid-input matrix: every returned money field passes Number.isSafeInteger', () => {
  const investments = [100000, 5000000, 250000000];
  const rates = [0, 0.01, 0.03, 0.05, 0.08];
  const horizons = [1, 10];
  let caseCount = 0;

  for (const investmentAmountCents of investments) {
    for (const rate of rates) {
      for (const horizonYears of horizons) {
        caseCount += 1;
        const result = computeSpendingGuardrailComparison(
          {
            investmentAmountCents,
            desiredAnnualWithdrawalCents: Math.round(investmentAmountCents * rate),
            horizonYears,
            inflationRate: 0.03,
            safetyFloorCents: Math.round(investmentAmountCents * 0.1),
            postTriggerReductionPercent: 50
          },
          SECURITIES
        );
        assert.equal(result.ok, true, `case ${caseCount} failed`);
        for (const field of collectMoneyFields(result)) {
          assert.ok(Number.isSafeInteger(field), `case ${caseCount}: non-safe-integer money field ${field}`);
        }
        const sum = result.allocation.items.reduce((s, i) => s + i.amountCents, 0);
        assert.equal(sum, investmentAmountCents, `case ${caseCount}: allocation does not sum to portfolio`);
      }
    }
  }

  assert.ok(caseCount >= 30, `expected at least 30 matrix cases, ran ${caseCount}`);

  // Explicit boundary cases beyond the matrix.
  const boundaryBase = {
    investmentAmountCents: 10000,
    desiredAnnualWithdrawalCents: 1000,
    horizonYears: 5,
    inflationRate: 0.02,
    safetyFloorCents: 2000
  };
  for (const postTriggerReductionPercent of [0, 100]) {
    const result = computeSpendingGuardrailComparison({ ...boundaryBase, postTriggerReductionPercent }, FLAT_SECURITIES);
    assert.equal(result.ok, true);
    for (const field of collectMoneyFields(result)) {
      assert.ok(Number.isSafeInteger(field));
    }
  }
});
