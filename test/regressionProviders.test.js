import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITIES } from '../src/data/securities.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { computeAllocation } from '../src/lib/allocation.js';
import { computeRequiredPortfolio } from '../src/lib/requiredPortfolio.js';
import { computeRetirementPlan } from '../src/lib/retirement.js';
import { createRequestHandler } from '../server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function javascriptFilesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFilesUnder(entryPath));
    else if (entry.name.endsWith('.js')) files.push(entryPath);
  }
  return files;
}

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
    '`RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE=1 npm test` starts the real server in an isolated temporary runtime directory, calls the production Refresh Data endpoint for the committed Vanguard and Fidelity sets, and renders each accepted provider display with its refreshed as-of date. It is intentionally excluded from the ordinary deterministic test run. A live fetch, redirect-domain, markup, parse, or validation failure exits unsuccessfully only after read-back proves the previous snapshot was not changed.', '',
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

test('provider hardening keeps the zero-runtime-dependency and integer-cent contracts while allowing only the approved browser-test dependency', async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies, { '@playwright/test': '1.62.1' });
  const packageLock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepEqual(packageLock.packages[''].devDependencies, packageJson.devDependencies);
  assert.equal(packageLock.packages['node_modules/@playwright/test'].dev, true);
  for (const lockfile of ['npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    await assert.rejects(access(path.join(ROOT, lockfile)));
  }
  const required = computeRequiredPortfolio({ desiredAnnualWithdrawalCents: 1000000, horizonYears: 1, inflationRate: 0.02 }, VANGUARD_SNAPSHOT.entries);
  assert.equal(required.ok, true);
  assert.ok(Number.isInteger(required.requiredPortfolioCents));
  assert.ok(required.allocation.every((line) => Number.isInteger(line.amountCents)));
});

