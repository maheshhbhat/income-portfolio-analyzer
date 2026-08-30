import { computeFixedInflationComparison, computeRetirementPlan } from './src/lib/retirement.js';
import { computeRetirementScenarios } from './src/lib/retirementScenarios.js';
import { computeRequiredPortfolio } from './src/lib/requiredPortfolio.js';
import { computeMaxSustainableWithdrawal } from './src/lib/maxSustainableWithdrawal.js';
import { computeLegacyWithdrawal } from './src/lib/legacyWithdrawal.js';
import { computeSpendingGuardrail } from './src/lib/spendingGuardrail.js';
import { SECURITIES } from './src/data/securities.js';
import { selectProvider } from './src/data/providers/index.js';

const form = document.getElementById('allocation-form');
const errorEl = document.getElementById('form-error');
const resultsEl = document.getElementById('results');
const verdictBanner = document.getElementById('verdict-banner');
const unreachableBanner = document.getElementById('unreachable-banner');
const summaryYield = document.getElementById('summary-yield');
const summaryGrowth = document.getElementById('summary-growth');
const summaryTotalReturn = document.getElementById('summary-total-return');
const summaryAllocated = document.getElementById('summary-allocated');
const allocationBody = document.getElementById('allocation-body');
const projectionBody = document.getElementById('projection-body');
const providerSelect = document.getElementById('provider-select');
const refreshDataButton = document.getElementById('refresh-data');
const providerStatus = document.getElementById('provider-status');
const providerError = document.getElementById('provider-error');
const comparisonSubmit = document.getElementById('comparison-submit');
const comparisonError = document.getElementById('comparison-error');
const comparisonResults = document.getElementById('comparison-results');
const comparisonSummary = document.getElementById('comparison-summary');
const comparisonProjections = document.getElementById('comparison-projections');
const scenarioComparisonSubmit = document.getElementById('scenario-comparison-submit');
const scenarioComparisonError = document.getElementById('scenario-comparison-error');
const scenarioComparisonResults = document.getElementById('scenario-comparison-results');
const scenarioComparisonSummary = document.getElementById('scenario-comparison-summary');
const scenarioComparisonProjections = document.getElementById('scenario-comparison-projections');
const scenarioDeterministicDisclosure = document.getElementById('scenario-deterministic-disclosure');
const scenarioSimplificationDisclosure = document.getElementById('scenario-simplification-disclosure');
const scenarioSequenceDisclosure = document.getElementById('scenario-sequence-disclosure');
const legacyWithdrawalForm = document.getElementById('legacy-withdrawal-form');
const legacyWithdrawalError = document.getElementById('legacy-withdrawal-error');
const legacyWithdrawalRefusal = document.getElementById('legacy-withdrawal-refusal');
const legacyWithdrawalResults = document.getElementById('legacy-withdrawal-results');
const legacyWithdrawalBanner = document.getElementById('legacy-withdrawal-banner');
const legacyWithdrawalValue = document.getElementById('legacy-withdrawal-value');
const legacyEndingBalance = document.getElementById('legacy-ending-balance');
const legacyCatalogReturn = document.getElementById('legacy-catalog-return');
const legacyAllocationBody = document.getElementById('legacy-allocation-body');
const legacyProjectionBody = document.getElementById('legacy-projection-body');
const spendingGuardrailForm = document.getElementById('spending-guardrail-form');
const spendingGuardrailError = document.getElementById('spending-guardrail-error');
const spendingGuardrailResults = document.getElementById('spending-guardrail-results');
const spendingGuardrailUnreachable = document.getElementById('spending-guardrail-unreachable');
const spendingGuardrailTrigger = document.getElementById('spending-guardrail-trigger');
const spendingGuardrailSummary = document.getElementById('spending-guardrail-summary');
const spendingGuardrailSteadyBody = document.getElementById('spending-guardrail-steady-body');
const spendingGuardrailGuardrailBody = document.getElementById('spending-guardrail-guardrail-body');

let activeProviderSnapshot = null;

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percent = (value) => `${(value * 100).toFixed(2)}%`;

const TYPE_LABELS = {
  stock: 'Stock',
  etf: 'ETF',
  reit: 'REIT',
  'covered-call-etf': 'Covered Call ETF',
  'bond-etf': 'Bond ETF'
};
const formatType = (type) => TYPE_LABELS[type] || type;

function parseUsdInputToCents(value) {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return NaN;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) return NaN;

  const [dollars, cents = ''] = trimmed.split('.');
  const normalizedCents = `${cents}00`.slice(0, 2);
  const centsText = `${dollars}${normalizedCents}`.replace(/^0+(?=\d)/, '');
  const amountCents = Number(centsText || '0');
  return Number.isSafeInteger(amountCents) ? amountCents : NaN;
}

