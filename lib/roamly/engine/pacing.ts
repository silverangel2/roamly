import { fmt, haversineKm, parseHoursForDay, travelMin, weekdayOf } from "@/lib/roamly/engine/util";
import type { EngineCandidate, EngineDay, EnginePack, EnginePos } from "@/lib/roamly/engine/util";
import { DURATIONS } from "@/lib/roamly/engine/solver";
import type { RestSpec } from "@/lib/roamly/engine/solver";
import type { LocalDate, PlanMinutes } from "@/lib/roamly/engine/time";

/*
 * pacing — the "day counter" stage (Phase 2 port of the shadow
 * zero-engine's pacing.mjs; owner, 2026-10-21).
 *
 * Runs BEFORE the solver and emits a DAY-TYPE CALENDAR the solver
 * must obey. The owner's traveler-mind problem: on a long stay,
 * programming activities every single day is wrong — it tires the
 * traveler out and reads as a tour bus, not a trip. This stage
 * decides the SHAPE of each day; the solver only fills the shapes it
 * is given.
 *
 * Day types:
 *   FULL  — a normal slate (the only shape a short trip knows).
 *   LIGHT — 1–2 anchor stops, a late start, home early.
 *   REST  — nothing scheduled; at most one soft suggestion line.
 *   OPEN  — no fixed stops; 2–3 optional ideas listed, unscheduled.
 *   MOVE  — travel between bases; at most one light stop near arrival.
 *
 * Rules of thumb (deterministic; this module is the only place they
 * live):
 *   - Trips of <= 5 days in a base: unchanged — all FULL (the owner's
 *     restSpec still applies inside the solver, exactly as before
 *     pacing existed). Pacing never touches a short trip.
 *   - 6–10 days in a base: at least 1 REST or OPEN per 5 days. If the
 *     owner asked for rest in the request, the first such slot is a
 *     full REST day (on a longer trip the asked-for rest grows into
 *     a whole slow day); otherwise the slots are OPEN days.
 *   - > 10 days in a base: a weekly rhythm, roughly 3 FULL / 2 LIGHT /
 *     1 OPEN / 1 REST per 7 days, repeating: F F L F L O R.
 *   - Multi-city: one MOVE day between bases. The first day in a new
 *     base is at most LIGHT (arrival recovery). No base shorter than
 *     2 nights is ever created by this stage; a shorter base handed
 *     in by the traveler is kept as given and flagged in the notes,
 *     never silently reshaped.
 *   - Long single-city stays (> 10 days in one base): the solver's
 *     used-up ledger RELAXES for beloved repeatables (see solver.ts
 *     RELAX_KINDS) — this module only raises the flag; the solver
 *     owns the rule.
 */

export const DAY_TYPES: readonly string[] = ["FULL", "LIGHT", "REST", "OPEN", "MOVE"];
const WEEK_RHYTHM: readonly string[] = ["FULL", "FULL", "LIGHT", "FULL", "LIGHT", "OPEN", "REST"];

function typeSegment(len: number, opts: { restSpec?: RestSpec | null } = {}): string[] {
  const { restSpec = null } = opts;
  if (len <= 5) return new Array<string>(len).fill("FULL");
  if (len <= 10) {
    const types = new Array<string>(len).fill("FULL");
    const slots = Math.floor(len / 5); // at least 1 REST-or-OPEN per 5 days
    for (let j = 0; j < slots; j++) {
      // spread the light-touch days through the segment, never on day 1
      let pos = Math.floor(((j + 1) * len) / (slots + 1));
      if (pos < 1) pos = 1;
      while (pos < len && types[pos] !== "FULL") pos++;
      if (pos >= len) break;
      types[pos] = restSpec && j === 0 ? "REST" : "OPEN";
    }
    return types;
  }
  return Array.from({ length: len }, (_, i) => WEEK_RHYTHM[i % 7]);
}

export interface CalendarBase {
  name: string;
  days: number;
}

export interface CalendarDay {
  day: number;
  type: string;
  base: string;
  baseIndex: number;
  fromBase?: string;
  toBase?: string;
}

export interface TripCalendar {
  days: CalendarDay[];
  notes: string[];
  relaxFavorites: boolean;
  counts: Record<string, number>;
}

/**
 * Build the day-type calendar for a whole trip.
 * bases: [{ name, days }] — `days` counts the days BASED there,
 * excluding the MOVE day between bases (the move day is the hinge,
 * owned by neither). totalDays must equal sum(bases.days) +
 * (bases.length - 1).
 */
