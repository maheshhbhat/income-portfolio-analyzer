import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class ChromeElement {
  constructor(tagName = 'div', { hidden = false, value = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.textContent = '';
    this._hidden = hidden;
    this._innerHTML = '';
    this.value = value;
    this.listeners = new Map();
  }

  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = value; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; this._innerHTML = ''; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }
}

async function chromeDocument() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const [, tagName, beforeId, id, afterId] = match;
    const attrs = `${beforeId} ${afterId}`;
    elements.set(id, new ChromeElement(tagName, {
      hidden: /\bhidden\b/i.test(attrs),
      value: attrs.match(/\bvalue="([^"]*)"/i)?.[1] || ''
    }));
  }
  return {
    createElement: (tagName) => new ChromeElement(tagName),
    getElementById: (id) => elements.get(id)
  };
}

async function withChromeHarness(assertions) {
  const priorDocument = globalThis.document;
  const priorConsoleError = console.error;
  const consoleErrors = [];
  globalThis.document = await chromeDocument();
  console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
  try {
    await import(`../app.js?spending-guardrail-chrome=${Date.now()}-${Math.random()}`);
    await assertions((id) => globalThis.document.getElementById(id), consoleErrors);
  } finally {
    console.error = priorConsoleError;
    globalThis.document = priorDocument;
  }
}

function submit(get) {
  get('spending-guardrail-form').dispatchEvent({ type: 'submit' });
}

function setInputs(get, {
  portfolio,
  withdrawal = '40000',
  horizon = '30',
  inflation = '3',
  floor = '200000',
  reduction = '10'
}) {
  get('spending-guardrail-portfolio').value = portfolio;
  get('spending-guardrail-withdrawal').value = withdrawal;
  get('spending-guardrail-horizon').value = horizon;
  get('spending-guardrail-inflation').value = inflation;
  get('spending-guardrail-floor').value = floor;
  get('spending-guardrail-reduction').value = reduction;
}

function assertComparisonVisible(get) {
  assert.equal(get('spending-guardrail-results').hidden, false);
  assert.equal(get('spending-guardrail-steady-body').children.length, 30);
  assert.equal(get('spending-guardrail-guardrail-body').children.length, 30);
}

function assertOutputCleared(get) {
  assert.equal(get('spending-guardrail-results').hidden, true);
  assert.equal(get('spending-guardrail-summary').children.length, 0);
  assert.equal(get('spending-guardrail-allocation-body').children.length, 0);
  assert.equal(get('spending-guardrail-steady-body').children.length, 0);
  assert.equal(get('spending-guardrail-guardrail-body').children.length, 0);
  assert.equal(get('spending-guardrail-trigger').textContent, '');
}