// The core consumes a non-negative rate as an exact parts-per-million fraction.
// This parser accepts a percentage entry only when its conversion to that scale
// is exact; it never rounds a finer user-entered value.
function parsePercentInputToRatePpm(value) {
  const trimmed = `${value ?? ''}`.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return NaN;
  const [whole, fraction = ''] = trimmed.split('.');
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  const decimalPlaces = fraction.length;
  const ppmShift = 4 - decimalPlaces;
  if (ppmShift < 0 && /[1-9]/.test(digits.slice(ppmShift))) return NaN;
  const ppmText = ppmShift >= 0
    ? `${digits}${'0'.repeat(ppmShift)}`
    : digits.slice(0, ppmShift) || '0';
  const ratePpm = Number(ppmText);
  return Number.isSafeInteger(ratePpm) ? ratePpm : NaN;
}

function parsePercentInputToRate(value) {
  const ratePpm = parsePercentInputToRatePpm(value);
  return Number.isNaN(ratePpm) ? NaN : ratePpm / 1000000;
}

function formatUsdCents(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const negative = cents < 0;
  const absoluteCents = Math.abs(cents);
  const wholeDollars = Math.floor(absoluteCents / 100);
  const centsPart = `${absoluteCents % 100}`.padStart(2, '0');
  const groupedDollars = wholeDollars.toLocaleString('en-US');
  return `${negative ? '-' : ''}$${groupedDollars}.${centsPart}`;
}

export function sourceCell(line, documentRef = document) {
  const cell = documentRef.createElement('td');
  const sourceUrl = line.facts?.name?.sourceUrl
    || activeProviderSnapshot?.entries.find((entry) => entry.symbol === line.symbol)?.facts?.name?.sourceUrl;
  if (sourceUrl) {
    const link = documentRef.createElement('a');
    link.href = sourceUrl;
    link.textContent = 'Official source';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `Official ${line.symbol} source`);
    cell.appendChild(link);
  } else {
    cell.textContent = '—';
  }
  return cell;
}

export function allocationRow(line, amount, documentRef = document) {
  const row = documentRef.createElement('tr');
  for (const value of [line.symbol, line.name, formatType(line.type), percent(line.yield), percent(line.growthRate), percent(line.totalReturn), amount, percent(line.percentOfPortfolio)]) {
    const cell = documentRef.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
    if (value === line.name) row.appendChild(sourceCell(line, documentRef));
  }
  return row;
}

function setProviderStatus() {
  const providerId = providerSelect.value;
  refreshDataButton.hidden = providerId === 'illustrative';
  if (providerId === 'illustrative') {
    providerStatus.textContent = 'Illustrative comparison data is selected. It is not real-time market data.';
    return;
  }
  if (activeProviderSnapshot?.providerId === providerId) {
    const name = providerId === 'vanguard' ? 'Vanguard' : 'Fidelity';
    providerStatus.textContent = `${name} data active as of ${activeProviderSnapshot.asOf}. This comparison is illustrative, not financial advice, and is not endorsed by ${name}.`;
  }
}

async function selectedSecurities() {
  if (providerSelect.value === 'illustrative') return SECURITIES;
  const providerId = providerSelect.value;
  const response = await fetch(`/api/providers/${providerId}/snapshot`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'The active provider snapshot could not be loaded.');
  activeProviderSnapshot = payload.snapshot;
  const selected = selectProvider(providerId, { [providerId]: activeProviderSnapshot });
  if (!selected.ok) throw new Error(selected.error);
  setProviderStatus();
  return selected.securities;
}

function showProviderError(message) {
  providerError.textContent = message;
  providerError.hidden = false;
}

providerSelect.addEventListener('change', async () => {
  providerError.hidden = true;
  activeProviderSnapshot = null;
  setProviderStatus();
  if (providerSelect.value !== 'illustrative') {
    try { await selectedSecurities(); } catch (error) { showProviderError(error.message); }
  }
});

