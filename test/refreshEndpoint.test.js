import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createRequestHandler, createServer } from '../server.js';
import { FIDELITY_SNAPSHOT } from '../src/data/providers/fidelity.js';
import { VANGUARD_SNAPSHOT } from '../src/data/providers/vanguard.js';

function responseFor(entry, { ok = true, url = entry.facts.name.sourceUrl, text } = {}) {
  return { ok, status: ok ? 200 : 503, url, text: async () => text ?? `Fund name: ${entry.name}\nTicker: ${entry.symbol}\nTrailing yield: ${(entry.yield * 100).toFixed(4)}%` };
}

async function request(handler, { method, url, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  const response = { status: null, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  const pending = handler(req, response);
  process.nextTick(() => { if (body) req.emit('data', body); req.emit('end'); });
  await pending;
  return { status: response.status, payload: JSON.parse(response.body) };
}

test('verified refresh atomically replaces active snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-refresh-'));
  try {
    const handler = createRequestHandler({ root, now: () => '2026-08-26', fetchImpl: async (url) => {
      const entry = VANGUARD_SNAPSHOT.entries.find((item) => item.facts.name.sourceUrl === url);
      return responseFor(entry);
    }});
    const refresh = await request(handler, { method: 'POST', url: '/api/providers/vanguard/refresh' });
    assert.equal(refresh.status, 200);
    const active = await request(handler, { method: 'GET', url: '/api/providers/vanguard/snapshot' });
    assert.equal(active.payload.snapshot.asOf, '2026-08-26');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed refresh leaves persisted last-known-good bytes unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-refresh-'));
  const runtime = path.join(root, '.runtime', 'provider-snapshots');
  const target = path.join(runtime, 'vanguard.json');
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(runtime, { recursive: true });
    await writeFile(target, JSON.stringify(VANGUARD_SNAPSHOT));
    const before = await readFile(target, 'utf8');
    const handler = createRequestHandler({ root, fetchImpl: async (url) => responseFor(VANGUARD_SNAPSHOT.entries.find((item) => item.facts.name.sourceUrl === url), { url: 'https://example.com/not-official' }) });
    const refresh = await request(handler, { method: 'POST', url: '/api/providers/vanguard/refresh' });
    assert.equal(refresh.status, 422);
    assert.match(refresh.payload.error, /final response URL/i);
    assert.equal(await readFile(target, 'utf8'), before);
    const active = await request(handler, { method: 'GET', url: '/api/providers/vanguard/snapshot' });
    assert.equal(active.payload.snapshot.asOf, VANGUARD_SNAPSHOT.asOf);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE = process.env.RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE === '1';

async function startServer(options) {
  const server = createServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function liveRequest(baseUrl, requestPath, options) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  return { status: response.status, payload: await response.json() };
}

test('opt-in live refresh accepts official Vanguard and Fidelity pages without losing last-known-good snapshots', {
  skip: RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE ? false : 'Set RUN_LIVE_PROVIDER_REFRESH_ACCEPTANCE=1 to run live official-provider acceptance.',
  timeout: 120_000
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-live-refresh-'));
  let server;
  try {
    const runtime = path.join(root, '.runtime', 'provider-snapshots');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(runtime, { recursive: true });
    for (const snapshot of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      await writeFile(path.join(runtime, `${snapshot.providerId}.json`), JSON.stringify(snapshot), 'utf8');
    }

    const started = await startServer({ root, now: () => '2026-08-26' });
    server = started.server;
    for (const seed of [VANGUARD_SNAPSHOT, FIDELITY_SNAPSHOT]) {
      const target = path.join(runtime, `${seed.providerId}.json`);
      const beforeBytes = await readFile(target, 'utf8');
      const before = await liveRequest(started.baseUrl, `/api/providers/${seed.providerId}/snapshot`);
      assert.equal(before.status, 200);

      const refreshed = await liveRequest(started.baseUrl, `/api/providers/${seed.providerId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshDate: '2026-08-26' })
      });

      // A live provider change must fail closed: prove the served and on-disk
      // last-known-good state before failing the acceptance check.
      if (refreshed.status !== 200 || !refreshed.payload.ok) {
        const afterFailure = await liveRequest(started.baseUrl, `/api/providers/${seed.providerId}/snapshot`);
        assert.deepEqual(afterFailure.payload.snapshot, before.payload.snapshot);
        assert.equal(await readFile(target, 'utf8'), beforeBytes);
        assert.fail(`Live ${seed.providerId} refresh failed: ${refreshed.payload.error}`);
      }

      assert.equal(refreshed.payload.snapshot.providerId, seed.providerId);
      assert.equal(refreshed.payload.snapshot.asOf, '2026-08-26');
      assert.equal(refreshed.payload.snapshot.entries.length, seed.entries.length);
      for (const entry of refreshed.payload.snapshot.entries) {
        const sourceUrl = entry.facts.name.sourceUrl;
        const source = new URL(sourceUrl);
        assert.equal(source.protocol, 'https:');
        assert.equal(entry.facts.ticker.sourceUrl, sourceUrl);
        assert.equal(entry.facts.trailingYield.sourceUrl, sourceUrl);
        assert.equal(entry.facts.name.asOf, '2026-08-26');
        assert.equal(entry.facts.name.status, 'verified');
        assert.match(source.hostname, seed.providerId === 'vanguard' ? /(^|\.)vanguard\.com$/ : /(^|\.)fidelity\.com$/);
      }
      const active = await liveRequest(started.baseUrl, `/api/providers/${seed.providerId}/active-snapshot`);
      assert.deepEqual(active.payload.snapshot, refreshed.payload.snapshot);
      assert.equal(active.payload.snapshot.asOf, '2026-08-26');
      assert.notEqual(await readFile(target, 'utf8'), beforeBytes);
    }
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
