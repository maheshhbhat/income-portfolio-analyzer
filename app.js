import { computeRetirementPlan } from './src/lib/retirement.js';
import { computeRequiredPortfolio } from './src/lib/requiredPortfolio.js';
import { SECURITIES } from './src/data/securities.js';

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

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultsEl.hidden = true;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
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
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${line.symbol}</td>
      <td>${line.name}</td>
      <td>${formatType(line.type)}</td>
      <td>${percent(line.yield)}</td>
      <td>${percent(line.growthRate)}</td>
      <td>${percent(line.totalReturn)}</td>
      <td>${currency.format(line.amount)}</td>
      <td>${percent(line.percentOfPortfolio)}</td>
    `;
    allocationBody.appendChild(row);
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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearError();

  const investmentAmount = Number.parseFloat(document.getElementById('investment-amount').value);
  const desiredAnnualWithdrawal = Number.parseFloat(document.getElementById('desired-income').value);
  const horizonYears = Number.parseFloat(document.getElementById('horizon-years').value);
  const inflationRate = Number.parseFloat(document.getElementById('inflation-rate').value) / 100;

  const result = computeRetirementPlan({ investmentAmount, desiredAnnualWithdrawal, horizonYears, inflationRate }, SECURITIES);

  if (!result.ok) {
    showError(result.error);
    return;
  }

  render(result);
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
const centsToDisplay = (cents) => currency.format(cents / 100);

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
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${line.symbol}</td>
      <td>${line.name}</td>
      <td>${formatType(line.type)}</td>
      <td>${percent(line.yield)}</td>
      <td>${percent(line.growthRate)}</td>
      <td>${percent(line.totalReturn)}</td>
      <td>${centsToDisplay(line.amountCents)}</td>
      <td>${percent(line.percentOfPortfolio)}</td>
    `;
    requiredAllocationBody.appendChild(row);
  }

  requiredResultsEl.hidden = false;
}

function runRequiredComputation() {
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

  const result = computeRequiredPortfolio(
    { desiredAnnualWithdrawalCents, horizonYears, inflationRate },
    SECURITIES
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

requiredForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runRequiredComputation();
});

requiredRetryButton.addEventListener('click', () => {
  runRequiredComputation();
});
