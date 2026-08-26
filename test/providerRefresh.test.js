import test from 'node:test';
import assert from 'node:assert/strict';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { parseOfficialProviderPage, refreshProviderSnapshot } from '../src/lib/providerRefresh.js';

function pagesFor(snapshot) {
  return Object.fromEntries(snapshot.entries.map((entry) => [entry.symbol, {
    finalUrl: entry.facts.name.sourceUrl,
    text: snapshot.providerId === 'vanguard'
      ? `<title>${entry.symbol}-${entry.name} | Vanguard</title>`
      : `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(entry.yield * 100).toFixed(4)}%`,
    ...(snapshot.providerId === 'vanguard' ? {
      dynamicFinalUrl: `https://investor.vanguard.com/investment-products/etfs/profile/api/${entry.symbol}/price`,
      dynamicText: JSON.stringify({ currentPrice: { yield: { yieldPct: `${(entry.yield * 100).toFixed(4)}%` } } })
    } : {})
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

test('unrelated name and yield markers cannot be accepted as verified facts', () => {
  const current = structuredClone(VANGUARD_SNAPSHOT);
  const pages = pagesFor(current);
  pages.VTI.text = '<input name="search" value="Vanguard Total Stock Market ETF">\n'
    + '<div data-not-ticker="VTI" data-not-yield="4%">not-yield: 4%</div>';

  const result = refreshProviderSnapshot({ currentSnapshot: current, refreshDate: '2026-08-25', pages });
  assert.equal(result.accepted, false);
  assert.equal(result.snapshot, current);
  assert.match(result.error, /verifiable name, ticker, and trailing yield facts/);
});

test('current Vanguard share-class and Fidelity summary markup read only titled identities and labeled yields', () => {
  const vanguard = parseOfficialProviderPage({
    providerId: 'vanguard',
    finalUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti',
    text: '<title>VTI-Vanguard Total Stock Market ETF | Vanguard</title><section><h4>30 day SEC yield</h4><strong>1.01%</strong><p>30 unrelated holdings</p></section>'
  });
  assert.deepEqual(vanguard, {
    ok: true, name: 'Vanguard Total Stock Market ETF', symbol: 'VTI', trailingYield: 0.0101,
    sourceUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti'
  });

  const fidelity = parseOfficialProviderPage({
    providerId: 'fidelity',
    finalUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/315911750',
    text: '<title>FXAIX - Fidelity &reg; 500 Index Fund | Fidelity Investments</title><section>30-Day Yield<sup>3</sup><span>AS OF 08/19/2026</span><strong>1.04%</strong></section><input value="FXAIX">'
  });
  assert.deepEqual(fidelity, {
    ok: true, name: 'Fidelity® 500 Index Fund', symbol: 'FXAIX', trailingYield: 0.0104,
    sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/315911750'
  });
});

test('Vanguard production fixture obtains VTI yield from its official dynamic response, not the profile shell', () => {
  const result = refreshProviderSnapshot({
    currentSnapshot: { ...VANGUARD_SNAPSHOT, entries: [VANGUARD_SNAPSHOT.entries[0]] },
    refreshDate: '2026-08-25',
    pages: {
      VTI: {
        finalUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti',
        text: '<title>VTI-Vanguard Total Stock Market ETF | Vanguard</title><main>Fund title only; no yield is present.</main>',
        dynamicFinalUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/api/VTI/price',
        dynamicText: '{"currentPrice":{"yield":{"yieldPct":"1.23"}}}'
      }
    }
  });
  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.entries[0].yield, 0.0123);
  assert.equal(result.snapshot.entries[0].facts.trailingYield.sourceUrl, VANGUARD_SNAPSHOT.entries[0].facts.name.sourceUrl);
});

test('Vanguard dynamic yield rejects malformed, unlabelled, and cross-domain responses', () => {
  const page = pagesFor(VANGUARD_SNAPSHOT).VTI;
  for (const patch of [
    { dynamicText: '{not json' },
    { dynamicText: '{"currentPrice":{"yield":{"otherPct":"1.01%"}}}' },
    { dynamicText: '{"currentPrice":{"yield":{"yieldPct":"1.01","yieldPct":"2.02"}}}' },
    { dynamicFinalUrl: 'https://example.com/yield' }
  ]) {
    const result = parseOfficialProviderPage({ providerId: 'vanguard', ...page, ...patch });
    assert.equal(result.ok, false);
  }
});

test('label/value swaps, nearby numbers, and ticker-as-name candidates fail closed', () => {
  const base = {
    providerId: 'vanguard', finalUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti'
  };
  for (const text of [
    '<title>VTI-Vanguard Total Stock Market ETF | Vanguard</title><p>1.01% 30 day SEC yield</p>',
    '<title>VTI-Vanguard Total Stock Market ETF | Vanguard</title><p>30 day SEC yield</p><p>Unrelated return: 1.01%</p>',
    '<p>Fund name: VTI</p><p>Ticker: VTI</p><p>30 day SEC yield: 1.01%</p>'
  ]) {
    const result = parseOfficialProviderPage({ ...base, text });
    assert.equal(result.ok, false, text);
  }
});

test('refresh core is deterministic and has no IO dependencies', async () => {
  const input = { currentSnapshot: VANGUARD_SNAPSHOT, refreshDate: '2026-08-25', pages: pagesFor(VANGUARD_SNAPSHOT) };
  assert.deepEqual(refreshProviderSnapshot(input), refreshProviderSnapshot(input));
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/lib/providerRefresh.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /\b(fetch\s*\(|XMLHttpRequest|document\b|window\b|process\b|Math\.random|Date\.now|readFile|writeFile|node:fs)/);
});
