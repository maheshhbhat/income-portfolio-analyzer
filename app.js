import { computeRetirementPlan } from './src/lib/retirement.js';
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
