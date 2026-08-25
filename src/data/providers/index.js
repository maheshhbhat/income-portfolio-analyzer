// Provider selection is deliberately separate from the calculation engines.
// The engines receive the returned `securities` array and remain unaware of
// where the active set came from.

import { SECURITIES } from '../securities.js';
import { VANGUARD_SNAPSHOT } from './vanguard.js';
import { FIDELITY_SNAPSHOT } from './fidelity.js';
import { validateProviderSnapshot } from '../../lib/providerFacts.js';

export const SUPPORTED_PROVIDER_IDS = Object.freeze(['vanguard', 'fidelity']);

const COMMITTED_SNAPSHOTS = Object.freeze({
  vanguard: VANGUARD_SNAPSHOT,
  fidelity: FIDELITY_SNAPSHOT
});

function supportedSelections() {
  return `illustrative, ${SUPPORTED_PROVIDER_IDS.join(', ')}`;
}

/**
 * Selects a calculation-ready data set without reading state or mutating an
 * injected snapshot. Omitting the id intentionally preserves the exact
 * illustrative array used before provider support was added.
 *
 * @param {string|undefined} providerId
 * @param {Record<string, object>} snapshots optional active snapshots, keyed by provider id
 * @returns {{ok: true, providerId: 'illustrative'|'vanguard'|'fidelity', snapshot: object|null, securities: Array<object>}|{ok: false, error: string, supportedSelections: string[]}}
 */
export function selectProvider(providerId, snapshots = {}) {
  if (providerId === undefined) {
    return { ok: true, providerId: 'illustrative', snapshot: null, securities: SECURITIES };
  }

  if (typeof providerId !== 'string' || !SUPPORTED_PROVIDER_IDS.includes(providerId)) {
    return {
      ok: false,
      error: `Unsupported provider. Choose one of: ${supportedSelections()}.`,
      supportedSelections: ['illustrative', ...SUPPORTED_PROVIDER_IDS]
    };
  }

  const snapshot = Object.hasOwn(snapshots, providerId) ? snapshots[providerId] : COMMITTED_SNAPSHOTS[providerId];
  const validation = validateProviderSnapshot(snapshot);
  if (!validation.ok || snapshot.providerId !== providerId) {
    return {
      ok: false,
      error: `The ${providerId} snapshot is unavailable or invalid. Choose one of: ${supportedSelections()}.`,
      supportedSelections: ['illustrative', ...SUPPORTED_PROVIDER_IDS]
    };
  }

  return { ok: true, providerId, snapshot, securities: snapshot.entries };
}

export const getProviderSelection = selectProvider;
