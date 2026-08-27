import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITIES } from '../src/data/securities.js';
import {
  computeRetirementScenarios,
  EARLY_DOWNTURN_GROWTH_ADJUSTMENT
} from '../src/lib/retirementScenarios.js';

const CENT = 0.01;

test('identical valid inputs return deep-equal steady and early-downturn scenario results on repeated calls', () => {
  const input = {
    investmentAmount: 1000000,
    desiredAnnualWithdrawal: 30000,
    horizonYears: 30,
    inflationRate: 0.03
  };

  const first = computeRetirementScenarios(input, SECURITIES);
  const second = computeRetirementScenarios(input, SECURITIES);

  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
});

test('early downturn uses steady blended yield and steady blended growth minus exactly 0.20 in year 1 only', () => {
  const result = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: 0.03
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(result.steady.years.length, 30);
  assert.equal(result.earlyDownturn.years.length, 30);

  const steadyYear1 = result.steady.years[0];
  const downturnYear1 = result.earlyDownturn.years[0];
  assert.equal(downturnYear1.blendedYield, steadyYear1.blendedYield);
  assert.equal(downturnYear1.blendedGrowth, steadyYear1.blendedGrowth + EARLY_DOWNTURN_GROWTH_ADJUSTMENT);

  for (let index = 1; index < result.earlyDownturn.years.length; index++) {
    const steadyRow = result.steady.years[index];
    const downturnRow = result.earlyDownturn.years[index];
    assert.ok(Math.abs(downturnRow.blendedYield - steadyRow.blendedYield) < CENT, `year ${index + 1} yield mismatch`);
    assert.ok(Math.abs(downturnRow.blendedGrowth - steadyRow.blendedGrowth) < CENT, `year ${index + 1} growth mismatch`);
  }
});

test('allocations stay on integer-cent boundaries, sum exactly to the input portfolio, and use only curated symbols', () => {
  const investmentAmount = 1234567.89;
  const result = computeRetirementScenarios(
    {
      investmentAmount,
      desiredAnnualWithdrawal: 50000,
      horizonYears: 25,
      inflationRate: 0.03
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  const curatedSymbols = new Set(SECURITIES.map((security) => security.symbol));
  const totalCents = Math.round(result.totalAllocated * 100);

  assert.equal(totalCents, Math.round(investmentAmount * 100));
  for (const allocation of result.allocations) {
    assert.equal(Math.round(allocation.amount * 100), allocation.amount * 100, `${allocation.symbol} is not on a cent boundary`);
    assert.equal(curatedSymbols.has(allocation.symbol), true, `${allocation.symbol} is not in the curated set`);
  }
});

test('representative scenario work is bounded by horizon years and selected securities, not portfolio cents', () => {
  const horizonYears = 30;
  const result = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears,
      inflationRate: 0.03
    },
    SECURITIES
  );

  assert.equal(result.ok, true);
  assert.equal(result.allocations.length <= SECURITIES.length, true);
  assert.equal(result.steady.years.length <= horizonYears, true);
  assert.equal(result.earlyDownturn.years.length <= horizonYears, true);
});

test('invalid scenario input returns actionable errors without throwing', () => {
  const badInvestment = computeRetirementScenarios(
    {
      investmentAmount: 0,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: 0.03
    },
    SECURITIES
  );
  assert.equal(badInvestment.ok, false);
  assert.match(badInvestment.error, /investment amount/i);

  const badWithdrawal = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: -1,
      horizonYears: 30,
      inflationRate: 0.03
    },
    SECURITIES
  );
  assert.equal(badWithdrawal.ok, false);
  assert.match(badWithdrawal.error, /withdrawal/i);

  const badHorizon = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 0,
      inflationRate: 0.03
    },
    SECURITIES
  );
  assert.equal(badHorizon.ok, false);
  assert.match(badHorizon.error, /horizon/i);

  const badInflation = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: -0.01
    },
    SECURITIES
  );
  assert.equal(badInflation.ok, false);
  assert.match(badInflation.error, /inflation/i);

  const badCuratedSet = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: 0.03
    },
    [{ symbol: 'ONLY' }]
  );
  assert.equal(badCuratedSet.ok, false);
  assert.match(badCuratedSet.error, /curated securities/i);
});

test('duplicate curated symbols are refused actionably', () => {
  const duplicateSymbols = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: 0.03
    },
    [
      SECURITIES[0],
      { ...SECURITIES[1], symbol: SECURITIES[0].symbol }
    ]
  );

  assert.equal(duplicateSymbols.ok, false);
  assert.match(duplicateSymbols.error, /unique symbols/i);
});

test('invalid curated-security entries are refused actionably', () => {
  const result = computeRetirementScenarios(
    {
      investmentAmount: 1000000,
      desiredAnnualWithdrawal: 30000,
      horizonYears: 30,
      inflationRate: 0.03
    },
    [
      SECURITIES[0],
      { ...SECURITIES[1], symbol: '' }
    ]
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /symbol, name, type, yield, and growth rate/i);
});
