// Curated Vanguard seed snapshot. Identity and 30-day SEC-yield facts were
// read from the recorded official profile pages on 2026-08-25. `asOf` is the
// date published beside that fact on Vanguard's page; growth is deliberately
// an illustrative estimate, not a provider-verified forecast.

const profileUrl = (symbol) => `https://investor.vanguard.com/investment-products/etfs/profile/${symbol.toLowerCase()}`;

function verified(value, sourceUrl, asOf) {
  return { value, status: 'verified', sourceUrl, asOf };
}

function fund({ symbol, name, yield: trailingYield, yieldAsOf, growthRate }) {
  const sourceUrl = profileUrl(symbol);
  return {
    symbol,
    name,
    type: 'etf',
    yield: trailingYield,
    growthRate,
    facts: {
      name: verified(name, sourceUrl, yieldAsOf),
      ticker: verified(symbol, sourceUrl, yieldAsOf),
      trailingYield: verified(trailingYield, sourceUrl, yieldAsOf),
      growth: { value: growthRate, status: 'illustrative-estimate' }
    }
  };
}

export const VANGUARD_SNAPSHOT = Object.freeze({
  providerId: 'vanguard',
  asOf: '2026-06-30',
  entries: Object.freeze([
    fund({ symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', yield: 0.0101, yieldAsOf: '2026-05-31', growthRate: 0.06 }),
    fund({ symbol: 'VOO', name: 'Vanguard S&P 500 ETF', yield: 0.0103, yieldAsOf: '2026-06-30', growthRate: 0.06 }),
    fund({ symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF', yield: 0.0223, yieldAsOf: '2026-05-31', growthRate: 0.05 }),
    fund({ symbol: 'VTV', name: 'Vanguard Value ETF', yield: 0.0187, yieldAsOf: '2026-06-30', growthRate: 0.05 }),
    fund({ symbol: 'VHT', name: 'Vanguard Health Care ETF', yield: 0.0143, yieldAsOf: '2026-05-31', growthRate: 0.055 }),
    fund({ symbol: 'VGT', name: 'Vanguard Information Technology ETF', yield: 0.0036, yieldAsOf: '2026-04-30', growthRate: 0.06 }),
    fund({ symbol: 'BND', name: 'Vanguard Total Bond Market ETF', yield: 0.0444, yieldAsOf: '2026-05-19', growthRate: 0.025 }),
    fund({ symbol: 'VGSH', name: 'Vanguard Short-Term Treasury ETF', yield: 0.0412, yieldAsOf: '2026-06-23', growthRate: 0.02 })
  ])
});
