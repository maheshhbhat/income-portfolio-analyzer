import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildLegacyWithdrawalCatalog,
  computeLegacyWithdrawal,
  computeLegacyWithdrawalUpperBound
} from '../src/lib/legacyWithdrawal.js';
import { projectLegacyWithdrawal } from '../src/lib/legacyWithdrawalProjection.js';
import { SECURITIES } from '../src/data/securities.js';

const PINNED_CANONICAL_RATES = [
  47, 70, 73, 74, 78, 79, 80, 82, 83, 85, 88, 89,
  90, 93, 95, 97, 98, 100, 105, 106, 110, 115, 120
];

function bruteForceEntry(input, catalogEntry) {
  const upperBoundCents = computeLegacyWithdrawalUpperBound(input.investmentAmountCents, catalogEntry);
  let bestWithdrawalCents = null;
  let bestProjection = null;

  for (let annualWithdrawalCents = 0; annualWithdrawalCents <= upperBoundCents; annualWithdrawalCents++) {
    const projection = projectLegacyWithdrawal({
      ...input,
      annualWithdrawalCents,
      catalogEntry
    });
    assert.equal(projection.ok, true);
    if (projection.meetsEndingBalanceFloor) {
      bestWithdrawalCents = annualWithdrawalCents;
      bestProjection = projection;
    }
  }

  const nextProjection = projectLegacyWithdrawal({
    ...input,
    annualWithdrawalCents: (bestWithdrawalCents ?? 0) + 1,
    catalogEntry
  });
  assert.equal(nextProjection.ok, true);

  return {
    upperBoundCents,
    bestWithdrawalCents,
    bestProjection,
    nextProjection
  };
}

test('canonicalization pins the live curated list to 23 total-return catalog entries with deterministic integer-cent allocations', () => {
  const investmentAmountCents = 1003;
  const catalog = buildLegacyWithdrawalCatalog(SECURITIES, investmentAmountCents);

  assert.equal(catalog.length, 23);
  assert.deepEqual(catalog.map((entry) => entry.canonicalReturnRate), PINNED_CANONICAL_RATES);

  for (const entry of catalog) {
    assert.ok(entry.securities.length >= 1);
    const sum = entry.allocation.reduce((total, line) => total + line.amountCents, 0);
    assert.equal(sum, investmentAmountCents);
    assert.ok(entry.allocation.every((line) => Number.isInteger(line.amountCents) && line.amountCents > 0));
  }

  assert.deepEqual(
    buildLegacyWithdrawalCatalog(SECURITIES, investmentAmountCents),
    buildLegacyWithdrawalCatalog(SECURITIES, investmentAmountCents)
  );
});

test('fixed catalog projections are monotone in withdrawal cents for every canonical entry', () => {
  const input = {
    investmentAmountCents: 250,
    horizonYears: 8,
    inflationRate: 0.03,
    endingBalanceFloorCents: 0
  };
  const catalog = buildLegacyWithdrawalCatalog(SECURITIES, input.investmentAmountCents);

  for (const entry of catalog) {
    const upperBoundCents = computeLegacyWithdrawalUpperBound(input.investmentAmountCents, entry);
    let hasFailed = false;

    for (let annualWithdrawalCents = 0; annualWithdrawalCents <= upperBoundCents; annualWithdrawalCents++) {
      const projection = projectLegacyWithdrawal({
        ...input,
        annualWithdrawalCents,
        catalogEntry: entry
      });
      assert.equal(projection.ok, true);

      if (!projection.meetsEndingBalanceFloor) {
        hasFailed = true;
      } else {
        assert.equal(
          hasFailed,
          false,
          `canonical rate ${entry.canonicalReturnRate} became survivable again at ${annualWithdrawalCents} cents`
        );
      }
    }
  }
});

