/**
 * Day-timeline rows for the Round 2 Live panel (composite structure,
 * real stored data — never the composite's sample times).
 *
 * Source: the trip's stored live_timeline seeds (the same data the trip
 * page renders). This module only reshapes + labels them:
 * - Transport legs are deduplicated and categorized as travel: a
 *   "Walk to X" row that merely approaches the next stop X is dropped
 *   (the stop itself is the entry; Directions covers the routing), and
 *   every remaining travel/transfer row renders as its own leg row —
 *   never merged into a neighboring leg (merging would invent a
 *   combined movement the plan does not state) and never as a venue.
 *   An arrival marker stays its own row when stored.
 * - Durations come ONLY from real fields, in this order — travel legs:
 *   travelTimeMinutes, then durationMinutes; stops: durationMinutes,
 *   then the startTime→endTime span when BOTH are real. A duration
 *   string ("2h", "45m") parses as a last resort. No duration data
 *   means NO duration is shown — never a default (the old 90-minute
 *   fallback in activityEndDate is deliberately NOT used here).
 * - Every shown duration is labeled: FACTUAL timing renders bare
 *   ("2h"); anything else renders with "(est.)" ("1h 45m (est.)").
 *   Only timing_status === "FACTUAL" counts as verified — missing or
 *   PLANNED/UNKNOWN fails closed to estimated.
 * - Times are the stored time_label (or startTime clock) verbatim —
 *   the composite's 8:00 / 1:00 / 3:30 sample times can never appear
 *   unless the stored plan itself carries them.
 */

// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { formatDurationHM } from "./tripClock.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { displayRestTitle } from "./activityDescription.ts";

export type DayTimelineItemInput = {
  time_label?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  description?: string | null;
  location_name?: string | null;
  category?: string | null;
  item_type?: string | null;
  travel_mode?: string | null;
  transportMode?: string | null;
  durationMinutes?: number | null;
  travelTimeMinutes?: number | null;
  duration?: string | null;
  origin?: string | null;
  destination?: string | null;
  timing_status?: string | null;
};

export type DayTimelineRow = {
  kind: "travel" | "stop";
  time: string | null;
  /** Stored category (stop) or mode (travel leg); drives the Picture 4 row icon. */
  category: string | null;
  title: string;
  /** Duration + mode/category/description line; "" when nothing honest exists. */
  detail: string;
  /** e.g. "1h 45m (est.)", "2h", or null when no duration data exists. */
  durationLabel: string | null;
  /** True when the row's times are schedule-derived (not FACTUAL). */
  planned: boolean;
  mode: string | null;
  /** Owner-10 item 5: true for an unverifiable junk-title stop
   *  (bare acronym title + no real description). The client renders
   *  it as an "Unplanned stop" with planTitle kept for traceability. */
  unverified: boolean;
  /** The stored plan title when unverified; null otherwise. */
  planTitle: string | null;
};

/**
 * Owner-10 item 5 — the same title-echo rule as
 * itineraryHome.stripTitleEcho, duplicated here because this module
 * is loaded directly by deterministic Node checks (no cross-module
 * import): a detail that IS the title, or that starts with the title
 * + a dash, loses the title prefix, and a remainder that is only the
 * generic "planned for day N" phrase is dropped entirely.
 */
export function stripTimelineTitleEcho(title: string, detail: string | null | undefined): string {
  const text = (detail || "").trim();
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
  const rawTitle = (title || "").trim();
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

export function isUnverifiableTimelineTitle(title: string, strippedDetail: string): boolean {
  return /^[A-Z0-9]{2,4}$/.test((title || "").trim()) && !strippedDetail.trim();
}

function finiteNumber(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : null;
}

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text ? text : null;
}

/** Coerce one stored seed (unknown shape) into timeline input. Used by the Live page. */
export function coerceDayTimelineItem(value: unknown): DayTimelineItemInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    time_label: cleanText(row.time_label),
    startTime: cleanText(row.startTime),
    endTime: cleanText(row.endTime),
    title: cleanText(row.title),
    description: cleanText(row.description),
    location_name: cleanText(row.location_name),
    category: cleanText(row.category),
    item_type: cleanText(row.item_type),
    travel_mode: cleanText(row.travel_mode),
    transportMode: cleanText(row.transportMode),
    durationMinutes: finiteNumber(row.durationMinutes),
    travelTimeMinutes: finiteNumber(row.travelTimeMinutes),
    duration: cleanText(row.duration),
    origin: cleanText(row.origin),
    destination: cleanText(row.destination),
    timing_status: cleanText(row.timing_status)
  };
}

function to12Hour(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function clockFromStartTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const hm = value.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return to12Hour(Number(hm[1]), Number(hm[2]));
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return to12Hour(parsed.getUTCHours(), parsed.getUTCMinutes());
  }
  return null;
}

function parseDurationString(value: string | null | undefined): number | null {
  if (!value) return null;
  const hm = value.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$/i);
  if (hm) return Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  const m = value.match(/^(\d+)\s*m$/i);
  if (m) return Number(m[1]);
  return null;
}

function minutesOfClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const hm = value.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.getUTCHours() * 60 + parsed.getUTCMinutes()
    : null;
}

function spanMinutes(item: DayTimelineItemInput): number | null {
  const start = minutesOfClock(item.startTime);
  const end = minutesOfClock(item.endTime);
  if (start == null || end == null || end <= start) return null;
  return end - start;
}

