/*
 * Itinerary Home panel (panel 5, mock panel 1 of correct-4-pages-part2).
 *
 * Pure derivation for the new itinerary-home surface: day picker labels,
 * the compact one-day timeline, and the evidence labeling on every row.
 * No imports — the checks script loads this file directly, and the trip
 * page composes it with `buildDisplayTimelineItems` (the plan view the
 * day cards already render, so the panel and the legacy cards show the
 * SAME stored plan; the Live tab shows the companion view of that plan).
 *
 * EVIDENCE RULES (the 4 boundaries, applied here, not in the mock):
 * - A row is a fact only when it is booking-anchored
 *   (`authority === "confirmed"`). Everything else is the plan draft.
 * - Plan durations are ESTIMATES: they always render with "(est.)".
 *   A confirmed row's duration renders bare — it comes from a booking.
 * - "Planned" is shown on a travel leg only when its time comes from
 *   the plan draft (the builder prefixes such times with "Planned · "),
 *   never on a booking-pinned or confirmed row.
 * - Nothing is invented: a missing duration renders no duration, a
 *   missing return-to-stay row is simply absent, a missing day
 *   subtitle renders no subtitle. Mock sample values (hotel names,
 *   times, durations) are NEVER used here — every string comes from
 *   the trip's own stored plan or bookings.
 * - Per-trip isolation is structural: every function takes ONLY one
 *   trip's days/rows. There is no lookup, no cache, no second trip.
 * - DISPLAY-ONLY day summary (final local round, 2026-10-27): the
 *   view's `subtitle` stays the stored plan text, untouched, for
 *   audit; `displaySummary` is derived at render time from the
 *   day's own rows by lib/roamly/daySummary.ts and is what the
 *   panel shows. The one import below is that pure derivation.
 */

import { deriveDaySummary } from "@/lib/roamly/daySummary";
import { displayActivityDescription, displayRestTitle } from "@/lib/roamly/activityDescription";

export type HomeTimelineRowInput = {
  time: string;
  title: string;
  description: string;
  location: string;
  category: string;
  itemType: string;
  durationLabel: string;
  travelLabel: string;
  mapQuery: string;
  authority: "confirmed" | "must_do" | "flexible" | "supporting" | string;
  timeFromBooking: boolean;
  /** True when the plan record carries retimed_by_event (recalculated time). */
  timeRetimed?: boolean;
};

export type HomeRowKind = "travel" | "arrival" | "venue" | "return-to-stay";

/**
 * Owner-10 item 5 — strip the title echo from a row's detail line.
 * Stored plan descriptions are often exactly "{title} — planned for
 * day N of this trip." — repeating the title as the description.
 * That echo is removed: a detail that IS the title, or that starts
 * with the title + a dash, loses the title prefix, and a remainder
 * that is only the generic "planned for day N" phrase is dropped
 * entirely (the row then shows its duration/category only — never
 * an invented description). A detail carrying real information
 * beyond the title is kept verbatim.
 */
export function stripTitleEcho(title: string, detail: string): string {
  const text = getString(detail);
  if (!text) return "";
  const plain = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (plain(text) === plain(title)) return "";
  let out = text;
  const rawTitle = getString(title);
  if (rawTitle && text.toLowerCase().startsWith(rawTitle.toLowerCase())) {
    out = text.slice(rawTitle.length);
  } else if (rawTitle && plain(text).startsWith(plain(rawTitle))) {
    const dash = text.search(/[—–-]/);
    if (dash !== -1) out = text.slice(dash + 1);
  } else {
    return text;
  }
  out = out.trim().replace(/^[—–-]\s*/, "").trim();
  if (/^planned for day \d+ of this trip\.?$/i.test(out)) return "";
  return out;
}

/** A junk plan title: a bare 2–4 character acronym with no spaces
 *  ("WIP") that carries no venue information of its own. Only
 *  flagged unverified when its detail is also empty/generic after
 *  echo-stripping — a short real name with a real description
 *  ("Zoo", "Spa") is never flagged. */
export function isUnverifiableStopTitle(title: string, strippedDetail: string): boolean {
  const text = getString(title);
  return /^[A-Z0-9]{2,4}$/.test(text) && !getString(strippedDetail);
}