export function buildCalendar(args: {
  totalDays: number;
  bases: CalendarBase[];
  restSpec?: RestSpec | null;
}): TripCalendar {
  const { totalDays, bases, restSpec = null } = args;
  const moveCount = Math.max(0, bases.length - 1);
  const basedDays = bases.reduce((s, b) => s + b.days, 0);
  if (basedDays + moveCount !== totalDays) {
    throw new Error(
      `pacing: bases (${basedDays} based days + ${moveCount} move days) do not add up to ${totalDays} total days`
    );
  }
  const notes: string[] = [];
  const days: CalendarDay[] = [];
  bases.forEach((base, bi) => {
    if (base.days < 2)
      notes.push(
        `base "${base.name}" is shorter than 2 nights — kept as given (the traveler's own split); the pacing stage never creates a base this short on its own`
      );
    const seg = typeSegment(base.days, { restSpec });
    if (bi > 0 && seg[0] === "FULL") {
      seg[0] = "LIGHT"; // first day in a new base is at most LIGHT
      notes.push(`day ${days.length + 1}: first day in ${base.name} capped at LIGHT (arrival recovery after the move)`);
    }
    for (const type of seg) days.push({ day: days.length + 1, type, base: base.name, baseIndex: bi });
    if (bi < bases.length - 1) {
      days.push({
        day: days.length + 1,
        type: "MOVE",
        base: bases[bi + 1].name,
        baseIndex: bi + 1,
        fromBase: base.name,
        toBase: bases[bi + 1].name
      });
    }
  });
  const relaxFavorites = bases.length === 1 && bases[0].days > 10;
  if (relaxFavorites)
    notes.push(
      `long single-base stay (${bases[0].days} days in ${bases[0].name}): the used-up ledger relaxes for beloved repeatables — markets and parks may return after a gap of days; headline sights never repeat`
    );
  const counts: Record<string, number> = Object.fromEntries(
    DAY_TYPES.map((t) => [t, days.filter((d) => d.type === t).length])
  );
  return { days, notes, relaxFavorites, counts };
}

export interface MoveDayJourneySpec {
  checkInMin?: number;
  checkInProvenance?: string;
  journeyMin: number;
  checkoutMin?: number;
}

export interface BuildMoveDayArgs {
  dayNumber: number;
  date: LocalDate;
  fromName: string;
  toName: string;
  arrivalPack: EnginePack | null;
  arrivalBasePos: EnginePos;
  arrivalBaseName: string;
  fromBaseName?: string | null;
  earliestMin?: PlanMinutes;
  journey?: MoveDayJourneySpec | null;
}

/**
 * Build the MOVE day between two bases (multi-city trips). The
 * transfer is a pencilled block — mode and exact times belong to the
 * traveler's booking, never invented here. At most ONE light stop
 * near the arrival base, and only when the arithmetic honestly
 * leaves room for it after arrival.
 */
