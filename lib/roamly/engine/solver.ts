import {
  DINNER_START,
  haversineKm,
  mealNameFor,
  normText,
  parseHoursForDay,
  shortName,
  travelMin,
  weekdayOf
} from "@/lib/roamly/engine/util";
import type {
  EngineCandidate,
  EngineDay,
  EngineHours,
  EngineItem,
  EngineLeg,
  EnginePack,
  EnginePos,
  EngineWeatherDay
} from "@/lib/roamly/engine/util";
import { BASE_PROFILE, buildArrival, buildDeparture } from "@/lib/roamly/engine/journey";
import type { JourneyEnvelopeSpec, PartyProfile } from "@/lib/roamly/engine/journey";
import { buildTripArc } from "@/lib/roamly/engine/continuity";
import type { TripArc } from "@/lib/roamly/engine/continuity";
import type { LocalDate, PlanMinutes } from "@/lib/roamly/engine/time";

/*
 * solver — the multi-day deterministic constraint solver (Phase 2
 * port of the shadow zero-engine's solver.mjs).
 *
 * Generalizes the spike: used-up ledger across days, a base/hotel
 * anchor per day, a mid-trip rest block, named must-sees
 * guaranteed-or-reported, and day geometry that is travel-time-
 * feasible by construction. Plus the bounded evening-remainder mode.
 *
 * Production changes vs the shadow (DESIGN-PRODUCTION Phase 2, each
 * covered by its own assertions in the Phase 2 golden checks):
 *   1. PINNED ANCHOR STAY: the production day anchor is the
 *      traveler's BOOKED stay. `spec.pinnedStay` (name + position of
 *      the booked stay) overrides the caller-computed base — the
 *      solver plans around the booking, never around a scored OSM
 *      winner the traveler did not book. Without a pin, behavior is
 *      the shadow's exactly.
 *   2. Must-see results carry the candidate's stable key
 *      (`itemKey`) alongside the display name, so the continuity
 *      ledger keys on stable IDs, not names.
 * The dietary helpers below are the shadow collectors' two pure
 * functions, carried here because the solver is their only core
 * consumer; the full collectors port is Phase 3.
 */

/* ---------------- dietary evidence (from OSM tags only) ---------------- */

export function dietTier(tags: Record<string, string> = {}): number {
  if (tags["diet:vegan"] === "only" || tags["diet:vegetarian"] === "only") return 0;
  if (tags["diet:vegetarian"] === "yes" || tags["diet:vegan"] === "yes") return 1;
  if (/\b(vegan|vegetarian|falafel|salad)\b/.test(tags.cuisine || "")) return 2;
  return 3;
}

export function dietLabels(tags: Record<string, string> = {}): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tags)) if (k.startsWith("diet:")) out.push(`${k} = ${v}`);
  return out;
}

/* ------------------------------------------------------------------ */

// The gentle class (owner, 2026-10-21): all a departure day — and the
// hours around a journey — may hold. A market is the souvenir stop in
// the open data (no shop kind exists); a park or viewpoint is the
// stroll.
export const GENTLE_KINDS: readonly string[] = ["market", "park", "viewpoint"];

export const DURATIONS: Record<string, number> = {
  museum: 90, gallery: 60, attraction: 60, viewpoint: 25, historic: 30,
  park: 45, market: 60, venue: 60, falls: 90, lighthouse: 60, ferry: 75,
  food: 60
};
const RANK: Record<string, number> = {
  museum: 1, market: 2, attraction: 3, gallery: 4, park: 5, historic: 6,
  venue: 7, viewpoint: 8
};
// Long-stay ledger relaxation (pacing rule, owner 2026-10-21): on a
// long single-base stay, beloved repeatables may be scheduled again
// after a gap; headline kinds are never relaxed and never repeat.
const RELAX_KINDS: readonly string[] = ["market", "park"];
const RELAX_GAP_DAYS = 4;
const DAY_END = 17 * 60 + 30;
const LUNCH_TARGET = 12 * 60 + 15;

export type HoursInfo = EngineHours & { provenance: string };

function hoursFor(cand: EngineCandidate, date: LocalDate): HoursInfo {
  // Provenance order: Google (live or fixture) beats OSM; a place is
  // UNKNOWN only where neither source knows.
  if (cand.google?.businessStatus === "CLOSED_PERMANENTLY")
    return { status: "closed", provenance: cand.google.source };
  const wd = weekdayOf(date);
  const g = cand.google?.hoursByDay?.[wd];
  if (g) return { status: "known", open: g.open, close: g.close, provenance: cand.google?.source ?? "google" };
  const h = parseHoursForDay(cand.hoursRaw, wd);
  return { ...h, provenance: h.status === "unknown" ? "none" : "osm" };
}

function slotCheck(
  hours: HoursInfo,
  start: number,
  dur: number
): { ok: boolean; reason?: string; start: number } {
  if (hours.status === "closed") return { ok: false, reason: "closed that day", start };
  if (hours.status === "known") {
    let s = start;
    if (hours.open > s) {
      if (hours.open - s <= 15) s = hours.open;
      else return { ok: false, reason: "opens later", start };
    }
    if (hours.close < s + dur) return { ok: false, reason: "closes before the visit ends", start };
    return { ok: true, start: s };
  }
  return { ok: true, start };
}

const KIND_BY_PATTERN: Record<string, string> = {
  falls: "falls", waterfall: "falls", lighthouse: "lighthouse",
  ferry: "ferry", market: "market", museum: "museum"
};

/* ------------------------------------------------------------------ */
/* Spec + results                                                      */
/* ------------------------------------------------------------------ */

export interface MustSeeSpec {
  id: string;
  label: string;
  patterns: string[];
}

export interface RestSpec {
  type: string; // "afternoon" | "morning"
  text?: string;
}

export interface CalendarDayLike {
  type: string;
}

export interface SolveSpec {
  days: number;
  startIso: LocalDate;
  dates: LocalDate[];
  earliestMin: PlanMinutes;
  restSpec: RestSpec | null;
  mustSees: MustSeeSpec[];
  basePos: EnginePos;
  baseName: string;
  /** DESIGN-MANDATED (Phase 2): the traveler's BOOKED stay, pinned as
   *  the day anchor. When present it overrides basePos/baseName. */
  pinnedStay?: { name: string; pos: EnginePos } | null;
  calendar?: (string | CalendarDayLike)[] | null;
  relaxFavorites?: boolean;
  profile?: PartyProfile;
  journey?: JourneyEnvelopeSpec | null;
  weatherOverride?: EngineWeatherDay[] | null;
  mustSeeDayPins?: Record<string, number> | null;
  closedKeys?: Set<string> | null;
}

export interface MustSeeResult {
  id: string;
  label: string;
  status: string;
  day?: number;
  item?: string;
  /** Stable candidate key of the matched place (ledger identity). */
  itemKey?: string;
  reason?: string;
}

export interface SolveResult {
  days: EngineDay[];
  mustSeeResults: MustSeeResult[];
  notes: string[];
  usedCount: number;
  arc: TripArc | null;
}

interface MatchedMustSee {
  cand: EngineCandidate;
  mode: "excursion" | "ferry" | "stop";
  ms: MustSeeSpec;
}

