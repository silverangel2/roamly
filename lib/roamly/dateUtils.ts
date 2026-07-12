function normalizeFallback(fallback: number) {
  return Number.isFinite(fallback) ? Math.max(1, Math.round(fallback)) : 3;
}

function parseDateOnly(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

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

export function calculateInclusiveTripDays(startDate?: string | null, endDate?: string | null, fallback = 3) {
  const fallbackDays = normalizeFallback(fallback);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (start === null || end === null || end < start) return fallbackDays;

  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}
