// lib/roamly/daySummary.ts — DISPLAY-ONLY day-summary derivation
// (final local round, 2026-10-27; consistency repairs, 2026-10-28).
//
// The stored day summary (a trip day's `primary_plan` / morning /
// afternoon / evening text) is NEVER overwritten, regenerated, or
// modified by anything in this file: this module takes the day's
// already-rendered timeline items as its ONLY input and returns a
// short factual sentence about them, for the render layer to show
// instead of the stored text. Callers keep the stored text intact
// (it stays on the day view object as `subtitle`) and render
// `displaySummary` — so an already-saved trip's stored sentence is
// preserved for audit while the user sees a summary that matches
// the itinerary on screen, item for item.
//
// ONE STOP-COUNT RULE (2026-10-28, binding on every surface):
// the stop count is computed from the day's FULL itinerary —
// every row that is not a travel leg, an arrival leg, a return
// to the stay, or a rest block counts as one stop — and a
// collapsed/capped list NEVER changes the total. The home panel
// already derives from the full day; the day card MUST derive
// from its full day too (its rendered timeline keeps its 6-row
// cap, but the summary is derived from the uncapped list — see
// DayTimelineCard). Two surfaces over the same day therefore
// always print the same count. Live Montreal Day 1 proves it:
// Musée, Galerie Blanche, Resto Végo, the WIP/unplanned stop,
// Théâtre Jean-Duceppe, and Le Centre d'art = 6 stops; the
// arrival leg, the hotel check-in, the rest block, and the
// return-to-base are NOT stops. Because the counted set includes
// the unplanned row, the sentence says "six stops" — never "six
// planned stops": the unplanned row must not be mislabelled as
// planned. (Row-level time pills are a different thing: a row's
// own "Planned" pill labels that row's stored plan time, never
// the summary's count.)
//
// Derivation rules (nothing is invented; anything absent is omitted):
// - Arrival information comes only from an actual arrival/travel
//   row; the destination name comes only from such a row's title
//   ("Travel from X to Y" -> Y; "Arrive in Y" -> Y). No travel
//   row, no destination clause.
// - The hotel clause ("settle into your hotel") appears ONLY when
//   the day actually has a hotel/stay row (check-in, return, or
//   any hotel row); a day with no stay row carries no such clause.
// - Times come only from actual item times: the START clock of a
//   row's time ("8:00 AM" from "8:00 AM–9:45 AM", "Planned · "
//   stripped, "1:00 p.m." normalised to "1:00 PM"). A row with no
//   clock ("Flexible", "Check-in", a date label) contributes no
//   time and is never given one. First-activity time = the first
//   timed STOP's clock; wrap-up time = the return row's clock
//   ONLY (a last stop's start clock is not a wrap-up — without a
//   return row there is simply no wrap-up clause). A clause whose
//   source is absent is omitted, never filled with a guess.
// - Rest blocks are NEVER in the headline sentence (they were
//   part of the log-like feel) and are never folded into a stop
//   count. A day of only rest blocks (+ return) gets a rest-day
//   sentence instead.
// - Edge shapes, honestly:
//   - no rows at all -> "" (the caller falls back to its existing
//     empty-day copy; there is nothing to derive from);
//   - stops but no clocked row -> count + names, "no fixed times";
//   - travel + arrival and no stops -> a short arrival sentence;
//   - unverified stops (rendered on screen as "Unplanned stop")
//     count as stops but are never named: the sentence carries
//     counts and times with no stop name at all.
// - The result is capped at 160 characters, cut at a word
//   boundary where possible. Typical derived sentences are far
//   shorter; the cap only guards pathological days.
// - Pure function: it reads its input and returns a string. It
//   performs no I/O, no mutation, and no write of any kind — so
//   calling it cannot change the itinerary, its ordering, its
//   bookings, or its budget fields. Tests assert input identity
//   (deep-equal before/after) for exactly this reason.

