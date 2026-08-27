import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SECURITIES } from '../src/data/securities.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';
import { computeRetirementScenarios } from '../src/lib/retirementScenarios.js';

test('scenario comparison markup discloses the deterministic early-downturn contract and non-advice limits', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(
    /<section class="comparison comparison--scenario"[\s\S]*?<\/section>\s*<section class="maximum-withdrawal"/
  )[0];

  assert.match(section, /steady illustrative path against an illustrative\s+deterministic early downturn/i);
  assert.match(section, /curated illustrative\s+securities only/i);
  assert.match(section, /id="scenario-deterministic-disclosure"/);
  assert.match(section, /id="scenario-simplification-disclosure"/);
  assert.match(section, /id="scenario-sequence-disclosure"/);
});

test('scenario comparison browser code is fixed to the pure curated scenario API and not provider snapshots', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function runScenarioComparison()');
  const end = app.indexOf("scenarioComparisonSubmit?.addEventListener('click'", start);
  const section = app.slice(start, end);

  assert.match(section, /computeRetirementScenarios/);
  assert.match(section, /SECURITIES/);
  for (const forbidden of ['selectedSecurities(', 'fetch(', 'activeProviderSnapshot', 'selectProvider(']) {
    assert.equal(section.includes(forbidden), false, `scenario comparison flow must not use ${forbidden}`);
  }
});

test('steady scenario remains a regression-equivalent wrapper over the existing steady retirement projection', () => {
  const input = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 30000,
    horizonYears: 30,
    inflationRate: 0.03
  };

  const steadyPlan = computeRetirementPlan(input, SECURITIES);
  const scenarios = computeRetirementScenarios(input, SECURITIES);

  assert.equal(steadyPlan.ok, true);
  assert.equal(scenarios.ok, true);
  assert.deepEqual(scenarios.allocations, steadyPlan.allocations);
  assert.equal(scenarios.totalAllocated, steadyPlan.totalAllocated);
  assert.equal(scenarios.targetRate, steadyPlan.targetRate);
  assert.equal(scenarios.unreachable, steadyPlan.unreachable);
  assert.equal(scenarios.bestAchievableRate, steadyPlan.bestAchievableRate);
  assert.equal(scenarios.blendedYield, steadyPlan.blendedYield);
  assert.equal(scenarios.blendedGrowth, steadyPlan.blendedGrowth);
  assert.equal(scenarios.blendedTotalReturn, steadyPlan.blendedTotalReturn);
  assert.equal(scenarios.steady.endingBalance, steadyPlan.endingBalance);
  assert.equal(scenarios.steady.depletionYear, steadyPlan.depletionYear);
  assert.equal(scenarios.steady.lastsFullHorizon, steadyPlan.lastsFullHorizon);
  assert.equal(scenarios.steady.status, steadyPlan.lastsFullHorizon ? 'full-horizon' : 'depleted');
  assert.deepEqual(
    scenarios.steady.years.map((year) => ({
      year: year.year,
      startingBalance: year.startingBalance,
      dividendIncome: year.dividendIncome,
      growthAmount: year.growthAmount,
      withdrawalRequested: year.withdrawalRequested,
      withdrawalPaid: year.withdrawalPaid,
      dividendPortion: year.dividendPortion,
      sharesSoldPortion: year.sharesSoldPortion,
      endingBalance: year.endingBalance
    })),
    steadyPlan.years
  );
});