export type HomeRow = {
  key: string;
  kind: HomeRowKind;
  /** Start time only, e.g. "8:00 AM" — or "Flexible" when the plan has none. */
  time: string;
  title: string;
  /** Owner-10 item 5: true for an unverifiable junk-title stop. The
   *  panel renders it as an "Unplanned stop" with the plan title kept
   *  as traceability — never as a venue, never hidden silently. */
  unverified: boolean;
  /** The stored plan title, kept when unverified so the row stays
   *  traceable to the plan; null otherwise. */
  planTitle: string | null;
  /** "2h (est.) · Historic market and local shops" — duration part first. */
  subtitle: string;
  /** Bare duration text ("2h") or null when the plan carries none. */
  durationText: string | null;
  /** True when the duration comes from the plan draft, not a booking. */
  durationEstimated: boolean;
  /** True only for a verified-booking row. */
  booked: boolean;
  /** True only for a plan-draft travel leg (the mock's Planned label). */
  planned: boolean;
  /** True when the shown time itself came from a booking record. */
  timeFromBooking: boolean;
  /** True when the shown time is a recalculation (retimed_by_event). */
  retimed: boolean;
  /** Map query for the "View day on map" / Map tab links. */
  mapQuery: string;
  /** Lowercased stored category, for the row icon only. */
  category: string;
};

export type HomeDayInput = {
  day_number: number;
  date?: string | null;
  primary_plan?: string | null;
  morning?: string | null;
  afternoon?: string | null;
  evening?: string | null;
  rows: readonly HomeTimelineRowInput[];
};

export type HomeDayView = {
  dayNumber: number;
  date: string | null;
  /** "Day 1 · Mon, Oct 26" (no year — the header carries the full range). */
  heading: string;
  pickerWeekday: string;
  pickerMonthDay: string;
  /** Day theme from the stored plan, or "" when the plan carries none.
   *  Kept verbatim for audit; the panel renders displaySummary. */
  subtitle: string;
  /** DISPLAY-ONLY derived summary (see module header): counted and
   *  timed from this day's own rows. When the day has no rows at
   *  all there is nothing to derive from, so this falls back to
   *  the stored subtitle rather than inventing a sentence. */
  displaySummary: string;
  rows: HomeRow[];
  /** Deduped map queries for the Map tab, in timeline order. */
  mapStops: string[];
};

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string, max = 110): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

/** Parse a stored "YYYY-MM-DD" as a local calendar date (never shifted
 *  by timezone: T00:00:00 local always lands on the same weekday). */
function parseLocalDate(value: string | null | undefined): Date | null {
  const text = getString(value);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** "Day 1 · Mon, Oct 26" — the mock's day-heading form. */
export function formatHomeDayHeading(
  dayNumber: number,
  date: string | null | undefined,
  locale = "en"
): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return `Day ${dayNumber}`;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(parsed);
  const monthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(parsed);
  return `Day ${dayNumber} · ${weekday}, ${monthDay}`;
}

export function homeDayPickerLabel(date: string | null | undefined, locale = "en"): {
  weekday: string;
  monthDay: string;
} {
  const parsed = parseLocalDate(date);
  if (!parsed) return { weekday: "", monthDay: "" };
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(parsed),
    monthDay: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(parsed)
  };
}

/** "Oct 26 – Oct 30, 2026 · 5 days" — the mock photo-header meta line.
 *  Day count is inclusive, computed in UTC so no timezone can shift it. */