async function buildRealChromeHarness() {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const sourceHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  const appUrl = new URL(`file://${path.join(root, 'app.js')}`).href;
  const page = sourceHtml
    .replace(/<link rel="stylesheet" href="\/styles\.css" \/>/, '')
    .replace(/\s*<script type="module" src="\/app\.js"><\/script>\s*/, '\n');
  const harness = `
<pre id="guardrail-chrome-result" hidden></pre>
<script type="module">
  const result = document.getElementById('guardrail-chrome-result');
  const pageErrors = [];
  window.addEventListener('error', (event) => pageErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => pageErrors.push(String(event.reason)));
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    pageErrors.push(args.map(String).join(' '));
    originalConsoleError(...args);
  };
  try {
    await import(${JSON.stringify(appUrl)} + '?spending-guardrail-browser=' + Date.now());
    const get = (id) => document.getElementById(id);
    const setInputs = ({ portfolio, withdrawal = '40000', floor = '200000' }) => {
      get('spending-guardrail-portfolio').value = portfolio;
      get('spending-guardrail-withdrawal').value = withdrawal;
      get('spending-guardrail-horizon').value = '30';
      get('spending-guardrail-inflation').value = '3';
      get('spending-guardrail-floor').value = floor;
      get('spending-guardrail-reduction').value = '10';
    };
    const click = async () => {
      const startedAt = performance.now();
      get('spending-guardrail-submit').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return performance.now() - startedAt;
    };
    const visible = () => !get('spending-guardrail-results').hidden;
    const rowCounts = () => [
      get('spending-guardrail-steady-body').querySelectorAll('tr').length,
      get('spending-guardrail-guardrail-body').querySelectorAll('tr').length
    ];

    const representativeRuns = [];
    for (const portfolio of ['500000', '1000000']) {
      setInputs({ portfolio });
      representativeRuns.push({ portfolio, elapsedMs: await click(), visible: visible(), rowCounts: rowCounts() });
    }

    setInputs({ portfolio: '1000000', floor: '1000000' });
    await click();
    const triggerText = get('spending-guardrail-trigger').textContent.trim();

    setInputs({ portfolio: '1000000', withdrawal: '200000', floor: '0' });
    await click();
    const unreachableText = get('spending-guardrail-unreachable').textContent.trim();
    const unreachableVisible = !get('spending-guardrail-unreachable').hidden;

    setInputs({ portfolio: '1000000' });
    await click();
    get('spending-guardrail-portfolio').value = '1,000,000';
    const error = get('spending-guardrail-error');
    let errorHidden = error.hidden;
    let invalidClearedBeforeError = false;
    Object.defineProperty(error, 'hidden', {
      configurable: true,
      get: () => errorHidden,
      set(value) {
        if (value === false) {
          invalidClearedBeforeError = !visible()
            && get('spending-guardrail-summary').children.length === 0
            && get('spending-guardrail-allocation-body').children.length === 0
            && rowCounts().every((count) => count === 0)
            && get('spending-guardrail-trigger').textContent === '';
        }
        errorHidden = value;
      }
    });
    await click();

    setInputs({ portfolio: '1000000' });
    await click();
    get('spending-guardrail-portfolio').value = '90071992547409.91';
    get('spending-guardrail-withdrawal').value = '0';
    await click();
    const safeRefusal = {
      cleared: !visible() && get('spending-guardrail-summary').children.length === 0
        && get('spending-guardrail-allocation-body').children.length === 0
        && rowCounts().every((count) => count === 0)
        && get('spending-guardrail-trigger').textContent === '',
      errorText: get('spending-guardrail-error').textContent.trim()
    };

    result.textContent = JSON.stringify({
      representativeRuns, triggerText, unreachableText, unreachableVisible,
      invalidClearedBeforeError, safeRefusal, pageErrors
    });
  } catch (error) {
    result.textContent = JSON.stringify({ harnessError: String(error?.stack || error) });
  } finally {
    console.error = originalConsoleError;
  }
</script>`;
  return `${page}\n${harness}`;
}

