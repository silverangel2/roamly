function normalizeFallback(fallback: number) {
  return Number.isFinite(fallback) ? Math.max(1, Math.round(fallback)) : 3;
}

export type TripDateRangeErrorCode = "MISSING_DATES" | "INVALID_DATES" | "END_BEFORE_START";

export type TripDateRangeResult = {
  ok: boolean;
  days: number | null;
  errorCode?: TripDateRangeErrorCode;
};

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

export function calculateTripDateRange(startDate?: string | null, endDate?: string | null): TripDateRangeResult {
  const hasStart = Boolean(startDate && startDate.trim());
  const hasEnd = Boolean(endDate && endDate.trim());
  if (!hasStart || !hasEnd) return { ok: false, days: null, errorCode: "MISSING_DATES" };

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start === null || end === null) return { ok: false, days: null, errorCode: "INVALID_DATES" };
  if (end < start) return { ok: false, days: null, errorCode: "END_BEFORE_START" };

  return {
    ok: true,
    days: Math.max(1, Math.floor((end - start) / 86_400_000) + 1)
  };
}

export function calculateInclusiveTripDays(startDate?: string | null, endDate?: string | null, fallback = 3) {
  const fallbackDays = normalizeFallback(fallback);
  const range = calculateTripDateRange(startDate, endDate);
  if (range.ok) return range.days || fallbackDays;
  if (range.errorCode === "END_BEFORE_START") return 0;
  return fallbackDays;
}
