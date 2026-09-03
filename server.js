// Zero-dependency server. Refresh IO stays at this edge; calculations stay pure.
import http from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIDELITY_SNAPSHOT } from './src/data/providers/fidelity.js';
import { SUPPORTED_PROVIDER_IDS } from './src/data/providers/index.js';
import { VANGUARD_SNAPSHOT } from './src/data/providers/vanguard.js';
import { PROVIDER_OFFICIAL_HOSTS, validateProviderSnapshot } from './src/lib/providerFacts.js';
import { refreshProviderSnapshot } from './src/lib/providerRefresh.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const SEEDS = Object.freeze({ vanguard: VANGUARD_SNAPSHOT, fidelity: FIDELITY_SNAPSHOT });
const supportedError = (id) => `Unsupported provider${id ? ` \"${id}\"` : ''}. Choose one of: illustrative, ${SUPPORTED_PROVIDER_IDS.join(', ')}.`;
const dateToday = () => new Date().toISOString().slice(0, 10);
const vanguardDynamicYieldUrl = (symbol) => `https://investor.vanguard.com/investment-products/etfs/profile/api/${encodeURIComponent(symbol)}/price`;

function isOfficialResponseUrl(value, providerId) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PROVIDER_OFFICIAL_HOSTS[providerId]?.includes(url.hostname);
  } catch {
    return false;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/** Creates the production handler with injectable IO for deterministic tests. */
export function createRequestHandler({ root = ROOT, fetchImpl = globalThis.fetch, fsOps = { mkdir, readFile, rename, unlink, writeFile }, now = dateToday } = {}) {
  const runtimeDirectory = path.join(root, '.runtime', 'provider-snapshots');
  const snapshotPath = (id) => path.join(runtimeDirectory, `${id}.json`);
  async function activeSnapshot(id) {
    if (!SUPPORTED_PROVIDER_IDS.includes(id)) return null;
    try { return JSON.parse(await fsOps.readFile(snapshotPath(id), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return SEEDS[id]; throw error; }
  }
  async function persistSnapshot(id, snapshot) {
    await fsOps.mkdir(runtimeDirectory, { recursive: true });
    const target = snapshotPath(id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsOps.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await fsOps.rename(temporary, target);
    } catch (error) {
      try { await fsOps.unlink(temporary); } catch { /* no temporary file */ }
      throw error;
    }
  }
  async function refresh(id, refreshDate) {
    if (!SUPPORTED_PROVIDER_IDS.includes(id)) return { ok: false, status: 400, error: supportedError(id) };
    const currentSnapshot = await activeSnapshot(id);
    if (!validateProviderSnapshot(currentSnapshot).ok) {
      return { ok: false, status: 422, error: 'The current provider snapshot is invalid and cannot be refreshed safely.' };
    }
    const pages = {};
    try {
      for (const entry of currentSnapshot.entries) {
        const requestOptions = { headers: { 'User-Agent': 'income-portfolio-analyzer/1.0' } };
        // The dynamic Vanguard endpoint requires an identified client. Keep
        // Fidelity's established one-argument fetch untouched.
        const response = id === 'vanguard'
          ? await fetchImpl(entry.facts.name.sourceUrl, requestOptions)
          : await fetchImpl(entry.facts.name.sourceUrl);
        if (!response?.ok) return { ok: false, status: 502, error: `Refresh failed for ${entry.symbol}: the official source returned HTTP ${response?.status ?? 'an invalid response'}.` };
        if (!isOfficialResponseUrl(response.url, id)) return { ok: false, status: 422, error: `Refresh failed for ${entry.symbol}: the final response URL must remain on the official ${id} domain.` };
        const page = { finalUrl: response.url, text: await response.text() };
        if (id === 'vanguard') {
          const dynamicResponse = await fetchImpl(vanguardDynamicYieldUrl(entry.symbol), requestOptions);
          if (!dynamicResponse?.ok) return { ok: false, status: 502, error: `Refresh failed for ${entry.symbol}: the official Vanguard yield source returned HTTP ${dynamicResponse?.status ?? 'an invalid response'}.` };
          if (!isOfficialResponseUrl(dynamicResponse.url, id)) return { ok: false, status: 422, error: `Refresh failed for ${entry.symbol}: the final response URL must remain on the official ${id} domain.` };
          page.dynamicFinalUrl = dynamicResponse.url;
          page.dynamicText = await dynamicResponse.text();
        }
        pages[entry.symbol] = page;
      }
    } catch {
      return { ok: false, status: 502, error: `Refresh failed: unable to reach the official ${id} source. Check your connection and try again.` };
    }
    const candidate = refreshProviderSnapshot({ currentSnapshot, refreshDate, pages });
    if (!candidate.accepted) return { ok: false, status: 422, error: candidate.error };
    try { await persistSnapshot(id, candidate.snapshot); }
    catch { return { ok: false, status: 500, error: 'Refresh was verified but could not be saved. Your previous data remains active; try again.' }; }
    return { ok: true, status: 200, snapshot: candidate.snapshot };
  }
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Chrome asks for this conventional path when no icon has been discovered
    // yet. The declared SVG is the real icon; this harmless fallback prevents
    // an automatic browser request from becoming a page-console error.
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
      res.end();
      return;
    }
    // Keep an empty provider identifier on the API surface. Without this
    // explicit branch it falls through to static-file handling and loses the
    // actionable supported-provider message that every other bad identifier
    // receives.
    const emptyProviderAction = url.pathname.match(/^\/api\/providers\/\/(snapshot|active-snapshot|refresh)$/)
      || (url.pathname === '/api/active-snapshot/' ? ['active-snapshot'] : null);
    if (emptyProviderAction) {
      return sendJson(res, 400, { ok: false, error: supportedError('') });
    }
    const match = url.pathname.match(/^\/api\/providers\/([^/]+)\/(snapshot|active-snapshot|refresh)$/)
      || url.pathname.match(/^\/api\/active-snapshot\/([^/]+)$/)?.concat('snapshot');
    if (match) {
      const id = decodeURIComponent(match[1]); const action = match[2];
      if (!SUPPORTED_PROVIDER_IDS.includes(id)) return sendJson(res, 400, { ok: false, error: supportedError(id) });
      if ((action === 'snapshot' || action === 'active-snapshot') && req.method === 'GET') {
        try { return sendJson(res, 200, { ok: true, snapshot: await activeSnapshot(id) }); }
        catch { return sendJson(res, 500, { ok: false, error: 'The active provider snapshot could not be read.' }); }
      }
      if (action === 'refresh' && req.method === 'POST') {
        let supplied = {};
        try { const body = await readRequestBody(req); supplied = body ? JSON.parse(body) : {}; }
        catch { return sendJson(res, 400, { ok: false, error: 'Refresh request must contain valid JSON.' }); }
        const result = await refresh(id, supplied.refreshDate || now());
        return sendJson(res, result.status, result.ok ? { ok: true, snapshot: result.snapshot } : { ok: false, error: result.error });
      }
      return sendJson(res, 405, { ok: false, error: 'Use GET for an active snapshot or POST to refresh provider data.' });
    }
    const relativePath = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(root, relativePath));
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
    try { const data = await fsOps.readFile(filePath); res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
  };
}
export const createServer = (options) => http.createServer(createRequestHandler(options));
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(PORT, () => console.log(`Income Portfolio Analyzer running at http://localhost:${PORT}`));
