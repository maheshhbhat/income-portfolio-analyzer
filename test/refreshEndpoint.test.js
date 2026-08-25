import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createRequestHandler } from '../server.js';
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
