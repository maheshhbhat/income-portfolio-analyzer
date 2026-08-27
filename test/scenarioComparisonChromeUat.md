# Scenario comparison Chrome UAT procedure

This file is an owner-executable Chrome procedure for Story #64. It is
supporting documentation only: it does not substitute for the required
owner-recorded Project acceptance evidence.

## Required run procedure

1. Start the application with `npm start`, then open the served local URL in
   Google Chrome. Open DevTools to the Console panel, enable Preserve log, and
   clear existing messages.
2. Leave **Fund provider** set to **Illustrative comparison**.
3. In **Steady vs. early downturn comparison**, enter a starting portfolio of
   `$1,000,000`, desired annual withdrawal `$30,000`, horizon `30` years, and
   inflation `3` percent.
4. Activate **Compare steady and early downturn** and measure elapsed time from
   click to both rendered scenario tables becoming visible. Record pass only if
   the full calculation and render complete within 1 second.
5. Verify both scenario summary cards are visible: **Steady scenario** and
   **Early downturn scenario**.
6. Verify both year-by-year tables are visible: **Steady scenario year-by-year
   table** and **Early downturn scenario year-by-year table**.
7. Verify the page visibly discloses all of the following:
   `Illustrative deterministic scenarios only; not a forecast or financial advice.`
   `Each scenario uses one portfolio-level blended allocation basis instead of tracking holding-level drift or rebalancing.`
   `Early downturn keeps the steady blended yield in every year, reduces blended growth by exactly 0.20 in year 1 only, then restores steady blended growth from year 2 onward.`
8. Replace the starting portfolio with `0` and run the comparison again.
   Verify the prior scenario summaries, scenario tables, and disclosures are no
   longer visible, and an actionable error is shown instead.
9. Inspect the Console. Record pass only if the page generated zero console
   errors during both the valid and invalid submissions. Ignore messages from
   browser extensions if any are present.

## Owner record template

Record the actual owner run in Project acceptance or linked issue evidence, not
in this file.

| Field | Record |
| --- | --- |
| Run at | |
| Chrome version | |
| Local URL | |
| Owner-verified application head | |
| Provider | Illustrative comparison |
| Measured elapsed time | |
| Visible scenario summaries | |
| Visible scenario tables | |
| Visible disclosures | |
| Invalid-input refusal with cleared output | |
| Page-console errors | |
| Durable owner evidence link | |
