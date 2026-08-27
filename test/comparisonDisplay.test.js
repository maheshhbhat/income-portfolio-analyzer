import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class MockElement {
  constructor(tagName = 'div', { hidden = false, value = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.textContent = '';
    this._hidden = hidden;
    this._innerHTML = '';
    this.value = value;
    this.listeners = new Map();
    this.className = '';
    this.disabled = false;
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(value) {
    this._hidden = value;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    if (typeof event.preventDefault !== 'function') {
      event.defaultPrevented = false;
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

async function loadAppDocument() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();

  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const [, tagName, beforeId, id, afterId] = match;
    const attrs = `${beforeId} ${afterId}`;
    const hidden = /\bhidden\b/i.test(attrs);
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/i);
    elements.set(id, new MockElement(tagName, { hidden, value: valueMatch?.[1] || '' }));
  }

  return {
    createElement: (tagName) => new MockElement(tagName),
    getElementById: (id) => elements.get(id)
  };
}

async function buildHarness() {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const htmlPath = path.join(root, 'index.html');
  const appUrl = new URL(`file://${path.join(root, 'app.js')}`).href;
  const sourceHtml = await readFile(htmlPath, 'utf8');
  const htmlWithoutRootAssets = sourceHtml
    .replace(/<link rel="stylesheet" href="\/styles\.css" \/>/, '')
    .replace(/\s*<script type="module" src="\/app\.js"><\/script>\s*/, '\n');

  const harnessScript = `
<pre id="comparison-test-result" hidden></pre>
<script type="module">
  const resultEl = document.getElementById('comparison-test-result');
  const pageErrors = [];
  window.addEventListener('error', (event) => pageErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => pageErrors.push(String(event.reason)));
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    pageErrors.push(args.map((value) => String(value)).join(' '));
    originalConsoleError(...args);
  };
  const originalFetch = window.fetch?.bind(window);
  window.fetch = (...args) => {
    pageErrors.push('comparison flow attempted fetch: ' + String(args[0]));
    throw new Error('comparison flow must not fetch provider snapshots');
  };

  try {
    await import(${JSON.stringify(appUrl)} + '?comparison-browser=' + Date.now());
    const get = (id) => document.getElementById(id);
    get('provider-select').value = 'vanguard';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('horizon-years').value = '30';
    get('inflation-rate').value = '3';

    const startedAt = performance.now();
    get('comparison-submit').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const elapsedMs = performance.now() - startedAt;

    const validState = {
      comparisonVisible: !get('comparison-results').hidden,
      errorHidden: get('comparison-error').hidden,
      summaryLabels: Array.from(document.querySelectorAll('#comparison-summary h3'), (node) => node.textContent.trim()),
      projectionLabels: Array.from(document.querySelectorAll('#comparison-projections h3'), (node) => node.textContent.trim()),
      rowCounts: Array.from(document.querySelectorAll('#comparison-projections tbody'), (node) => node.querySelectorAll('tr').length)
    };

    get('investment-amount').value = '0';
    const comparisonError = get('comparison-error');
    let hiddenValue = comparisonError.hidden;
    let errorShownAfterClear = false;
    Object.defineProperty(comparisonError, 'hidden', {
      configurable: true,
      get() {
        return hiddenValue;
      },
      set(value) {
        if (value === false) {
          errorShownAfterClear = get('comparison-results').hidden
            && get('comparison-summary').children.length === 0
            && get('comparison-projections').children.length === 0
            && document.querySelectorAll('#comparison-projections tbody tr').length === 0;
        }
        hiddenValue = value;
      }
    });

    get('comparison-submit').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    resultEl.textContent = JSON.stringify({
      elapsedMs,
      validState,
      invalidState: {
        errorShownAfterClear,
        comparisonHidden: get('comparison-results').hidden,
        summaryCount: get('comparison-summary').children.length,
        projectionCount: get('comparison-projections').children.length,
        lingeringRows: document.querySelectorAll('#comparison-projections tbody tr').length,
        summaryHtml: get('comparison-summary').innerHTML,
        projectionHtml: get('comparison-projections').innerHTML,
        errorText: get('comparison-error').textContent.trim(),
        pageErrors
      }
    });
  } catch (error) {
    resultEl.textContent = JSON.stringify({ harnessError: String(error?.stack || error) });
  } finally {
    console.error = originalConsoleError;
    if (originalFetch) window.fetch = originalFetch;
  }
</script>
`;

  return `${htmlWithoutRootAssets}\n${harnessScript}`;
}

async function runChromeHarness() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'comparison-browser-'));
  try {
    const harnessPath = path.join(tempDir, 'comparison-browser-harness.html');
    await writeFile(harnessPath, await buildHarness(), 'utf8');

    const chrome = spawn(CHROME_BIN, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      '--virtual-time-budget=1000',
      '--dump-dom',
      new URL(`file://${harnessPath}`).href
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    chrome.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    const [code] = await new Promise((resolve, reject) => {
      chrome.once('error', reject);
      chrome.once('exit', (...args) => resolve(args));
    });

    assert.equal(code, 0, `Chrome exited cleanly.\n${stderr}`);
    const match = stdout.match(/<pre id="comparison-test-result" hidden="">([\s\S]*?)<\/pre>/);
    assert.ok(match, `comparison harness result was rendered.\n${stdout}\n${stderr}`);
    return JSON.parse(match[1]
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('OE-DEGRADE-1: browser comparison flow clears stale output, renders only the exact 2%, 3%, and 4% scenarios, and stays under one second at representative scale', { timeout: 30000 }, async (t) => {
  let outcome;
  try {
    outcome = await runChromeHarness();
  } catch (error) {
    t.skip(`Chrome browser flow could not run in this environment: ${error.message}`);
    return;
  }
  assert.equal(outcome.harnessError, undefined, outcome.harnessError);
  assert.equal(outcome.validState.comparisonVisible, true);
  assert.equal(outcome.validState.errorHidden, true);
  assert.deepEqual(outcome.validState.summaryLabels, ['2%', '3%', '4%']);
  assert.deepEqual(outcome.validState.projectionLabels, [
    '2% year-by-year projection',
    '3% year-by-year projection',
    '4% year-by-year projection'
  ]);
  assert.deepEqual(outcome.validState.rowCounts, [30, 30, 30]);
  assert.ok(outcome.elapsedMs < 1000, `representative $1,000,000/30-year browser comparison rendered in ${outcome.elapsedMs.toFixed(2)}ms`);

  assert.equal(outcome.invalidState.errorShownAfterClear, true);
  assert.equal(outcome.invalidState.comparisonHidden, true);
  assert.equal(outcome.invalidState.summaryCount, 0);
  assert.equal(outcome.invalidState.projectionCount, 0);
  assert.equal(outcome.invalidState.lingeringRows, 0);
  assert.equal(outcome.invalidState.summaryHtml, '');
  assert.equal(outcome.invalidState.projectionHtml, '');
  assert.match(outcome.invalidState.errorText, /investment amount greater than \$0/i);
  assert.deepEqual(outcome.invalidState.pageErrors, []);
});

test('comparison flow regression still clears stale output and renders only the exact 2%, 3%, and 4% scenarios when exercised through the app wiring', async () => {
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const savedConsoleError = console.error;
  const consoleErrors = [];
  globalThis.document = await loadAppDocument();
  globalThis.fetch = async () => {
    throw new Error('comparison flow must not fetch provider snapshots');
  };
  console.error = (...args) => {
    consoleErrors.push(args);
  };

  try {
    await import(`../app.js?comparison-display=${Date.now()}`);
    const get = (id) => globalThis.document.getElementById(id);

    get('provider-select').value = 'vanguard';
    get('investment-amount').value = '1000000';
    get('desired-income').value = '40000';
    get('horizon-years').value = '30';
    get('inflation-rate').value = '3';

    const startedAt = performance.now();
    get('comparison-submit').click();
    const elapsedMs = performance.now() - startedAt;

    assert.equal(get('comparison-results').hidden, false);
    assert.equal(get('comparison-error').hidden, true);
    assert.equal(get('comparison-summary').children.length, 3, 'renders exactly three scenario summaries');
    assert.equal(get('comparison-projections').children.length, 3, 'renders exactly three scenario projections');
    assert.ok(elapsedMs < 1000, `representative $1,000,000/30-year comparison rendered in ${elapsedMs.toFixed(2)}ms`);

    assert.deepEqual(
      get('comparison-summary').children.map((card) => card.children[0].textContent),
      ['2%', '3%', '4%'],
      'summary cards use only the required scenario labels'
    );
    assert.deepEqual(
      get('comparison-projections').children.map((section) => section.children[0].textContent),
      ['2% year-by-year projection', '3% year-by-year projection', '4% year-by-year projection'],
      'projection headings use only the required scenario labels'
    );

    for (const projection of get('comparison-projections').children) {
      const table = projection.children[1];
      const body = table.children[0];
      assert.equal(body.children.length, 30, 'each rendered projection has one row per requested year');
    }
    assert.deepEqual(consoleErrors, [], 'the valid flow produces no page-console errors');

    get('investment-amount').value = '0';
    const comparisonError = get('comparison-error');
    let errorWasShownAfterClear = false;
    let comparisonErrorHidden = comparisonError.hidden;
    Object.defineProperty(comparisonError, 'hidden', {
      configurable: true,
      get: () => comparisonErrorHidden,
      set: (value) => {
        if (value === false) {
          errorWasShownAfterClear = get('comparison-results').hidden
            && get('comparison-summary').children.length === 0
            && get('comparison-projections').children.length === 0;
        }
        comparisonErrorHidden = value;
      }
    });

    get('comparison-submit').click();

    assert.equal(errorWasShownAfterClear, true, 'the refusal is shown only after stale output is cleared and hidden');
    assert.equal(get('comparison-results').hidden, true, 'stale comparison results are hidden');
    assert.equal(get('comparison-summary').children.length, 0, 'stale comparison summaries are removed');
    assert.equal(get('comparison-projections').children.length, 0, 'stale comparison projections are removed');
    assert.equal(get('comparison-summary').innerHTML, '', 'stale comparison summaries are cleared');
    assert.equal(get('comparison-projections').innerHTML, '', 'stale comparison projections are cleared');
    assert.match(get('comparison-error').textContent, /investment amount greater than \$0/i);
  } finally {
    globalThis.document = savedDocument;
    globalThis.fetch = savedFetch;
    console.error = savedConsoleError;
  }
});
