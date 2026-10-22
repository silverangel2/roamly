/*
 * Money — the canonical money types for the production wiring
 * (DESIGN-PRODUCTION.md Phase 1).
 *
 * Rules inherited from the shadow price layer (zero-engine
 * engine/prices.mjs) and the Budget-vs-Real bot:
 *   - A price is a RANGE unless it is a recorded fact. Bands and cost
 *     models produce ranges; only a VERIFIED record is a point.
 *   - UNKNOWN is represented by a null range — never by zero.
 *   - Currency is carried, never converted. Arithmetic across
 *     currencies is an error, not a silent FX guess.
 *   - Amounts are plain numbers in major units (dollars), matching the
 *     shadow records ({ amount, currency, per }). Per-person vs
 *     per-party is part of the value, never a comment.
 */

export type CurrencyCode = string; // ISO 4217 alphabetic code, e.g. "CAD"

export type PerBasis = "person" | "party";

export interface MoneyAmount {
  amount: number;
  currency: CurrencyCode;
  per: PerBasis;
}

export interface MoneyRange {
  low: number;
  high: number;
  currency: CurrencyCode;
  per: PerBasis;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCY_PATTERN.test(value);
}

export function isPerBasis(value: unknown): value is PerBasis {
  return value === "person" || value === "party";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isMoneyAmount(value: unknown): value is MoneyAmount {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isFiniteNumber(v.amount) &&
    isCurrencyCode(v.currency) &&
    isPerBasis(v.per)
  );
}

export function isMoneyRange(value: unknown): value is MoneyRange {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isFiniteNumber(v.low) &&
    isFiniteNumber(v.high) &&
    v.low <= v.high &&
    isCurrencyCode(v.currency) &&
    isPerBasis(v.per)
  );
}

/** A verified point price expressed as a degenerate range. */
export function pointRange(amount: MoneyAmount): MoneyRange {
  return {
    low: amount.amount,
    high: amount.amount,
    currency: amount.currency,
    per: amount.per
  };
}

export function makeRange(
  low: number,
  high: number,
  currency: CurrencyCode,
  per: PerBasis
): MoneyRange {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
    throw new RangeError(`invalid money range ${low}..${high}`);
  }
  if (!isCurrencyCode(currency)) {
    throw new RangeError(`invalid currency code: ${String(currency)}`);
  }
  return { low, high, currency, per };
}

/** Scale a per-person range to a party range (or any positive factor). */
export function scaleRange(range: MoneyRange, factor: number, per: PerBasis): MoneyRange {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new RangeError(`invalid scale factor ${factor}`);
  }
  return {
    low: range.low * factor,
    high: range.high * factor,
    currency: range.currency,
    per
  };
}

/**
 * Add ranges. All ranges must share currency and per basis — a mismatch
 * throws, because silently adding CAD-per-person to USD-per-party is
 * how fake totals are born (the shadow judge only ever sums one
 * currency, one basis).
 */
export function addRanges(ranges: readonly MoneyRange[]): MoneyRange | null {
  if (ranges.length === 0) return null;
  const first = ranges[0];
  let low = 0;
  let high = 0;
  for (const r of ranges) {
    if (r.currency !== first.currency || r.per !== first.per) {
      throw new RangeError(
        `money range basis mismatch: ${r.currency}/${r.per} vs ${first.currency}/${first.per}`
      );
    }
    low += r.low;
    high += r.high;
  }
  return { low, high, currency: first.currency, per: first.per };
}

/** Display form used by reports: "CAD 908–2004" (rounded, no decimals). */
export function formatRange(range: MoneyRange): string {
  return `${range.currency} ${Math.round(range.low)}–${Math.round(range.high)}`;
}

export function formatAmount(amount: MoneyAmount): string {
  return `${amount.currency} ${Math.round(amount.amount)}`;
}
