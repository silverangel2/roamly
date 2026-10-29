/**
 * ONE trip clock for the Round 2 panels (Round 2, CLOCK HONESTY).
 *
 * The composite's "Trip in 3 days" badge and its "Today" tab must be
 * computed from the same real clock. Both panels therefore read here,
 * never from ad-hoc date math:
 * - The trip window (future / active / completed / missing) is decided
 *   in the TRIP's timezone from calendar dates, exactly like
 *   tripWindowState in liveCompanion.ts (same Intl en-CA day parts).
 * - Days-until is the calendar-date difference in that same timezone,
 *   so the badge and the tab can never disagree about which day "today"
 *   is — even when the viewer's device timezone differs from the trip's.
 * - If the trip has not started, the Today tab shows the PLANNED Day 1
 *   content labeled as planned, never as happening today. That labeling
 *   lives in the panels; this module only supplies the consistent facts.
 *
 * Pure functions; `now` is injectable so tests are timezone-independent
 * (the same assertions run under TZ=America/Moncton and TZ=UTC).
 */

export type TripClockWindow = "future_trip" | "active" | "completed_trip" | "missing_dates";

export type TripClockState = {
  window: TripClockWindow;
  /** Days from today (trip timezone) to the start date; null when unknown. */
  daysUntilStart: number | null;
  /** Inclusive trip length in days; null when dates are missing/invalid. */
  dayCount: number | null;
  /** Hero badge copy, e.g. "Trip in 3 days" / "Trip in progress". */
  badge: string;
};

function parseCalendarDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function dayPartsInTimezone(now: Date, timezone: string): { year: number; month: number; day: number } {
  let zone = (timezone || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format();
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function utcDayNumber(date: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

export function tripClockState(params: {
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  now?: Date;
}): TripClockState {
  const start = parseCalendarDate(params.startDate);
  const end = parseCalendarDate(params.endDate);
  if (!start || !end) {
    return { window: "missing_dates", daysUntilStart: null, dayCount: null, badge: "Dates to confirm" };
  }
  const today = dayPartsInTimezone(params.now || new Date(), params.timezone || "UTC");
  const todayNum = utcDayNumber(today);
  const startNum = utcDayNumber(start);
  const endNum = utcDayNumber(end);
  const daysUntilStart = startNum - todayNum;
  const dayCount = endNum >= startNum ? endNum - startNum + 1 : null;
  if (todayNum < startNum) {
    return {
      window: "future_trip",
      daysUntilStart,
      dayCount,
      badge: daysUntilStart === 1 ? "Trip tomorrow" : `Trip in ${daysUntilStart} days`
    };
  }
  if (todayNum > endNum) {
    return { window: "completed_trip", daysUntilStart, dayCount, badge: "Trip complete" };
  }
  return { window: "active", daysUntilStart, dayCount, badge: "Trip in progress" };
}

/** "Oct 26 – Oct 30, 2026" from calendar dates (no timezone shift: dates are calendar facts). */
export function formatTripDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!start) return "";
  const monthDay = (date: { year: number; month: number; day: number }) =>
    new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(date.year, date.month - 1, date.day))
    );
  if (!end || (end.year === start.year && end.month === start.month && end.day === start.day)) {
    return `${monthDay(start)}, ${start.year}`;
  }
  return `${monthDay(start)} – ${monthDay(end)}, ${end.year}`;
}

/** "Mon, Oct 26" for a trip day number (1-based) off the start date. */
export function tripDayDateLabel(startDate: string | null | undefined, dayNumber: number): string | null {
  const start = parseCalendarDate(startDate);
  if (!start || !Number.isFinite(dayNumber) || dayNumber < 1) return null;
  const date = new Date(Date.UTC(start.year, start.month - 1, start.day) + (Math.floor(dayNumber) - 1) * 86_400_000);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

/** "2h", "45m", "1h 15m" — the composite's duration style. Null/0/negative → null (never a fabricated duration). */
export function formatDurationHM(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}
