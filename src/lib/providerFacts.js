// Provider-snapshot provenance validation. This module intentionally has no IO:
// callers supply already-recorded facts and decide separately how to fetch or store them.

export const PROVIDER_OFFICIAL_HOSTS = Object.freeze({
  vanguard: Object.freeze(['investor.vanguard.com', 'personal.vanguard.com', 'advisors.vanguard.com']),
  fidelity: Object.freeze(['fundresearch.fidelity.com', 'digital.fidelity.com', 'www.fidelity.com'])
});

const ENGINE_FACTS = Object.freeze([
  ['name', 'name'],
  ['symbol', 'ticker'],
  ['yield', 'trailingYield'],
  ['growthRate', 'growth']
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isOfficialHttpsUrl(value, providerId) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return PROVIDER_OFFICIAL_HOSTS[providerId].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function entryName(entry, index) {
  return isRecord(entry) && typeof entry.symbol === 'string' && entry.symbol.trim()
    ? entry.symbol
    : `entry[${index}]`;
}

/**
 * Validates a product-owned provider snapshot without mutating it or reading
 * external state. The accepted entry shape is engine-ready fields plus facts:
 *
 * { symbol, name, type, yield, growthRate, facts: {
 *   name: { value, status: 'verified', sourceUrl, asOf },
 *   ticker: { value, status: 'verified', sourceUrl, asOf },
 *   trailingYield: { value, status: 'verified', sourceUrl, asOf },
 *   growth: { value, status: 'illustrative-estimate' }
 * }}
 *
 * @param {unknown} snapshot
 * @returns {{ok: true} | {ok: false, errors: Array<{entry: string, field: string, message: string}>}}
 */
export function validateProviderSnapshot(snapshot) {
  const errors = [];
  const add = (entry, field, message) => errors.push({ entry, field, message });

  if (!isRecord(snapshot)) {
    add('snapshot', 'snapshot', 'snapshot must be an object');
    return { ok: false, errors };
  }

  const providerId = snapshot.providerId;
  if (typeof providerId !== 'string' || !Object.hasOwn(PROVIDER_OFFICIAL_HOSTS, providerId)) {
    add('snapshot', 'providerId', 'providerId must name a supported provider');
  }
  if (!isDate(snapshot.asOf)) add('snapshot', 'asOf', 'asOf must be a valid YYYY-MM-DD date');

  if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    add('snapshot', 'entries', 'entries must be a non-empty array');
    return { ok: false, errors };
  }

  const symbols = new Set();
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const entry = snapshot.entries[index];
    const label = entryName(entry, index);
    if (!isRecord(entry)) {
      add(label, 'entry', 'entry must be an object');
      continue;
    }

    for (const field of ['symbol', 'name', 'type']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        add(label, field, `${field} must be a non-empty string`);
      }
    }
    for (const field of ['yield', 'growthRate']) {
      if (typeof entry[field] !== 'number' || !Number.isFinite(entry[field])) {
        add(label, field, `${field} must be a finite number`);
      }
    }

    if (typeof entry.symbol === 'string' && entry.symbol.trim()) {
      if (symbols.has(entry.symbol)) add(label, 'symbol', 'symbol must be unique');
      symbols.add(entry.symbol);
    }

    const facts = entry.facts;
    if (!isRecord(facts)) {
      add(label, 'facts', 'facts must be an object');
      continue;
    }

    for (const [engineField, factField] of ENGINE_FACTS.slice(0, 3)) {
      const fact = facts[factField];
      if (!isRecord(fact)) {
        add(label, factField, `${factField} provenance is required`);
        continue;
      }
      if (fact.status !== 'verified') add(label, factField, `${factField} must be verified`);
      if (fact.value !== entry[engineField]) add(label, factField, `${factField} value must match ${engineField}`);
      if (!isOfficialHttpsUrl(fact.sourceUrl, providerId)) {
        add(label, factField, `${factField} must use an HTTPS official provider source`);
      }
      if (!isDate(fact.asOf)) add(label, factField, `${factField} asOf must be a valid YYYY-MM-DD date`);
    }

    const growth = facts.growth;
    if (!isRecord(growth)) {
      add(label, 'growth', 'growth provenance is required');
    } else {
      if (growth.status !== 'illustrative-estimate') {
        add(label, 'growth', 'growth must be an illustrative-estimate');
      }
      if (growth.value !== entry.growthRate) add(label, 'growth', 'growth value must match growthRate');
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
