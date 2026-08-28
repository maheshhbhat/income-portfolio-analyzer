# Legacy withdrawal Chrome UAT procedure

This owner-facing procedure is the manual Chrome evidence for Story #80. It
uses the product-owned **Illustrative comparison** catalog only; do not select
a provider or use Refresh Data.

## Required run

1. From the exact application commit under review, run `git rev-parse HEAD` and
   record the complete value in the execution record below. Start the app with
   `npm start`, open its local URL in Google Chrome, open DevTools Console,
   enable Preserve log, and clear prior page messages.
2. Leave **Fund provider** at **Illustrative comparison**. Under **Legacy
   withdrawal planner**, enter `$500,000`, `30` years, `3` percent inflation,
   and `$100,000` desired ending balance. Select **Calculate verified
   withdrawal**.
3. Verify one dollar withdrawal, a supporting allocation table, and exactly
   30 projection rows. Verify the final projected balance is at least
   `$100,000` and the result banner says it is the highest verified first-year
   annual withdrawal across the displayed fixed allocation catalog. Verify the
   same banner also states that, for the displayed winning allocation,
   increasing the displayed withdrawal by `$0.01` fails the requested
   ending-balance floor. These are the required catalog-limit and next-cent
   disclosures.
4. Repeat with `$1,000,000`, `30` years, `3` percent inflation, and `$100,000`
   desired ending balance. Time the click through visible result render in the
   Chrome Performance panel. Record a pass only below 1,000 ms. Confirm the
   same explicit winning-allocation next-cent statement is present on the page.
5. Enter a negative desired ending balance or a zero starting portfolio and
   submit. Confirm the preceding withdrawal, allocation, and all projection
   rows disappear before the actionable refusal is visible. Record any
   page-generated Console errors; browser-extension messages are excluded.

## Execution record

Owner to complete after the Chrome observation; this file intentionally does
not claim that an automated harness is owner UAT.

| Field | Record |
| --- | --- |
| Run at | |
| Chrome version | |
| Local URL | |
| Exact application head (`git rev-parse HEAD`) | |
| Catalog-limit disclosure observed | |
| Winning-allocation next-cent disclosure observed | |
| $500,000 result / allocation / 30 rows / final floor | |
| $1,000,000 click-to-render milliseconds | |
| Stale-output clearing observation | |
| Page-console errors | |
