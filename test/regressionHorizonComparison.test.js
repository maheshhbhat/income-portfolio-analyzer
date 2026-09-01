import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('horizon comparison markup pins the fixed named horizons and illustrative non-advice disclosure', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.match(
    /<section class="comparison comparison--horizon"[\s\S]*?<\/section>\s*<section class="spending-guardrail"/
  )[0];

  assert.match(section, /Retirement horizon comparison/i);
  assert.match(section, /Short horizon \(20 years\)/);
  assert.match(section, /Standard horizon \(30 years\)/);
  assert.match(section, /Long horizon \(40 years\)/);
  assert.match(section, /curated SECURITIES set/i);
  assert.match(section, /illustrative comparison only/i);
  assert.match(section, /not a forecast/i);
  assert.match(section, /not financial advice/i);
  assert.match(section, /id="horizon-comparison-disclosure"/);
});

test('horizon comparison browser code remains bound to the pure curated horizon API instead of provider state', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function runHorizonComparison()');
  const end = app.indexOf("horizonComparisonSubmit?.addEventListener('click'", start);
  const section = app.slice(start, end);

  assert.match(section, /computeRetirementHorizonComparison/);
  assert.match(section, /SECURITIES/);
  for (const forbidden of ['selectedSecurities(', 'fetch(', 'activeProviderSnapshot', 'selectProvider(', 'providerSelect']) {
    assert.equal(section.includes(forbidden), false, `horizon comparison flow must not use ${forbidden}`);
  }
});
