import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('comparison markup discloses illustrative deterministic scenarios and financial-advice limits', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(/<section class="comparison"[\s\S]*?<\/section>\s*<section class="maximum-withdrawal"/)[0];

  assert.match(section, /exactly 2%, 3%, and 4% annual inflation/i);
  assert.match(section, /curated SECURITIES set/i);
  assert.match(section, /illustrative/i);
  assert.match(section, /not a forecast/i);
  assert.match(section, /not financial advice/i);
});

test('comparison browser code is fixed to the pure curated comparison API and not provider snapshots', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function runComparison()');
  const end = app.indexOf("comparisonSubmit?.addEventListener('click'", start);
  const comparisonSection = app.slice(start, end);

  assert.match(comparisonSection, /computeFixedInflationComparison/);
  assert.match(comparisonSection, /SECURITIES/);
  for (const forbidden of ['selectedSecurities(', 'fetch(', 'activeProviderSnapshot', 'selectProvider(']) {
    assert.equal(comparisonSection.includes(forbidden), false, `comparison flow must not use ${forbidden}`);
  }
});

test('comparison Chrome procedure remains owner-executable guidance, not an execution record', async () => {
  const procedure = await readFile(new URL('./comparisonChromeProcedure.md', import.meta.url), 'utf8');

  assert.match(procedure, /owner-executable Google Chrome procedure/i);
  assert.match(procedure, /After all delivery PRs[\s\S]*owner performs the real run/i);
  assert.match(procedure, /Record the elapsed time/i);
  assert.match(procedure, /page generated zero console[\s\S]*errors/i);
  assert.equal(/## Execution record/i.test(procedure), false, 'procedure must not contain a worker-authored execution record');
});
