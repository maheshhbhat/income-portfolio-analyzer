import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITIES } from '../src/data/securities.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';
import {
  computeRetirementHorizonComparison,
  RETIREMENT_HORIZON_COMPARISON_SCENARIOS
} from '../src/lib/retirementHorizonComparison.js';

test('identical valid inputs return deep-equal ordered horizon scenarios on repeated calls', () => {
  const input = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 40000,
    inflationRate: 0.03
  };

  const first = computeRetirementHorizonComparison(input, SECURITIES);
  const second = computeRetirementHorizonComparison(input, SECURITIES);

  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.scenarios.map(({ label, horizonYears }) => ({ label, horizonYears })),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS
  );
});

test('standard 30-year scenario matches the existing retirement plan exactly for the same input', () => {
  const input = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 40000,
    inflationRate: 0.03
  };

  const comparison = computeRetirementHorizonComparison(input, SECURITIES);
  const standard = computeRetirementPlan({ ...input, horizonYears: 30 }, SECURITIES);

  assert.equal(comparison.ok, true);
  assert.equal(standard.ok, true);
  assert.deepEqual(comparison.scenarios[1], {
    label: 'Standard horizon (30 years)',
    horizonYears: 30,
    result: standard
  });
});

test('OE-WORK-1: the module delegates exactly once per fixed horizon and keeps scenario work fixed when only investmentAmount changes', () => {
  const baseInput = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 40000,
    inflationRate: 0.03
  };

  function captureWork(input) {
    const calls = [];
    const result = computeRetirementHorizonComparison(input, SECURITIES, (scenarioInput, securities) => {
      calls.push({
        horizonYears: scenarioInput.horizonYears,
        investmentAmount: scenarioInput.investmentAmount,
        securities
      });

      return {
        ok: true,
        investmentAmount: scenarioInput.investmentAmount,
        desiredAnnualWithdrawal: scenarioInput.desiredAnnualWithdrawal,
        horizonYears: scenarioInput.horizonYears,
        inflationRate: scenarioInput.inflationRate,
        allocations: [],
        totalAllocated: scenarioInput.investmentAmount,
        targetRate: scenarioInput.desiredAnnualWithdrawal / scenarioInput.investmentAmount,
        unreachable: false,
        bestAchievableRate: 0,
        blendedYield: 0,
        blendedGrowth: 0,
        blendedTotalReturn: 0,
        years: Array.from({ length: scenarioInput.horizonYears }, (_, index) => ({ year: index + 1 })),
        depletionYear: null,
        endingBalance: scenarioInput.investmentAmount,
        lastsFullHorizon: true
      };
    });

    return { calls, result };
  }

  const representative = captureWork(baseInput);
  const changedPortfolio = captureWork({ ...baseInput, investmentAmount: 1000000.01 });

  assert.equal(representative.result.ok, true);
  assert.equal(changedPortfolio.result.ok, true);
  assert.equal(representative.calls.length, 3);
  assert.equal(changedPortfolio.calls.length, 3);
  assert.deepEqual(
    representative.calls.map(({ horizonYears }) => horizonYears),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS.map(({ horizonYears }) => horizonYears)
  );
  assert.deepEqual(
    representative.result.scenarios.map(({ label, horizonYears }) => ({ label, horizonYears })),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS
  );
  assert.deepEqual(
    changedPortfolio.result.scenarios.map(({ label, horizonYears }) => ({ label, horizonYears })),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS
  );
  assert.equal(representative.calls.every(({ securities }) => securities === SECURITIES), true);
  assert.equal(changedPortfolio.calls.every(({ securities }) => securities === SECURITIES), true);
  assert.deepEqual(
    representative.result.scenarios.map((scenario) => scenario.result.years.length),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS.map(({ horizonYears }) => horizonYears)
  );
  assert.deepEqual(
    changedPortfolio.result.scenarios.map((scenario) => scenario.result.years.length),
    RETIREMENT_HORIZON_COMPARISON_SCENARIOS.map(({ horizonYears }) => horizonYears)
  );
});

test('invalid input returns the existing actionable refusal shape with no partial scenarios', () => {
  const result = computeRetirementHorizonComparison(
    {
      investmentAmount: 0,
      desiredAnnualWithdrawal: 40000,
      inflationRate: 0.03
    },
    SECURITIES
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /investment amount/i);
  assert.equal('scenarios' in result, false);
});
