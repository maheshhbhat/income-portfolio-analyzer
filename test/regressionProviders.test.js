import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITIES } from '../src/data/securities.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { computeAllocation } from '../src/lib/allocation.js';
import { computeRequiredPortfolio } from '../src/lib/requiredPortfolio.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// These literals are the pre-provider illustrative contract.  Keeping the
// expected values here (rather than deriving them from the implementation)
// makes an accidental change to the default data or calculation observable.
const ALLOCATION_BASELINE = {
  ok: true, unreachable: false, targetYield: 0.04, investmentAmount: 250000, desiredAnnualIncome: 10000,
  allocations: [
    { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', type: 'reit', yield: 0.039, amount: 25925.93, percentOfPortfolio: 0.10370372, annualIncome: 1011.11127 },
    { symbol: 'HDV', name: 'iShares Core High Dividend ETF', type: 'etf', yield: 0.037, amount: 25925.93, percentOfPortfolio: 0.10370372, annualIncome: 959.25941 },
    { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', type: 'etf', yield: 0.035, amount: 25925.93, percentOfPortfolio: 0.10370372, annualIncome: 907.4075500000001 },
    { symbol: 'XOM', name: 'Exxon Mobil Corporation', type: 'stock', yield: 0.033, amount: 25925.92, percentOfPortfolio: 0.10370368, annualIncome: 855.55536 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'stock', yield: 0.03, amount: 25925.92, percentOfPortfolio: 0.10370368, annualIncome: 777.7775999999999 },
    { symbol: 'STAG', name: 'STAG Industrial, Inc.', type: 'reit', yield: 0.04, amount: 24074.08, percentOfPortfolio: 0.09629632, annualIncome: 962.9632000000001 },
    { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', type: 'bond-etf', yield: 0.042, amount: 24074.08, percentOfPortfolio: 0.09629632, annualIncome: 1011.1113600000001 },
    { symbol: 'SPYD', name: 'SPDR Portfolio S&P 500 High Dividend ETF', type: 'etf', yield: 0.043, amount: 24074.07, percentOfPortfolio: 0.09629628, annualIncome: 1035.18501 },
    { symbol: 'DIVO', name: 'Amplify CWP Enhanced Dividend Income ETF', type: 'covered-call-etf', yield: 0.048, amount: 24074.07, percentOfPortfolio: 0.09629628, annualIncome: 1155.55536 },
    { symbol: 'T', name: 'AT&T Inc.', type: 'stock', yield: 0.055, amount: 24074.07, percentOfPortfolio: 0.09629628, annualIncome: 1324.07385 }
  ],
  totalAllocated: 250000.00000000006, estimatedAnnualIncome: 9999.99997,
  effectiveYield: 0.039999999880000005, bestAchievableYield: 0.09100000000000001
};

const RETIREMENT_BASELINE = {
  ok: true, investmentAmount: 250000, desiredAnnualWithdrawal: 10000, horizonYears: 3, inflationRate: 0.02,
  targetRate: 0.04, unreachable: false, bestAchievableRate: 0.11120000000000001,
  allocations: [
    { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', type: 'bond-etf', yield: 0.042, growthRate: 0.005, totalReturn: 0.047, amount: 50000, percentOfPortfolio: 0.2 },
    { symbol: 'T', name: 'AT&T Inc.', type: 'stock', yield: 0.055, growthRate: 0.015, totalReturn: 0.07, amount: 50000, percentOfPortfolio: 0.2 },
    { symbol: 'STAG', name: 'STAG Industrial, Inc.', type: 'reit', yield: 0.04, growthRate: 0.03, totalReturn: 0.07, amount: 50000, percentOfPortfolio: 0.2 },
    { symbol: 'XOM', name: 'Exxon Mobil Corporation', type: 'stock', yield: 0.033, growthRate: 0.04, totalReturn: 0.07300000000000001, amount: 50000, percentOfPortfolio: 0.2 },
    { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', type: 'reit', yield: 0.039, growthRate: 0.035, totalReturn: 0.07400000000000001, amount: 50000, percentOfPortfolio: 0.2 }
  ],
  totalAllocated: 250000, blendedYield: 0.0418, blendedGrowth: 0.025, blendedTotalReturn: 0.0668,
  years: [
    { year: 1, startingBalance: 250000, dividendIncome: 10450, growthAmount: 6250, withdrawalRequested: 10000, withdrawalPaid: 10000, dividendPortion: 10000, sharesSoldPortion: 0, endingBalance: 256700 },
    { year: 2, startingBalance: 256700, dividendIncome: 10730.06, growthAmount: 6417.5, withdrawalRequested: 10200, withdrawalPaid: 10200, dividendPortion: 10200, sharesSoldPortion: 0, endingBalance: 263647.56 },
    { year: 3, startingBalance: 263647.56, dividendIncome: 11020.468008, growthAmount: 6591.189, withdrawalRequested: 10404, withdrawalPaid: 10404, dividendPortion: 10404, sharesSoldPortion: 0, endingBalance: 270855.217008 }
  ],
  depletionYear: null, endingBalance: 270855.217008, lastsFullHorizon: true
};

const REQUIRED_PORTFOLIO_BASELINE = {
  ok: true, requiredPortfolioCents: 899929, blendedYield: 0.06620003466940168,
  blendedGrowth: 0.04499997222003069, blendedTotalReturn: 0.11120000688943237, rounds: 2,
  allocation: [
    { symbol: 'QYLD', name: 'Global X Nasdaq 100 Covered Call ETF', type: 'covered-call-etf', yield: 0.115, growthRate: 0.005, totalReturn: 0.12000000000000001, amountCents: 179986, percentOfPortfolio: 0.20000022223975447 },
    { symbol: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium Income ETF', type: 'covered-call-etf', yield: 0.095, growthRate: 0.02, totalReturn: 0.115, amountCents: 179986, percentOfPortfolio: 0.20000022223975447 },
    { symbol: 'MO', name: 'Altria Group, Inc.', type: 'stock', yield: 0.08, growthRate: 0.03, totalReturn: 0.11, amountCents: 179986, percentOfPortfolio: 0.20000022223975447 },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', yield: 0.006, growthRate: 0.1, totalReturn: 0.10600000000000001, amountCents: 179986, percentOfPortfolio: 0.20000022223975447 },
    { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', type: 'etf', yield: 0.035, growthRate: 0.07, totalReturn: 0.10500000000000001, amountCents: 179985, percentOfPortfolio: 0.1999991110409821 }
  ],
  projection: { years: [{ year: 1, startingBalance: 8999.29, dividendIncome: 595.7533099999998, growthAmount: 404.9678, withdrawalRequested: 10000, withdrawalPaid: 10000, dividendPortion: 595.7533099999998, sharesSoldPortion: 9404.24669, endingBalance: 0.01111000000128115 }], depletionYear: null, endingBalance: 0.01111000000128115, lastsFullHorizon: true }
};

function manifestFor(snapshots) {
  const rows = snapshots.flatMap((snapshot) => snapshot.entries.flatMap((entry) => [
    ['name', entry.facts.name], ['ticker', entry.facts.ticker], ['trailingYield', entry.facts.trailingYield]
  ].map(([field, fact]) => `| ${snapshot.providerId} | ${entry.symbol} | ${field} | ${String(fact.value)} | ${fact.sourceUrl} | ${fact.asOf} |`)));
  return [
    '# Provider spot-check manifest', '',
    'Generated from the committed provider snapshots. Every row is a verified fact; growth estimates are deliberately excluded because they are illustrative.', '',
    '| Provider | Symbol | Field | Value | Official URL | As-of date |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows, '',
    '## Opt-in live refresh acceptance', '',
    '`RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE=1 npm test` starts the real server in an isolated temporary runtime directory and calls the production Refresh Data endpoint for the committed Vanguard and Fidelity sets. It is intentionally excluded from the ordinary deterministic test run. A live fetch, redirect-domain, markup, parse, or validation failure exits unsuccessfully only after read-back proves the previous snapshot was not changed.', '',
    'Acceptance: a human must compare at least five rows against their recorded official pages before accepting this data.', ''
  ].join('\n');
}

test('the illustrative allocation, retirement, and required-portfolio contracts remain byte-for-byte literal outputs', () => {
  assert.deepEqual(computeAllocation({ investmentAmount: 250000, desiredAnnualIncome: 10000 }, SECURITIES), ALLOCATION_BASELINE);
  assert.deepEqual(computeRetirementPlan({ investmentAmount: 250000, desiredAnnualWithdrawal: 10000, horizonYears: 3, inflationRate: 0.02 }, SECURITIES), RETIREMENT_BASELINE);
  assert.deepEqual(computeRequiredPortfolio({ desiredAnnualWithdrawalCents: 1000000, horizonYears: 1, inflationRate: 0.02 }, SECURITIES), REQUIRED_PORTFOLIO_BASELINE);
});

test('committed spot-check manifest is the exact generated record of every verified provider fact', async () => {
  const expected = manifestFor([VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]);
  const actual = await readFile(path.join(ROOT, 'docs', 'provider-spot-check.md'), 'utf8');
  assert.equal(actual, expected);
  assert.equal((actual.match(/^\| (?:vanguard|fidelity) \|/gm) || []).length, 48);
});

test('provider hardening keeps the zero-dependency and integer-cent contracts', async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies ?? {}, {});
  for (const lockfile of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    await assert.rejects(access(path.join(ROOT, lockfile)));
  }
  const required = computeRequiredPortfolio({ desiredAnnualWithdrawalCents: 1000000, horizonYears: 1, inflationRate: 0.02 }, VANGUARD_SNAPSHOT.entries);
  assert.equal(required.ok, true);
  assert.ok(Number.isInteger(required.requiredPortfolioCents));
  assert.ok(required.allocation.every((line) => Number.isInteger(line.amountCents)));
});