export type DaySummaryItemInput = {
  /** Displayed row time ("8:00 AM", "Planned · 8:00 AM–9:45 AM",
   *  "Flexible", "Check-in", …). Only a clock start is used. */
  time: string;
  /** Displayed row title. */
  title: string;
  /** Home-row kind when the caller has one ("travel" | "arrival" |
   *  "venue" | "return-to-stay"). Wins over inference. */
  kind?: string;
  /** Raw item type when the caller has one ("travel" | "transfer" |
   *  "rest" | "hotel" | "activity" | …). */
  itemType?: string;
  /** Raw category when the caller has one. */
  category?: string;
  /** Stored description (used only for the return-to-stay
   *  description check on a last hotel row). */
  description?: string;
  /** True for a row the screen renders as "Unplanned stop". */
  unverified?: boolean;
  /** The stored plan title of an unverified row (never used as a
   *  venue name in the derived sentence). */
  planTitle?: string | null;
};

type Classified =
  | "travel"
  | "arrival"
  | "return"
  | "rest"
  | "stop";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Start clock of a displayed time, normalised to "8:00 AM" form,
 *  or null when the row carries no clock. Accepts 12-hour times
 *  ("8:00 AM", "1:00 p.m.") AND 24-hour times ("09:30", "14:00"):
 *  the itinerary timeline stores 24-hour times, and treating them
 *  as clock-less made every seeded day print "with no fixed times
 *  set" directly above its own listed times (audit D2, 2026-10-28).
 *  A bare "H:MM" is read as a 24-hour clock, matching
 *  parseClockMinutes in ItineraryDayPlan. */
export function daySummaryStartClock(time: string): string | null {
  const cleaned = text(time)
    .replace(/^Planned\s*·\s*/i, "")
    .replace(/a\.m\./gi, "AM")
    .replace(/p\.m\./gi, "PM");
  const start = cleaned.split(/[–—-]/)[0].trim();
  const twelve = start.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = twelve[2] ? Number(twelve[2]) : 0;
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    return `${hour}:${String(minute).padStart(2, "0")} ${twelve[3].toUpperCase()}`;
  }
  const military = start.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour24 = Number(military[1]);
    const minute = Number(military[2]);
    if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
  }
  return null;
}

function classify(
  item: DaySummaryItemInput,
  index: number,
  total: number
): Classified {
  const kind = text(item.kind).toLowerCase();
  if (kind === "travel") return "travel";
  if (kind === "arrival") return "arrival";
  if (kind === "return-to-stay" || kind === "return") return "return";
  if (kind === "rest") return "rest";
  const type = `${text(item.itemType)} ${text(item.category)}`.toLowerCase();
  const title = text(item.title);
  const lowerTitle = title.toLowerCase();
  const isLast = index === total - 1 && total > 1;
  if (isLast) {
    if (/^(return to|back to|return\b)/.test(lowerTitle)) return "return";
    if (/return to/i.test(`${title} ${text(item.description)}`)) return "return";
    if (
      /\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type) &&
      /\b(check-?in|rest|overnight|settle)\b/.test(lowerTitle)
    )
      return "return";
  }
  if (/^(arrive in|arrive\b|arrival\b)/.test(lowerTitle)) return "arrival";
  // A hotel row whose TIME label is the arrival marker ("Check-in")
  // is the plan's arrival event, not a venue stop — mirrors
  // classifyHomeRow's arrival rule for callers without a kind.
  if (/^(check-?in|arrival|arrive)\b/i.test(text(item.time)) && /\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type)) return "arrival";
  // A hotel return row is a return WHEREVER it sits in the list,
  // not only when it happens to be last: the day card's
  // clock-sorted full list puts clock-less rows (travel,
  // check-in) after it, so a last-only rule misreads it as a
  // 7th stop (live Montreal Day 1, 2026-10-28). The "Return to X
  // for the night" description (or the "Return to your stay"
  // title) is the return's own signature, independent of order.
  if (/\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type) &&
    /return to/i.test(`${title} ${text(item.description)}`)) return "return";
  if (/^return to your stay$/i.test(title)) return "return";
  if (/\b(rest)\b/.test(type)) return "rest";
  if (/^(rest|break|free time|downtime)\b/i.test(title)) return "rest";
  if (
    /\b(flight|travel|transfer|drive|driving|train|bus|ferry|taxi|shuttle)\b/.test(type) ||
    /^(travel|drive|transfer|depart|leave)\b/.test(lowerTitle)
  )
    return "travel";
  return "stop";
}

