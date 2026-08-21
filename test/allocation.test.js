import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocation } from '../src/lib/allocation.js';
import { SECURITIES } from '../src/data/securities.js';

const CENT = 0.01;

test('curated dataset has at least 10 securities with plausible yields and growth rates', () => {
  assert.ok(SECURITIES.length >= 10, `expected >= 10 securities, got ${SECURITIES.length}`);
  for (const security of SECURITIES) {
    assert.ok(security.symbol && security.name, 'security must have symbol and name');
    assert.ok(security.yield > 0 && security.yield < 0.2, `implausible yield for ${security.symbol}: ${security.yield}`);
    assert.ok(
      security.growthRate >= 0 && security.growthRate < 0.2,
      `implausible growthRate for ${security.symbol}: ${security.growthRate}`
    );
  }
});

test('curated dataset includes VOO and QQQ as low-yield, higher-growth broad-market ETFs', () => {
  const voo = SECURITIES.find((s) => s.symbol === 'VOO');
  const qqq = SECURITIES.find((s) => s.symbol === 'QQQ');

  assert.ok(voo, 'expected VOO in the curated dataset');
  assert.ok(qqq, 'expected QQQ in the curated dataset');
  assert.equal(voo.type, 'etf');
  assert.equal(qqq.type, 'etf');

  // Low current income, growth-oriented character relative to the rest of the list.
  assert.ok(voo.yield < 0.02, `expected VOO yield to be low, got ${voo.yield}`);
  assert.ok(qqq.yield < 0.02, `expected QQQ yield to be low, got ${qqq.yield}`);

  // Compare against the income-focused cohort specifically (not the other
  // broad-market/growth ETFs added alongside VOO/QQQ, which are expected peers).
  const incomeFocused = SECURITIES.filter((s) => ['stock', 'reit', 'covered-call-etf'].includes(s.type));
  const maxIncomeFocusedGrowth = Math.max(...incomeFocused.map((s) => s.growthRate));
  assert.ok(voo.growthRate > maxIncomeFocusedGrowth, 'expected VOO growth to exceed every income-focused curated security');
  assert.ok(qqq.growthRate > maxIncomeFocusedGrowth, 'expected QQQ growth to exceed every income-focused curated security');
});

test('curated dataset includes at least 3 covered-call ETFs, 3 REITs, and 1 bond ETF', () => {
  const coveredCallEtfs = SECURITIES.filter((s) => s.type === 'covered-call-etf');
  const reits = SECURITIES.filter((s) => s.type === 'reit');
  const bondEtfs = SECURITIES.filter((s) => s.type === 'bond-etf');

  assert.ok(coveredCallEtfs.length >= 3, `expected >= 3 covered-call-etf, got ${coveredCallEtfs.length}`);
  assert.ok(reits.length >= 3, `expected >= 3 reit, got ${reits.length}`);
  assert.ok(bondEtfs.length >= 1, `expected >= 1 bond-etf, got ${bondEtfs.length}`);

  for (const security of [...coveredCallEtfs, ...reits, ...bondEtfs]) {
    assert.ok(security.yield > 0 && security.yield < 0.2, `implausible yield for ${security.symbol}: ${security.yield}`);
  }

  const knownTypes = new Set(['stock', 'etf', 'reit', 'covered-call-etf', 'bond-etf']);
  for (const security of SECURITIES) {
    assert.ok(knownTypes.has(security.type), `unexpected type "${security.type}" for ${security.symbol}`);
  }
});

test('curated dataset includes the new Vanguard funds spanning dividend-growth, growth, total-market, international, and bond categories', () => {
  const expected = {
    VIG: 'etf',
    VUG: 'etf',
    VTI: 'etf',
    VXUS: 'etf',
    BND: 'bond-etf'
  };

  for (const [symbol, type] of Object.entries(expected)) {
    const security = SECURITIES.find((s) => s.symbol === symbol);
    assert.ok(security, `expected ${symbol} in the curated dataset`);
    assert.equal(security.type, type, `expected ${symbol} to be typed "${type}"`);
    assert.ok(security.yield >= 0 && security.yield < 0.2, `implausible yield for ${symbol}: ${security.yield}`);
    assert.ok(security.growthRate >= 0 && security.growthRate < 0.2, `implausible growthRate for ${symbol}: ${security.growthRate}`);
  }

  // BND (bonds) should sit at a materially lower total return than the growth-oriented
  // Vanguard equity ETFs added alongside it - a genuinely different risk/return category.
  const bnd = SECURITIES.find((s) => s.symbol === 'BND');
  const vug = SECURITIES.find((s) => s.symbol === 'VUG');
  const bndTotalReturn = bnd.yield + bnd.growthRate;
  const vugTotalReturn = vug.yield + vug.growthRate;
  assert.ok(bndTotalReturn < vugTotalReturn, 'expected BND total return to be materially lower than VUG');
});