function durationFor(item: DayTimelineItemInput, isTravel: boolean): number | null {
  if (isTravel) {
    return item.travelTimeMinutes ?? item.durationMinutes ?? parseDurationString(item.duration) ?? spanMinutes(item);
  }
  return item.durationMinutes ?? parseDurationString(item.duration) ?? spanMinutes(item);
}

function isVerified(item: DayTimelineItemInput): boolean {
  return (item.timing_status || "").toUpperCase() === "FACTUAL";
}

function durationLabelFor(item: DayTimelineItemInput, isTravel: boolean): string | null {
  const minutes = durationFor(item, isTravel);
  const formatted = formatDurationHM(minutes);
  if (!formatted) return null;
  return isVerified(item) ? formatted : `${formatted} (est.)`;
}

const TRAVEL_TITLE_VERB = /^(walk|transfer|transit|getting|travel|drive|take|go|ride|fly)\b/i;
const TRAVEL_CATEGORY = /travel|transport|transit|flight/i;

export function isTravelTimelineItem(item: DayTimelineItemInput): boolean {
  const type = (item.item_type || "").toLowerCase();
  if (type === "travel" || type === "transfer") return true;
  if (type) return false;
  if (TRAVEL_CATEGORY.test(item.category || "")) return true;
  return TRAVEL_TITLE_VERB.test(item.title || "");
}

function normalize(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** "Walk to Musée" → "musée"; "Travel from Saint John to Montreal" stays long (never equals a stop). */
function travelTargetOf(title: string): string {
  let target = normalize(title);
  target = target.replace(/^(walk|transfer|transit|getting|travel|drive|take(?: a)?|go|ride|fly)\s+(to\s+|from\s+)?/, "");
  target = target.replace(/^(to\s+|from\s+)/, "");
  return target.trim();
}

function approachesNextStop(travel: DayTimelineItemInput, next: DayTimelineItemInput): boolean {
  const target = travelTargetOf(travel.title || "");
  if (!target || target.length < 4) return false;
  for (const candidate of [normalize(next.title), normalize(next.location_name)]) {
    if (!candidate) continue;
    if (candidate === target || candidate.startsWith(target) || target.startsWith(candidate)) return true;
  }
  return false;
}

function capitalizeMode(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncateDetail(value: string | null | undefined, maxLength = 80): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Build the Day timeline rows. `originLabel` / `destinationLabel` are
 * the trip's own origin/destination (used only to title a leading leg
 * whose stored items carry no origin/destination of their own).
 */
export function buildDayTimelineRows(
  items: DayTimelineItemInput[],
  originLabel: string | null,
  destinationLabel: string | null
): DayTimelineRow[] {
  const usable = items.filter((item) => {
    const title = cleanText(item.title);
    if (!title) return false;
    // A bare destination label is not a stop.
    if (destinationLabel && normalize(title) === normalize(destinationLabel)) return false;
    return true;
  });
  const rows: DayTimelineRow[] = [];
  let index = 0;
  while (index < usable.length) {
    const item = usable[index];
    if (!isTravelTimelineItem(item)) {
      const durationLabel = durationLabelFor(item, false);
      const stopTitle = cleanText(item.title) || "";
      const strippedDetail = stripTimelineTitleEcho(stopTitle, item.description);
      const detailParts = [
        durationLabel,
        strippedDetail ? truncateDetail(strippedDetail) : cleanText(item.category)
      ].filter(Boolean);
      const unverified = isUnverifiableTimelineTitle(stopTitle, strippedDetail);
      rows.push({
        kind: "stop",
        time: cleanText(item.time_label) || clockFromStartTime(item.startTime),
        category: cleanText(item.category),
        // DISPLAY-ONLY rest wording (2026-10-28): shown title
        // shortened; unverified/planTitle below still use the raw
        // stopTitle, and time/category are untouched.
        title: displayRestTitle(stopTitle),
        detail: detailParts.join(" · "),
        durationLabel,
        planned: !isVerified(item),
        mode: null,
        unverified,
        planTitle: unverified ? stopTitle : null
      });
      index += 1;
      continue;
    }
    // Travel item: dropped when it merely approaches the next stop.
    // Otherwise it is its own leg row — adjacent travel items are NOT
    // merged (a flight leg followed by a walk is two movements, and
    // summing them would invent a leg the plan does not state).
    const next = usable[index + 1];
    if (next && !isTravelTimelineItem(next) && approachesNextStop(item, next)) {
      index += 1;
      continue;
    }
    const legDurationLabel = durationLabelFor(item, true);
    const legOrigin = cleanText(item.origin) || cleanText(originLabel);
    const legDestination = cleanText(item.destination) || cleanText(destinationLabel);
    const title =
      legOrigin && legDestination
        ? `Travel from ${legOrigin} to ${legDestination}`
        : cleanText(item.title) || "Travel";
    const mode = capitalizeMode(item.transportMode || item.travel_mode || (TRAVEL_CATEGORY.test(item.category || "") ? item.category : null));
    const detailParts = [mode, legDurationLabel].filter(Boolean);
    rows.push({
      kind: "travel",
      time: cleanText(item.time_label) || clockFromStartTime(item.startTime),
      category: cleanText(item.category),
      title,
      detail: detailParts.join(" · "),
      durationLabel: legDurationLabel,
      planned: !isVerified(item),
      mode,
      unverified: false,
      planTitle: null
    });
    index += 1;
  }
  return rows;
}