test('the solver returns the greatest independently verified withdrawal across every catalog contender', () => {
  const input = {
    investmentAmountCents: 1000,
    horizonYears: 7,
    inflationRate: 0.02,
    endingBalanceFloorCents: 125
  };
  const result = computeLegacyWithdrawal(input, SECURITIES, { includeContenders: true });
  assert.equal(result.ok, true);
  assert.equal(result.catalogSize, 23);

  const catalog = buildLegacyWithdrawalCatalog(SECURITIES, input.investmentAmountCents);
  let oracleWinner = null;

  for (const entry of catalog) {
    const oracle = bruteForceEntry(input, entry);
    const contender = result.contenders.find((candidate) => candidate.canonicalReturnRate === entry.canonicalReturnRate);

    assert.ok(contender, `missing contender for canonical rate ${entry.canonicalReturnRate}`);
    assert.equal(contender.upperBoundCents, oracle.upperBoundCents);
    assert.equal(contender.maxAnnualWithdrawalCents, oracle.bestWithdrawalCents ?? 0);
    assert.equal(contender.verified, Boolean(oracle.bestProjection?.meetsEndingBalanceFloor));
    assert.equal(contender.nextCentVerified, oracle.nextProjection.meetsEndingBalanceFloor);

    if (oracle.bestProjection?.meetsEndingBalanceFloor && !oracle.nextProjection.meetsEndingBalanceFloor) {
      if (oracleWinner === null || contender.maxAnnualWithdrawalCents > oracleWinner.maxAnnualWithdrawalCents) {
        oracleWinner = {
          canonicalReturnRate: entry.canonicalReturnRate,
          maxAnnualWithdrawalCents: contender.maxAnnualWithdrawalCents
        };
      }
    }
  }

  assert.ok(oracleWinner);
  assert.equal(result.maxAnnualWithdrawalCents, oracleWinner.maxAnnualWithdrawalCents);
  assert.equal(result.catalogEntry.canonicalReturnRate, oracleWinner.canonicalReturnRate);
  assert.equal(result.projection.meetsEndingBalanceFloor, true);
  assert.equal(result.nextCentProjection.meetsEndingBalanceFloor, false);
});

test('the work bound stays logarithmic per catalog entry and never degenerates into a cent-by-cent sweep', () => {
  const input = {
    investmentAmountCents: 50_000_000,
    horizonYears: 30,
    inflationRate: 0.03,
    endingBalanceFloorCents: 1_000_000
  };
  const evaluationsByRate = new Map();
  const probesByRate = new Map();

  const result = computeLegacyWithdrawal(input, SECURITIES, {
    includeContenders: true,
    instrumentation: {
      onEvaluate({ canonicalReturnRate, annualWithdrawalCents }) {
        const values = evaluationsByRate.get(canonicalReturnRate) ?? new Set();
        values.add(annualWithdrawalCents);
        evaluationsByRate.set(canonicalReturnRate, values);
      },
      onProbe({ canonicalReturnRate }) {
        probesByRate.set(canonicalReturnRate, (probesByRate.get(canonicalReturnRate) ?? 0) + 1);
      }
    }
  });

  assert.equal(result.ok, true);
  for (const contender of result.contenders) {
    const evaluations = evaluationsByRate.get(contender.canonicalReturnRate);
    const probeCount = probesByRate.get(contender.canonicalReturnRate) ?? 0;
    const logarithmicBound = Math.ceil(Math.log2(contender.upperBoundCents + 1)) + 3;

    assert.ok(evaluations, `missing instrumentation for canonical rate ${contender.canonicalReturnRate}`);
    assert.ok(
      evaluations.size <= logarithmicBound,
      `canonical rate ${contender.canonicalReturnRate} evaluated ${evaluations.size} cents across a ${contender.upperBoundCents}-cent domain`
    );
    assert.ok(
      probeCount <= logarithmicBound,
      `canonical rate ${contender.canonicalReturnRate} probed ${probeCount} times across a ${contender.upperBoundCents}-cent domain`
    );
  }
});

test('negative ending-balance floors are rejected, above-start floors can verify, and impossible floors refuse without a number', () => {
  const invalid = computeLegacyWithdrawal({
    investmentAmountCents: 1000,
    horizonYears: 1,
    inflationRate: 0.03,
    endingBalanceFloorCents: -1
  }, SECURITIES);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-input');

  const aboveStart = computeLegacyWithdrawal({
    investmentAmountCents: 1000,
    horizonYears: 1,
    inflationRate: 0.03,
    endingBalanceFloorCents: 1050
  }, SECURITIES);
  assert.equal(aboveStart.ok, true);
  assert.ok(aboveStart.maxAnnualWithdrawalCents >= 0);
  assert.equal(aboveStart.projection.endingBalanceCents >= 1050, true);

  const impossible = computeLegacyWithdrawal({
    investmentAmountCents: 1000,
    horizonYears: 1,
    inflationRate: 0.03,
    endingBalanceFloorCents: 1121
  }, SECURITIES);
  assert.equal(impossible.ok, false);
  assert.equal(impossible.reason, 'no-verified-result');
  assert.ok(!('maxAnnualWithdrawalCents' in impossible));
});

test('legacy-withdrawal modules stay pure and do not reference DOM, IO, clock, provider, or randomness APIs', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/lib/legacyWithdrawal.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/legacyWithdrawalProjection.js', import.meta.url), 'utf8')
  ]);

  for (const source of sources) {
    for (const forbidden of ['document.', 'window.', 'fetch(', 'readFile', 'writeFile', 'Math.random', 'Date.now', 'new Date(']) {
      assert.ok(!source.includes(forbidden), `module source unexpectedly references ${forbidden}`);
    }
  }
});
