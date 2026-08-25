import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';

function mockElement(tagName) {
  return {
    tagName: tagName.toUpperCase(), children: [], textContent: '', hidden: false,
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this[name] = value; }
  };
}

function appDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner', 'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated', 'allocation-body', 'projection-body', 'provider-select', 'refresh-data', 'provider-status', 'provider-error',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message', 'required-retry', 'required-results', 'required-banner', 'required-portfolio-value', 'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body'
  ];
  const elements = new Map(ids.map((id) => [id, { ...mockElement('div'), value: 'illustrative', addEventListener() {} }]));
  return { createElement: mockElement, getElementById: (id) => elements.get(id) };
}

test('each rendered provider allocation row has the exact accessible official-source link', async () => {
  const savedDocument = globalThis.document;
  globalThis.document = appDocument();
  try {
    const { allocationRow } = await import(`../app.js?provider-display-test=${Date.now()}`);
    for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      for (const entry of snapshot.entries) {
        const row = allocationRow({ ...entry, totalReturn: entry.yield + entry.growthRate, percentOfPortfolio: 0.25 }, '$250.00', globalThis.document);
        const link = row.children[2].children[0];
        assert.equal(link.tagName, 'A');
        assert.equal(link.href, entry.facts.name.sourceUrl);
        assert.equal(link.textContent, 'Official source');
        assert.equal(link.target, '_blank');
        assert.equal(link['aria-label'], `Official ${entry.symbol} source`);
        assert.equal(new URL(link.href).hostname.endsWith(snapshot.providerId === 'vanguard' ? 'vanguard.com' : 'fidelity.com'), true);
      }
    }
  } finally { globalThis.document = savedDocument; }
});

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
