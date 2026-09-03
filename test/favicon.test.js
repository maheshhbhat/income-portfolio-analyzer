import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequestHandler } from '../server.js';

async function request(pathname) {
  const request = new EventEmitter();
  request.method = 'GET';
  request.url = pathname;
  const response = {
    status: null,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body) { this.body = body ?? Buffer.alloc(0); }
  };
  await createRequestHandler()(request, response);
  return response;
}

test('the declared SVG favicon is served with its image content type', async () => {
  const response = await request('/favicon.svg');
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'image/svg+xml');
  assert.match(response.body.toString(), /Income Portfolio Analyzer/);
});

test('the conventional favicon fallback never produces a browser 404', async () => {
  const response = await request('/favicon.ico');
  assert.equal(response.status, 204);
});
