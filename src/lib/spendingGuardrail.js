import { bracketAndBlendCents } from './allocation.js';

const RATE_SCALE = 1000000;
const SCALE_BIGINT = BigInt(RATE_SCALE);

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
}

function refusal(error) {
  return { ok: false, reason: 'safe-arithmetic-refusal', error };
}

function toBigInt(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return BigInt(value);
}

function roundRatio(numerator, denominator) {
  if (denominator === 0n) {
    throw new RangeError('Cannot divide by zero.');
  }

  const negative = numerator < 0n;
  const absoluteNumerator = negative ? -numerator : numerator;
  const quotient = absoluteNumerator / denominator;
  const remainder = absoluteNumerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

function bigIntToSafeInteger(value, label) {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return asNumber;
}

function multiplyScaledInteger(value, scaledRate, label) {
  const numerator = toBigInt(value, `${label} base`) * toBigInt(scaledRate, `${label} rate`);
  return bigIntToSafeInteger(roundRatio(numerator, SCALE_BIGINT), label);
}

function parseScaledDecimal(rate, label) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new TypeError(`${label} must be a finite non-negative number.`);
  }

  const rendered = rate.toString().toLowerCase();
  const [coefficient, exponentText] = rendered.split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);

  if (!Number.isInteger(exponent)) {
    throw new TypeError(`${label} must use a deterministic decimal representation.`);
  }

  const [whole = '0', fraction = ''] = coefficient.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new TypeError(`${label} must use a deterministic decimal representation.`);
  }

  let digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  if (digits === '') digits = '0';

  let decimalPlaces = fraction.length - exponent;
  if (decimalPlaces < 0) {
    digits += '0'.repeat(-decimalPlaces);
    decimalPlaces = 0;
  }

  if (decimalPlaces > 6) {
    const extraPlaces = decimalPlaces - 6;
    const extraDigits = digits.slice(-extraPlaces);
    if (/[1-9]/.test(extraDigits)) {
      throw new RangeError(`${label} must be an exact multiple of 0.000001.`);
    }
    digits = digits.slice(0, digits.length - extraPlaces) || '0';
    decimalPlaces = 6;
  }

  const scaledDigits = digits + '0'.repeat(6 - decimalPlaces);
  const scaled = Number(scaledDigits);
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`${label} exceeds the supported scale range.`);
  }

  return scaled;
}

function validatePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a safe integer greater than zero.`);
  }
}

function validateNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a safe integer of zero or more.`);
  }
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

function validateMoneyFields(object, fields) {
  for (const field of fields) {
    if (!Number.isSafeInteger(object[field])) {
      throw new RangeError(`${field} must remain a safe integer.`);
    }
  }
}

function canonicalizeSecurities(securities, instrumentation) {
  if (!Array.isArray(securities) || securities.length < 2 || !securities.every(validateSecurity)) {
    throw new TypeError('Curated securities must each include a symbol, name, type, yield, and growth rate.');
  }

  return securities.map((security) => {
    instrumentation?.onSecurity?.(security);
    return {
      security,
      yieldRatePpm: parseScaledDecimal(security.yield, `${security.symbol} yield`),
      growthRatePpm: parseScaledDecimal(security.growthRate, `${security.symbol} growth rate`)
    };
  });
}

function computeBlendedRates(allocationItems, canonicalSecurities, investmentAmountCents, instrumentation) {
  const bySecurity = new Map(canonicalSecurities.map((entry) => [entry.security, entry]));
  let weightedYield = 0n;
  let weightedGrowth = 0n;

  for (const item of allocationItems) {
    instrumentation?.onAllocationItem?.(item);
    const canonical = bySecurity.get(item.security);
    weightedYield += toBigInt(item.amountCents, 'allocation amountCents') * BigInt(canonical.yieldRatePpm);
    weightedGrowth += toBigInt(item.amountCents, 'allocation amountCents') * BigInt(canonical.growthRatePpm);
  }

  const denominator = toBigInt(investmentAmountCents, 'investmentAmountCents');
  const blendedYieldRatePpm = bigIntToSafeInteger(roundRatio(weightedYield, denominator), 'blended yield rate');
  const blendedGrowthRatePpm = bigIntToSafeInteger(roundRatio(weightedGrowth, denominator), 'blended growth rate');

  return {
    blendedYieldRatePpm,
    blendedGrowthRatePpm,
    blendedTotalReturnRatePpm: blendedYieldRatePpm + blendedGrowthRatePpm
  };
}