export function formatHomeDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  locale = "en"
): string {
  const start = parseLocalDate(startDate);
  if (!start) return "Dates flexible";
  const monthDay = (date: Date) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  const year = new Intl.DateTimeFormat(locale, { year: "numeric" }).format(start);
  const end = parseLocalDate(endDate);
  if (!end || end.getTime() === start.getTime()) return `${monthDay(start)}, ${year} · 1 day`;
  const days =
    Math.round(
      (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86_400_000
    ) + 1;
  const count = days > 0 ? `${days} days` : "Dates flexible";
  return `${monthDay(start)} – ${monthDay(end)}, ${year} · ${count}`;
}

/** The builder's full-range time ("Planned · 8:00 AM–10:00 AM") reduced
 *  to the mock row's start time ("8:00 AM"). "Flexible" stays Flexible. */
export function homeRowTime(time: string): string {
  const cleaned = getString(time).replace(/^Planned · /, "");
  const start = cleaned.split(/[–-]/)[0].trim();
  return start.replace(/a\.m\./gi, "AM").replace(/p\.m\./gi, "PM") || "Flexible";
}

export function homeRowIsPlannedTime(time: string): boolean {
  return getString(time).startsWith("Planned · ");
}

/** "105 min" / "1h 45m" / "2 hours" / "45m" → minutes, else null.
 *  An unparseable stored duration is kept verbatim by the caller,
 *  never converted into a number it does not contain. */
export function parseHomeDurationToMinutes(label: string): number | null {
  const text = getString(label).toLowerCase();
  if (!text) return null;
  const hoursMinutes = text.match(/(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*(?:m(?:in(?:utes?)?)?)?)?/);
  if (hoursMinutes) {
    const hours = Number(hoursMinutes[1]);
    const minutes = hoursMinutes[2] ? Number(hoursMinutes[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes)) return hours * 60 + minutes;
  }
  const minutesOnly = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/);
  if (minutesOnly) return Number(minutesOnly[1]);
  return null;
}

/** 45 → "45m", 120 → "2h", 105 → "1h 45m" — the mock's duration forms. */
export function formatHomeMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  if (total % 60 === 0) return `${total / 60}h`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

function durationTextForRow(item: HomeTimelineRowInput): string | null {
  // A travel leg's span lives in travelLabel ("105 min travel") when
  // the builder kept no durationLabel for it; a venue row uses its own.
  const raw = getString(item.durationLabel) || getString(item.travelLabel);
  if (!raw) return null;
  const minutes = parseHomeDurationToMinutes(raw);
  return minutes != null ? formatHomeMinutes(minutes) : raw;
}

export function classifyHomeRow(
  item: HomeTimelineRowInput,
  index: number,
  total: number
): HomeRowKind {
  const title = getString(item.title);
  const lowerTitle = title.toLowerCase();
  const type = `${getString(item.itemType)} ${getString(item.category)}`.toLowerCase();
  const timeLabel = getString(item.time);
  const isLast = index === total - 1 && total > 1;
  // Return-to-stay is the LAST row only: a "Return to …" row, or a
  // closing stay row — including the stored shape where the return
  // is a hotel row whose DESCRIPTION says "Return to … for the
  // night" while its title is just the hotel name. A mid-day
  // "Check in, store bags" arrival row must never be misread as
  // the return.
  if (isLast) {
    if (/^(return to|back to|return\b)/.test(lowerTitle)) return "return-to-stay";
    if (/return to/i.test(`${title} ${getString(item.description)}`)) return "return-to-stay";
    if (/\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type) &&
      /\b(check-?in|rest|overnight|settle)\b/.test(lowerTitle)) return "return-to-stay";
  }
  // Arrival: a row titled as an arrival, or a hotel row whose stored
  // time label is the arrival marker ("Check-in", "Arrival") — the
  // plan's own arrival event, not a venue.
  if (/^(arrive in|arrive\b|arrival\b)/.test(lowerTitle)) return "arrival";
  if (/^(check-?in|arrival|arrive)\b/i.test(timeLabel) && /\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type)) return "arrival";
  if (
    /\b(flight|travel|transfer|drive|driving|train|bus|ferry|taxi|shuttle)\b/.test(type) ||
    /^(travel|drive|transfer|depart|leave)\b/.test(lowerTitle) ||
    /\bto\s+\S+\s+from\s+\S+/.test(lowerTitle)
  ) return "travel";
  return "venue";
}