function compact160(value: string): string {
  const clean = value.trim();
  if (clean.length <= 160) return clean;
  const cut = clean.slice(0, 157);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

type ClassifiedRow = {
  item: DaySummaryItemInput;
  kind: Classified;
  clock: string | null;
  title: string;
};

function classifyRows(items: readonly DaySummaryItemInput[]): ClassifiedRow[] {
  return items.map((item, index) => ({
    item,
    kind: classify(item, index, items.length),
    clock: daySummaryStartClock(item.time),
    title: text(item.title)
  }));
}

/** THE ONE STOP-COUNT RULE, as a function: count the day's FULL
 *  itinerary rows (callers must pass the uncapped list — a capped
 *  list passed here still counts only what it was given, so the
 *  rule lives or dies at the call site; both render surfaces are
 *  suite-pinned to pass the full day). Travel legs, arrival legs,
 *  returns to the stay, and rest blocks are never stops. */
export function countDayStops(items: readonly DaySummaryItemInput[]): number {
  return classifyRows(items).filter((row) => row.kind === "stop").length;
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve"
];

function countWord(count: number): string {
  return count >= 0 && count < NUMBER_WORDS.length ? NUMBER_WORDS[count] : String(count);
}

/** Destination name from a travel/arrival row's title only:
 *  "Travel from Saint John to Montreal" -> "Montreal";
 *  "Arrive in Montreal" / "Arrival in Montreal" -> "Montreal".
 *  Anything else -> null (no destination is ever guessed). */
function destinationFromRows(rows: ClassifiedRow[]): string | null {
  for (const row of rows) {
    if (row.kind !== "travel" && row.kind !== "arrival") continue;
    const toMatch = row.title.match(/^travel from .+? to (.+)$/i);
    if (toMatch) return toMatch[1].trim();
    const inMatch = row.title.match(/^(?:arrive|arrival) in (.+)$/i);
    if (inMatch) return inMatch[1].trim();
  }
  return null;
}

/** True when the day has a hotel/stay row (a hotel-typed row, or
 *  the return-to-stay row, which by definition returns to a stay)
 *  — the ONLY basis for the "settle into your hotel" clause. An
 *  arrival row alone does NOT imply a hotel: a day with travel +
 *  stops but no stay row carries no settle clause. */
function hasHotelStay(rows: ClassifiedRow[]): boolean {
  return rows.some((row) => {
    const type = `${text(row.item.itemType)} ${text(row.item.category)}`.toLowerCase();
    if (/\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type)) return true;
    return row.kind === "return";
  });
}

/** Derive the display summary for one day from its FULL rows.
 *  Returns "" when the day has no rows (nothing to derive).
 *  Natural shape (2026-10-28): "Arrive in Montreal, settle into
 *  your hotel, and explore six stops. Your first activity begins
 *  at 9:37 AM, with your day wrapping up around 5:17 PM." — no
 *  rest-block time in the headline, no "planned stops" label, and
 *  every clause backed by a row (or omitted). */
export function deriveDaySummary(
  items: readonly DaySummaryItemInput[]
): string {
  const rows = classifyRows(items);
  if (!rows.length) return "";

  const travel = rows.find((row) => row.kind === "travel");
  const arrival = rows.find((row) => row.kind === "arrival");
  const returns = rows.filter((row) => row.kind === "return");
  const back = returns.length ? returns[returns.length - 1] : null;
  const rests = rows.filter((row) => row.kind === "rest");
  const stops = rows.filter((row) => row.kind === "stop");
  const verifiedStops = stops.filter((row) => !row.item.unverified && row.title);
  const timedStops = stops.filter((row) => row.clock);
  const destination = destinationFromRows(rows);
  const hotel = hasHotelStay(rows);
  const stopWord = stops.length === 1 ? "stop" : "stops";

  // Rest day: no stops at all, only rest blocks (+ travel/return).
  if (!stops.length && rests.length) {
    const wrap = back?.clock;
    return compact160(
      wrap ? `A rest day, wrapping up around ${wrap}.` : "A rest day."
    );
  }

  // Arrival-only day: travel/arrival/return, no stops, no rest.
  if (!stops.length) {
    if (!travel && !arrival && !back) return "";
    let lead = destination ? `Arrive in ${destination}` : "Arrival";
    if (hotel) lead += " and settle into your hotel";
    return compact160(`${lead}.`);
  }

  // Lead clause: destination + hotel + count, each only if sourced.
  let lead: string;
  const explore = `explore ${countWord(stops.length)} ${stopWord}`;
  if (destination && hotel) {
    lead = `Arrive in ${destination}, settle into your hotel, and ${explore}`;
  } else if (destination) {
    lead = `Arrive in ${destination} and ${explore}`;
  } else if (hotel) {
    lead = `Settle into your hotel and ${explore}`;
  } else {
    lead = `Explore ${countWord(stops.length)} ${stopWord}`;
    lead = lead.charAt(0).toUpperCase() + lead.slice(1);
  }

  // No timed stops at all: count + verified names, no invented times.
  if (!timedStops.length) {
    const names = verifiedStops.map((row) => row.title);
    const namePart =
      names.length === 0
        ? ""
        : names.length <= 3
          ? ` — ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]}`
          : `, starting with ${names[0]}`;
    return compact160(`${lead}${namePart}, with no fixed times set.`);
  }

  // Normal day: first-activity clock + wrap-up clock, each if sourced.
  const firstClock = timedStops[0].clock as string;
  const wrapClock = back?.clock || null;
  const secondParts: string[] = [];
  secondParts.push(`Your first activity begins at ${firstClock}`);
  const second = wrapClock
    ? `${secondParts.join("")}, with your day wrapping up around ${wrapClock}.`
    : `${secondParts.join("")}.`;
  return compact160(`${lead}. ${second}`);
}

