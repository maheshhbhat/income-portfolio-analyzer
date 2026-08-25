import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';

test('provider UI exposes selected default, provider refresh, disclosures, and official sources', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /option value="illustrative" selected/);
  assert.match(html, /id="refresh-data"/);
  assert.match(app, /illustrative, not financial advice, and is not endorsed by/);
  assert.match(app, /Official source/);
  for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
    for (const entry of snapshot.entries) {
      const source = entry.facts.name.sourceUrl;
      assert.equal(new URL(source).hostname.endsWith(snapshot.providerId === 'vanguard' ? 'vanguard.com' : 'fidelity.com'), true);
      assert.equal(entry.facts.name.sourceUrl, source);
    }
  }
});
