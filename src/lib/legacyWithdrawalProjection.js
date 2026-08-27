const RETURN_RATE_SCALE = 1000;
const INFLATION_RATE_SCALE = 1000000;

function invalid(error) {
  return { ok: false, reason: 'invalid-input', error };
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

export function canonicalizeReturnRate(rate) {
  if (!Number.isFinite(rate)) {
    throw new TypeError('Return rate must be finite.');
  }

  return Math.round(rate * RETURN_RATE_SCALE);
}

export function canonicalizeInflationRate(rate) {
  if (!Number.isFinite(rate)) {
    throw new TypeError('Inflation rate must be finite.');
  }

  return Math.round(rate * INFLATION_RATE_SCALE);
}

export function applyCanonicalReturnRate(balanceCents, canonicalReturnRate) {
  const numerator = toBigInt(balanceCents, 'balanceCents') * toBigInt(canonicalReturnRate, 'canonicalReturnRate');
  const rounded = roundRatio(numerator, BigInt(RETURN_RATE_SCALE));
  return bigIntToSafeInteger(rounded, 'return cents');
}

export function growWithdrawalByInflation(withdrawalCents, canonicalInflationRate) {
  const numerator = toBigInt(withdrawalCents, 'withdrawalCents') * BigInt(INFLATION_RATE_SCALE + canonicalInflationRate);
  const rounded = roundRatio(numerator, BigInt(INFLATION_RATE_SCALE));
  return bigIntToSafeInteger(rounded, 'inflated withdrawal cents');
}

export function projectLegacyWithdrawal({
  investmentAmountCents,
  annualWithdrawalCents,
  horizonYears,
  inflationRate,
  endingBalanceFloorCents = 0,
  catalogEntry
}) {
  if (!Number.isSafeInteger(investmentAmountCents) || investmentAmountCents <= 0) {
    return invalid('Enter a starting portfolio as a safe whole number of cents greater than $0.');
  }
  if (!Number.isSafeInteger(annualWithdrawalCents) || annualWithdrawalCents < 0) {
    return invalid('Enter a first-year annual withdrawal as a safe whole number of cents of $0 or more.');
  }
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    return invalid('Enter a retirement horizon of at least 1 whole year.');
  }
  if (!Number.isFinite(inflationRate) || inflationRate < 0) {
    return invalid('Enter an inflation rate of 0% or more.');
  }
  if (!Number.isSafeInteger(endingBalanceFloorCents) || endingBalanceFloorCents < 0) {
    return invalid('Enter a desired ending balance as a safe whole number of cents of $0 or more.');
  }
  if (
    !catalogEntry ||
    !Number.isInteger(catalogEntry.canonicalReturnRate) ||
    !Array.isArray(catalogEntry.allocation) ||
    catalogEntry.allocation.length < 1
  ) {
    return invalid('No valid fixed catalog allocation is available to project.');
  }

  const canonicalInflationRate = canonicalizeInflationRate(inflationRate);
  const years = [];
  let endingBalanceCents = investmentAmountCents;
  let withdrawalCents = annualWithdrawalCents;
  let depletionYear = null;

  for (let year = 1; year <= horizonYears; year++) {
    const startingBalanceCents = endingBalanceCents;
    const returnCents = applyCanonicalReturnRate(startingBalanceCents, catalogEntry.canonicalReturnRate);
    endingBalanceCents = startingBalanceCents + returnCents - withdrawalCents;

    years.push({
      year,
      startingBalanceCents,
      returnCents,
      withdrawalCents,
      endingBalanceCents
    });

    if (endingBalanceCents < 0) {
      depletionYear = year;
      break;
    }

    withdrawalCents = growWithdrawalByInflation(withdrawalCents, canonicalInflationRate);
  }

  const lastsFullHorizon = depletionYear === null;
  const meetsEndingBalanceFloor = lastsFullHorizon && endingBalanceCents >= endingBalanceFloorCents;

  return {
    ok: true,
    annualWithdrawalCents,
    endingBalanceFloorCents,
    horizonYears,
    canonicalInflationRate,
    years,
    endingBalanceCents,
    depletionYear,
    lastsFullHorizon,
    meetsEndingBalanceFloor
  };
}

export const LEGACY_WITHDRAWAL_RATE_SCALES = Object.freeze({
  returnRate: RETURN_RATE_SCALE,
  inflationRate: INFLATION_RATE_SCALE
});
