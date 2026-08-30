// Steady vs. deterministic spending-guardrail withdrawal comparison.
//
// This module is a pure integer-cent core: it takes validated integer-cent
// inputs plus the curated securities list, calls the separate integer-cent
// allocation API (`bracketAndBlendCents`), and simulates two year-by-year
// paths - a steady schedule and a guardrail schedule that cuts the withdrawal
// once the portfolio's balance touches a user-entered safety floor. It has no
// DOM, IO, network, clock, or randomness dependency, and performs one shared
// allocation plus two horizon-length passes; it never searches cent-by-cent
// or iterates over providers.
//
// Simplification (disclosed): both paths share the same allocation and the
// same constant blended yield/growth rates for every year of the horizon,
// exactly like the existing dollar-based retirement projection - only the
// withdrawal rule differs between the two paths.
//
// Trigger rule: for each year in order starting at year 1, this module
// evaluates whether that year's STARTING balance is at or below
// safetyFloorCents. The first such year is the trigger year and it never
// un-triggers. A year's starting balance equals the prior year's ending
// balance, so a year that itself depletes (ending at zero) does not satisfy
// the rule on its own starting balance - the following year, if it exists
// within the horizon, starts at zero and satisfies the rule for any floor,
// including exactly 0. If depletion occurs in the final horizon year, no
// later row exists and the module reports that the floor was not reached.
//
// Depletion rule: a year that cannot fund its full scheduled withdrawal pays
// only the available grown balance, clamps that year's ending balance to 0,
// keeps the row, and every remaining horizon row is emitted with zero
// starting balance, zero withdrawal paid, zero return, and zero ending
// balance, so the table always has one row per requested horizon year.

import { bracketAndBlendCents } from './allocation.js';
import {
  canonicalizeReturnRate,
  canonicalizeInflationRate,
  applyCanonicalReturnRate,
  growWithdrawalByInflation
} from './legacyWithdrawalProjection.js';

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
}

function validateSecurity(security) {
  return Boolean(
    security &&
    typeof security.symbol === 'string' &&
    security.symbol.trim() &&
    typeof security.name === 'string' &&
    security.name.trim() &&
    typeof security.type === 'string' &&
    security.type.trim() &&
    typeof security.yield === 'number' &&
    Number.isFinite(security.yield) &&
    typeof security.growthRate === 'number' &&
    Number.isFinite(security.growthRate)
  );
}

export function validateGuardrailInputs(input, securities) {
  const {
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    inflationRate,
    safetyFloorCents,
    postTriggerReductionPercent
  } = input || {};

  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    return invalid('Enter a starting portfolio as a safe whole number of cents greater than $0.');
  }
  if (!Number.isSafeInteger(desiredAnnualWithdrawalCents) || desiredAnnualWithdrawalCents < 0) {
    return invalid('Enter a desired annual withdrawal as a safe whole number of cents of $0 or more.');
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    return invalid('Enter a retirement horizon of at least 1 whole year.');
  }
  if (!Number.isFinite(inflationRate) || inflationRate < 0) {
    return invalid('Enter an inflation rate of 0% or more.');
  }
  if (!Number.isSafeInteger(canonicalizeInflationRate(inflationRate))) {
    return invalid('Enter an inflation rate that can be represented safely at the supported precision.');
  }
  if (!Number.isSafeInteger(safetyFloorCents) || safetyFloorCents < 0) {
    return invalid('Enter a safety-floor balance as a safe whole number of cents of $0 or more.');
  }
  if (!Number.isFinite(postTriggerReductionPercent) || postTriggerReductionPercent < 0 || postTriggerReductionPercent > 100) {
    return invalid('Enter a post-trigger withdrawal reduction between 0 and 100 percent.');
  }
  if (!Array.isArray(securities) || securities.length < 2) {
    return invalid('No curated securities are available to build an allocation.');
  }
  if (!securities.every(validateSecurity)) {
    return invalid('Curated securities must each include a symbol, name, type, yield, and growth rate.');
  }

  const symbols = securities.map((security) => security.symbol);
  if (new Set(symbols).size !== symbols.length) {
    return invalid('Curated securities must use unique symbols.');
  }

  return {
    ok: true,
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    inflationRate,
    safetyFloorCents,
    postTriggerReductionPercent
  };
}