refreshDataButton.addEventListener('click', async () => {
  const providerId = providerSelect.value;
  providerError.hidden = true;
  refreshDataButton.disabled = true;
  refreshDataButton.textContent = 'Refreshing…';
  try {
    const response = await fetch(`/api/providers/${providerId}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Refresh failed. Your previous data remains active.');
    activeProviderSnapshot = payload.snapshot;
    invalidateCalculatedResults();
    setProviderStatus();
  } catch (error) {
    showProviderError(`${error.message} Your last-known-good data remains active.`);
  } finally {
    refreshDataButton.disabled = false;
    refreshDataButton.textContent = 'Refresh Data';
  }
});

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultsEl.hidden = true;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function clearComparisonError() {
  if (!comparisonError) return;
  comparisonError.hidden = true;
  comparisonError.textContent = '';
}

function clearComparisonOutputs() {
  if (!comparisonResults) return;
  comparisonResults.hidden = true;
  comparisonSummary.replaceChildren?.();
  comparisonProjections.replaceChildren?.();
  comparisonSummary.innerHTML = '';
  comparisonProjections.innerHTML = '';
}

function showComparisonError(message) {
  if (!comparisonError) return;
  // Clear stale results before exposing the refusal so assistive technology
  // and the visible page never present a prior plan alongside an error.
  clearComparisonOutputs();
  comparisonError.textContent = message;
  comparisonError.hidden = false;
}

function clearScenarioComparisonError() {
  if (!scenarioComparisonError) return;
  scenarioComparisonError.hidden = true;
  scenarioComparisonError.textContent = '';
}

function clearScenarioComparisonOutputs() {
  if (!scenarioComparisonResults) return;
  scenarioComparisonResults.hidden = true;
  scenarioComparisonSummary.replaceChildren?.();
  scenarioComparisonProjections.replaceChildren?.();
  scenarioComparisonSummary.innerHTML = '';
  scenarioComparisonProjections.innerHTML = '';
  if (scenarioDeterministicDisclosure) scenarioDeterministicDisclosure.textContent = '';
  if (scenarioSimplificationDisclosure) scenarioSimplificationDisclosure.textContent = '';
  if (scenarioSequenceDisclosure) scenarioSequenceDisclosure.textContent = '';
}

function showScenarioComparisonError(message) {
  if (!scenarioComparisonError) return;
  clearScenarioComparisonOutputs();
  scenarioComparisonError.textContent = message;
  scenarioComparisonError.hidden = false;
}

/**
 * Results are tied to the snapshot used for their calculation. A successful
 * provider refresh therefore makes both calculators stale until the user
 * deliberately recalculates with the accepted snapshot.
 */
function invalidateCalculatedResults() {
  resultsEl.hidden = true;
  verdictBanner.hidden = true;
  unreachableBanner.hidden = true;
  allocationBody.innerHTML = '';
  projectionBody.innerHTML = '';
  hideRequiredOutputs();
  requiredBanner.hidden = true;
  requiredAllocationBody.innerHTML = '';
  clearComparisonError();
  clearComparisonOutputs();
  clearScenarioComparisonError();
  clearScenarioComparisonOutputs();
}

function render(result) {
  if (result.lastsFullHorizon) {
    verdictBanner.textContent =
      `Lasts all ${result.horizonYears} years — projected ending balance ${currency.format(result.endingBalance)}.`;
    verdictBanner.className = 'banner banner--success';
  } else {
    verdictBanner.textContent =
      `Depletes in year ${result.depletionYear} of ${result.horizonYears} — the portfolio can't fully fund ` +
      `the requested withdrawal for the full horizon at this allocation.`;
    verdictBanner.className = 'banner banner--danger';
  }
  verdictBanner.hidden = false;

  if (result.unreachable) {
    unreachableBanner.textContent =
      `A ${percent(result.targetRate)} annual withdrawal rate isn't achievable at reasonable total returns ` +
      `from this curated list. Showing the best achievable alternative below ` +
      `(~${percent(result.bestAchievableRate)} blended total return).`;
    unreachableBanner.hidden = false;
  } else {
    unreachableBanner.hidden = true;
  }

  summaryYield.textContent = percent(result.blendedYield);
  summaryGrowth.textContent = percent(result.blendedGrowth);
  summaryTotalReturn.textContent = percent(result.blendedTotalReturn);
  summaryAllocated.textContent = currency.format(result.totalAllocated);

  allocationBody.innerHTML = '';
  for (const line of result.allocations) {
    allocationBody.appendChild(allocationRow(line, currency.format(line.amount)));
  }

  projectionBody.innerHTML = '';
  for (const row of result.years) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.year}</td>
      <td>${currency.format(row.startingBalance)}</td>
      <td>${currency.format(row.dividendIncome)}</td>
      <td>${currency.format(row.growthAmount)}</td>
      <td>${currency.format(row.withdrawalPaid)}</td>
      <td>${currency.format(row.endingBalance)}</td>
    `;
    projectionBody.appendChild(tr);
  }

  resultsEl.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const investmentAmount = Number.parseFloat(document.getElementById('investment-amount').value);
  const desiredAnnualWithdrawal = Number.parseFloat(document.getElementById('desired-income').value);
  const horizonYears = Number.parseFloat(document.getElementById('horizon-years').value);
  const inflationRate = Number.parseFloat(document.getElementById('inflation-rate').value) / 100;

  let securities;
  try { securities = await selectedSecurities(); }
  catch (error) { showError(error.message); return; }
  const result = computeRetirementPlan({ investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate }, securities);

  if (!result.ok) {
    showError(result.error);
    return;
  }

  render(result);
});

function comparisonCard(result, label) {
  const card = document.createElement('article');
  card.className = 'comparison__card';

  const heading = document.createElement('h3');
  heading.textContent = label;
  card.appendChild(heading);

  const list = document.createElement('dl');
  const entries = [
    ['Outcome', result.lastsFullHorizon
      ? `Lasts all ${result.horizonYears} years`
      : `Depletes in year ${result.depletionYear} of ${result.horizonYears}`],
    ['Ending balance', currency.format(result.endingBalance)],
    ['Blended yield', percent(result.blendedYield)],
    ['Blended growth', percent(result.blendedGrowth)],
    ['Blended total return', percent(result.blendedTotalReturn)]
  ];

  for (const [term, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  card.appendChild(list);
  return card;
}

function comparisonProjection(result, label) {
  const section = document.createElement('section');
  section.className = 'comparison__projection';

  const heading = document.createElement('h3');
  heading.textContent = `${label} year-by-year projection`;
  section.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'allocation-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Year</th>
        <th>Starting balance</th>
        <th>Dividend income</th>
        <th>Growth</th>
        <th>Withdrawal</th>
        <th>Ending balance</th>
      </tr>
    </thead>
  `;
  const body = document.createElement('tbody');

  for (const row of result.years) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.year}</td>
      <td>${currency.format(row.startingBalance)}</td>
      <td>${currency.format(row.dividendIncome)}</td>
      <td>${currency.format(row.growthAmount)}</td>
      <td>${currency.format(row.withdrawalPaid)}</td>
      <td>${currency.format(row.endingBalance)}</td>
    `;
    body.appendChild(tr);
  }

  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function renderComparison(comparison) {
  clearComparisonError();
  clearComparisonOutputs();

  for (const scenario of comparison.scenarios) {
    comparisonSummary.appendChild(comparisonCard(scenario.result, scenario.label));
    comparisonProjections.appendChild(comparisonProjection(scenario.result, scenario.label));
  }

  comparisonResults.hidden = false;
}

async function runComparison() {
  clearComparisonError();
  clearComparisonOutputs();

  const investmentAmount = Number.parseFloat(document.getElementById('investment-amount').value);
  const desiredAnnualWithdrawal = Number.parseFloat(document.getElementById('desired-income').value);
  const horizonYears = Number.parseFloat(document.getElementById('horizon-years').value);

  const comparison = computeFixedInflationComparison(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears },
    SECURITIES
  );

  if (!comparison.ok) {
    showComparisonError(comparison.error);
    return;
  }

  renderComparison(comparison);
}

comparisonSubmit?.addEventListener('click', () => {
  runComparison();
});

function scenarioOutcome(result) {
  return result.lastsFullHorizon
    ? `Lasts all ${result.years.length} years`
    : `Depletes in year ${result.depletionYear}`;
}

function scenarioComparisonCard(result, label) {
  const card = document.createElement('article');
  card.className = 'comparison__card';

  const heading = document.createElement('h3');
  heading.textContent = label;
  card.appendChild(heading);

  const list = document.createElement('dl');
  const entries = [
    ['Outcome', scenarioOutcome(result)],
    ['Ending balance', currency.format(result.endingBalance)],
    ['Status', result.lastsFullHorizon ? 'Full horizon sustained' : 'Portfolio depleted']
  ];

  for (const [term, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  card.appendChild(list);
  return card;
}

function scenarioComparisonProjection(result, label) {
  const section = document.createElement('section');
  section.className = 'comparison__projection';

  const heading = document.createElement('h3');
  heading.textContent = `${label} year-by-year table`;
  section.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'allocation-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Year</th>
        <th>Starting balance</th>
        <th>Dividend income</th>
        <th>Growth</th>
        <th>Withdrawal</th>
        <th>Ending balance</th>
      </tr>
    </thead>
  `;
  const body = document.createElement('tbody');

  for (const row of result.years) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.year}</td>
      <td>${currency.format(row.startingBalance)}</td>
      <td>${currency.format(row.dividendIncome)}</td>
      <td>${currency.format(row.growthAmount)}</td>
      <td>${currency.format(row.withdrawalPaid)}</td>
      <td>${currency.format(row.endingBalance)}</td>
    `;
    body.appendChild(tr);
  }

  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function renderScenarioComparison(comparison) {
  clearScenarioComparisonError();
  clearScenarioComparisonOutputs();

  scenarioDeterministicDisclosure.textContent = comparison.disclosures.deterministicIllustration;
  scenarioSimplificationDisclosure.textContent = comparison.disclosures.portfolioLevelSimplification;
  scenarioSequenceDisclosure.textContent = comparison.disclosures.earlyDownturnSequence;

  scenarioComparisonSummary.appendChild(scenarioComparisonCard(comparison.steady, 'Steady scenario'));
  scenarioComparisonSummary.appendChild(scenarioComparisonCard(comparison.earlyDownturn, 'Early downturn scenario'));
  scenarioComparisonProjections.appendChild(scenarioComparisonProjection(comparison.steady, 'Steady scenario'));
  scenarioComparisonProjections.appendChild(scenarioComparisonProjection(comparison.earlyDownturn, 'Early downturn scenario'));

  scenarioComparisonResults.hidden = false;
}

function runScenarioComparison() {
  clearScenarioComparisonError();
  clearScenarioComparisonOutputs();

  const investmentAmount = Number.parseFloat(document.getElementById('investment-amount').value);
  const desiredAnnualWithdrawal = Number.parseFloat(document.getElementById('desired-income').value);
  const horizonYears = Number.parseFloat(document.getElementById('horizon-years').value);
  const inflationRate = Number.parseFloat(document.getElementById('inflation-rate').value) / 100;

  const comparison = computeRetirementScenarios(
    { investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate },
    SECURITIES
  );

  if (!comparison.ok) {
    showScenarioComparisonError(comparison.error);
    return;
  }

  renderScenarioComparison(comparison);
}

scenarioComparisonSubmit?.addEventListener('click', () => {
  runScenarioComparison();
});

function clearSpendingGuardrailError() {
  spendingGuardrailError.hidden = true;
  spendingGuardrailError.textContent = '';
}

function clearSpendingGuardrailOutputs() {
  spendingGuardrailResults.hidden = true;
  spendingGuardrailUnreachable.hidden = true;
  spendingGuardrailUnreachable.textContent = '';
  spendingGuardrailTrigger.hidden = true;
  spendingGuardrailTrigger.textContent = '';
  spendingGuardrailSummary.replaceChildren();
  spendingGuardrailSteadyBody.replaceChildren();
  spendingGuardrailGuardrailBody.replaceChildren();
}

function showSpendingGuardrailError(message) {
  // A refusal is a complete browser outcome. Clear before it becomes visible so
  // no prior money result can be mistaken for a response to this submission.
  clearSpendingGuardrailOutputs();
  spendingGuardrailError.textContent = message;
  spendingGuardrailError.hidden = false;
}

function spendingGuardrailCard(label, path) {
  const card = document.createElement('article');
  card.className = 'comparison__card';
  const heading = document.createElement('h3');
  heading.textContent = label;
  card.appendChild(heading);
  const list = document.createElement('dl');
  for (const [term, value] of [
    ['Total withdrawals paid', formatUsdCents(path.totalWithdrawalsPaidCents)],
    ['Ending balance', formatUsdCents(path.endingBalanceCents)]
  ]) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    list.append(dt, dd);
  }
  card.appendChild(list);
  return card;
}

function appendSpendingGuardrailRows(body, rows) {
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of [
      row.year,
      formatUsdCents(row.startingBalanceCents),
      formatUsdCents(row.dividendIncomeCents),
      formatUsdCents(row.growthAmountCents),
      formatUsdCents(row.withdrawalPaidCents),
      formatUsdCents(row.endingBalanceCents)
    ]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function renderSpendingGuardrail(result) {
  clearSpendingGuardrailError();
  clearSpendingGuardrailOutputs();
  spendingGuardrailSummary.append(
    spendingGuardrailCard('Steady plan', result.steady),
    spendingGuardrailCard('Spending guardrail plan', result.guardrail)
  );
  appendSpendingGuardrailRows(spendingGuardrailSteadyBody, result.steady.rows);
  appendSpendingGuardrailRows(spendingGuardrailGuardrailBody, result.guardrail.rows);

  if (result.allocation.unreachable) {
    spendingGuardrailUnreachable.textContent =
      'Requested withdrawal rate is unreachable from the curated list. Showing the shared best-achievable allocation.';
    spendingGuardrailUnreachable.hidden = false;
  }
  spendingGuardrailTrigger.textContent = result.guardrail.floorReached
    ? `Safety floor triggered in year ${result.guardrail.triggerYear}; the reduction applies from that year forward.`
    : 'Safety floor not reached within the selected horizon.';
  spendingGuardrailTrigger.hidden = false;
  spendingGuardrailResults.hidden = false;
}

function runSpendingGuardrailComparison() {
  clearSpendingGuardrailError();
  clearSpendingGuardrailOutputs();
  const investmentAmountCents = parseUsdInputToCents(document.getElementById('spending-guardrail-portfolio').value);
  const desiredAnnualWithdrawalCents = parseUsdInputToCents(document.getElementById('spending-guardrail-withdrawal').value);
  const safetyFloorCents = parseUsdInputToCents(document.getElementById('spending-guardrail-floor').value);
  const horizonYears = Number(document.getElementById('spending-guardrail-horizon').value);
  const inflationRate = parsePercentInputToRate(document.getElementById('spending-guardrail-inflation').value);
  const reductionInput = document.getElementById('spending-guardrail-reduction').value;
  const reductionRatePpm = parsePercentInputToRatePpm(reductionInput);
  const postTriggerReductionPercent = Number.isNaN(reductionRatePpm) ? NaN : Number(reductionInput);

  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    showSpendingGuardrailError('Starting portfolio must be a plain dollar amount greater than $0 with at most two decimal places.');
    return;
  }
  if (!Number.isSafeInteger(desiredAnnualWithdrawalCents) || desiredAnnualWithdrawalCents < 0) {
    showSpendingGuardrailError('Desired annual withdrawal must be a plain non-negative dollar amount with at most two decimal places.');
    return;
  }
  if (!Number.isSafeInteger(safetyFloorCents) || safetyFloorCents < 0) {
    showSpendingGuardrailError('Safety-floor balance must be a plain non-negative dollar amount with at most two decimal places.');
    return;
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    showSpendingGuardrailError('Retirement horizon must be a whole number of at least 1.');
    return;
  }
  if (!Number.isFinite(inflationRate)) {
    showSpendingGuardrailError('Inflation must map exactly to the supported 0.000001 rate scale; finer precision is not accepted.');
    return;
  }
  if (!Number.isFinite(postTriggerReductionPercent) || postTriggerReductionPercent > 100) {
    showSpendingGuardrailError('Post-trigger reduction must be between 0% and 100% and map exactly to the supported rate scale.');
    return;
  }

  // This flow deliberately passes the product-owned constant directly to the
  // pure core and has no external-data dependency.
  const result = computeSpendingGuardrail({
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    inflationRate,
    safetyFloorCents,
    postTriggerReductionPercent
  }, SECURITIES);

  if (!result.ok) {
    showSpendingGuardrailError(result.reason === 'safe-arithmetic-refusal'
      ? `This request exceeds the calculator's safe arithmetic range: ${result.error}`
      : result.error);
    return;
  }
  renderSpendingGuardrail(result);
}

spendingGuardrailForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  runSpendingGuardrailComparison();
});

// --- Required starting portfolio section ---

const requiredForm = document.getElementById('required-form');
const requiredErrorEl = document.getElementById('required-error');
const requiredUnverifiedEl = document.getElementById('required-unverified');
const requiredUnverifiedMessage = document.getElementById('required-unverified-message');
const requiredRetryButton = document.getElementById('required-retry');
const requiredResultsEl = document.getElementById('required-results');
const requiredBanner = document.getElementById('required-banner');
const requiredPortfolioValue = document.getElementById('required-portfolio-value');
const requiredYield = document.getElementById('required-yield');
const requiredGrowth = document.getElementById('required-growth');
const requiredTotalReturn = document.getElementById('required-total-return');
const requiredAllocationBody = document.getElementById('required-allocation-body');

// Money is integer cents inside the computation; cents become dollars only
// here, at the display edge.
const centsToDisplay = (cents) => formatUsdCents(cents);

function hideRequiredOutputs() {
  requiredErrorEl.hidden = true;
  requiredErrorEl.textContent = '';
  requiredUnverifiedEl.hidden = true;
  requiredUnverifiedMessage.textContent = '';
  requiredResultsEl.hidden = true;
}

function renderRequired(result, horizonYears) {
  requiredBanner.textContent =
    `Smallest starting portfolio under this model's fixed, illustrative blended rates: ` +
    `${centsToDisplay(result.requiredPortfolioCents)} sustains the plan for all ${horizonYears} years ` +
    `(settled in ${result.rounds} round${result.rounds === 1 ? '' : 's'}). This is minimal only for ` +
    `these settled rates — not a minimum across all possible allocations — and is an illustration ` +
    `under fixed model assumptions, not a forecast or advice.`;
  requiredBanner.hidden = false;

  requiredPortfolioValue.textContent = centsToDisplay(result.requiredPortfolioCents);
  requiredYield.textContent = percent(result.blendedYield);
  requiredGrowth.textContent = percent(result.blendedGrowth);
  requiredTotalReturn.textContent = percent(result.blendedTotalReturn);

  requiredAllocationBody.innerHTML = '';
  for (const line of result.allocation) {
    requiredAllocationBody.appendChild(allocationRow(line, centsToDisplay(line.amountCents)));
  }

  requiredResultsEl.hidden = false;
}

