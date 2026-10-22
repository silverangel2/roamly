/*
 * Time — THE canonical time adapter for the production wiring
 * (DESIGN-PRODUCTION.md §1.2 / §2.1, Phase 1). Every later phase
 * converts through here. No module parses dates independently, forces
 * UTC, hard-codes a timezone, or adds 86,400,000 ms for a calendar day.
 *
 * THE THREE TIME MODELS (keep them distinct):
 *   - INSTANT — a UTC timestamp (epoch ms / ISO-8601 Z string).
 *     Ordering, sync, audit, expiry. The only form that may be
 *     compared or stored as "when something happened".
 *   - PLAN TIME — trip-local civil date + minutes after local
 *     midnight, in the trip's IANA timezone. Solver and companion
 *     geometry live here. This is exactly the shadow semantics:
 *     part2's stated times are { date, time, minutes } with
 *     minutes = hour*60 + minute of the stated local clock, and the
 *     zero-engine solver's start/end are the same minutes.
 *   - SOURCE WALL TIME — the exact local date/time + timezone string
 *     a booking provider stated, kept verbatim with provenance
 *     (types.ts StatedDateTimeDTO). A stated abbreviation ("AST") is
 *     provenance, NOT an IANA zone; conversion to plan time happens
 *     only against the trip's IANA zone.
 *
 * CONVERSION POLICIES (explicit — these are decisions, not accidents):
 *   - Nonexistent local time (spring-forward gap, e.g. 02:30 on the
 *     day clocks jump 02:00 -> 03:00): SHIFT FORWARD — the result is
 *     the instant the local clock first reaches a valid time at or
 *     after the requested wall time, shifted by the gap (02:30 ->
 *     03:30 local). A booking that states a gap time means "that
 *     morning, as early as the clock allows", never the previous day.
 *   - Ambiguous local time (fall-back overlap, e.g. 01:30 occurs
 *     twice): default FIRST occurrence (the daylight-time instant);
 *     callers that know better pass { ambiguous: "second" }.
 *   - Nonexistent local DATE (a whole civil date skipped by a zone
 *     change — Pacific/Apia skipped 2011-12-30): localToInstant
 *     THROWS RangeError("nonexistent local date ..."). A plan day
 *     that does not exist must surface as an error, never silently
 *     become a different day.
 *   - Plan minutes outside [0, 1440) are not an error at the value
 *     level (an item may end after midnight); normalizePlanTime()
 *     rolls them into a (date, minutes) pair when a date is needed.
 *
 * Implementation: Intl.DateTimeFormat only — no date libraries, so
 * the IANA database the runtime ships is the single source of truth.
 */

export type UtcInstant = string; // ISO 8601, Z form: "2026-10-23T13:20:00.000Z"
export type LocalDate = string; // civil date: "2026-10-23"
export type PlanMinutes = number; // minutes after local midnight

export interface LocalParts {
  date: LocalDate;
  minutes: PlanMinutes; // hour*60 + minute at the instant
  clock: string; // "HH:MM" (shadow fmt semantics)
  offsetMinutes: number; // zone offset from UTC at the instant (+ = east)
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const m = LOCAL_DATE_PATTERN.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function isUtcInstant(value: unknown): value is UtcInstant {
  if (typeof value !== "string") return false;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

const tzValidityCache = new Map<string, boolean>();

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const cached = tzValidityCache.get(value);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    ok = false;
  }
  tzValidityCache.set(value, ok);
  return ok;
}

/* ------------------------------------------------------------------ */
/* Civil-date arithmetic (timezone-free; a civil date is a civil date) */
/* ------------------------------------------------------------------ */