export function solveTrip(pack: EnginePack, spec: SolveSpec): SolveResult {
  const {
    days: nDays,
    dates,
    earliestMin,
    restSpec,
    mustSees,
    calendar = null,
    relaxFavorites = false,
    profile = BASE_PROFILE,
    journey = null,
    weatherOverride = null,
    mustSeeDayPins = null,
    closedKeys = null
  } = spec;
  // Pinned anchor (design-mandated): the booked stay anchors the day
  // geometry when one is pinned; otherwise the caller's base stands.
  const basePos = spec.pinnedStay ? spec.pinnedStay.pos : spec.basePos;
  const baseName = spec.pinnedStay ? spec.pinnedStay.name : spec.baseName;
  // Continuity spec extensions (owner, 2026-10-21): weatherOverride is a
  // PINNED-FACT weather series for counterfactual drills (a labeled
  // scenario fact, exactly like the travel-day spike's stub provider —
  // it replaces the cached forecast wholesale, never silently).
  // mustSeeDayPins pins a must-see to one day (a traveler's booking
  // fixes it there). closedKeys holds "<key>@<dayIdx>" entries a stated
  // fact has closed (e.g. rain) — the item is unusable that day only.
  // Journey envelope (owner, 2026-10-21): when a journey spec rides
  // along, day 1 opens at the traveler's front door (arrival chain +
  // check-in + rest & refresh) and the last day bends around the
  // departure flight. Without one the solver behaves exactly as
  // before, apart from the meal/break anchors and the party profile,
  // which are always on.
  const isArrivalDay = (i: number): boolean => !!journey?.arrival && i === 0;
  const isDepartureDay = (i: number): boolean => !!journey?.departure && i === nDays - 1;
  const sights = pack.sights.map((c) => ({ ...c }));
  const excursions = pack.excursions.map((c) => ({ ...c }));
  const ferries = pack.transport.filter((c) => c.kind === "ferry");
  const foods = pack.foods.map((c) => ({ ...c }));
  const used = new Set<string>(); // candidate keys, across ALL days
  const usedPos: EnginePos[] = []; // anti-clustering, across all days
  const usedFood = new Set<string>();
  const lastUsedDay = new Map<string, number>(); // candidate key -> 0-based day it last ran (long-stay relaxation)
  const scheduledDay = new Map<string, number>(); // candidate key -> 0-based day it was actually scheduled (any path)
  const softUsed = new Set<string>(); // keys reserved as REST/OPEN ideas — never scheduled later
  const notes: string[] = [];
  const mustSeeResults: MustSeeResult[] = [];

  // Pacing calendar (owner, 2026-10-21): when the day-counter stage has
  // spoken, its day types rule and the solver only fills the shapes.
  // The owner's restSpec is then the pacing stage's business, not the
  // solver's. Without a calendar the solver behaves exactly as it did
  // before pacing.
  const calType = calendar ? calendar.map((d) => (typeof d === "string" ? d : d.type)) : null;
  // Effective day types: the pacing calendar as the continuity arc
  // layer leaves it (the arc may demote, never upgrade). dayTypeOf
  // reads these.
  const effTypes: string[] | null = calType ? [...calType] : null;
  const dayTypeOf = (i: number): string => (effTypes ? effTypes[i] : "FULL");
  const restDayIdx = !calendar && restSpec ? Math.floor(nDays / 2) : -1; // 0-based middle day

  /* ---- match must-sees to real candidates ---- */
  const matched = new Map<string, MatchedMustSee>(); // mustSee.id -> match
  for (const ms of mustSees) {
    const pools = [...excursions, ...ferries, ...sights];
    let cand: EngineCandidate | null = null;
    for (const c of pools) {
      const nm = normText(c.name);
      if (ms.patterns.some((p) => nm.includes(normText(p)))) {
        cand = c;
        break;
      }
    }
    if (!cand) {
      const kinds = [...new Set(ms.patterns.map((p) => KIND_BY_PATTERN[normText(p)]).filter(Boolean))];
      cand = pools.find((c) => kinds.includes(c.kind)) || null;
    }
    if (!cand) {
      mustSeeResults.push({
        id: ms.id,
        label: ms.label,
        status: "unmet",
        reason: "no matching candidate exists in the open data for this destination"
      });
      continue;
    }
    const mode: MatchedMustSee["mode"] =
      cand.kind === "ferry" ? "ferry" : cand.kind === "falls" || cand.kind === "lighthouse" ? "excursion" : "stop";
    matched.set(ms.id, { cand, mode, ms });
  }
  // Pinned must-sees (a booking fixes the day): the candidate is
  // reserved for its pinned day — the normal skeleton may not take it
  // early and strand the pin.
  const pinnedKeyDay = new Map<string, number>();
  if (mustSeeDayPins)
    for (const m of matched.values())
      if (mustSeeDayPins[m.ms.id] != null) pinnedKeyDay.set(m.cand.key, mustSeeDayPins[m.ms.id]);

  /* ---- assign special days (weather-aware for the excursion) ---- */
  let eligible: number[] = [];
  for (let i = 0; i < nDays; i++) {
    if (calendar ? calType?.[i] === "FULL" : i !== restDayIdx) eligible.push(i);
  }
  // The departure day belongs to the envelope (gentle class only) —
  // never hand it the excursion or the ferry.
  if (journey?.departure && nDays > 1) eligible = eligible.filter((i) => !isDepartureDay(i));
  const weatherSeries = weatherOverride || pack.weather;
  const precip = (i: number): number =>
    weatherSeries.find((w) => w.date === dates[i])?.precipProb ?? 50;
  const byDry = [...eligible].sort((a, b) => precip(a) - precip(b) || a - b);
  const excursionMs = [...matched.values()].filter((m) => m.mode === "excursion");
  const ferryMs = [...matched.values()].filter((m) => m.mode === "ferry");
  const dayRole = new Array<string>(nDays).fill("standard");
  if (calendar && calType) {
    const roleFor: Record<string, string> = {
      FULL: "standard",
      LIGHT: "light",
      REST: "rest-day",
      OPEN: "open-day"
    };
    for (let i = 0; i < nDays; i++) dayRole[i] = roleFor[calType[i]] || "standard";
    if (relaxFavorites)
      notes.push(
        `Long single-base stay: the used-up ledger relaxes for beloved repeatables (${RELAX_KINDS.join(", ")}) — a favourite may return after a gap of ${RELAX_GAP_DAYS}+ days; headline sights never repeat.`
      );
  }
  if (restDayIdx >= 0) dayRole[restDayIdx] = restSpec?.type === "morning" ? "rest-morning" : "rest-afternoon";
  let excursionDay = -1;
  if (excursionMs.length) {
    excursionDay = byDry.find((i) => i !== 0) ?? byDry[0] ?? -1;
    if (excursionDay >= 0) dayRole[excursionDay] = "excursion";
    if (weatherSeries.length)
      notes.push(
        `Excursion placed on ${dates[excursionDay]} — the driest eligible day in the forecast (${precip(excursionDay)}% rain chance).`
      );
  }
  let ferryDay = -1;
  if (ferryMs.length) {
    ferryDay =
      eligible.find((i) => i !== excursionDay && i !== 0) ?? eligible.find((i) => i !== excursionDay) ?? -1;
    if (ferryDay >= 0 && dayRole[ferryDay] === "standard") dayRole[ferryDay] = "ferry";
    else if (ferryDay === restDayIdx) {
      /* ferry rides the rest day only if it is a morning-rest day */
      if (dayRole[ferryDay] !== "rest-morning") ferryDay = -1;
    }
  }

  /* ---- Continuity: the trip arc over the pacing calendar ----
     SETTLE -> EXPLORE -> PEAK -> LAND (see continuity.ts). Runs only
     when the day counter has spoken: without a calendar there is no
     pacing shape to protect and the solver behaves exactly as before.
     The peak is estimated from placement (the excursion day carries
     the trip's headline; the ferry day a named must-see); the landing
     demotion never touches the peak, the excursion, or the ferry. */
  let tripArc: TripArc | null = null;
  if (calendar && effTypes) {
    const heuristic = new Map<number, number>();
    for (let i = 0; i < nDays; i++)
      heuristic.set(i + 1, (i === excursionDay ? 100 : 0) + (i === ferryDay ? 60 : 0));
    tripArc = buildTripArc({
      types: effTypes,
      peakScoreByDay: heuristic,
      adjust: true,
      envelopeArrival: !!journey?.arrival,
      envelopeDeparture: !!journey?.departure
    });
    // honor the demotion unless it would land on a protected day
    const honored: TripArc["adjustments"] = [];
    for (const adj of tripArc.adjustments) {
      const idx = adj.day - 1;
      if (idx === excursionDay || idx === ferryDay || (tripArc.peakDay != null && idx === tripArc.peakDay - 1)) continue;
      effTypes[idx] = adj.to;
      if (dayRole[idx] === "standard") dayRole[idx] = "light";
      honored.push(adj);
      notes.push(`Continuity arc: day ${adj.day} steps FULL -> LIGHT — ${adj.reason}.`);
    }
    tripArc = { ...tripArc, types: [...effTypes], adjustments: honored };
    for (const n of tripArc.notes) notes.push(`Continuity arc: ${n}.`);
    if (tripArc.peakDay)
      notes.push(
        `Continuity arc: peak day ${tripArc.peakDay} (the day carrying the trip's headline content); settle day ${tripArc.settleDay}, land day ${tripArc.landDay}.`
      );
  }

  /* ---- helpers bound to the ledger ---- */
  const isFree = (c: EngineCandidate): boolean => !used.has(c.key);
  const farFromUsed = (c: EngineCandidate, allowSelf = false): boolean =>
    !usedPos.some((p) => {
      const d = haversineKm(p, c.pos);
      return d < 0.15 && !(allowSelf && d < 1e-9);
    });
  // The used-up ledger, with the long-stay relaxation: a beloved
  // repeatable (market, park) may be picked again once it has rested
  // RELAX_GAP_DAYS days. Idea candidates (softUsed) are never
  // scheduled at all.
  const usable = (c: EngineCandidate, dayIdx: number): "fresh" | "repeat" | null => {
    if (softUsed.has(c.key)) return null;
    if (pinnedKeyDay.size && pinnedKeyDay.has(c.key) && pinnedKeyDay.get(c.key) !== dayIdx) return null; // reserved for its pinned day
    if (closedKeys && closedKeys.has(`${c.key}@${dayIdx}`)) return null; // a stated fact closed this place on this day
    if (!used.has(c.key)) return "fresh";
    if (
      relaxFavorites &&
      RELAX_KINDS.includes(c.kind) &&
      dayIdx - (lastUsedDay.get(c.key) ?? -99) >= RELAX_GAP_DAYS
    )
      return "repeat";
    return null;
  };

  interface Pick {
    c: EngineCandidate;
    hours: HoursInfo;
    chk: { ok: boolean; reason?: string; start: number };
    score: [number, number, string];
  }

  function pick(
    pool: EngineCandidate[],
    fromPos: EnginePos,
    atTime: number,
    date: LocalDate,
    dayIdx: number,
    opts: {
      maxLegKm?: number;
      maxEnd?: number;
      prevKind?: string | null;
      kinds?: string[] | null;
    } = {}
  ): Pick | null {
    const { maxLegKm = profile.maxLegKm, maxEnd = DAY_END, prevKind = null, kinds = null } = opts;
    let best: Pick | null = null;
    for (const c of pool) {
      const u = usable(c, dayIdx);
      if (!u) continue;
      if (kinds && !kinds.includes(c.kind)) continue;
      if (!farFromUsed(c, u === "repeat")) continue;
      const km = haversineKm(fromPos, c.pos);
      if (km > maxLegKm) continue;
      const hours = hoursFor(c, date);
      const arrival = atTime + travelMin(km, "walk");
      const chk = slotCheck(hours, arrival, DURATIONS[c.kind] || 45);
      if (!chk.ok) continue;
      if (chk.start + (DURATIONS[c.kind] || 45) > maxEnd) continue;
      const effRank = (RANK[c.kind] ?? 9) + (c.kind === prevKind ? 3 : 0);
      const score: [number, number, string] = [effRank, km, c.name];
      if (
        !best ||
        score[0] < best.score[0] ||
        (score[0] === best.score[0] &&
          (score[1] < best.score[1] - 1e-9 ||
            (Math.abs(score[1] - best.score[1]) <= 1e-9 && score[2] < best.score[2])))
      ) {
        best = { c, hours, chk, score };
      }
    }
    return best;
  }

  function buildDay(dayIdx: number): EngineDay {
    const date = dates[dayIdx];
    const role = dayRole[dayIdx];
    const items: EngineItem[] = [];
    const legs: EngineLeg[] = [];
    let t = Math.max(earliestMin, 9 * 60 + 30);
    if (dayIdx === 0) t = Math.max(earliestMin, 9 * 60 + 30);
    let pos = basePos, posKey = "base", posName = baseName;
    let walkKmToday = 0; // party-profile walking budget accounting
    let spanStart: number | null = null; // when the current unbroken activity span began
    let envelope: EngineDay["envelope"] = null; // journey-envelope record for composer/judges
    const move = (
      destPos: EnginePos,
      destKey: string,
      destName: string,
      mode: string
    ): { km: number; minutes: number } => {
      const km = haversineKm(pos, destPos);
      const minutes = travelMin(km, mode);
      legs.push({ fromKey: posKey, toKey: destKey, fromName: posName, toName: destName, mode, km, minutes, depart: t, arrive: t + minutes });
      if (mode === "walk") walkKmToday += km;
      t += minutes;
      pos = destPos;
      posKey = destKey;
      posName = destName;
      return { km, minutes };
    };
    // Meals & breaks are ESSENTIALS (owner, 2026-10-21): a sit-down
    // pause is a protected anchor, inserted before the next stop
    // whenever the party has been active longer than its profile
    // allows. It is a rest item — the day carries it openly, never as
    // hidden slack.
    const pace = (): void => {
      if (spanStart == null || t - spanStart < profile.breakEveryMin) return;
      items.push({
        type: "rest", part: "break", title: "A short pause — sit down, water, breathe",
        start: t, end: t + profile.sitBreakMin, key: `break-${date}-${t}`
      });
      t += profile.sitBreakMin;
      spanStart = t;
    };
    // Duration-aware pacing: two long stops back to back can blow the
    // party's break cadence without either pick crossing it alone — if
    // the NEXT stop (durMin long) would carry the unbroken span past
    // the limit, the pause goes in before it. Returns true when it
    // fired.
    const paceFor = (durMin: number): boolean => {
      pace();
      if (spanStart == null || t - spanStart < 60 || t - spanStart + durMin <= profile.breakEveryMin + 45)
        return false;
      items.push({
        type: "rest", part: "break", title: "A short pause — sit down, water, breathe",
        start: t, end: t + profile.sitBreakMin, key: `break-${date}-${t}`
      });
      t += profile.sitBreakMin;
      spanStart = t;
      return true;
    };
    const addStop = (cand: EngineCandidate, hours: HoursInfo, start: number, roleTag: string): EngineItem => {
      const isRepeat = lastUsedDay.has(cand.key);
      const item: EngineItem = {
        type: "stop", key: cand.key, name: cand.name, kind: cand.kind, role: roleTag,
        start, end: start + (DURATIONS[cand.kind] || 45), pos: cand.pos,
        hours, hoursRaw: cand.hoursRaw, url: cand.url, price: "UNKNOWN",
        ...(isRepeat ? { repeat: true, firstDay: (lastUsedDay.get(cand.key) ?? 0) + 1 } : {})
      };
      items.push(item);
      used.add(cand.key);
      usedPos.push(cand.pos);
      lastUsedDay.set(cand.key, dayIdx);
      scheduledDay.set(cand.key, dayIdx);
      t = item.end;
      pos = cand.pos;
      posKey = cand.key;
      posName = cand.name;
      return item;
    };
    const addLunch = (
      opts: { wantOverride?: number | null; maxKm?: number; mustEndBy?: number } = {}
    ): EngineItem | null => {
      const { wantOverride = null, maxKm = 1.8, mustEndBy = Infinity } = opts;
      // Cadence gate: if the unbroken span would run far past this
      // party's break rhythm by the time lunch lands, the pause goes in
      // first — unless it would push the meal into a protected time
      // (mustEndBy, e.g. a departure day's pack-up), where the chain
      // wins.
      if (
        spanStart != null &&
        Math.max(t, wantOverride ?? LUNCH_TARGET) + 15 - spanStart > profile.breakEveryMin + 45 &&
        t + profile.sitBreakMin + 75 <= mustEndBy
      ) {
        items.push({
          type: "rest", part: "break", title: "A short pause — sit down, water, breathe",
          start: t, end: t + profile.sitBreakMin, key: `break-${date}-${t}`
        });
        t += profile.sitBreakMin;
        spanStart = t;
      }
      const want = Math.max(t, wantOverride ?? LUNCH_TARGET);
      // The meal anchor is protected: when no restaurant can be booked,
      // the day still carries an honest meal WINDOW (a rest item —
      // nothing invented, no place named) instead of silently starving
      // the plan.
      const mealWindow = (): null => {
        items.push({
          type: "rest", part: "meal",
          title: `${mealNameFor(want)} window — nothing booked; eat when you find a spot`,
          start: want, end: want + 60, key: `meal-${date}`
        });
        t = want + 60;
        spanStart = t;
        return null;
      };
      const near = foods
        .map((f) => ({ f, tier: dietTier(f.tags), km: haversineKm(pos, f.pos) }))
        .filter((x) => x.km <= maxKm);
      if (!near.length) {
        notes.push(`${date}: no food places in the open data near the day's route — a lunch window is held instead of a booking.`);
        return mealWindow();
      }
      const unusedNear = near.filter((x) => !usedFood.has(x.f.key));
      const pool = unusedNear.length ? unusedNear : near;
      const bestTier = Math.min(...pool.map((x) => x.tier));
      const cands = pool
        .filter((x) => x.tier === bestTier)
        .map((x) => {
          const hours = hoursFor(x.f, date);
          return { ...x, hours, chk: slotCheck(hours, want + travelMin(x.km, "walk"), DURATIONS.food) };
        })
        .filter((x) => x.chk.ok)
        .sort(
          (a, b) =>
            (a.hours.status === "known" ? 0 : 1) - (b.hours.status === "known" ? 0 : 1) ||
            a.km - b.km ||
            a.f.name.localeCompare(b.f.name)
        );
      const chosen = cands[0];
      if (!chosen) return mealWindow();
      t = want;
      move(chosen.f.pos, chosen.f.key, chosen.f.name, "walk");
      const start = Math.max(t, chosen.chk.start);
      const labels = dietLabels(chosen.f.tags);
      const item: EngineItem = {
        type: "food", key: chosen.f.key, name: chosen.f.name, kind: "food", role: "lunch",
        mealName: mealNameFor(start),
        start, end: start + DURATIONS.food, pos: chosen.f.pos, hours: chosen.hours,
        hoursRaw: chosen.f.hoursRaw, url: chosen.f.url, price: "UNKNOWN",
        diet: {
          tier: chosen.tier,
          labels,
          strong: chosen.tier <= 1 && labels.length > 0,
          veganOnly: chosen.f.tags["diet:vegan"] === "only",
          evidenceText: labels.join(", ")
        }
      };
      items.push(item);
      usedFood.add(chosen.f.key);
      t = item.end;
      pos = chosen.f.pos;
      posKey = chosen.f.key;
      posName = chosen.f.name;
      spanStart = t; // a meal resets the activity span — it IS the break
      return item;
    };
    const addSimple = (
      poolKinds: string[],
      maxEnd: number,
      prevKind: string | null
    ): EngineItem | null => {
      // Party-profile walking budget: when the day's walking is spent,
      // the solver stops adding stops — tired travelers are a failed
      // plan.
      const budget = profile.walkBudgetKm[dayTypeOf(dayIdx)] ?? profile.walkBudgetKm.FULL;
      if (walkKmToday >= budget) {
        notes.push(`${date}: walking budget for this party (${budget} km) reached — no further stops added.`);
        return null;
      }
      let p = pick(sights, pos, t, date, dayIdx, { maxEnd, prevKind, kinds: poolKinds });
      if (!p) return null;
      // If the pause fired, the pick is re-run at the later hour; if
      // nothing still fits, the day keeps the pause and one less stop
      // rather than an impossible hour.
      if (paceFor(DURATIONS[p.c.kind] || 45)) {
        p = pick(sights, pos, t, date, dayIdx, { maxEnd, prevKind, kinds: poolKinds });
        if (!p) return null;
      }
      move(p.c.pos, p.c.key, p.c.name, "walk");
      return addStop(p.c, p.hours, Math.max(t, p.chk.start), "stop");
    };

    /* ---- Journey envelope: arrival day (owner, 2026-10-21) ----
       The day opens at the traveler's front door: journey chain ->
       (wait for the room, lunch held inside a long wait) -> check-in
       -> rest & refresh -> only then a fill, whose shape the
       journey's length caps. */
    let skeletonDone = false;
    if (isArrivalDay(dayIdx) && journey?.arrival) {
      const A = buildArrival(journey.arrival, { date, baseName });
      envelope = {
        arrival: {
          journeyMin: A.journeyMin, arriveBaseMin: A.arriveBaseMin, checkInMin: A.checkInMin,
          checkInProvenance: A.checkInProvenance, restMinutes: A.rest.minutes,
          restTier: A.rest.tier, cap: A.rest.cap, mode: journey.arrival.mode || "fly"
        }
      };
      items.push(...A.items);
      t = A.arriveBaseMin;
      pos = basePos;
      posKey = "base";
      posName = baseName;
      let lunchDone = false;
      // A long wait for the room holds lunch inside it (near base, bags
      // close) — but only when the meal provably FITS before check-in:
      // settle-in + walk + a full hour at the table.
      if (A.waitWindow) {
        const [w0, w1] = A.waitWindow;
        const fitsInWait = A.arriveBaseMin <= 13 * 60 && w1 - w0 >= 45 && A.arriveBaseMin + 20 + 75 <= w1;
        let mealHeldInWait = false;
        if (fitsInWait) {
          const itemsBefore = items.length;
          const lunch = addLunch({ wantOverride: Math.max(A.arriveBaseMin + 20, LUNCH_TARGET), maxKm: 0.9 });
          if (lunch) {
            lunchDone = true;
            mealHeldInWait = true;
            lunch.interruptible = true; // room-wait content (owner hard rule): an unbooked meal the traveler can abandon mid-minute if the room opens early — nothing promised lives in a wait
            const outLeg = legs.find((l) => l.toKey === lunch.key);
            if (posKey !== "base") move(basePos, "base", baseName, "walk");
            const backAt = t; // settled back at base after lunch
            if (outLeg && outLeg.depart - w0 >= 10)
              items.push({ type: "rest", part: "arrival-wait", title: "Settle in near base — the room is not ready yet", start: w0, end: outLeg.depart, key: `wait-${date}-a` });
            if (w1 - backAt >= 10)
              items.push({ type: "rest", part: "arrival-wait", title: "Settle in near base — the room is not ready yet", start: backAt, end: w1, key: `wait-${date}-b` });
          } else if (items.length > itemsBefore) {
            // addLunch held a meal WINDOW inside the wait instead — the
            // meal anchor is served; no separate wait block is drawn.
            lunchDone = true;
            mealHeldInWait = true;
            if (posKey !== "base") move(basePos, "base", baseName, "walk");
          }
        }
        if (!mealHeldInWait) {
          items.push({ type: "rest", part: "arrival-wait", title: "Settle in near base — the room is not ready yet", start: w0, end: w1, key: `wait-${date}` });
        }
      }
      items.push(A.checkInItem);
      t = A.effCheckInMin + 15;
      if (!lunchDone && A.arriveBaseMin >= 12 * 60) {
        const lunch = addLunch({ wantOverride: t });
        if (lunch) {
          lunchDone = true;
          if (posKey !== "base") move(basePos, "base", baseName, "walk");
        }
      }
      const restIt = A.restItem(t);
      items.push(restIt);
      t = restIt.end;
      spanStart = t;
      notes.push(`${date}: arrival envelope — ${A.journeyMin} min door to door (${A.rest.tier}); check-in ${A.checkInProvenance}; rest & refresh ${A.rest.minutes} min before any stop.`);
      if (A.rest.cap === "LIGHT") {
        const a = addSimple(["museum", "market", "attraction", "park"], DAY_END - 30, null);
        if (!lunchDone) {
          addLunch();
          lunchDone = true;
        }
        if (t <= 16 * 60) addSimple(["park", "viewpoint", "historic"], DAY_END - 30, a?.kind ?? null);
      } else {
        addSimple(["museum", "market", "attraction"], LUNCH_TARGET + 30, null);
        addSimple(["park", "gallery", "historic", "viewpoint"], LUNCH_TARGET + 45, null);
        if (!lunchDone) addLunch();
        addSimple(["attraction", "museum", "gallery", "venue"], DAY_END - 45, null);
      }
      skeletonDone = true;
    }
    /* ---- Journey envelope: departure day ----
       Its own shape: gentle class only (souvenirs, strolling), then
       the protected chain — pack-up, checkout, transfer — derived
       backwards from the flight. A dawn flight empties the morning
       entirely. */
    if (!skeletonDone && isDepartureDay(dayIdx) && journey?.departure) {
      const D = buildDeparture(journey.departure, { date });
      envelope = {
        departure: {
          flightMin: D.flightMin, leaveBaseMin: D.leaveBaseMin,
          packOnEve: D.packOnEve, emptyMorning: D.emptyMorning
        }
      };
      t = Math.max(earliestMin, 9 * 60 + 30);
      spanStart = t;
      if (!D.emptyMorning && D.gentleUntil) {
        if (!addSimple(["market"], D.gentleUntil, null)) addSimple(["park", "viewpoint"], D.gentleUntil, null); // the souvenir stop first
        if (t <= D.gentleUntil - 75) addSimple(["park", "viewpoint", "historic"], D.gentleUntil, null);
        const packStart = D.packWindow?.[0];
        if (packStart != null) {
          if (Math.max(t, LUNCH_TARGET) + 15 + 60 <= packStart) addLunch({ mustEndBy: packStart });
          else if (t + 30 <= packStart) {
            items.push({ type: "rest", part: "meal", title: `${mealNameFor(t)} window — nothing booked; eat when you find a spot`, start: t, end: t + 30, key: `meal-${date}` });
            t += 30;
          }
        }
      }
      if (posKey !== "base") move(basePos, "base", baseName, "walk");
      const tail = D.items(D.packOnEve ? null : (D.packWindow?.[0] ?? null));
      items.push(...tail);
      t = tail[tail.length - 1].end;
      notes.push(`${date}: departure envelope — flight ${journey.departure.flightMin} min; gentle class only, pack-up protected, leave base at ${D.leaveBaseMin}.`);
      skeletonDone = true;
    }

    // A pinned must-see LEADS its day (continuity drills): a booking
    // that fixes a place to a day is an anchor, not an afterthought —
    // the day is built around it, driving out if it sits beyond
    // walking range, exactly as the excursion does. FULL days only:
    // pacing shapes (REST/OPEN/LIGHT) are not silently overridden by
    // a pin.
    if (!skeletonDone && dayTypeOf(dayIdx) === "FULL") {
      for (const m of matched.values()) {
        if (m.mode !== "stop" || !isFree(m.cand)) continue;
        if (!pinnedKeyDay.size || pinnedKeyDay.get(m.cand.key) !== dayIdx) continue;
        if (mustSeeResults.some((r) => r.id === m.ms.id)) continue;
        if (closedKeys && closedKeys.has(`${m.cand.key}@${dayIdx}`)) continue;
        const hours = hoursFor(m.cand, date);
        const km0 = haversineKm(pos, m.cand.pos);
        move(m.cand.pos, m.cand.key, m.cand.name, km0 > 1.2 ? "drive" : "walk");
        const chk = slotCheck(hours, t, DURATIONS[m.cand.kind] || 45);
        const item = addStop(m.cand, hours, chk.ok ? Math.max(t, chk.start) : t, "mustsee");
        mustSeeResults.push({ id: m.ms.id, label: m.ms.label, status: "scheduled", day: dayIdx + 1, item: item.name, itemKey: m.cand.key });
        spanStart = t;
      }
    }

    if (spanStart == null) spanStart = t; // activity span starts with the day

    // Pacing day types (calendar mode): the day counter has already
    // decided this day's shape; the solver only fills it, never
    // upgrades it.
    if (!skeletonDone && role === "rest-day") {
      items.push({ type: "rest", part: "day", title: "Rest day — nothing booked", start: earliestMin, end: 17 * 60, key: `rest-${date}` });
      t = 17 * 60;
      skeletonDone = true;
    } else if (role === "open-day") {
      t = earliestMin;
      skeletonDone = true; // nothing scheduled — ideas attach below
    } else if (role === "light") {
      t = Math.max(earliestMin, 10 * 60); // a late start, on purpose
      const lightAnchor = addSimple(["museum", "market", "attraction"], LUNCH_TARGET + 45, null);
      addLunch();
      if (t <= 15 * 60) addSimple(["park", "viewpoint", "historic"], 16 * 60 + 30, lightAnchor?.kind ?? null);
      skeletonDone = true;
    }
    if (!skeletonDone && role === "rest-morning") {
      items.push({ type: "rest", part: "morning", title: "Slow morning — nothing booked", start: earliestMin, end: 12 * 60, key: `rest-${date}` });
      t = 12 * 60;
      addLunch();
    }
    if (!skeletonDone && (role === "ferry" || (role === "rest-morning" && ferryDay === dayIdx))) {
      const fm = ferryMs[0];
      if (fm && isFree(fm.cand) && !(closedKeys && closedKeys.has(`${fm.cand.key}@${dayIdx}`))) {
        move(fm.cand.pos, fm.cand.key, fm.cand.name, "walk");
        const hours = hoursFor(fm.cand, date);
        const item: EngineItem = {
          type: "stop", key: fm.cand.key, name: fm.cand.name, title: `Ferry crossing (from ${fm.cand.name})`,
          kind: "ferry", role: "mustsee", start: t, end: t + DURATIONS.ferry, pos: fm.cand.pos,
          hours, hoursRaw: fm.cand.hoursRaw, url: fm.cand.url, price: "UNKNOWN"
        };
        items.push(item);
        used.add(fm.cand.key);
        usedPos.push(fm.cand.pos);
        t = item.end;
        pos = fm.cand.pos;
        posKey = fm.cand.key;
        posName = fm.cand.name;
        spanStart = t; // a ferry crossing is seated time — the activity span rests aboard
        mustSeeResults.push({ id: fm.ms.id, label: fm.ms.label, status: "scheduled", day: dayIdx + 1, item: fm.cand.name, itemKey: fm.cand.key });
        move(basePos, "base", baseName, "walk");
      }
      if (role === "ferry") {
        addSimple(["museum", "attraction"], LUNCH_TARGET + 30, null);
        addLunch();
        if (profile.energyBurn) {
          if (!addSimple(["park", "viewpoint"], DAY_END - 30, null)) addSimple(["park", "gallery", "historic"], DAY_END - 30, null);
        } else addSimple(["park", "gallery", "historic"], DAY_END - 30, null);
      }
    } else if (!skeletonDone && role === "excursion") {
      addSimple(["museum", "attraction", "market"], LUNCH_TARGET + 15, null);
      addLunch();
      const em = excursionMs[0];
      if (em && isFree(em.cand) && !(closedKeys && closedKeys.has(`${em.cand.key}@${dayIdx}`))) {
        move(em.cand.pos, em.cand.key, em.cand.name, "drive");
        const hours = hoursFor(em.cand, date);
        const chk = slotCheck(hours, t, DURATIONS[em.cand.kind] || 60);
        const start = chk.ok ? Math.max(t, chk.start) : t;
        const item: EngineItem = {
          type: "stop", key: em.cand.key, name: em.cand.name, kind: em.cand.kind, role: "excursion",
          start, end: start + (DURATIONS[em.cand.kind] || 60), pos: em.cand.pos,
          hours, hoursRaw: em.cand.hoursRaw, url: em.cand.url, price: "UNKNOWN"
        };
        items.push(item);
        used.add(em.cand.key);
        usedPos.push(em.cand.pos);
        t = item.end;
        pos = em.cand.pos;
        posKey = em.cand.key;
        posName = em.cand.name;
        mustSeeResults.push({
          id: em.ms.id, label: em.ms.label,
          status: chk.ok ? "scheduled" : "scheduled-with-hours-conflict",
          day: dayIdx + 1, item: em.cand.name, itemKey: em.cand.key
        });
        move(basePos, "base", baseName, "drive");
      }
    } else if (!skeletonDone && role !== "rest-morning") {
      // standard / arrival / rest-afternoon skeletons
      const anchor = addSimple(["museum", "market", "attraction"], LUNCH_TARGET + 30, null);
      addSimple(["park", "gallery", "historic", "viewpoint"], LUNCH_TARGET + 45, anchor?.kind ?? null);
      addLunch();
      if (role === "rest-afternoon") {
        items.push({ type: "rest", part: "afternoon", title: "Rest afternoon — nothing booked", start: t, end: 17 * 60, key: `rest-${date}` });
        t = 17 * 60;
      } else {
        // Party profile: young kids burn energy outdoors mid-day — the
        // post-lunch slot prefers open space over another hall.
        if (profile.energyBurn) {
          if (!addSimple(["park", "viewpoint", "attraction"], DAY_END - 45, null)) addSimple(["attraction", "museum", "gallery", "venue"], DAY_END - 45, null);
        } else addSimple(["attraction", "museum", "gallery", "venue"], DAY_END - 45, null);
        if (t <= 16 * 60) addSimple(["park"], DAY_END - 30, null);
      }
    } else if (!skeletonDone) {
      // rest-morning afternoon: one light stop after lunch
      addSimple(["park", "attraction", "historic"], DAY_END - 30, null);
    }
    // remaining matched 'stop' must-sees: force-schedule on this day if
    // not yet placed
    for (const m of matched.values()) {
      if (m.mode !== "stop" || !isFree(m.cand)) continue;
      if (mustSeeResults.some((r) => r.id === m.ms.id)) continue;
      // Continuity drills: a booking may pin a must-see to one day, and
      // a stated fact (rain) may close its candidate on a given day —
      // the force-placement honors both, exactly as it honors the
      // calendar.
      if (mustSeeDayPins && mustSeeDayPins[m.ms.id] != null && mustSeeDayPins[m.ms.id] !== dayIdx) continue;
      if (closedKeys && closedKeys.has(`${m.cand.key}@${dayIdx}`)) continue;
      if (isArrivalDay(dayIdx) || isDepartureDay(dayIdx)) continue; // envelope days are spoken for — a later day gets its chance
      if (!["standard", "ferry", "rest-morning"].includes(role)) continue; // must-sees land on FULL days only
      const hours = hoursFor(m.cand, date);
      const km = haversineKm(pos, m.cand.pos);
      if (km > 1.6) continue;
      paceFor(DURATIONS[m.cand.kind] || 45); // a forced stop obeys the same break cadence
      move(m.cand.pos, m.cand.key, m.cand.name, "walk");
      const chk = slotCheck(hours, t, DURATIONS[m.cand.kind] || 45);
      const item = addStop(m.cand, hours, chk.ok ? Math.max(t, chk.start) : t, "mustsee");
      mustSeeResults.push({ id: m.ms.id, label: m.ms.label, status: "scheduled", day: dayIdx + 1, item: item.name, itemKey: m.cand.key });
    }
    if (posKey !== "base") move(basePos, "base", baseName, posKey && haversineKm(pos, basePos) > 1.2 ? "drive" : "walk");
    items.sort((a, b) => a.start - b.start);
    // REST carries one soft suggestion; OPEN carries 2–3 unscheduled
    // ideas. Ideas are drawn from the pack near base, never consume
    // the ledger, and are soft-reserved so a later FULL day doesn't
    // schedule an "idea".
    let ideas: EngineDay["ideas"] = [];
    if (role === "rest-day" || role === "open-day") {
      const want = role === "rest-day" ? 1 : 3;
      const byKind = ["park", "market", "viewpoint", "historic", "attraction", "museum"];
      const chosenIdeas: { c: EngineCandidate; km: number }[] = [];
      for (const kind of byKind) {
        if (chosenIdeas.length >= want) break;
        const near = sights
          .filter((c) => c.kind === kind && !used.has(c.key) && !softUsed.has(c.key))
          .map((c) => ({ c, km: haversineKm(basePos, c.pos) }))
          .filter((x) => x.km <= 1.2)
          .sort((a, b) => a.km - b.km || a.c.name.localeCompare(b.c.name));
        if (near.length) chosenIdeas.push(near[0]);
      }
      ideas = chosenIdeas.map(({ c, km }) => {
        softUsed.add(c.key);
        return { key: c.key, name: c.name, kind: c.kind, km: +km.toFixed(2), walkMin: travelMin(km, "walk") };
      });
    }
    return {
      dayNumber: dayIdx + 1, date, role, dayType: dayTypeOf(dayIdx),
      items, legs, ideas, envelope, endMin: role === "open-day" ? 17 * 60 : t
    };
  }

  const days: EngineDay[] = [];
  for (let i = 0; i < nDays; i++) days.push(buildDay(i));

  // Dawn-flight departure: pack-up moves to the evening before, and
  // that evening winds down early — nothing runs against the early
  // start.
  if (journey?.departure && nDays >= 2) {
    const D = buildDeparture(journey.departure, { date: dates[nDays - 1] });
    if (D.packOnEve && D.packEveItem) {
      const eve = days[nDays - 2];
      eve.items.push(D.packEveItem);
      eve.items.sort((a, b) => a.start - b.start);
      eve.envelope = {
        ...(eve.envelope || {}),
        windDown: {
          by: D.eveWindDownBy,
          reason: `dawn flight tomorrow (${D.flightMin} min) — the evening ends early on purpose`
        }
      };
      notes.push(`${dates[nDays - 2]}: wind-down evening — pack-up done tonight, nothing scheduled late, for tomorrow's ${D.flightMin}-min dawn flight.`);
    }
  }

  // Any stop-mode must-see with no result yet: it may already BE in
  // the plan — a day's normal skeleton can pick the candidate before
  // the force block runs, and a promise kept by any path is kept.
  // Only a candidate that never made any day is unmet.
  for (const m of matched.values()) {
    if (m.mode !== "stop" || mustSeeResults.some((r) => r.id === m.ms.id)) continue;
    const sd = scheduledDay.get(m.cand.key);
    if (sd != null)
      mustSeeResults.push({ id: m.ms.id, label: m.ms.label, status: "scheduled", day: sd + 1, item: m.cand.name, itemKey: m.cand.key });
    else
      mustSeeResults.push({
        id: m.ms.id, label: m.ms.label, status: "unmet",
        reason: `candidate "${m.cand.name}" exists but no feasible slot remained (distance/geometry)`
      });
  }
  for (const m of [...excursionMs, ...ferryMs]) {
    if (!mustSeeResults.some((r) => r.id === m.ms.id)) {
      mustSeeResults.push({
        id: m.ms.id, label: m.ms.label, status: "unmet",
        reason: "no eligible day remained for the excursion/ferry slot"
      });
    }
  }
  return { days, mustSeeResults, notes, usedCount: used.size, arc: tripArc };
}