export function buildMoveDay(args: BuildMoveDayArgs): EngineDay {
  const {
    dayNumber,
    date,
    fromName,
    toName,
    arrivalPack,
    arrivalBasePos,
    arrivalBaseName,
    fromBaseName = null,
    earliestMin = 9 * 60,
    journey = null
  } = args;
  const MOVE_START = Math.max(earliestMin, 9 * 60 + 30); // out after breakfast
  const ARRIVE = 16 * 60 + 30; // pencilled arrival at the new base
  const moveItem: EngineDay["items"][number] = {
    type: "move",
    title: `Travel day — ${fromName} → ${toName}`,
    start: MOVE_START,
    end: ARRIVE,
    key: `move-${date}`,
    fromName,
    toName
  };
  const items: EngineDay["items"] = [moveItem];
  const legs: EngineDay["legs"] = [];
  // Seam chaining (continuity, owner 2026-10-21): with a journey tail,
  // the move is ONE motion — checkout at the old base, the transfer,
  // and check-in at the new base, with no orphaned hours between them
  // and the luggage state carried openly (bags with the traveler
  // until the room opens). checkoutMin is when keys are handed back
  // at the old base (default 30 min before the pencilled departure).
  let seam: EngineDay["seam"] = null;
  // Journey envelope on a fly-in MOVE day (owner, 2026-10-21): arrival
  // is not the end of the journey — check-in and rest & refresh
  // follow, and the gentle arrival stop may only start once the
  // traveler has rested. Without a journey spec the day behaves
  // exactly as before.
  let stopNotBefore = ARRIVE;
  let envelope: EngineDay["envelope"] = null;
  if (journey) {
    const checkInMin = journey.checkInMin ?? 15 * 60;
    const provenance =
      journey.checkInMin != null
        ? journey.checkInProvenance || "hotel/booking data"
        : "assumed — conservative 15:00 default; an earlier room is never invented";
    const effCheckIn = Math.max(checkInMin, ARRIVE);
    const restMin = journey.journeyMin > 300 ? 120 : journey.journeyMin >= 120 ? 60 : 30;
    if (effCheckIn > ARRIVE)
      items.push({
        type: "rest", part: "arrival-wait",
        title: "Settle in near base — the room is not ready yet",
        start: ARRIVE, end: effCheckIn, key: `wait-${date}`
      });
    items.push({
      type: "checkin", part: "checkin", title: `Check in — ${arrivalBaseName}`,
      start: effCheckIn, end: effCheckIn + 15, key: `checkin-${date}`,
      sub: `room from ${fmt(checkInMin)} · ${provenance}`, pos: null
    });
    items.push({
      type: "rest", part: "refresh",
      title: "Rest & refresh — travel takes something out of you",
      start: effCheckIn + 15, end: effCheckIn + 15 + restMin, key: `refresh-${date}`
    });
    stopNotBefore = effCheckIn + 15 + restMin;
    envelope = {
      arrival: {
        journeyMin: journey.journeyMin, checkInMin, checkInProvenance: provenance,
        restMinutes: restMin, via: "move-day", arriveBaseMin: ARRIVE
      }
    };
    // The seam record: the whole chain, timed, with the luggage state
    // and the orphan account (minutes between checkout and check-in
    // not carried by a named block — by construction zero, verified
    // in the continuity proofs, never asserted blind).
    const checkoutMin = journey.checkoutMin ?? MOVE_START - 30;
    items.push({
      type: "checkout", part: "checkout", title: `Check out — ${fromBaseName || fromName}`,
      start: checkoutMin, end: MOVE_START, key: `checkout-${date}`,
      sub: "keys handed back, bags in hand — the block runs to the moment the motion starts, so no minute of the seam is unaccounted",
      pos: null
    });
    moveItem.sub = `bags with you from checkout until check-in at ${toName} (${fmt(effCheckIn)}) — nothing is left behind or orphaned in between`;
    seam = {
      day: dayNumber,
      fromBase: fromName,
      toBase: toName,
      checkoutMin,
      transferStart: MOVE_START,
      transferEnd: ARRIVE,
      checkInMin: effCheckIn,
      checkInLabel: fmt(effCheckIn),
      restEndMin: effCheckIn + 15 + restMin,
      luggageNote: `bags with you until ${fmt(effCheckIn)} check-in`,
      orphanMin: 0,
      chain: "checkout -> transfer -> check-in -> rest & refresh (one motion)"
    };
  }
  const lightKinds = ["park", "viewpoint", "historic", "market", "attraction"];
  const near = (arrivalPack?.sights || [])
    .filter((c: EngineCandidate) => lightKinds.includes(c.kind))
    .map((c: EngineCandidate) => ({ c, km: haversineKm(arrivalBasePos, c.pos) }))
    .filter((x) => x.km <= 1.0)
    .sort((a, b) => a.km - b.km || a.c.name.localeCompare(b.c.name));
  for (const { c, km } of near) {
    const hours = {
      ...parseHoursForDay(c.hoursRaw, weekdayOf(date)),
      provenance: c.hoursRaw ? "osm" : "none"
    };
    if (hours.status === "closed") continue;
    const dur = Math.min(DURATIONS[c.kind] || 45, 30); // a light stop, never a slate
    const walk = travelMin(km, "walk");
    const start = stopNotBefore + walk;
    if (start + dur > 17 * 60 + 30) continue; // the day must still end gently
    legs.push({
      fromKey: "base", toKey: c.key, fromName: arrivalBaseName, toName: c.name,
      mode: "walk", km, minutes: walk, depart: stopNotBefore, arrive: start
    });
    items.push({
      type: "stop", key: c.key, name: c.name, kind: c.kind, role: "arrival",
      start, end: start + dur, pos: c.pos, hours, hoursRaw: c.hoursRaw, url: c.url,
      price: "UNKNOWN"
    });
    legs.push({
      fromKey: c.key, toKey: "base", fromName: c.name, toName: arrivalBaseName,
      mode: "walk", km, minutes: walk, depart: start + dur, arrive: start + dur + walk
    });
    break; // at most one
  }
  items.sort((a, b) => a.start - b.start);
  return {
    dayNumber,
    date,
    role: "move",
    dayType: "MOVE",
    move: { fromName, toName },
    items,
    legs,
    ideas: [],
    envelope,
    seam,
    endMin: items.length > 1 ? items[items.length - 1].end : ARRIVE
  };
}
