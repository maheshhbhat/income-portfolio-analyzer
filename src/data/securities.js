// Curated, manually-maintained dataset of well-known dividend-paying securities.
// Yields and growth rates are illustrative, static estimates (not a live feed or a
// forecast) expressed as decimals (e.g. 0.08 = 8.0%). Values are broadly
// representative of recent trailing yields / typical long-run price appreciation
// for each security's category, but must not be treated as real-time data or
// investment advice, and growthRate in particular is not a prediction of future
// returns - actual returns are volatile and can be negative in any given year.
//
// growthRate figures are deliberately conservative, long-run baselines rather than
// an extrapolation of any security's recent hot streak (see QQQ below) - this
// avoids the tool implicitly promising that a strong recent run will continue, at
// the cost of understating how well a security may have actually performed lately.
//
// type taxonomy:
//   'stock'             - individual dividend-paying company
//   'etf'                - broad-market / dividend-focused / growth / international index ETF
//   'reit'                - real estate investment trust (individual or ETF)
//   'covered-call-etf'    - options-overlay / covered-call income ETF
//   'bond-etf'            - fixed-income index ETF
//
// yield       - illustrative trailing dividend/interest yield
// growthRate  - illustrative static annual price-appreciation estimate (not yield)

export const SECURITIES = [
  { symbol: 'QYLD', name: 'Global X Nasdaq 100 Covered Call ETF', type: 'covered-call-etf', yield: 0.115, growthRate: 0.005 },
  { symbol: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium Income ETF', type: 'covered-call-etf', yield: 0.095, growthRate: 0.02 },
  { symbol: 'XYLD', name: 'Global X S&P 500 Covered Call ETF', type: 'covered-call-etf', yield: 0.09, growthRate: 0.01 },
  { symbol: 'MO', name: 'Altria Group, Inc.', type: 'stock', yield: 0.08, growthRate: 0.03 },
  { symbol: 'JEPI', name: 'JPMorgan Equity Premium Income ETF', type: 'covered-call-etf', yield: 0.075, growthRate: 0.02 },
  { symbol: 'VZ', name: 'Verizon Communications Inc.', type: 'stock', yield: 0.063, growthRate: 0.015 },
  { symbol: 'PFE', name: 'Pfizer Inc.', type: 'stock', yield: 0.06, growthRate: 0.03 },
  { symbol: 'MAIN', name: 'Main Street Capital Corporation', type: 'stock', yield: 0.057, growthRate: 0.04 },
  { symbol: 'T', name: 'AT&T Inc.', type: 'stock', yield: 0.055, growthRate: 0.015 },
  { symbol: 'O', name: 'Realty Income Corporation', type: 'reit', yield: 0.055, growthRate: 0.03 },
  { symbol: 'VICI', name: 'VICI Properties Inc.', type: 'reit', yield: 0.055, growthRate: 0.04 },
  { symbol: 'DIVO', name: 'Amplify CWP Enhanced Dividend Income ETF', type: 'covered-call-etf', yield: 0.048, growthRate: 0.035 },
  { symbol: 'SPYD', name: 'SPDR Portfolio S&P 500 High Dividend ETF', type: 'etf', yield: 0.043, growthRate: 0.04 },
  { symbol: 'STAG', name: 'STAG Industrial, Inc.', type: 'reit', yield: 0.04, growthRate: 0.03 },
  { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', type: 'reit', yield: 0.039, growthRate: 0.035 },
  { symbol: 'HDV', name: 'iShares Core High Dividend ETF', type: 'etf', yield: 0.037, growthRate: 0.045 },
  { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', type: 'etf', yield: 0.035, growthRate: 0.07 },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', type: 'stock', yield: 0.033, growthRate: 0.04 },
  { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'stock', yield: 0.03, growthRate: 0.05 },
  { symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF', type: 'etf', yield: 0.029, growthRate: 0.06 },
  { symbol: 'KO', name: 'The Coca-Cola Company', type: 'stock', yield: 0.029, growthRate: 0.05 },
  { symbol: 'PG', name: 'The Procter & Gamble Company', type: 'stock', yield: 0.024, growthRate: 0.05 },
  // VOO/QQQ: broad-market index ETFs trade current income for capital appreciation.
  // Real-world trailing dividend yields for both sit well under 2%; illustrative
  // growth is set higher than every other entry above to reflect the long-run
  // price-appreciation character of the S&P 500 / Nasdaq-100, not a forecast.
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'etf', yield: 0.013, growthRate: 0.08 },
  // QQQ's growth figure is intentionally held near VOO's rather than chasing its
  // unusually strong recent multi-year run - a conservative long-run baseline, not
  // a bet that recent outperformance repeats.
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', yield: 0.006, growthRate: 0.1 },
  // VIG: dividend-growth ETF (rising payouts from quality companies) - lower current
  // yield than pure high-dividend funds like SCHD/VYM, with correspondingly higher
  // illustrative long-run growth.
  { symbol: 'VIG', name: 'Vanguard Dividend Appreciation ETF', type: 'etf', yield: 0.018, growthRate: 0.08 },
  // VUG: pure growth-style index ETF, similar profile to QQQ (very low current
  // income) but less concentrated in a single sector - growth set below QQQ's for
  // the same "conservative baseline, not a hot-streak extrapolation" reason.
  { symbol: 'VUG', name: 'Vanguard Growth ETF', type: 'etf', yield: 0.005, growthRate: 0.09 },
  // VTI: total U.S. stock market ETF - broad-market profile similar to VOO, with a
  // slightly lower illustrative growth figure reflecting the drag of small/mid-cap
  // exposure relative to the large-cap-only S&P 500.
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf', yield: 0.013, growthRate: 0.075 },
  // VXUS: total international stock ETF - non-U.S. developed/emerging markets
  // typically carry higher current yields than U.S. broad-market funds but have
  // illustrated slower long-run price appreciation over most recent decades.
  { symbol: 'VXUS', name: 'Vanguard Total International Stock ETF', type: 'etf', yield: 0.03, growthRate: 0.05 },
  // BND: total U.S. bond market ETF - fixed income's total return is overwhelmingly
  // interest income with minimal price appreciation, the opposite profile from the
  // growth-oriented ETFs above; included to broaden the curated universe into a
  // genuinely different risk/return category.
  { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', type: 'bond-etf', yield: 0.042, growthRate: 0.005 }
];