test('provider regression pins the single fail-closed branded-Chrome assurance path', async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const config = await readFile(path.join(ROOT, 'playwright.config.js'), 'utf8');
  const workflow = await readFile(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
  const browserTest = await readFile(path.join(ROOT, 'test', 'horizonComparisonChrome.test.js'), 'utf8');
  const ownerProcedure = await readFile(path.join(ROOT, 'test', 'horizonComparisonChromeUat.md'), 'utf8');

  assert.equal(packageJson.scripts['test:chrome'], 'playwright test --project=chrome');
  assert.equal((config.match(/name:\s*['"]chrome['"]/g) || []).length, 1);
  assert.match(config, /channel:\s*['"]chrome['"]/);
  assert.match(config, /headless:\s*true/);
  assert.doesNotMatch(config, /channel:\s*['"]chromium['"]|headless:\s*false|process\.env/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /playwright install --with-deps chrome/);
  assert.match(workflow, /npm run test:chrome/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(browserTest, /\b(?:test|describe)\.skip\b|\bt\.skip\b/);

  const rawBrowserLaunch = /Google Chrome\.app|CHROME_BIN|--dump-dom|--remote-debugging|child_process/;
  for (const testFile of await javascriptFilesUnder(path.join(ROOT, 'test'))) {
    if (testFile === fileURLToPath(import.meta.url)) continue;
    assert.doesNotMatch(
      await readFile(testFile, 'utf8'),
      rawBrowserLaunch,
      `${path.relative(ROOT, testFile)} must use the supported Playwright Chrome path instead of launching a browser process directly`
    );
  }
  assert.match(ownerProcedure, /guidance only and is not Project acceptance evidence/i);
  assert.match(ownerProcedure, /Full application commit SHA/);
  assert.match(ownerProcedure, /Branded Google Chrome version/);
  assert.match(ownerProcedure, /Measured click-to-visible time/);
  assert.match(ownerProcedure, /Invalid refusal and stale-output clearing/);
  assert.match(ownerProcedure, /Page-generated console errors/);
});

function responseFor(entry, { ok = true, url, text, requestUrl } = {}) {
  const dynamic = requestUrl?.includes('/etfs/profile/api/');
  return {
    ok,
    status: ok ? 200 : 503,
    url: url ?? requestUrl ?? entry.facts.name.sourceUrl,
    text: async () => text ?? (dynamic
      ? JSON.stringify({ currentPrice: { yield: { yieldPct: `${(entry.yield * 100).toFixed(4)}%` } } })
      : `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(entry.yield * 100).toFixed(4)}%`)
  };
}

function verifiedResponseFor(entry, refreshYield) {
  return responseFor(entry, {
    text: `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(refreshYield * 100).toFixed(4)}%`
  });
}

async function request(handler, { method, url, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  const response = { status: null, body: '', writeHead(status) { this.status = status; }, end(bodyText) { this.body = bodyText; } };
  const pending = handler(req, response);
  process.nextTick(() => { if (body) req.emit('data', body); req.emit('end'); });
  await pending;
  return { status: response.status, payload: JSON.parse(response.body) };
}

async function seedLastKnownGood(root) {
  const runtime = path.join(root, '.runtime', 'provider-snapshots');
  const target = path.join(runtime, 'vanguard.json');
  await mkdir(runtime, { recursive: true });
  await writeFile(target, `${JSON.stringify(VANGUARD_SNAPSHOT)}\n`, 'utf8');
  return { target, bytes: await readFile(target, 'utf8') };
}

test('production refresh handler rejects every failure class without mutating the active snapshot', async (t) => {
  const entryFor = (url) => VANGUARD_SNAPSHOT.entries.find((entry) => entry.facts.name.sourceUrl === url || url.endsWith(`/api/${entry.symbol}/price`));
  const cases = [
    { name: 'network failure', status: 502, error: /unable to reach/i, fetchImpl: async () => { throw new Error('offline'); } },
    { name: 'non-success HTTP response', status: 502, error: /HTTP 503/i, fetchImpl: async (url) => responseFor(entryFor(url), { requestUrl: url, ok: false }) },
    { name: 'malformed content', status: 422, error: /does not contain (?:verifiable|one explicitly labeled)/i, fetchImpl: async (url) => responseFor(entryFor(url), { requestUrl: url, text: url.includes('/api/') ? '{bad json' : '<html>not fund facts</html>' }) },
    { name: 'partial content', status: 422, error: /does not contain (?:verifiable|one explicitly labeled)/i, fetchImpl: async (url) => responseFor(entryFor(url), { requestUrl: url, text: url.includes('/api/') ? JSON.stringify({ currentPrice: {} }) : `Fund name: ${entryFor(url).name}\nTicker: ${entryFor(url).symbol}` }) },
    { name: 'unverifiable factual value', status: 422, error: /does not contain (?:verifiable|one explicitly labeled)/i, fetchImpl: async (url) => responseFor(entryFor(url), { requestUrl: url, text: url.includes('/api/') ? JSON.stringify({ currentPrice: { yield: { yieldPct: 'unknown' } } }) : `Fund name: ${entryFor(url).name}\nTicker: ${entryFor(url).symbol}\nTrailing yield: unknown` }) },
    { name: 'cross-provider final URL', status: 422, error: /final response URL/i, fetchImpl: async (url) => responseFor(entryFor(url), { requestUrl: url, url: FIDELITY_SNAPSHOT.entries[0].facts.name.sourceUrl }) }
  ];

  for (const scenario of cases) await t.test(scenario.name, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'provider-refresh-regression-'));
    try {
      const persisted = await seedLastKnownGood(root);
      let renameCalls = 0;
      const handler = createRequestHandler({
        root,
        fetchImpl: scenario.fetchImpl,
        fsOps: { mkdir, readFile, unlink, writeFile, rename: async (...args) => { renameCalls += 1; return rename(...args); } }
      });
      const before = await request(handler, { method: 'GET', url: '/api/providers/vanguard/active-snapshot' });
      const refresh = await request(handler, { method: 'POST', url: '/api/providers/vanguard/refresh' });
      const after = await request(handler, { method: 'GET', url: '/api/providers/vanguard/active-snapshot' });

      assert.equal(refresh.status, scenario.status);
      assert.equal(refresh.payload.ok, false);
      assert.match(refresh.payload.error, scenario.error);
      assert.equal(renameCalls, 0, 'a rejected candidate must not begin atomic replacement');
      assert.deepEqual(after.payload.snapshot, before.payload.snapshot, 'active snapshot changed after rejection');
      assert.equal(after.payload.snapshot.asOf, before.payload.snapshot.asOf, 'active as-of date changed after rejection');
      assert.equal(await readFile(persisted.target, 'utf8'), persisted.bytes, 'persisted last-known-good bytes changed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('production refresh handler atomically accepts fully verifiable Vanguard and Fidelity candidates', async (t) => {
  const refreshDate = '2026-08-25';
  for (const seed of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) await t.test(seed.providerId, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'provider-refresh-regression-'));
    try {
      const runtime = path.join(root, '.runtime', 'provider-snapshots');
      const target = path.join(runtime, `${seed.providerId}.json`);
      await mkdir(runtime, { recursive: true });
      await writeFile(target, `${JSON.stringify(seed)}\n`, 'utf8');
      const beforeBytes = await readFile(target, 'utf8');
      const refreshedYields = new Map(seed.entries.map((entry) => [entry.facts.name.sourceUrl, entry.yield + 0.0001]));
      let renameCalls = 0;
      const handler = createRequestHandler({
        root,
        now: () => refreshDate,
        fetchImpl: async (url) => {
          const entry = seed.entries.find((item) => item.facts.name.sourceUrl === url || url.endsWith(`/api/${item.symbol}/price`));
          const refreshYield = refreshedYields.get(entry.facts.name.sourceUrl);
          return responseFor(entry, { requestUrl: url, text: url.includes('/api/')
            ? JSON.stringify({ currentPrice: { yield: { yieldPct: `${(refreshYield * 100).toFixed(4)}%` } } })
            : `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(refreshYield * 100).toFixed(4)}%` });
        },
        fsOps: { mkdir, readFile, unlink, writeFile, rename: async (...args) => { renameCalls += 1; return rename(...args); } }
      });

      const before = await request(handler, { method: 'GET', url: `/api/providers/${seed.providerId}/active-snapshot` });
      const refresh = await request(handler, { method: 'POST', url: `/api/providers/${seed.providerId}/refresh` });
      const active = await request(handler, { method: 'GET', url: `/api/providers/${seed.providerId}/active-snapshot` });

      assert.equal(refresh.status, 200);
      assert.equal(refresh.payload.ok, true);
      assert.equal(renameCalls, 1, 'an accepted complete candidate is persisted with one atomic rename');
      assert.equal(refresh.payload.snapshot.asOf, refreshDate);
      assert.deepEqual(active.payload.snapshot, refresh.payload.snapshot, 'active-snapshot read-back must return the accepted candidate');
      assert.notDeepEqual(active.payload.snapshot, before.payload.snapshot, 'accepted candidate must replace the prior snapshot');
      assert.ok(active.payload.snapshot.entries.every((entry) => (
        entry.facts.name.status === 'verified'
        && entry.facts.ticker.status === 'verified'
        && entry.facts.trailingYield.status === 'verified'
        && entry.facts.name.asOf === refreshDate
        && entry.facts.trailingYield.value.toFixed(4) === refreshedYields.get(entry.facts.name.sourceUrl).toFixed(4)
      )));
      assert.notEqual(await readFile(target, 'utf8'), beforeBytes, 'accepted candidate must replace persisted last-known-good bytes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