/** Rest + wrap-up clocks for one day's FULL rows (audit D2, 2026-10-28:
 *  the day card showed neither a rest time nor a day-end time even
 *  when the day's own rows carried them). Returns nulls when the data
 *  has no rest/return row — the caller then renders no line at all,
 *  which is the honest absence, never an invented time. */
export function dayRestAndWrap(items: readonly DaySummaryItemInput[]): {
  restClock: string | null;
  wrapClock: string | null;
} {
  const rows = classifyRows(items);
  const rests = rows.filter((row) => row.kind === "rest");
  const returns = rows.filter((row) => row.kind === "return");
  return {
    restClock: rests.length ? rests[0].clock : null,
    wrapClock: returns.length ? returns[returns.length - 1].clock : null
  };
}

/** What is actually unconfirmed about a day (audit D4, 2026-10-28:
 *  the day card printed the content-free "Some details still need
 *  confirmation." without naming anything). Sources, in order: the
 *  day's own uncertainty notes, the timeline rows' status texts
 *  ("Route details to confirm", "Price not available",
 *  "Details to confirm"), an unconfident day-heading join, and an
 *  uncertain plan status. Empty when nothing specific is unconfirmed
 *  — the caller then renders no line, instead of a vague warning. */
export function dayUncertaintyNotes(input: {
  headingKind?: string | null;
  planStatus?: string | null;
  uncertainty?: readonly unknown[] | null;
  statusTexts?: readonly unknown[] | null;
}): string[] {
  const seen = new Set<string>();
  const notes: string[] = [];
  const push = (value: unknown) => {
    const clean = typeof value === "string" ? value.trim() : "";
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    notes.push(clean);
  };
  for (const item of input.uncertainty || []) push(item);
  for (const item of input.statusTexts || []) push(item);
  if (text(input.headingKind).toLowerCase() === "uncertain") push("Day headings need confirmation");
  if (text(input.planStatus).toLowerCase() === "uncertain") push("Day plan needs confirmation");
  return notes;
}

/** A stop row is generic when its title is a bare placeholder word —
 *  "Place", "Stop", "Free time" — and carries no real venue name.
 *  Bare words only: a real venue whose name STARTS with a generic
 *  word ("Place Jacques-Cartier") is kept. Correction phase (D2,
 *  2026-10-28): the old prefix rule dropped the real venue Place
 *  Jacques-Cartier from Montreal Day 1, so the card showed 3 stops
 *  where the data has 4. Moved here from ItineraryDayPlan so the
 *  rule is unit-testable; the component imports it. */
export function isGenericStopText(value: string): boolean {
  const clean = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    clean === "stop" || clean === "place" || clean === "location" ||
    clean === "activity" || clean === "visit" || clean === "explore" ||
    clean === "sightseeing" || clean === "free time" || clean === "leisure"
  ) return true;
  if (/^(a )?(place|stop) to (visit|see)$/.test(clean)) return true;
  return false;
}
