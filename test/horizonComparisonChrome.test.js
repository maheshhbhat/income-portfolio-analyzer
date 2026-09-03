import { test, expect } from '@playwright/test';
import { computeRetirementHorizonComparison } from '../src/lib/retirementHorizonComparison.js';
import { SECURITIES } from '../src/data/securities.js';

const INPUT = Object.freeze({
  investmentAmount: 1_000_000,
  desiredAnnualWithdrawal: 40_000,
  inflationRate: 0.03
});
const LABELS = [
  'Short horizon (20 years)',
  'Standard horizon (30 years)',
  'Long horizon (40 years)'
];
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function submitRepresentativeComparison(page, providerId) {
  await page.evaluate(({ providerId: selectedProvider, input }) => {
    // Deliberately set the selector without firing its provider-loading change
    // event. The assertion below concerns the horizon action while provider
    // state points at either supported provider.
    document.getElementById('provider-select').value = selectedProvider;
    document.getElementById('investment-amount').value = String(input.investmentAmount);
    document.getElementById('desired-income').value = String(input.desiredAnnualWithdrawal);
    document.getElementById('inflation-rate').value = String(input.inflationRate * 100);
  }, { providerId, input: INPUT });

  return page.evaluate(() => new Promise((resolve, reject) => {
    const results = document.getElementById('horizon-comparison-results');
    const summary = document.getElementById('horizon-comparison-summary');
    const projections = document.getElementById('horizon-comparison-projections');
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('horizon comparison did not become visible within 1,000 ms'));
    }, 1_000);
    const observeResult = () => {
      if (results.hidden || summary.children.length !== 3 || projections.children.length !== 3) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(performance.now() - startedAt);
    };
    const observer = new MutationObserver(observeResult);
    observer.observe(results, { attributes: true, childList: true, subtree: true });
    document.getElementById('horizon-comparison-submit').click();
    observeResult();
  }));
}

test('OE-SCALE-1, OE-RESP-1, OE-PROVIDER-1, and OE-DEGRADE-1: the integrated horizon surface passes in headless branded Chrome', async ({ page, browser }, testInfo) => {
  expect(testInfo.project.name).toBe('chrome');
  expect(testInfo.project.use.channel).toBe('chrome');
  expect(testInfo.project.use.headless).toBe(true);

  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    networkErrors.push(`REQUEST FAILED ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });

  const providerRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/providers/')) providerRequests.push(request.url());
  });

  await page.goto('/');

  const identity = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData?.brands?.map(({ brand }) => brand) ?? []
  }));
  expect(identity.userAgent).toContain('Chrome/');
  expect(identity.userAgent).not.toContain('Chromium/');
  expect(identity.brands).toContain('Google Chrome');
  expect(browser.version()).toMatch(/^\d+\.\d+/);

  const expected = computeRetirementHorizonComparison(INPUT, SECURITIES);
  expect(expected.ok).toBe(true);

  for (const providerId of ['vanguard', 'fidelity']) {
    const elapsedMilliseconds = await submitRepresentativeComparison(page, providerId);
    expect(elapsedMilliseconds, `${providerId} click-to-visible render time`).toBeLessThan(1_000);

    await expect(page.locator('#horizon-comparison-results')).toBeVisible();
    await expect(page.locator('#horizon-comparison-error')).toBeHidden();
    await expect(page.locator('#horizon-comparison-summary > article > h3')).toHaveText(LABELS);
    await expect(page.locator('#horizon-comparison-projections > section > h3')).toHaveText(
      LABELS.map((label) => `${label} year-by-year projection`)
    );
    await expect(page.locator('#horizon-comparison-projections tbody')).toHaveCount(3);
    expect(await page.locator('#horizon-comparison-projections tbody').evaluateAll(
      (tables) => tables.map((table) => table.rows.length)
    )).toEqual([20, 30, 40]);

    const renderedEndingBalances = await page.locator('#horizon-comparison-summary > article dl dd:nth-of-type(2)').allTextContents();
    expect(renderedEndingBalances).toEqual(
      expected.scenarios.map((scenario) => currency.format(scenario.result.endingBalance))
    );
  }

  expect(providerRequests).toEqual([]);

  const refusalState = await page.evaluate(() => {
    document.getElementById('investment-amount').value = '0';
    const error = document.getElementById('horizon-comparison-error');
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    let clearedBeforeRefusal = false;
    Object.defineProperty(error, 'hidden', {
      configurable: true,
      get() { return hiddenDescriptor.get.call(this); },
      set(value) {
        if (value === false) {
          const results = document.getElementById('horizon-comparison-results');
          const summary = document.getElementById('horizon-comparison-summary');
          const projections = document.getElementById('horizon-comparison-projections');
          clearedBeforeRefusal = results.hidden
            && summary.children.length === 0
            && projections.children.length === 0
            && summary.textContent === ''
            && projections.textContent === '';
        }
        hiddenDescriptor.set.call(this, value);
      }
    });

    document.getElementById('horizon-comparison-submit').click();
    const results = document.getElementById('horizon-comparison-results');
    return {
      clearedBeforeRefusal,
      resultsHidden: results.hidden,
      staleRows: results.querySelectorAll('tbody tr').length,
      staleMoney: /\$[\d,]+(?:\.\d{2})?/.test(results.textContent),
      refusal: error.textContent,
      disclosureHidden: document.getElementById('horizon-comparison-disclosure').hidden,
      disclosure: document.getElementById('horizon-comparison-disclosure').textContent
    };
  });

  expect(refusalState.clearedBeforeRefusal).toBe(true);
  expect(refusalState.resultsHidden).toBe(true);
  expect(refusalState.staleRows).toBe(0);
  expect(refusalState.staleMoney).toBe(false);
  expect(refusalState.refusal).toMatch(/investment amount greater than \$0/i);
  expect(refusalState.disclosureHidden).toBe(false);
  expect(refusalState.disclosure).toMatch(/illustrative comparison only/i);
  expect(refusalState.disclosure).toMatch(/not financial advice/i);
  expect({ consoleErrors, networkErrors }).toEqual({ consoleErrors: [], networkErrors: [] });
});

test('failed-resource diagnostics include the exact address and response status', async ({ page }) => {
  const failures = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()} ${response.url()}`);
  });

  const response = await page.goto('/missing-resource-diagnostic-probe');

  expect(response.status()).toBe(404);
  expect(failures).toEqual([
    'HTTP 404 http://127.0.0.1:4173/missing-resource-diagnostic-probe'
  ]);
});
