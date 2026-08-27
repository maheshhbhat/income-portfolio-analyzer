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

function independentCatalogMaximum(input, entry) {
  const upperBoundCents = computeLegacyWithdrawalUpperBound(input.investmentAmountCents, entry);
  let greatestVerifiedCents = null;

  for (let cents = 0; cents <= upperBoundCents; cents++) {
    const projection = projectLegacyWithdrawal({ ...input, annualWithdrawalCents: cents, catalogEntry: entry });
    assert.equal(projection.ok, true);
    if (projection.meetsEndingBalanceFloor) greatestVerifiedCents = cents;
  }

  const nextCentProjection = projectLegacyWithdrawal({
    ...input,
    annualWithdrawalCents: (greatestVerifiedCents ?? 0) + 1,
    catalogEntry: entry
  });
  return { greatestVerifiedCents, nextCentProjection };
}

test('regression contract: the solver equals an independent oracle across every fixed catalog allocation', () => {
  // Kept deliberately small so this is an independent cent-by-cent oracle,
  // rather than a second copy of the production binary search.
  const input = {
    investmentAmountCents: 1_000,
    horizonYears: 7,
    inflationRate: 0.02,
    endingBalanceFloorCents: 125
  };
  const result = computeLegacyWithdrawal(input, SECURITIES, { includeContenders: true });
  const catalog = buildLegacyWithdrawalCatalog(SECURITIES, input.investmentAmountCents);
  assert.equal(result.ok, true);
  assert.equal(catalog.length, 23);

  let winner = null;
  for (const entry of catalog) {
    const oracle = independentCatalogMaximum(input, entry);
    const contender = result.contenders.find((item) => item.canonicalReturnRate === entry.canonicalReturnRate);
    assert.ok(contender, `missing catalog contender ${entry.canonicalReturnRate}`);
    assert.equal(contender.maxAnnualWithdrawalCents, oracle.greatestVerifiedCents ?? 0);
    assert.equal(contender.nextCentVerified, oracle.nextCentProjection.meetsEndingBalanceFloor);

    if (oracle.greatestVerifiedCents !== null && !oracle.nextCentProjection.meetsEndingBalanceFloor) {
      if (winner === null || oracle.greatestVerifiedCents > winner.cents) {
        winner = { rate: entry.canonicalReturnRate, cents: oracle.greatestVerifiedCents };
      }
    }
  }

  assert.deepEqual(
    { rate: result.catalogEntry.canonicalReturnRate, cents: result.maxAnnualWithdrawalCents },
    winner
  );
  assert.equal(result.projection.meetsEndingBalanceFloor, true);
  assert.equal(result.nextCentProjection.meetsEndingBalanceFloor, false);
});

test('regression contract: values remain integer cents and representative results are deterministic', () => {
  const input = {
    investmentAmountCents: 100_000_000,
    horizonYears: 30,
    inflationRate: 0.03,
    endingBalanceFloorCents: 10_000_000
  };
  const first = computeLegacyWithdrawal(input, SECURITIES);
  const second = computeLegacyWithdrawal({ ...input }, SECURITIES);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);

  for (const value of [
    first.maxAnnualWithdrawalCents,
    first.projection.endingBalanceCents,
    first.nextCentProjection.endingBalanceCents,
    ...first.allocation.map((line) => line.amountCents),
    ...first.projection.years.flatMap((year) => [
      year.startingBalanceCents, year.returnCents, year.withdrawalCents, year.endingBalanceCents
    ])
  ]) {
    assert.ok(Number.isSafeInteger(value), `non-integer-cent value: ${value}`);
  }
  assert.equal(first.allocation.reduce((sum, line) => sum + line.amountCents, 0), input.investmentAmountCents);
});

test('regression contract: the legacy path stays curated-only, zero-dependency, and isolated from provider UI state', async () => {
  const [core, projection, app, packageJson] = await Promise.all([
    readFile(new URL('../src/lib/legacyWithdrawal.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/legacyWithdrawalProjection.js', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  const legacyUi = app.slice(app.indexOf('// --- Legacy withdrawal section ---'));

  for (const source of [core, projection]) {
    assert.doesNotMatch(source, /providers\/|fetch\(|document\.|window\.|Math\.random|Date\.now/);
  }
  assert.match(legacyUi, /computeLegacyWithdrawal\(parsed\.input, SECURITIES\)/);
  assert.doesNotMatch(legacyUi, /selectedSecurities|activeProviderSnapshot|providerSelect|fetch\(|refreshDataButton/);
  assert.deepEqual(JSON.parse(packageJson).dependencies ?? {}, {});
});