function blendedRate(items, investmentAmountCents, metricOf) {
  const weighted = items.reduce((sum, item) => sum + item.amountCents * metricOf(item.security), 0);
  return weighted / investmentAmountCents;
}

function halfUpDivideBigInt(numerator, denominator) {
  const negative = numerator < 0n;
  const absoluteNumerator = negative ? -numerator : numerator;
  const quotient = absoluteNumerator / denominator;
  const remainder = absoluteNumerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function decimalPercentRatio(percent) {
  const [coefficient, exponentText] = String(percent).toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = `${whole}${fraction}`;
  const scaleExponent = fraction.length - exponent;

  if (scaleExponent <= 0) {
    return {
      numerator: BigInt(digits) * (10n ** BigInt(-scaleExponent)),
      denominator: 1n
    };
  }

  return {
    numerator: BigInt(digits),
    denominator: 10n ** BigInt(scaleExponent)
  };
}

/**
 * Reduce `withdrawalCents` by the exact decimal value represented by
 * `postTriggerReductionPercent` (0-100). The decimal ratio is converted to
 * integers before the BigInt half-up division, so values such as 33.333 are
 * never silently rounded to a coarser percentage precision.
 */
export function applyPostTriggerReduction(withdrawalCents, postTriggerReductionPercent) {
  const { numerator: reductionNumerator, denominator: reductionDenominator } = decimalPercentRatio(
    postTriggerReductionPercent
  );
  const remainingNumerator = reductionDenominator * 100n - reductionNumerator;
  const numerator = BigInt(withdrawalCents) * remainingNumerator;
  const reduced = halfUpDivideBigInt(numerator, reductionDenominator * 100n);
  const asNumber = Number(reduced);
  if (!Number.isSafeInteger(asNumber)) {
    throw new RangeError('Reduced withdrawal exceeds the safe integer range.');
  }
  return asNumber;
}

function stepYear(startingBalanceCents, withdrawalDueCents, canonicalReturnRate) {
  const returnCents = applyCanonicalReturnRate(startingBalanceCents, canonicalReturnRate);
  const grownBalanceCents = startingBalanceCents + returnCents;

  if (grownBalanceCents < withdrawalDueCents) {
    return {
      returnCents,
      withdrawalPaidCents: Math.max(0, grownBalanceCents),
      endingBalanceCents: 0,
      depleted: true
    };
  }

  return {
    returnCents,
    withdrawalPaidCents: withdrawalDueCents,
    endingBalanceCents: grownBalanceCents - withdrawalDueCents,
    depleted: false
  };
}

function simulateSteadyPath({
  investmentAmountCents,
  desiredAnnualWithdrawalCents,
  horizonYears,
  canonicalInflationRate,
  canonicalReturnRate,
  onYearStep
}) {
  const years = [];
  let balanceCents = investmentAmountCents;
  let withdrawalScheduledCents = desiredAnnualWithdrawalCents;
  let depletionYear = null;
  let depleted = false;

  for (let year = 1; year <= horizonYears; year++) {
    onYearStep?.();

    if (depleted) {
      years.push({
        year,
        startingBalanceCents: 0,
        withdrawalScheduledCents: 0,
        withdrawalPaidCents: 0,
        returnCents: 0,
        endingBalanceCents: 0
      });
      continue;
    }

    const startingBalanceCents = balanceCents;
    const step = stepYear(startingBalanceCents, withdrawalScheduledCents, canonicalReturnRate);

    years.push({
      year,
      startingBalanceCents,
      withdrawalScheduledCents,
      withdrawalPaidCents: step.withdrawalPaidCents,
      returnCents: step.returnCents,
      endingBalanceCents: step.endingBalanceCents
    });

    balanceCents = step.endingBalanceCents;
    if (step.depleted) {
      depletionYear = year;
      depleted = true;
    }

    withdrawalScheduledCents = growWithdrawalByInflation(withdrawalScheduledCents, canonicalInflationRate);
  }

  const totalWithdrawalPaidCents = years.reduce((sum, y) => sum + y.withdrawalPaidCents, 0);

  return {
    years,
    depletionYear,
    lastsFullHorizon: depletionYear === null,
    endingBalanceCents: balanceCents,
    totalWithdrawalPaidCents
  };
}

function simulateGuardrailPath({
  investmentAmountCents,
  desiredAnnualWithdrawalCents,
  horizonYears,
  canonicalInflationRate,
  canonicalReturnRate,
  safetyFloorCents,
  postTriggerReductionPercent,
  onYearStep
}) {
  const years = [];
  let balanceCents = investmentAmountCents;
  let withdrawalScheduledCents = desiredAnnualWithdrawalCents;
  let depletionYear = null;
  let depleted = false;
  let triggerYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    onYearStep?.();

    const startingBalanceCents = balanceCents;
    if (triggerYear === null && startingBalanceCents <= safetyFloorCents) {
      triggerYear = year;
    }
    const reduced = triggerYear !== null;

    if (depleted) {
      years.push({
        year,
        startingBalanceCents: 0,
        withdrawalScheduledCents: 0,
        withdrawalPaidCents: 0,
        returnCents: 0,
        endingBalanceCents: 0,
        reduced
      });
      continue;
    }

    const withdrawalDueCents = reduced
      ? applyPostTriggerReduction(withdrawalScheduledCents, postTriggerReductionPercent)
      : withdrawalScheduledCents;

    const step = stepYear(startingBalanceCents, withdrawalDueCents, canonicalReturnRate);

    years.push({
      year,
      startingBalanceCents,
      withdrawalScheduledCents,
      withdrawalDueCents,
      withdrawalPaidCents: step.withdrawalPaidCents,
      returnCents: step.returnCents,
      endingBalanceCents: step.endingBalanceCents,
      reduced
    });

    balanceCents = step.endingBalanceCents;
    if (step.depleted) {
      depletionYear = year;
      depleted = true;
    }

    withdrawalScheduledCents = growWithdrawalByInflation(withdrawalScheduledCents, canonicalInflationRate);
  }

  const totalWithdrawalPaidCents = years.reduce((sum, y) => sum + y.withdrawalPaidCents, 0);
  const floorReached = triggerYear !== null;

  return {
    years,
    depletionYear,
    lastsFullHorizon: depletionYear === null,
    endingBalanceCents: balanceCents,
    totalWithdrawalPaidCents,
    triggerYear,
    floorReached
  };
}

