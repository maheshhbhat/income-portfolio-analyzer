# product.md — Income Portfolio Analyzer

**Standing constraints and quality bars.** Not a feature list and not a roadmap. This
document says what must remain true of anything built here, so that a plan can be
judged against something durable rather than against the mood of the day.

Human-authored. Along with roadmap-commitment issues, it is one of only two artifacts
in this system a person writes by hand.

---

## What this product is

Given an amount to invest and a desired annual income, it proposes an allocation
across a curated list of dividend-paying securities, and projects whether a
retirement withdrawal plan survives a chosen horizon.

## What it is not

**It is not financial advice, and no change may make it read as though it were.**
The curated dataset is static and illustrative. Growth figures are deliberately
conservative long-run baselines rather than extrapolations of recent performance —
understating a hot streak is the correct error, because the opposite error implicitly
promises that the streak continues.

It is not a live trading system, not a market data feed, and not a forecast.

---

## Standing constraints

**1. Money is integer cents.** Never a float, at any layer. Allocation splits a total
in cents and distributes the remainder deterministically, one cent at a time, so that
the parts sum to the whole exactly. A plan that introduces floating-point currency is
rejected regardless of how well it tests.

**2. The core is pure.** `src/lib/**` has no DOM and no IO, so the same module runs
unchanged in the browser and under the Node test runner. Anything that needs the
network, the clock, or the filesystem lives at the edge and is injected. This is what
makes the maths testable without a harness, and it is not negotiable for convenience.

**3. Same input, same output.** No randomness, no hidden dependence on the current
time, no implicit ordering. A projection that cannot be reproduced cannot be checked,
and an unreproducible number about someone's retirement is worse than no number.

**4. Every simplification is disclosed where it is made.** `retirement.js` opens by
stating that it simulates at portfolio level using blended rates, and says what that
costs — no per-holding drift, no rebalancing. That is the standard: a comment at the
top of the module naming the simplification *and its price*. A simplification that is
only visible by reading the implementation has not been disclosed.

**5. Unreachable is a result, not an error.** When a target cannot be met, the product
says so and still returns the best achievable allocation. It never silently
approximates and presents the approximation as the answer.

**6. Only curated securities appear.** Nothing may propose an instrument outside the
maintained dataset. If the dataset should grow, that is a change to the dataset, made
deliberately, with its own justification.

**7. Zero runtime dependencies.** Node ≥ 20, `node --test`, no framework, no bundler.
A dependency is a hazard path: it must be justified on its own terms, not adopted
because it was convenient. This constraint may be traded away, but only explicitly.

---

## Quality bars

Every one of these is currently enforced by a test. A change that breaks one is a
defect, not a trade-off, unless this document is amended first.

- An allocation **sums exactly** to the investment amount. No rounding drift.
- Per-line and total estimated income are **arithmetically correct** against the
  stated rates.
- The effective blended yield **lands close to the requested target** when the target
  is reachable.
- Percentages across selected securities **sum to ~100%**.
- Invalid input — non-positive amounts, negative income, non-numeric values — is
  **rejected with a message a person can act on**, not with an exception.
- Zero desired income is a **valid request**, not an edge case to reject.

## What "done" means

A change is done when the maths is right, the invariants above still hold, the
simplifications are disclosed, and the tests say so without anyone having to run the
app to believe it.

## On changing this document

These constraints are meant to outlive individual plans, so amending one is a
deliberate act with a stated reason — not something a plan does in passing to make
itself easier to satisfy. If a plan cannot be built without weakening a bar here, that
is a finding worth surfacing, and the amendment is the decision to make first.
