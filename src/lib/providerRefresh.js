// Pure refresh candidate builder. This module accepts already-fetched page text
// and final response URLs; it deliberately has no network, clock, persistence,
// browser globals, runtime state, randomness, or filesystem dependency.

import { PROVIDER_OFFICIAL_HOSTS, validateProviderSnapshot } from './providerFacts.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isOfficialFinalUrl(value, providerId) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PROVIDER_OFFICIAL_HOSTS[providerId]?.includes(url.hostname);
  } catch {
    return false;
  }
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function fieldFromText(text, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = escaped.replace(/[-_]/g, '[-_ ]');
    const patterns = [
      // Only dedicated data attributes are facts. Do not accept generic
      // attributes such as `name`, or substring aliases such as
      // `data-not-ticker`, as those can describe unrelated page controls.
      new RegExp(`(?:^|\\s)data-${escaped}\\s*=\\s*["']([^"']+)["']`, 'i'),
      // Text facts must begin at a text/line boundary and use an exact,
      // provider-page fact label. This permits ordinary HTML text while
      // rejecting incidental markers such as `not-yield: 4%`.
      new RegExp(`(?:^|[>\\n\\r])\\s*${label}\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
      new RegExp(`(?:^|[>\\n\\r])\\s*${label}\\s*[:=]\\s*([^<\\n\\r;|]+)`, 'i')
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return unquote(match[1]);
    }
  }
  return null;
}

function parseYield(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(%)?$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return match[2] ? numeric / 100 : numeric;
}

function pageForSymbol(pages, symbol) {
  if (Array.isArray(pages)) return pages.find((page) => isRecord(page) && page.symbol === symbol);
  return isRecord(pages) ? pages[symbol] : undefined;
}

/**
 * Parses a supplied official-page response. Supported factual markers are
 * `fund-name`, `ticker`/`symbol`, and `trailing-yield`/`30-day-sec-yield`,
 * either as dedicated HTML data attributes or exact `Label: value` text.
 * Values are returned only when all three can be read from the supplied text
 * and the final URL is on the selected provider's official HTTPS host.
 */
export function parseOfficialProviderPage({ providerId, text, finalUrl } = {}) {
  if (!Object.hasOwn(PROVIDER_OFFICIAL_HOSTS, providerId)) {
    return { ok: false, error: 'A supported provider id is required to parse a refresh page.' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'The official response text is missing or malformed.' };
  }
  if (!isOfficialFinalUrl(finalUrl, providerId)) {
    return { ok: false, error: `The final response URL must remain on the official ${providerId} domain.` };
  }

  const name = fieldFromText(text, ['fund-name', 'fund_name']);
  const symbol = fieldFromText(text, ['ticker', 'symbol']);
  const trailingYield = parseYield(fieldFromText(text, ['trailing-yield', 'trailing_yield', '30-day-sec-yield']));
  if (!name || !symbol || trailingYield === null) {
    return { ok: false, error: 'The official response does not contain verifiable name, ticker, and trailing yield facts.' };
  }
  return { ok: true, name, symbol, trailingYield, sourceUrl: finalUrl };
}

function rejected(currentSnapshot, error) {
  return { accepted: false, snapshot: currentSnapshot, error };
}

/**
 * Builds and atomically accepts a whole-provider candidate from supplied page
 * responses. `pages` may be an object keyed by current entry symbol or an
 * array of `{symbol, text, finalUrl}` records. A failure never alters or
 * clones the last-known-good snapshot.
 */
export function refreshProviderSnapshot({ currentSnapshot, refreshDate, pages } = {}) {
  const currentValidation = validateProviderSnapshot(currentSnapshot);
  if (!currentValidation.ok) return rejected(currentSnapshot, 'The current provider snapshot is invalid and cannot be refreshed safely.');
  if (!isDate(refreshDate)) return rejected(currentSnapshot, 'Refresh date must be a valid YYYY-MM-DD date.');

  const { providerId } = currentSnapshot;
  const entries = [];
  for (const existing of currentSnapshot.entries) {
    const page = pageForSymbol(pages, existing.symbol);
    const parsed = parseOfficialProviderPage({
      providerId,
      text: page?.text ?? page?.body ?? page?.pageText,
      finalUrl: page?.finalUrl ?? page?.responseUrl ?? page?.url
    });
    if (!parsed.ok) return rejected(currentSnapshot, `Refresh failed for ${existing.symbol}: ${parsed.error}`);
    if (parsed.symbol !== existing.symbol) {
      return rejected(currentSnapshot, `Refresh failed for ${existing.symbol}: the official page ticker does not match the expected fund.`);
    }
    const factual = (value) => ({ value, status: 'verified', sourceUrl: parsed.sourceUrl, asOf: refreshDate });
    entries.push({
      ...existing,
      name: parsed.name,
      yield: parsed.trailingYield,
      facts: {
        name: factual(parsed.name),
        ticker: factual(parsed.symbol),
        trailingYield: factual(parsed.trailingYield),
        growth: { ...existing.facts.growth }
      }
    });
  }

  const candidate = { providerId, asOf: refreshDate, entries };
  const candidateValidation = validateProviderSnapshot(candidate);
  if (!candidateValidation.ok) return rejected(currentSnapshot, 'Refresh candidate could not be fully verified and was not accepted.');
  return { accepted: true, snapshot: candidate, error: null };
}

export const buildRefreshCandidate = refreshProviderSnapshot;