function applyReduction(withdrawalCents, reductionRatePpm) {
  const retainedRatePpm = RATE_SCALE - reductionRatePpm;
  return multiplyScaledInteger(withdrawalCents, retainedRatePpm, 'reduced withdrawal cents');
}

function parsePostTriggerReductionPercent(percent) {
  const scaledPercent = parseScaledDecimal(percent, 'post-trigger reduction percent');
  const maximumScaledPercent = RATE_SCALE * 100;
  if (scaledPercent > maximumScaledPercent) {
    throw new RangeError('post-trigger reduction percent must be between 0 and 100 inclusive.');
  }
  if (scaledPercent % 100 !== 0) {
    throw new RangeError('post-trigger reduction percent must produce an exact 0.000001 rate.');
  }
  return scaledPercent / 100;
}

function buildSimulation({
  investmentAmountCents,
  desiredAnnualWithdrawalCents,
  horizonYears,
  inflationRatePpm,
  safetyFloorCents,
  reductionRatePpm,
  blendedYieldRatePpm,
  blendedGrowthRatePpm,
  guardrail,
  instrumentation
}) {
  const rows = [];
  let startingBalanceCents = investmentAmountCents;
  let scheduledWithdrawalCents = desiredAnnualWithdrawalCents;
  let totalWithdrawalsPaidCents = 0;
  let triggerYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    instrumentation?.onYear?.({ guardrail, year, startingBalanceCents });

    const floorTriggered = guardrail && triggerYear === null && startingBalanceCents <= safetyFloorCents;
    if (floorTriggered) {
      triggerYear = year;
    }

    const reductionApplied = guardrail && triggerYear !== null;
    const withdrawalRequestedCents = reductionApplied
      ? applyReduction(scheduledWithdrawalCents, reductionRatePpm)
      : scheduledWithdrawalCents;

    if (startingBalanceCents === 0) {
      const row = {
        year,
        startingBalanceCents: 0,
        dividendIncomeCents: 0,
        growthAmountCents: 0,
        totalReturnCents: 0,
        withdrawalRequestedCents,
        withdrawalPaidCents: 0,
        reductionApplied,
        endingBalanceCents: 0
      };
      validateMoneyFields(row, [
        'startingBalanceCents',
        'dividendIncomeCents',
        'growthAmountCents',
        'totalReturnCents',
        'withdrawalRequestedCents',
        'withdrawalPaidCents',
        'endingBalanceCents'
      ]);
      rows.push(row);
      scheduledWithdrawalCents = multiplyScaledInteger(
        scheduledWithdrawalCents,
        RATE_SCALE + inflationRatePpm,
        'inflated withdrawal cents'
      );
      continue;
    }

    const dividendIncomeCents = multiplyScaledInteger(
      startingBalanceCents,
      blendedYieldRatePpm,
      'dividend income cents'
    );
    const growthAmountCents = multiplyScaledInteger(
      startingBalanceCents,
      blendedGrowthRatePpm,
      'growth amount cents'
    );
    const totalReturnCents = bigIntToSafeInteger(
      toBigInt(dividendIncomeCents, 'dividend income cents') + toBigInt(growthAmountCents, 'growth amount cents'),
      'total return cents'
    );
    const grownBalanceCents = bigIntToSafeInteger(
      toBigInt(startingBalanceCents, 'startingBalanceCents') + toBigInt(totalReturnCents, 'total return cents'),
      'grown balance cents'
    );
    const withdrawalPaidCents = Math.min(withdrawalRequestedCents, grownBalanceCents);
    const endingBalanceCents = grownBalanceCents - withdrawalPaidCents;
    const row = {
      year,
      startingBalanceCents,
      dividendIncomeCents,
      growthAmountCents,
      totalReturnCents,
      withdrawalRequestedCents,
      withdrawalPaidCents,
      reductionApplied,
      endingBalanceCents
    };

    validateMoneyFields(row, [
      'startingBalanceCents',
      'dividendIncomeCents',
      'growthAmountCents',
      'totalReturnCents',
      'withdrawalRequestedCents',
      'withdrawalPaidCents',
      'endingBalanceCents'
    ]);

    rows.push(row);
    totalWithdrawalsPaidCents = bigIntToSafeInteger(
      toBigInt(totalWithdrawalsPaidCents, 'totalWithdrawalsPaidCents') + toBigInt(withdrawalPaidCents, 'withdrawalPaidCents'),
      'total withdrawals paid cents'
    );
    startingBalanceCents = endingBalanceCents;
    scheduledWithdrawalCents = multiplyScaledInteger(
      scheduledWithdrawalCents,
      RATE_SCALE + inflationRatePpm,
      'inflated withdrawal cents'
    );
  }

  const result = {
    rows,
    totalWithdrawalsPaidCents,
    endingBalanceCents: startingBalanceCents,
    triggerYear,
    floorReached: triggerYear !== null
  };

  validateMoneyFields(result, ['totalWithdrawalsPaidCents', 'endingBalanceCents']);
  return result;
}

