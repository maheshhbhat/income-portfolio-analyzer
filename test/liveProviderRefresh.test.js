// This acceptance test deliberately uses the real server and its default
// fetch implementation. It is opt-in because official sites can change
// markup, redirect policy, or network access; a failure is evidence that the
// production refresh path is not proven and must not be converted to a skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';

const ENABLED = process.env.RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE === '1';
// Keep the injected server clock and requested fact date aligned to the
// review-date baseline. This prevents the acceptance check from asking the
// production endpoint to accept a future as-of date.
const REFRESH_DATE = '2026-08-25';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mockElement(tagName) {
  return {
    tagName: tagName.toUpperCase(), children: [], textContent: '', hidden: false, innerHTML: '', value: 'illustrative', listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function appDocument() {
  const ids = [
    'allocation-form', 'form-error', 'results', 'verdict-banner', 'unreachable-banner', 'summary-yield', 'summary-growth', 'summary-total-return', 'summary-allocated', 'allocation-body', 'projection-body', 'provider-select', 'refresh-data', 'provider-status', 'provider-error',
    'required-form', 'required-error', 'required-unverified', 'required-unverified-message', 'required-retry', 'required-results', 'required-banner', 'required-portfolio-value', 'required-yield', 'required-growth', 'required-total-return', 'required-allocation-body'
  ];
  const elements = new Map(ids.map((id) => [id, mockElement('div')]));
  return { createElement: mockElement, getElementById: (id) => elements.get(id) };
}

async function startIsolatedServer(root) {
  const server = createServer({ root, now: () => REFRESH_DATE });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function api(baseUrl, route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  return { status: response.status, payload: await response.json() };
}

function officialHost(providerId, url) {
  const hostname = new URL(url).hostname;
  return providerId === 'vanguard'
    ? /(^|\.)vanguard\.com$/.test(hostname)
    : /(^|\.)fidelity\.com$/.test(hostname);
}

test('opt-in live refresh proves official Vanguard and Fidelity pages through the production server', {
  skip: ENABLED ? false : 'Run RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE=1 npm test for live official-provider acceptance.',
  timeout: 120_000
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'income-provider-live-'));
  let server;
  try {
    await Promise.all([
      'index.html', 'app.js', 'styles.css', 'src'
    ].map((item) => cp(path.join(PROJECT_ROOT, item), path.join(root, item), { recursive: item === 'src' })));
    const runtime = path.join(root, '.runtime', 'provider-snapshots');
    await mkdir(runtime, { recursive: true });
    for (const seed of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      await writeFile(path.join(runtime, `${seed.providerId}.json`), `${JSON.stringify(seed)}\n`, 'utf8');
    }

    const started = await startIsolatedServer(root);
    server = started.server;
    const application = await fetch(`${started.baseUrl}/`);
    assert.equal(application.status, 200, 'the live acceptance server must serve the production application');
    assert.match(await application.text(), /id="provider-status"/);
    assert.equal((await fetch(`${started.baseUrl}/app.js`)).status, 200);
    for (const seed of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      const route = `/api/providers/${seed.providerId}/snapshot`;
      const persistedPath = path.join(runtime, `${seed.providerId}.json`);
      const before = await api(started.baseUrl, route);
      const beforeBytes = await readFile(persistedPath, 'utf8');
      assert.equal(before.status, 200);

      const refresh = await api(started.baseUrl, `/api/providers/${seed.providerId}/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshDate: REFRESH_DATE })
      });

      if (refresh.status !== 200 || !refresh.payload.ok) {
        const afterFailure = await api(started.baseUrl, route);
        assert.deepEqual(afterFailure.payload.snapshot, before.payload.snapshot, `${seed.providerId}: served snapshot changed after failed live refresh`);
        assert.equal(await readFile(persistedPath, 'utf8'), beforeBytes, `${seed.providerId}: persisted snapshot changed after failed live refresh`);
        assert.fail(`Live ${seed.providerId} refresh failed: ${refresh.payload.error}`);
      }

      const accepted = refresh.payload.snapshot;
      assert.equal(accepted.providerId, seed.providerId);
      assert.equal(accepted.asOf, REFRESH_DATE, 'as-of changes only after the verified candidate is accepted');
      assert.equal(accepted.entries.length, seed.entries.length);
      for (const entry of accepted.entries) {
        for (const field of ['name', 'ticker', 'trailingYield']) {
          const fact = entry.facts[field];
          assert.equal(fact.status, 'verified');
          assert.equal(fact.asOf, REFRESH_DATE);
          assert.match(fact.sourceUrl, /^https:/);
          assert.ok(officialHost(seed.providerId, fact.sourceUrl), `${seed.providerId} ${entry.symbol} ended on a non-official domain`);
        }
      }
      const active = await api(started.baseUrl, `/api/providers/${seed.providerId}/active-snapshot`);
      assert.deepEqual(active.payload.snapshot, accepted, `${seed.providerId}: accepted snapshot was not served back`);
      assert.notEqual(await readFile(persistedPath, 'utf8'), beforeBytes, `${seed.providerId}: acceptance did not atomically persist a new snapshot`);

      const savedDocument = globalThis.document;
      const savedFetch = globalThis.fetch;
      globalThis.document = appDocument();
      globalThis.fetch = (route, options) => savedFetch(new URL(route, started.baseUrl), options);
      try {
        await import(`../app.js?live-provider-display=${seed.providerId}-${Date.now()}`);
        const select = globalThis.document.getElementById('provider-select');
        select.value = seed.providerId;
        await select.listeners.change();
        const providerName = seed.providerId === 'vanguard' ? 'Vanguard' : 'Fidelity';
        assert.match(globalThis.document.getElementById('provider-status').textContent, new RegExp(`${providerName} data active as of ${REFRESH_DATE}`), `${seed.providerId}: provider display did not render the accepted as-of date`);
      } finally {
        globalThis.document = savedDocument;
        globalThis.fetch = savedFetch;
      }
    }
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