async function runRequiredComputation() {
  hideRequiredOutputs();

  const withdrawalDollars = Number.parseFloat(document.getElementById('required-withdrawal').value);
  const horizonYears = Number.parseFloat(document.getElementById('required-horizon').value);
  const inflationRate = Number.parseFloat(document.getElementById('required-inflation').value) / 100;

  // Convert the entered dollar amount to integer cents at this edge; a
  // non-numeric entry becomes NaN, which the module rejects with an
  // actionable invalid-input message.
  const desiredAnnualWithdrawalCents = Number.isFinite(withdrawalDollars)
    ? Math.round(withdrawalDollars * 100)
    : NaN;

  let securities;
  try { securities = await selectedSecurities(); }
  catch (error) { requiredErrorEl.textContent = error.message; requiredErrorEl.hidden = false; return; }
  const result = computeRequiredPortfolio(
    { desiredAnnualWithdrawalCents, horizonYears, inflationRate },
    securities
  );

  if (!result.ok) {
    if (result.reason === 'no-verified-result') {
      requiredUnverifiedMessage.textContent =
        `The product could not calculate a verified result for these inputs. ` +
        `No unverified figure is shown. ${result.error}`;
      requiredUnverifiedEl.hidden = false;
    } else {
      requiredErrorEl.textContent = result.error;
      requiredErrorEl.hidden = false;
    }
    return;
  }

  renderRequired(result, horizonYears);
}

requiredForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runRequiredComputation();
});

requiredRetryButton.addEventListener('click', () => {
  runRequiredComputation();
});

// --- Maximum sustainable withdrawal section ---
// This flow is intentionally bound directly to the repository's illustrative
// curated list. It has no provider-selection, snapshot, or refresh dependency.

const maximumWithdrawalForm = document.getElementById('maximum-withdrawal-form');
const maximumWithdrawalError = document.getElementById('maximum-withdrawal-error');
const maximumWithdrawalRefusal = document.getElementById('maximum-withdrawal-refusal');
const maximumWithdrawalResults = document.getElementById('maximum-withdrawal-results');
const maximumWithdrawalBanner = document.getElementById('maximum-withdrawal-banner');
const maximumWithdrawalValue = document.getElementById('maximum-withdrawal-value');
const maximumTotalReturn = document.getElementById('maximum-total-return');
const maximumAllocationBody = document.getElementById('maximum-allocation-body');
const maximumProjectionBody = document.getElementById('maximum-projection-body');

function clearMaximumWithdrawalOutputs() {
  if (!maximumWithdrawalResults) return;
  maximumWithdrawalError.hidden = true;
  maximumWithdrawalError.textContent = '';
  maximumWithdrawalRefusal.hidden = true;
  maximumWithdrawalRefusal.textContent = '';
  maximumWithdrawalResults.hidden = true;
  maximumWithdrawalBanner.hidden = true;
  maximumAllocationBody.innerHTML = '';
  maximumProjectionBody.innerHTML = '';
}

