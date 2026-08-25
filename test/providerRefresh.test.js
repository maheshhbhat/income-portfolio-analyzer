import test from 'node:test';
import assert from 'node:assert/strict';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { refreshProviderSnapshot } from '../src/lib/providerRefresh.js';

function pagesFor(snapshot) {
  return Object.fromEntries(snapshot.entries.map((entry) => [entry.symbol, {
    finalUrl: entry.facts.name.sourceUrl,
    text: `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(entry.yield * 100).toFixed(4)}%`
  }]));
}

test('fully verifiable official pages accept a complete dated candidate and retain illustrative growth', () => {
  for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
    const result = refreshProviderSnapshot({ currentSnapshot: snapshot, refreshDate: '2026-08-25', pages: pagesFor(snapshot) });
    assert.equal(result.accepted, true);
    assert.equal(result.snapshot.asOf, '2026-08-25');
    assert.ok(result.snapshot.entries.every((entry) => entry.facts.growth.status === 'illustrative-estimate'));
  }
});

test('malformed, partial, cross-domain, and verified-growth candidates fail closed', () => {
  for (const mutate of [
    (pages) => { pages.VTI.text = ''; },
    (pages) => { delete pages.VTI; },
    (pages) => { pages.VTI.finalUrl = 'https://example.com/VTI'; }
  ]) {
    const current = structuredClone(VANGUARD_SNAPSHOT);
    const pages = pagesFor(current);
    mutate(pages);
    const result = refreshProviderSnapshot({ currentSnapshot: current, refreshDate: '2026-08-25', pages });
    assert.equal(result.accepted, false);
    assert.equal(result.snapshot, current);
    assert.match(result.error, /Refresh/);
  }

  const current = structuredClone(VANGUARD_SNAPSHOT);
  current.entries[0].facts.growth.status = 'verified';
  const result = refreshProviderSnapshot({ currentSnapshot: current, refreshDate: '2026-08-25', pages: pagesFor(current) });
  assert.equal(result.accepted, false);
  assert.equal(result.snapshot, current);
});

test('refresh core is deterministic and has no IO dependencies', async () => {
  const input = { currentSnapshot: VANGUARD_SNAPSHOT, refreshDate: '2026-08-25', pages: pagesFor(VANGUARD_SNAPSHOT) };
  assert.deepEqual(refreshProviderSnapshot(input), refreshProviderSnapshot(input));
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/lib/providerRefresh.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /\b(fetch\s*\(|XMLHttpRequest|document\b|window\b|process\b|Math\.random|Date\.now|readFile|writeFile|node:fs)/);
});
