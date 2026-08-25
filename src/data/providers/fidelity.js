// Curated Fidelity seed snapshot. Identity and yield facts were read from the
// recorded Fidelity Fund Research pages on 2026-08-25. Growth rates are
// intentionally conservative illustrative estimates, not provider forecasts.

const readDate = '2026-08-25';

function verified(value, sourceUrl, asOf) {
  return { value, status: 'verified', sourceUrl, asOf };
}

function entry({ symbol, name, type, yield: trailingYield, growthRate, sourceUrl, asOf }) {
  return {
    symbol,
    name,
    type,
    yield: trailingYield,
    growthRate,
    facts: {
      name: verified(name, sourceUrl, asOf),
      ticker: verified(symbol, sourceUrl, asOf),
      trailingYield: verified(trailingYield, sourceUrl, asOf),
      growth: { value: growthRate, status: 'illustrative-estimate' }
    }
  };
}

// For the index funds, trailing yield is the trailing twelve-month cash
// distribution shown in the recorded Fidelity dividend history divided by the
// NAV on the same page. The other entries use Fidelity's displayed yield.
export const FIDELITY_SNAPSHOT = Object.freeze({
  providerId: 'fidelity',
  asOf: readDate,
  entries: Object.freeze([
    entry({
      symbol: 'SPAXX',
      name: 'Fidelity Government Money Market Fund',
      type: 'money-market',
      yield: 0.0332,
      growthRate: 0.001,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/31617H102',
      asOf: '2026-08-23'
    }),
    entry({
      symbol: 'FXNAX',
      name: 'Fidelity U.S. Bond Index Fund',
      type: 'bond-index-fund',
      yield: 0.0463,
      growthRate: 0.005,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/316146356',
      asOf: '2026-08-20'
    }),
    entry({
      symbol: 'FCBFX',
      name: 'Fidelity Corporate Bond Fund',
      type: 'bond-fund',
      yield: 0.052,
      growthRate: 0.005,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/316146596',
      asOf: '2026-08-20'
    }),
    entry({
      symbol: 'FFRHX',
      name: 'Fidelity Floating Rate High Income Fund',
      type: 'high-yield-bond-fund',
      yield: 0.0681,
      growthRate: 0.01,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/315916783',
      asOf: '2026-08-19'
    }),
    entry({
      symbol: 'FSDIX',
      name: 'Fidelity Strategic Dividend & Income Fund',
      type: 'income-allocation-fund',
      yield: 0.0227,
      growthRate: 0.04,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/summary/316145887',
      asOf: '2026-08-20'
    }),
    entry({
      symbol: 'FSKAX',
      name: 'Fidelity Total Market Index Fund',
      type: 'total-market-index-fund',
      yield: 0.0092,
      growthRate: 0.06,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/view-all/315911693',
      asOf: '2026-08-21'
    }),
    entry({
      symbol: 'FXAIX',
      name: 'Fidelity 500 Index Fund',
      type: 'large-cap-index-fund',
      yield: 0.0104,
      growthRate: 0.06,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/view-all/315911750',
      asOf: '2026-08-20'
    }),
    entry({
      symbol: 'FSPSX',
      name: 'Fidelity International Index Fund',
      type: 'international-index-fund',
      yield: 0.0275,
      growthRate: 0.05,
      sourceUrl: 'https://fundresearch.fidelity.com/mutual-funds/view-all/315911727',
      asOf: '2026-08-21'
    })
  ])
});

export default FIDELITY_SNAPSHOT;