function maximumWithdrawalInput() {
  const portfolioDollars = Number.parseFloat(document.getElementById('maximum-portfolio').value);
  const horizonYears = Number.parseFloat(document.getElementById('maximum-horizon').value);
  const inflationRate = Number.parseFloat(document.getElementById('maximum-inflation').value) / 100;
  const investmentAmountCents = portfolioDollars * 100;
  if (!Number.isSafeInteger(investmentAmountCents)) {
    return { error: 'Enter a starting portfolio greater than $0 in whole cents.' };
  }
  return { input: { investmentAmountCents, horizonYears, inflationRate } };
}

function renderMaximumWithdrawal(result) {
  maximumWithdrawalBanner.textContent =
    `${centsToDisplay(result.maxAnnualWithdrawalCents)} is the highest verified first-year annual withdrawal that lasts all ${result.horizonYears} years; increasing it by $0.01 fails the supporting projection.`;
  maximumWithdrawalBanner.hidden = false;
  maximumWithdrawalValue.textContent = centsToDisplay(result.maxAnnualWithdrawalCents);
  maximumTotalReturn.textContent = percent(result.blendedTotalReturn);

  maximumAllocationBody.innerHTML = '';
  for (const line of result.allocation) {
    const row = document.createElement('tr');
    for (const value of [line.symbol, line.name, formatType(line.type), percent(line.yield), percent(line.growthRate), percent(line.totalReturn), centsToDisplay(line.amountCents), percent(line.percentOfPortfolio)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    maximumAllocationBody.appendChild(row);
  }

  maximumProjectionBody.innerHTML = '';
  for (const year of result.projection.years) {
    const row = document.createElement('tr');
    for (const value of [year.year, currency.format(year.startingBalance), currency.format(year.dividendIncome), currency.format(year.growthAmount), currency.format(year.withdrawalPaid), currency.format(year.endingBalance)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    maximumProjectionBody.appendChild(row);
  }
  maximumWithdrawalResults.hidden = false;
}

function runMaximumWithdrawalComputation() {
  clearMaximumWithdrawalOutputs();
  const parsed = maximumWithdrawalInput();
  if (parsed.error) {
    maximumWithdrawalError.textContent = parsed.error;
    maximumWithdrawalError.hidden = false;
    return;
  }
  const result = computeMaxSustainableWithdrawal(parsed.input, SECURITIES);
  if (!result.ok) {
    const target = result.reason === 'no-verified-result' ? maximumWithdrawalRefusal : maximumWithdrawalError;
    target.textContent = result.reason === 'no-verified-result'
      ? `A verified maximum withdrawal could not be calculated for these inputs. No unverified figure is shown. ${result.error}`
      : result.error;
    target.hidden = false;
    return;
  }
  renderMaximumWithdrawal(result);
}

maximumWithdrawalForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  runMaximumWithdrawalComputation();
});

// --- Legacy withdrawal section ---
// This flow is intentionally illustrative-only. It always uses the fixed
// product-owned catalog from SECURITIES and never provider state or refreshes.

function clearLegacyWithdrawalOutputs() {
  if (!legacyWithdrawalResults) return;
  legacyWithdrawalError.hidden = true;
  legacyWithdrawalError.textContent = '';
  legacyWithdrawalRefusal.hidden = true;
  legacyWithdrawalRefusal.textContent = '';
  legacyWithdrawalResults.hidden = true;
  legacyWithdrawalBanner.hidden = true;
  legacyWithdrawalValue.textContent = '—';
  legacyEndingBalance.textContent = '—';
  legacyCatalogReturn.textContent = '—';
  legacyAllocationBody.innerHTML = '';
  legacyProjectionBody.innerHTML = '';
}

function legacyWithdrawalInput() {
  const investmentAmountCents = parseUsdInputToCents(document.getElementById('legacy-portfolio').value);
  const horizonYears = Number.parseFloat(document.getElementById('legacy-horizon').value);
  const inflationRate = Number.parseFloat(document.getElementById('legacy-inflation').value) / 100;
  const endingBalanceFloorInput = document.getElementById('legacy-ending-balance-floor').value;
  const endingBalanceFloorCents = parseUsdInputToCents(endingBalanceFloorInput);

  if (`${endingBalanceFloorInput ?? ''}`.trim().startsWith('-')) {
    return { error: 'Desired ending balance must be zero or greater.' };
  }

  if (!Number.isSafeInteger(investmentAmountCents) || !Number.isSafeInteger(endingBalanceFloorCents)) {
    return { error: 'Enter the starting portfolio and desired ending balance in whole cents.' };
  }

  return { input: { investmentAmountCents, horizonYears, inflationRate, endingBalanceFloorCents } };
}

function renderLegacyWithdrawal(result) {
  legacyWithdrawalBanner.textContent =
    `${centsToDisplay(result.maxAnnualWithdrawalCents)} is the highest verified first-year annual withdrawal across the displayed fixed allocation catalog. ` +
    `For the displayed winning allocation, increasing that withdrawal by $0.01 fails the requested ending-balance floor. ` +
    `This deterministic illustrative result is not financial advice.`;
  legacyWithdrawalBanner.hidden = false;
  legacyWithdrawalValue.textContent = centsToDisplay(result.maxAnnualWithdrawalCents);
  legacyEndingBalance.textContent = centsToDisplay(result.projection.endingBalanceCents);
  legacyCatalogReturn.textContent = percent(result.catalogEntry.totalReturn);

  legacyAllocationBody.innerHTML = '';
  for (const line of result.allocation) {
    const row = document.createElement('tr');
    for (const value of [line.symbol, line.name, formatType(line.type), percent(line.yield), percent(line.growthRate), percent(line.canonicalReturnRate / 1000), centsToDisplay(line.amountCents), percent(line.percentOfPortfolio)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    legacyAllocationBody.appendChild(row);
  }

  legacyProjectionBody.innerHTML = '';
  for (const year of result.projection.years) {
    const row = document.createElement('tr');
    for (const value of [year.year, formatUsdCents(year.startingBalanceCents), formatUsdCents(year.returnCents), formatUsdCents(year.withdrawalCents), formatUsdCents(year.endingBalanceCents)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    legacyProjectionBody.appendChild(row);
  }

  legacyWithdrawalResults.hidden = false;
}

function runLegacyWithdrawalComputation() {
  clearLegacyWithdrawalOutputs();
  const parsed = legacyWithdrawalInput();
  if (parsed.error) {
    legacyWithdrawalError.textContent = parsed.error;
    legacyWithdrawalError.hidden = false;
    return;
  }

  const result = computeLegacyWithdrawal(parsed.input, SECURITIES);
  if (!result.ok) {
    const target = result.reason === 'no-verified-result' ? legacyWithdrawalRefusal : legacyWithdrawalError;
    target.textContent = result.reason === 'no-verified-result'
      ? `No verified result could be calculated for these inputs. No unverified withdrawal is shown. ${result.error}`
      : result.error;
    target.hidden = false;
    return;
  }

  renderLegacyWithdrawal(result);
}

legacyWithdrawalForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  runLegacyWithdrawalComputation();
});
