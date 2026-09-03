# Retirement horizon comparison branded-Chrome UAT procedure

This is an owner-run procedure for Story #107. This checked-in Markdown file is
guidance only and is not Project acceptance evidence. Record the completed run
in durable owner evidence linked to the Project or Story.

## Required owner run

1. Check out the application head under review, record its full commit SHA, run
   `npm ci`, run `npx playwright install chrome`, and start the application with
   `npm start`.
2. Open the local application in branded Google Chrome. Record the full Chrome
   version from `chrome://version`; a Chromium build or another browser does not
   satisfy this procedure.
3. Open DevTools Console, enable Preserve log, and clear existing messages.
4. Set the shared inputs to a `$1,000,000` starting portfolio, `$40,000`
   first-year withdrawal, and `3%` inflation. Set **Fund provider** to Vanguard,
   then activate **Compare 20, 30, and 40 years** while measuring from click
   until all comparison output is visible.
5. Record a pass only when the elapsed time is below 1,000 ms and the page shows,
   in order, `Short horizon (20 years)`, `Standard horizon (30 years)`, and
   `Long horizon (40 years)`, each with one outcome summary and its complete
   year-by-year projection table (20, 30, and 40 rows respectively).
6. Repeat the comparison with **Fund provider** set to Fidelity. Confirm the
   horizon outputs remain the same illustrative results and do not display
   provider-specific data.
7. After a valid comparison is visible, replace the starting portfolio with
   `0` and activate the horizon comparison again. Confirm the old summaries,
   tables, rows, and money values are cleared before the actionable refusal is
   shown. Confirm the illustrative, not-a-forecast, and not-financial-advice
   disclosure remains visible.
8. Record a pass only when the page produced zero console errors throughout the
   valid and refusal flows. Browser-extension messages are not page-generated;
   identify any excluded extension message explicitly in the owner evidence.

## Owner evidence template

| Field | Record |
| --- | --- |
| Run at | |
| Full application commit SHA | |
| Branded Google Chrome version | |
| Local URL | |
| Representative inputs | $1,000,000 / $40,000 / 3% |
| Measured click-to-visible time | |
| Ordered named summaries | |
| Projection table row counts | |
| Vanguard/Fidelity provider-independence observation | |
| Invalid refusal and stale-output clearing | |
| Disclosure after refusal | |
| Page-generated console errors | |
| Durable owner evidence link | |