/* ================================================================== */
/* Evening remainder mode (owner fix, 2026-10-21).                    */
/* The daytime solver's skeleton caps the day at 17:30; a travel day   */
/* that breaks mid-afternoon (the travel-day spike's delayed arrival)  */
/* needs the REST of the day re-solved natively, in the evening:       */
/* post-17:00 slotting, a DINNER anchor (an evening meal starts no     */
/* earlier than 17:00 and is named Dinner by the clock), and timed     */
/* evening commitments (a prepaid cruise, a show) held PROTECTED —     */
/* keeps are sequenced around them, never into them.                   */
/*                                                                     */
/* spec: {                                                             */
/*   date, anchorMin, anchorPos, anchorName,                           */
/*   keeps: [{ key } | { meal: true }],           // what the day keeps */
/*   protectedItems: [{ key?, name, kind, start, end, pos, url? }],    */
/*   arriveProtectedByMin,   // be at the first protected item's place  */
/*                           // by then (default: its start - 15)      */
/*   hardEndMin,             // last keep ends by then (default: the    */
/*                           // first protected item's start)          */
/* }                                                                   */
/* Every ordering of the keeps is feasibility-checked with the same    */
/* primitives the day solver uses (hoursFor / slotCheck / DURATIONS /  */
/* travelMin). Returns { plans, close, chosen } under the spike's       */
/* pre-registered closeness rule: equal keeps + finish within 45 min   */
/* -> CLOSE (present both); chosen = most keeps, least walking,         */
/* earliest finish.                                                    */
/* ================================================================== */

