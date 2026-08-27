import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFixedInflationComparison,
  FIXED_INFLATION_COMPARISON_SCENARIOS
} from '../src/lib/retirement.js';
import { SECURITIES } from '../src/data/securities.js';

test('fixed-inflation comparison is deterministic for identical valid input and curated securities', () => {
  const input = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 40000,
    horizonYears: 30
  };

  const first = computeFixedInflationComparison(input, SECURITIES);
  const second = computeFixedInflationComparison(input, SECURITIES);

  assert.deepEqual(first, second);
});

test('OE-WORK-1: comparison runs exactly three fixed scenarios, caps rows at the requested horizon, and observed work stays fixed when only cents change', () => {
  const baseInput = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 20000,
    horizonYears: 30
  };

  function captureWork(input) {
    const calls = [];
    const result = computeFixedInflationComparison(input, SECURITIES, (scenarioInput, securities) => {
      calls.push({
        inflationRate: scenarioInput.inflationRate,
        investmentAmount: scenarioInput.investmentAmount
      });
      return {
        ok: true,
        inflationRate: scenarioInput.inflationRate,
        years: Array.from({ length: scenarioInput.horizonYears }, (_, index) => ({ year: index + 1 })),
        lastsFullHorizon: true,
        depletionYear: null,
        endingBalance: scenarioInput.investmentAmount,
        horizonYears: scenarioInput.horizonYears,
        desiredAnnualWithdrawal: scenarioInput.desiredAnnualWithdrawal,
        investmentAmount: scenarioInput.investmentAmount,
        allocations: [],
        totalAllocated: scenarioInput.investmentAmount,
        targetRate: scenarioInput.desiredAnnualWithdrawal / scenarioInput.investmentAmount,
        unreachable: false,
        bestAchievableRate: 0,
        blendedYield: 0,
        blendedGrowth: 0,
        blendedTotalReturn: 0
      };
    });

    return {
      result,
      calls,
      totalRows: result.scenarios.reduce((sum, scenario) => sum + scenario.result.years.length, 0)
    };
  }

  const exactDollar = captureWork(baseInput);
  const extraCent = captureWork({ ...baseInput, investmentAmount: 1000000.01 });

  assert.equal(exactDollar.result.ok, true);
  assert.equal(exactDollar.calls.length, 3);
  assert.deepEqual(
    exactDollar.calls.map((call) => call.inflationRate),
    FIXED_INFLATION_COMPARISON_SCENARIOS.map((scenario) => scenario.inflationRate)
  );

  for (const scenario of exactDollar.result.scenarios) {
    assert.ok(scenario.result.years.length <= baseInput.horizonYears);
  }

  assert.deepEqual(
    {
      scenarioCount: exactDollar.calls.length,
      rates: exactDollar.calls.map((call) => call.inflationRate),
      totalRows: exactDollar.totalRows
    },
    {
      scenarioCount: extraCent.calls.length,
      rates: extraCent.calls.map((call) => call.inflationRate),
      totalRows: extraCent.totalRows
    }
  );
});