test('rejects a non-positive investment amount', () => {
  const result = computeAllocation({ investmentAmount: 0, desiredAnnualIncome: 1000 }, SECURITIES);
  assert.equal(result.ok, false);
  assert.match(result.error, /investment amount/i);
});

test('rejects a negative desired income', () => {
  const result = computeAllocation({ investmentAmount: 10000, desiredAnnualIncome: -1 }, SECURITIES);
  assert.equal(result.ok, false);
  assert.match(result.error, /income/i);
});

test('rejects non-numeric input', () => {
  const result = computeAllocation({ investmentAmount: NaN, desiredAnnualIncome: 1000 }, SECURITIES);
  assert.equal(result.ok, false);
});

test('achievable target: allocation sums exactly to the investment amount', () => {
  const investmentAmount = 100000;
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome: 4500 }, SECURITIES);
  assert.equal(result.ok, true);
  assert.ok(result.allocations.length >= 1, 'expects at least one selected security');
  assert.ok(Math.abs(result.totalAllocated - investmentAmount) < CENT, `totalAllocated ${result.totalAllocated} !~ ${investmentAmount}`);
});

test('achievable target: estimated income is arithmetically correct per line and in total', () => {
  const investmentAmount = 250000;
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome: 10000 }, SECURITIES);
  assert.equal(result.ok, true);

  let expectedTotalIncome = 0;
  for (const line of result.allocations) {
    const expectedLineIncome = line.amount * line.yield;
    assert.ok(Math.abs(line.annualIncome - expectedLineIncome) < 1e-9, `line income mismatch for ${line.symbol}`);
    expectedTotalIncome += expectedLineIncome;
  }
  assert.ok(Math.abs(result.estimatedAnnualIncome - expectedTotalIncome) < 1e-6);
  assert.ok(Math.abs(result.effectiveYield - result.estimatedAnnualIncome / investmentAmount) < 1e-9);
});

test('achievable target: effective yield lands close to the requested target', () => {
  const investmentAmount = 100000;
  const desiredAnnualIncome = 4500; // 4.5% target, within the curated range (~2.9%-9.1%)
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);
  const targetYield = desiredAnnualIncome / investmentAmount;
  assert.ok(Math.abs(result.effectiveYield - targetYield) < 0.001, `effectiveYield ${result.effectiveYield} not close to target ${targetYield}`);
});

test('high-yield target surfaces covered-call ETFs in the proposed allocation', () => {
  const investmentAmount = 100000;
  const desiredAnnualIncome = 9000; // 9% target - at the top of the curated range, dominated by covered-call ETFs
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const coveredCallLines = result.allocations.filter((l) => l.type === 'covered-call-etf');
  assert.ok(coveredCallLines.length >= 1, 'expected at least one covered-call-etf in a high-yield allocation');
});

test('mid-yield target surfaces REITs in the proposed allocation', () => {
  const investmentAmount = 100000;
  const desiredAnnualIncome = 5000; // 5% target - lands in the REIT yield band (3.9%-5.5%)
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);

  const reitLines = result.allocations.filter((l) => l.type === 'reit');
  assert.ok(reitLines.length >= 1, 'expected at least one reit in a mid-yield allocation');
});

test('unreachable target: flags unreachable and still returns the best achievable allocation', () => {
  const investmentAmount = 10000;
  const desiredAnnualIncome = 5000; // 50% yield - unreachable with this curated list
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, true);
  assert.ok(result.allocations.length >= 1);
  assert.ok(Math.abs(result.totalAllocated - investmentAmount) < CENT);
  // Best achievable alternative should match the top of the curated yield range.
  assert.ok(Math.abs(result.effectiveYield - result.bestAchievableYield) < 1e-6);
});

test('zero desired income is trivially reachable and still allocates the full investment', () => {
  const investmentAmount = 50000;
  const result = computeAllocation({ investmentAmount, desiredAnnualIncome: 0 }, SECURITIES);
  assert.equal(result.ok, true);
  assert.equal(result.unreachable, false);
  assert.ok(Math.abs(result.totalAllocated - investmentAmount) < CENT);
  assert.ok(result.estimatedAnnualIncome > 0, 'should still earn some income even though 0 was requested');
});

test('every selected security in the allocation comes from the curated list', () => {
  const result = computeAllocation({ investmentAmount: 75000, desiredAnnualIncome: 3000 }, SECURITIES);
  assert.equal(result.ok, true);
  const symbols = new Set(SECURITIES.map((s) => s.symbol));
  for (const line of result.allocations) {
    assert.ok(symbols.has(line.symbol), `${line.symbol} is not in the curated list`);
  }
});

test('percent of portfolio across selected securities sums to ~100%', () => {
  const result = computeAllocation({ investmentAmount: 40000, desiredAnnualIncome: 1800 }, SECURITIES);
  assert.equal(result.ok, true);
  const totalPercent = result.allocations.reduce((sum, l) => sum + l.percentOfPortfolio, 0);
  assert.ok(Math.abs(totalPercent - 1) < 1e-6, `percentages summed to ${totalPercent}`);
});