export function toHomeRow(
  item: HomeTimelineRowInput,
  index: number,
  total: number
): HomeRow {
  const kind = classifyHomeRow(item, index, total);
  const booked = item.authority === "confirmed";
  // A travel leg is a plan-draft leg unless a booking pins it: the
  // builder only prefixes "Planned · " on clock-carrying legs, so
  // clock-less legs (the opening "Arrival" leg) need the same pill
  // from authority, not from the prefix.
  const planned = kind === "travel" && !item.timeFromBooking && !booked;
  const durationText = durationTextForRow(item);
  const durationEstimated = durationText != null && !booked;
  const durationPart = durationText
    ? durationEstimated ? `${durationText} (est.)` : durationText
    : "";
  const rawDetail = getString(item.description) || getString(item.location);
  // DISPLAY-ONLY shortening (2026-10-28): same rule as the day
  // cards (the detail usually already arrives shortened from
  // buildDisplayTimelineItems; this is idempotent defence for
  // any other caller). Stored text is never touched.
  const detail = displayActivityDescription(
    getString(item.title),
    stripTitleEcho(getString(item.title), rawDetail)
  );
  const unverified = kind === "venue" && isUnverifiableStopTitle(getString(item.title), detail);
  // Mock order: travel rows read "Flight · 1h 45m (est.)" (detail first);
  // venue rows read "2h · Historic market…" (duration first).
  const parts =
    kind === "travel"
      ? [detail ? compact(detail) : "", durationPart]
      : [durationPart, detail ? compact(detail) : ""];
  const subtitle = parts.filter(Boolean).join(" · ");
  return {
    key: `${index}-${homeRowTime(item.time)}-${getString(item.title)}`,
    kind,
    time: homeRowTime(item.time),
    // DISPLAY-ONLY rest wording (2026-10-28): the shown title is
    // shortened; kind/time/category (what the count derivation
    // keys on) and the key (raw title) are untouched.
    title: displayRestTitle(getString(item.title)) || getString(item.category) || "Stop",
    unverified,
    planTitle: unverified ? getString(item.title) : null,
    subtitle,
    durationText,
    durationEstimated,
    booked,
    planned,
    timeFromBooking: item.timeFromBooking === true,
    retimed: item.timeRetimed === true,
    mapQuery: getString(item.mapQuery) || getString(item.location) || getString(item.title),
    category: getString(item.category).toLowerCase()
  };
}

/** Owner-10 item 4 — chronological safety sort for home rows.
 *  Timed rows sort by start minutes; untimed rows keep their stored
 *  position (they inherit the previous timed row's key, or -1 when
 *  they lead the day — the travel leg and check-in that open a day
 *  carry date labels, not clocks, and must stay first). Stable, so
 *  an already-chronological stored plan is returned unchanged. */
export function sortHomeRowsChronologically(rows: HomeRow[]): HomeRow[] {
  const startMinutes = (time: string): number | null => {
    const match = homeRowTime(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
    return hour * 60 + minute;
  };
  let lastTimed = -1;
  const keyed = rows.map((row, index) => {
    const minutes = startMinutes(row.time);
    if (minutes != null) lastTimed = minutes;
    return { row, key: minutes != null ? minutes : lastTimed, index };
  });
  return keyed
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.row);
}

export function buildHomeDayView(day: HomeDayInput, locale = "en"): HomeDayView {
  const rows = sortHomeRowsChronologically(
    day.rows.map((item, index) => toHomeRow(item, index, day.rows.length))
  );
  const subtitle = compact(
    getString(day.primary_plan) ||
      getString(day.morning) ||
      getString(day.afternoon) ||
      getString(day.evening),
    110
  );
  // DISPLAY-ONLY correction: derive from the day's own rendered rows
  // (never from the stored sentence, never written back anywhere).
  // HomeRow already carries kind/time/title/unverified/planTitle,
  // i.e. exactly the derivation's input shape.
  const derived = deriveDaySummary(rows);
  const displaySummary = derived || subtitle;
  const picker = homeDayPickerLabel(day.date, locale);
  const seen = new Set<string>();
  const mapStops: string[] = [];
  for (const row of rows) {
    const query = row.mapQuery.trim();
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    mapStops.push(query);
    if (mapStops.length >= 8) break;
  }
  return {
    dayNumber: day.day_number,
    date: getString(day.date) || null,
    heading: formatHomeDayHeading(day.day_number, day.date, locale),
    pickerWeekday: picker.weekday,
    pickerMonthDay: picker.monthDay,
    subtitle,
    displaySummary,
    rows,
    mapStops
  };
}

/** Requested day when it exists in THIS trip's days, else the first day
 *  (Day 1 — the mock's default). Never a day from another trip: the
 *  caller passes only this trip's days, and selection never reaches
 *  outside that array. */
export function selectHomeDay(
  days: readonly HomeDayView[],
  requestedDayNumber: number | null | undefined
): HomeDayView | null {
  if (!days.length) return null;
  if (typeof requestedDayNumber === "number") {
    const found = days.find((day) => day.dayNumber === requestedDayNumber);
    if (found) return found;
  }
  return days[0];
}