export function computeSpendingGuardrail(input, securities, options = {}) {
  try {
    const {
      investmentAmountCents,
      desiredAnnualWithdrawalCents,
      horizonYears,
      inflationRate,
      safetyFloorCents,
      postTriggerReductionPercent = 0
    } = input || {};

    validatePositiveSafeInteger(investmentAmountCents, 'investmentAmountCents');
    validateNonNegativeSafeInteger(desiredAnnualWithdrawalCents, 'desiredAnnualWithdrawalCents');
    if (!Number.isInteger(horizonYears) || horizonYears < 1) {
      throw new TypeError('horizonYears must be a whole number of at least 1.');
    }
    validateNonNegativeSafeInteger(safetyFloorCents, 'safetyFloorCents');

    const inflationRatePpm = parseScaledDecimal(inflationRate, 'inflation rate');
    const reductionRatePpm = parsePostTriggerReductionPercent(postTriggerReductionPercent);

    const instrumentation = options.instrumentation;
    const canonicalSecurities = canonicalizeSecurities(securities, instrumentation);
    instrumentation?.onAllocation?.({ securitiesCount: canonicalSecurities.length });

    const targetRatePpm = bigIntToSafeInteger(
      roundRatio(
        toBigInt(desiredAnnualWithdrawalCents, 'desiredAnnualWithdrawalCents') * SCALE_BIGINT,
        toBigInt(investmentAmountCents, 'investmentAmountCents')
      ),
      'target rate'
    );
    const canonicalBySecurity = new Map(canonicalSecurities.map((entry) => [entry.security, entry]));
    const allocation = bracketAndBlendCents(
      investmentAmountCents,
      canonicalSecurities.map((entry) => entry.security),
      targetRatePpm / RATE_SCALE,
      (security) => security.yield + security.growthRate,
      {
        targetRatePpm,
        metricRatePpmOf(security) {
          const canonical = canonicalBySecurity.get(security);
          return canonical.yieldRatePpm + canonical.growthRatePpm;
        }
      }
    );

    const blendedRates = computeBlendedRates(
      allocation.items,
      canonicalSecurities,
      investmentAmountCents,
      instrumentation
    );

    const steady = buildSimulation({
      investmentAmountCents,
      desiredAnnualWithdrawalCents,
      horizonYears,
      inflationRatePpm,
      safetyFloorCents,
      reductionRatePpm,
      blendedYieldRatePpm: blendedRates.blendedYieldRatePpm,
      blendedGrowthRatePpm: blendedRates.blendedGrowthRatePpm,
      guardrail: false,
      instrumentation
    });
    const guardrail = buildSimulation({
      investmentAmountCents,
      desiredAnnualWithdrawalCents,
      horizonYears,
      inflationRatePpm,
      safetyFloorCents,
      reductionRatePpm,
      blendedYieldRatePpm: blendedRates.blendedYieldRatePpm,
      blendedGrowthRatePpm: blendedRates.blendedGrowthRatePpm,
      guardrail: true,
      instrumentation
    });

    return {
      ok: true,
      investmentAmountCents,
      desiredAnnualWithdrawalCents,
      horizonYears,
      safetyFloorCents,
      inflationRatePpm,
      postTriggerReductionPercent,
      postTriggerReductionRatePpm: reductionRatePpm,
      allocation,
      blendedRates,
      steady,
      guardrail
    };
  } catch (error) {
    if (error instanceof TypeError) {
      return invalid(error.message);
    }
    if (error instanceof RangeError) {
      return refusal(error.message);
    }
    throw error;
  }
}

export const SPENDING_GUARDRAIL_RATE_SCALE = RATE_SCALE;