export const DINNER_ANCHOR_MIN: number = DINNER_START;

export type EveningKeep = { key: string; role?: string } | { meal: true };

export interface EveningProtectedItem {
  key?: string;
  name: string;
  kind?: string;
  start: number;
  end: number;
  pos: EnginePos;
  url?: string;
}

export interface EveningSpec {
  date: LocalDate;
  anchorMin: number;
  anchorPos: EnginePos;
  anchorName?: string;
  keeps?: EveningKeep[];
  protectedItems?: EveningProtectedItem[];
  arriveProtectedByMin?: number | null;
  hardEndMin?: number | null;
  bufferBeforeProtectedMin?: number;
}

export interface EveningPlan {
  id: string;
  items: EngineItem[];
  legs: EngineLeg[];
  endMin: number;
  walkMin: number;
  legMin: number;
  arriveProtectedMin: number | null;
  label: string;
  score: { itemsKept: number; totalWalk: number; endMin: number };
}

export interface EveningResult {
  plans: EveningPlan[];
  close: boolean;
  chosen: EveningPlan | null;
}

export function solveEveningRemainder(pack: EnginePack, spec: EveningSpec): EveningResult {
  const {
    date,
    anchorMin,
    anchorPos,
    anchorName = "base",
    keeps = [],
    protectedItems = [],
    arriveProtectedByMin = null,
    hardEndMin = null,
    bufferBeforeProtectedMin = 15
  } = spec;
  const pools = [
    ...(pack.sights || []),
    ...(pack.excursions || []),
    ...(pack.transport || []),
    ...(pack.foods || [])
  ];
  const byKey = new Map(pools.map((c) => [c.key, c]));
  const foods = (pack.foods || []).map((c) => ({ ...c }));
  const prot0 = protectedItems[0] || null;
  const arriveBy = arriveProtectedByMin ?? (prot0 ? prot0.start - bufferBeforeProtectedMin : null);
  const endBy = hardEndMin ?? (prot0 ? prot0.start : null);

  // The evening meal pick: the day solver's lunch selection rule (best
  // dietary tier, known hours first, then nearest, then name) applied
  // at the dinner anchor — the meal starts at max(arrival, 17:00).
  const pickMeal = (fromPos: EnginePos, departMin: number, usedFoodKeys: Set<string>) => {
    const cands = foods
      .filter((f) => !usedFoodKeys.has(f.key))
      .map((f) => ({ f, tier: dietTier(f.tags), km: haversineKm(fromPos, f.pos) }))
      .filter((x) => x.km <= 1.8)
      .map((x) => {
        const mode = x.km > 1.2 ? "drive" : "walk";
        const legMin = travelMin(x.km, mode);
        const arrival = departMin + legMin;
        const hours = hoursFor(x.f, date);
        const chk = slotCheck(hours, Math.max(arrival, DINNER_ANCHOR_MIN), DURATIONS.food);
        return { ...x, mode, legMin, arrival, hours, chk };
      })
      .filter((x) => x.chk.ok)
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          (a.hours.status === "known" ? 0 : 1) - (b.hours.status === "known" ? 0 : 1) ||
          a.km - b.km ||
          a.f.name.localeCompare(b.f.name)
      );
    return cands[0] || null;
  };

  const sequence = (order: EveningKeep[]): Omit<EveningPlan, "id" | "score"> | null => {
    let t = anchorMin, pos = anchorPos, posKey = "anchor", posName = anchorName;
    const items: EngineItem[] = [], legs: EngineLeg[] = [];
    const usedFoodKeys = new Set<string>();
    const legTo = (destPos: EnginePos, destKey: string, destName: string) => {
      const km = haversineKm(pos, destPos);
      const mode = km > 1.2 ? "drive" : "walk";
      const minutes = travelMin(km, mode);
      legs.push({ fromKey: posKey, toKey: destKey, fromName: posName, toName: destName, mode, km, minutes, depart: t, arrive: t + minutes });
      return { km, mode, minutes };
    };
    for (const keep of order) {
      if ("meal" in keep && keep.meal) {
        const m = pickMeal(pos, t, usedFoodKeys);
        if (!m) return null;
        legTo(m.f.pos, m.f.key, m.f.name);
        const start = m.chk.start;
        const labels = dietLabels(m.f.tags);
        const item: EngineItem = {
          type: "food", key: m.f.key, name: m.f.name, kind: "food", role: "meal",
          mealName: mealNameFor(start),
          start, end: start + DURATIONS.food, pos: m.f.pos, hours: m.hours,
          hoursRaw: m.f.hoursRaw, url: m.f.url, price: "UNKNOWN",
          diet: {
            tier: m.tier, labels,
            strong: m.tier <= 1 && labels.length > 0,
            veganOnly: m.f.tags["diet:vegan"] === "only",
            evidenceText: labels.join(", ")
          }
        };
        items.push(item);
        usedFoodKeys.add(m.f.key);
        t = item.end;
        pos = m.f.pos;
        posKey = m.f.key;
        posName = m.f.name;
      } else if ("key" in keep) {
        const cand = byKey.get(keep.key);
        if (!cand) return null;
        const { minutes } = legTo(cand.pos, cand.key, cand.name);
        const arrival = t + minutes;
        const hours = hoursFor(cand, date);
        const chk = slotCheck(hours, arrival, DURATIONS[cand.kind] || 45);
        if (!chk.ok) return null;
        const start = Math.max(arrival, chk.start);
        const item: EngineItem = {
          type: "stop", key: cand.key, name: cand.name, kind: cand.kind, role: keep.role || "stop",
          start, end: start + (DURATIONS[cand.kind] || 45), pos: cand.pos, hours,
          hoursRaw: cand.hoursRaw, url: cand.url, price: "UNKNOWN"
        };
        items.push(item);
        t = item.end;
        pos = cand.pos;
        posKey = cand.key;
        posName = cand.name;
      }
    }
    if (endBy != null && t > endBy) return null;
    let arriveProtectedMin: number | null = null;
    if (prot0) {
      const { minutes } = legTo(prot0.pos, prot0.key || "protected", prot0.name);
      arriveProtectedMin = t + minutes;
      if (arriveBy != null && arriveProtectedMin > arriveBy) return null;
      for (const p of protectedItems)
        for (const i of items) {
          if (i.start < p.end && p.start < i.end) return null; // a keep may never land inside a protected commitment
        }
    }
    const walkMinTotal = legs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.minutes, 0);
    const legMin = legs.reduce((s, l) => s + l.minutes, 0);
    const partOf = (item: EngineItem): string =>
      item.type === "food" ? mealNameFor(item.start) : shortName(item.name);
    const label =
      items.length === 2
        ? `${partOf(items[0])} first, then ${items[1].type === "food" ? mealNameFor(items[1].start).toLowerCase() : partOf(items[1])}`
        : items.map(partOf).join(" → ");
    return { items, legs, endMin: t, walkMin: walkMinTotal, legMin, arriveProtectedMin, label };
  };

  const perms: EveningKeep[][] = [];
  const permute = (arr: EveningKeep[], prefix: EveningKeep[] = []): void => {
    if (!arr.length) {
      perms.push(prefix);
      return;
    }
    for (let i = 0; i < arr.length; i++)
      permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...prefix, arr[i]]);
  };
  permute(keeps);
  const plans: EveningPlan[] = [];
  for (const order of perms) {
    const plan = sequence(order);
    if (plan)
      plans.push({
        id: String.fromCharCode(65 + plans.length),
        ...plan,
        score: { itemsKept: plan.items.length, totalWalk: plan.legMin, endMin: plan.endMin }
      });
  }
  let close = false;
  if (plans.length === 2)
    close =
      plans[0].score.itemsKept === plans[1].score.itemsKept &&
      Math.abs(plans[0].endMin - plans[1].endMin) <= 45;
  const chosen =
    [...plans].sort(
      (a, b) =>
        b.score.itemsKept - a.score.itemsKept || a.score.totalWalk - b.score.totalWalk || a.endMin - b.endMin
    )[0] || null;
  return { plans, close, chosen };
}
