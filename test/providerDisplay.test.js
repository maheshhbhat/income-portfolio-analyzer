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
  const elements = new Map(ids.map((id) => [id, {
    ...mockElement('div'), value: 'illustrative', listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
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

test('provider UI renders complete disclosures for each selected provider snapshot', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const [html] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(html, /option value="illustrative" selected/);
  assert.match(html, /id="refresh-data"/);

  globalThis.document = appDocument();
  globalThis.fetch = async (url) => {
    const providerId = url.match(/\/api\/providers\/([^/]+)\/snapshot/)?.[1];
    const snapshot = providerId === 'vanguard' ? VANGUARD_SNAPSHOT : FIDELITY_SNAPSHOT;
    return { ok: true, json: async () => ({ ok: true, snapshot }) };
  };
  try {
    await import(`../app.js?provider-disclosure-test=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);
    for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      get('provider-select').value = snapshot.providerId;
      await get('provider-select').listeners.change();

      const providerName = snapshot.providerId === 'vanguard' ? 'Vanguard' : 'Fidelity';
      const status = get('provider-status').textContent;
      assert.match(status, new RegExp(`${providerName} data active as of ${snapshot.asOf}`));
      assert.match(status, /comparison is illustrative/i);
      assert.match(status, /not financial advice/i);
      assert.match(status, new RegExp(`not endorsed by ${providerName}`));
    }
  } finally {
    globalThis.document = savedDocument;
    globalThis.fetch = savedFetch;
  }
});

test('a successful refresh hides stale results before showing the refreshed as-of date', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  globalThis.document = appDocument();
  try {
    const refreshedSnapshot = { ...VANGUARD_SNAPSHOT, asOf: '2026-08-26' };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, snapshot: refreshedSnapshot }) });
    await import(`../app.js?refresh-invalidation-test=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);
    get('provider-select').value = 'vanguard';
    for (const id of ['results', 'required-results']) get(id).hidden = false;
    for (const id of ['verdict-banner', 'unreachable-banner', 'required-banner']) get(id).hidden = false;
    for (const id of ['allocation-body', 'projection-body', 'required-allocation-body']) get(id).innerHTML = '<tr>stale</tr>';

    await get('refresh-data').listeners.click();

    for (const id of ['results', 'required-results', 'verdict-banner', 'unreachable-banner', 'required-banner']) {
      assert.equal(get(id).hidden, true, `${id} remains hidden until recalculation`);
    }
    for (const id of ['allocation-body', 'projection-body', 'required-allocation-body']) {
      assert.equal(get(id).innerHTML, '', `${id} no longer contains stale snapshot results`);
    }
    assert.match(get('provider-status').textContent, /Vanguard data active as of 2026-08-26/);
  } finally {
    globalThis.document = savedDocument;
    globalThis.fetch = savedFetch;
  }
});