/**
 * @param {{
 *   investmentAmountCents: number,
 *   desiredAnnualWithdrawalCents: number,
 *   horizonYears: number,
 *   inflationRate: number,
 *   safetyFloorCents: number,
 *   postTriggerReductionPercent: number
 * }} input
 * @param {Array<object>} securities curated list, read only through `item.security`
 * @param {{instrumentation?: {onYearStep?: () => void, onAllocationItem?: () => void}}} [options]
 */
export function computeSpendingGuardrailComparison(input, securities, options = {}) {
  const validated = validateGuardrailInputs(input, securities);
  if (!validated.ok) return validated;

  const {
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    inflationRate,
    safetyFloorCents,
    postTriggerReductionPercent
  } = validated;

  const onYearStep = options.instrumentation?.onYearStep;
  const onAllocationItem = options.instrumentation?.onAllocationItem;

  const targetRate = desiredAnnualWithdrawalCents / investmentAmountCents;
  const { items, unreachable, bestAchievableMetric } = bracketAndBlendCents(
    investmentAmountCents,
    securities,
    targetRate,
    (s) => s.yield + s.growthRate
  );

  for (const item of items) {
    onAllocationItem?.(item);
  }

  const blendedYield = blendedRate(items, investmentAmountCents, (s) => s.yield);
  const blendedGrowth = blendedRate(items, investmentAmountCents, (s) => s.growthRate);
  const canonicalReturnRate = canonicalizeReturnRate(blendedYield + blendedGrowth);
  const canonicalInflationRate = canonicalizeInflationRate(inflationRate);

  const steady = simulateSteadyPath({
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    canonicalInflationRate,
    canonicalReturnRate,
    onYearStep
  });

  const guardrail = simulateGuardrailPath({
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    canonicalInflationRate,
    canonicalReturnRate,
    safetyFloorCents,
    postTriggerReductionPercent,
    onYearStep
  });

  return {
    ok: true,
    investmentAmountCents,
    desiredAnnualWithdrawalCents,
    horizonYears,
    inflationRate,
    safetyFloorCents,
    postTriggerReductionPercent,
    allocation: { items, unreachable, bestAchievableMetric },
    blendedYield,
    blendedGrowth,
    canonicalReturnRate,
    steady,
    guardrail
  };
}
