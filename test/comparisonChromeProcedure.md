# Comparison Chrome Procedure

This is an owner-executable Google Chrome procedure for Story #71. Do not
record execution evidence here. After all delivery PRs for Project #67 merge,
the owner performs the real run and records the evidence in the Project
acceptance record.

## Owner run procedure

1. Start the application with `npm start`, then open the displayed local URL in
   Google Chrome. Open DevTools on the page, switch to the Console panel,
   enable Preserve log, and clear existing messages.
2. Leave **Fund provider** set to **Illustrative comparison**. In the main
   retirement form, enter investment amount `$1,000,000`, desired annual
   withdrawal `$40,000`, retirement horizon `30`, and inflation rate `3`.
3. With a stopwatch or Chrome performance timing ready, select **Compare 2%,
   3%, and 4%** and measure elapsed time from the click until all comparison
   results finish rendering. Record the elapsed time. The acceptance bound is
   strictly less than one second.
4. Verify the comparison renders exactly three scenario summaries labeled `2%`,
   `3%`, and `4%`. Verify the projection section renders exactly three headings:
   `2% year-by-year projection`, `3% year-by-year projection`, and `4%
   year-by-year projection`. Verify there is no fourth scenario anywhere in the
   comparison output.
5. Record the rendered outputs for each scenario, including the visible outcome
   text, ending balance, blended yield, blended growth, blended total return,
   and the fact that each projection contains 30 yearly rows.
6. Verify the visible disclosure says the comparison is illustrative, uses this
   repository's curated `SECURITIES` set, is deterministic, is not a forecast,
   and is not financial advice.
7. Without changing the valid comparison output first, replace investment amount
   with `0` and select **Compare 2%, 3%, and 4%** again. Verify every prior
   comparison summary and projection disappears before the refusal is shown.
   Record the stale-output clearing result and the refusal text.
8. Inspect the Console and record pass only when the page generated zero console
   errors during both submissions. Ignore messages from browser extensions if
   any appear.

## Owner evidence to record after the real run

- Exercised revision
- Local URL
- Exact inputs used
- Measured click-to-render elapsed time
- Rendered outputs for the `2%`, `3%`, and `4%` scenarios
- Stale-output clearing result after invalid submission
- Visible disclosure text result
- Page-console result