async function runRealChromeHarness() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spending-guardrail-browser-'));
  try {
    const harnessPath = path.join(tempDir, 'spending-guardrail-browser-harness.html');
    await writeFile(harnessPath, await buildRealChromeHarness(), 'utf8');
    const chrome = spawn(CHROME_BIN, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--virtual-time-budget=1000', '--dump-dom',
      new URL(`file://${harnessPath}`).href
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    chrome.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    chrome.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    const [code, signal] = await new Promise((resolve, reject) => {
      chrome.once('error', reject);
      chrome.once('exit', (...args) => resolve(args));
    });
    assert.equal(code, 0, `Chrome exited cleanly (signal: ${signal ?? 'none'}).\n${stderr}`);
    const match = stdout.match(/<pre id="guardrail-chrome-result" hidden="">([\s\S]*?)<\/pre>/);
    assert.ok(match, `Chrome harness result was rendered.\n${stdout}\n${stderr}`);
    return JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('OE-RESP-1: real Chrome click-to-render assurance covers the completed guardrail comparison', { timeout: 30000 }, async () => {
  const outcome = await runRealChromeHarness();
  assert.equal(outcome.harnessError, undefined, outcome.harnessError);
  for (const run of outcome.representativeRuns) {
    assert.equal(run.visible, true, `$${run.portfolio} comparison is visible`);
    assert.deepEqual(run.rowCounts, [30, 30], `$${run.portfolio} renders both 30-year tables`);
    assert.ok(run.elapsedMs < 1000, `$${run.portfolio} click-to-visible-render took ${run.elapsedMs.toFixed(2)} ms`);
  }
  assert.match(outcome.triggerText, /triggered in year/i);
  assert.equal(outcome.unreachableVisible, true);
  assert.match(outcome.unreachableText, /unreachable/i);
  assert.equal(outcome.invalidClearedBeforeError, true);
  assert.equal(outcome.safeRefusal.cleared, true);
  assert.match(outcome.safeRefusal.errorText, /safe arithmetic range/i);
  assert.deepEqual(outcome.pageErrors, []);
});

test('OE-RESP-1 Chrome harness verifies the completed spending-guardrail comparison', async () => {
  await withChromeHarness(async (get, consoleErrors) => {
    for (const portfolio of ['500000', '1000000']) {
      setInputs(get, { portfolio });
      const startedAt = performance.now();
      submit(get);
      const elapsedMilliseconds = performance.now() - startedAt;

      assert.ok(elapsedMilliseconds < 1_000,
        `$${portfolio} click-to-visible-render took ${elapsedMilliseconds.toFixed(2)} ms`);
      assertComparisonVisible(get);
      assert.equal(consoleErrors.length, 0,
        `$${portfolio} render generated page console errors: ${consoleErrors.join('\n')}`);
    }

    setInputs(get, { portfolio: '1000000', floor: '1000000' });
    submit(get);
    assert.match(get('spending-guardrail-trigger').textContent, /triggered in year/i,
      'a triggering case must visibly state its trigger');

    setInputs(get, { portfolio: '1000000', withdrawal: '200000', floor: '0' });
    submit(get);
    assertComparisonVisible(get);
    assert.equal(get('spending-guardrail-unreachable').hidden, false);
    assert.match(get('spending-guardrail-unreachable').textContent, /unreachable/i,
      'an unreachable request must be disclosed rather than presented as a match');

    setInputs(get, { portfolio: '1000000' });
    submit(get);
    assertComparisonVisible(get);
    get('spending-guardrail-portfolio').value = '1,000,000';
    let invalidErrorAppearedAfterClear = false;
    const error = get('spending-guardrail-error');
    let errorHidden = error.hidden;
    Object.defineProperty(error, 'hidden', {
      configurable: true,
      get: () => errorHidden,
      set(value) {
        if (value === false) {
          invalidErrorAppearedAfterClear = get('spending-guardrail-results').hidden
            && get('spending-guardrail-summary').children.length === 0
            && get('spending-guardrail-allocation-body').children.length === 0
            && get('spending-guardrail-steady-body').children.length === 0
            && get('spending-guardrail-guardrail-body').children.length === 0
            && get('spending-guardrail-trigger').textContent === '';
        }
        errorHidden = value;
      }
    });
    submit(get);
    assert.equal(invalidErrorAppearedAfterClear, true, 'invalid refusal clears stale output before becoming visible');
    assertOutputCleared(get);

    setInputs(get, { portfolio: '1000000' });
    submit(get);
    assertComparisonVisible(get);
    get('spending-guardrail-portfolio').value = '90071992547409.91';
    get('spending-guardrail-withdrawal').value = '0';
    submit(get);
    assertOutputCleared(get);
    assert.match(get('spending-guardrail-error').textContent, /safe arithmetic range/i);
    assert.equal(consoleErrors.length, 0,
      `guardrail flow generated page console errors: ${consoleErrors.join('\n')}`);
  });
});