function dateToDayIndex(date: LocalDate): number {
  const m = LOCAL_DATE_PATTERN.exec(date);
  if (!m) throw new RangeError(`invalid local date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

function dayIndexToDate(index: number): LocalDate {
  const d = new Date(index * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Add n calendar days. Pure civil math — DST can never leak into this. */
export function addCalendarDays(date: LocalDate, n: number): LocalDate {
  if (!isLocalDate(date)) throw new RangeError(`invalid local date: ${date}`);
  return dayIndexToDate(dateToDayIndex(date) + n);
}

/** Whole calendar days from a to b (b - a). */
export function diffCalendarDays(a: LocalDate, b: LocalDate): number {
  return dateToDayIndex(b) - dateToDayIndex(a);
}

/** 0 = Sunday .. 6 = Saturday, for a civil date. */
export function weekdayOf(date: LocalDate): number {
  // Day index 0 (1970-01-01) was a Thursday (4).
  return (((dateToDayIndex(date) + 4) % 7) + 7) % 7;
}

/* ------------------------------------------------------------------ */
/* Clock <-> minutes (shadow fmt parity)                             */
/* ------------------------------------------------------------------ */

/** "HH:MM" — zero-padded, hours may exceed 23 (shadow util.fmt). */
export function minutesToClock(minutes: PlanMinutes): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function clockToMinutes(clock: string): PlanMinutes {
  const m = /^(\d{1,3}):(\d{2})$/.exec(clock);
  if (!m) throw new RangeError(`invalid clock: ${clock}`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59) throw new RangeError(`invalid clock: ${clock}`);
  return minutes;
}

/** Roll out-of-range minutes into a (date, minutes in [0,1440)) pair. */
export function normalizePlanTime(
  date: LocalDate,
  minutes: PlanMinutes
): { date: LocalDate; minutes: PlanMinutes } {
  const dayShift = Math.floor(minutes / 1440);
  return {
    date: addCalendarDays(date, dayShift),
    minutes: minutes - dayShift * 1440
  };
}

/* ------------------------------------------------------------------ */
/* Instant <-> trip-local conversion                                   */
/* ------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

interface RawParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function rawPartsAt(instantMs: number, timeZone: string): RawParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  let hour = get("hour");
  if (hour === 24) hour = 0; // defensive: some ICU builds report 24 at midnight
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second")
  };
}

/** Zone offset from UTC, in minutes, at an instant (+ = east of UTC). */
export function utcOffsetMinutesAt(instantMs: number, timeZone: string): number {
  const p = rawPartsAt(instantMs, timeZone);
  const localAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instantSecondMs = Math.floor(instantMs / 1000) * 1000;
  return Math.round((localAsUtcMs - instantSecondMs) / MINUTE_MS);
}

export function instantToLocal(instantMs: number, timeZone: string): LocalParts {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`invalid time zone: ${timeZone}`);
  const p = rawPartsAt(instantMs, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const minutes = p.hour * 60 + p.minute;
  return {
    date,
    minutes,
    clock: minutesToClock(minutes),
    offsetMinutes: utcOffsetMinutesAt(instantMs, timeZone)
  };
}

export interface LocalToInstantOptions {
  /** Which occurrence of an ambiguous (fall-back) wall time to pick. */
  ambiguous?: "first" | "second";
  /** Nonexistent (spring-gap) wall times shift forward by the gap. */
  gap?: "shift-forward";
}

/**
 * Convert a trip-local (date, minutes) in an IANA zone to an instant.
 * See the header for the gap / ambiguity / skipped-date policies.
 */
export function localToInstant(
  date: LocalDate,
  minutes: PlanMinutes,
  timeZone: string,
  options: LocalToInstantOptions = {}
): number {
  if (!isLocalDate(date)) throw new RangeError(`invalid local date: ${date}`);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) {
    throw new RangeError(`plan minutes out of range [0,1440): ${minutes}`);
  }
  if (!isValidTimeZone(timeZone)) throw new RangeError(`invalid time zone: ${timeZone}`);

  const civilMs = dateToDayIndex(date) * DAY_MS + minutes * MINUTE_MS;

  // Candidate offsets: the offset in force around the target day. A
  // transition inside the window contributes both of its offsets.
  const offsets = new Set<number>();
  for (const probe of [civilMs - DAY_MS, civilMs, civilMs + DAY_MS]) {
    offsets.add(utcOffsetMinutesAt(probe, timeZone));
  }

  const valid: number[] = [];
  const shifted: { instantMs: number; local: LocalParts }[] = [];
  for (const offset of offsets) {
    const candidate = civilMs - offset * MINUTE_MS;
    const back = instantToLocal(candidate, timeZone);
    if (back.date === date && back.minutes === minutes) {
      valid.push(candidate);
    } else {
      shifted.push({ instantMs: candidate, local: back });
    }
  }

  if (valid.length === 1) return valid[0];
  if (valid.length >= 2) {
    valid.sort((a, b) => a - b);
    return options.ambiguous === "second" ? valid[valid.length - 1] : valid[0];
  }

  // No exact match: the wall time is nonexistent (gap) — or the whole
  // date is. Shift forward: the earliest candidate whose local time is
  // at/after the requested wall time ON THE SAME DATE.
  const forward = shifted
    .filter((s) => s.local.date === date && s.local.minutes >= minutes)
    .sort((a, b) => a.instantMs - b.instantMs)[0];
  if (forward) return forward.instantMs;

  throw new RangeError(
    `nonexistent local date ${date} in time zone ${timeZone} (the civil date was skipped)`
  );
}

/** Length of a local day in minutes: 1440 normally, 1380 / 1500 on DST days. */
export function localDayLengthMinutes(date: LocalDate, timeZone: string): number {
  const start = localToInstant(date, 0, timeZone);
  const end = localToInstant(addCalendarDays(date, 1), 0, timeZone);
  return Math.round((end - start) / MINUTE_MS);
}

/* ------------------------------------------------------------------ */
/* Instant parsing / formatting                                        */
/* ------------------------------------------------------------------ */

export function parseInstant(instant: UtcInstant): number {
  if (!isUtcInstant(instant)) throw new RangeError(`invalid UTC instant: ${instant}`);
  return Date.parse(instant);
}

export function formatInstant(instantMs: number): UtcInstant {
  return new Date(instantMs).toISOString();
}

/** Convenience: ISO instant -> trip-local parts in one call. */
export function instantStringToLocal(instant: UtcInstant, timeZone: string): LocalParts {
  return instantToLocal(parseInstant(instant), timeZone);
}

/** Convenience: trip-local (date, minutes) -> ISO instant string. */
export function localToInstantString(
  date: LocalDate,
  minutes: PlanMinutes,
  timeZone: string,
  options: LocalToInstantOptions = {}
): UtcInstant {
  return formatInstant(localToInstant(date, minutes, timeZone, options));
}
