import { fmt } from "@/lib/roamly/engine/util";
import type { EngineItem } from "@/lib/roamly/engine/util";
import type { LocalDate, PlanMinutes } from "@/lib/roamly/engine/time";
import type { TravelersDTO } from "@/lib/roamly/engine/types";

/*
 * journey — the Journey Envelope + party profile (Phase 2 port of
 * the shadow zero-engine's journey.mjs; owner, 2026-10-21).
 *
 * THE problem the owner named: the itinerary pretended travelers
 * teleport to the first sight — no journey, no check-in, no
 * tiredness, no meals as essentials, no feelings. This module is the
 * deterministic fix for the journey half: the trip starts at the
 * traveler's front door and ends at the departure gate, and the
 * people in the spec set the tempo.
 *
 * Everything here is arithmetic over stated inputs. Where data is
 * absent the envelope says so — check-in defaults to a CONSERVATIVE
 * 15:00 labeled "assumed" (some hotels open rooms at 12:00, others
 * at 16:00; inventing an earlier room would be inventing the
 * traveler's afternoon).
 */

/* ------------------------------------------------------------------ */
/* Party profile — the spec's people drive the tempo.                  */
/* Derived deterministically from the pool entry (traveler counts,     */
/* the party sentence, access asks). Rules, the only place they live:  */
/*   walking budget / day   adult 7.0 km · mature(50s-60s) 5.5 ·       */
/*                          kids 4-11: 5.5 · infant/toddler: 4.5 ·     */
/*                          senior (elderly / 70+): 3.5                */
/*   max single leg         1.0 km (the solver's standing default) ·   */
/*                          senior 0.7 km                              */
/*   sit-down break every   adult 150 min · mature 135 · kids 120 ·    */
/*                          infant 105 · senior 90                     */
/*   max activity / day     adult 480 · mature 450 · kids 390 ·        */
/*                          infant 360 · senior 300 (minutes)          */
/* The most vulnerable traveler in the party sets each number (min).   */
/* Kids 4–11 also raise energyBurn: an open-space stop (park /         */
/* playground class) is preferred mid-day so energy burns outdoors,    */
/* not in a museum queue. Slope tolerance is 'low' for senior /        */
/* step-free parties — with no elevation data it expresses itself as   */
/* the shorter legs and budgets above, and is labeled as such.         */
/* ------------------------------------------------------------------ */

export interface PartyProfile {
  labels: string[];
  kidAges: number[];
  hasInfant: boolean;
  senior: boolean;
  mature: boolean;
  energyBurn: boolean;
  slopeTolerance: "low" | "normal";
  walkBudgetKm: { FULL: number; LIGHT: number } & Record<string, number>;
  maxLegKm: number;
  breakEveryMin: number;
  sitBreakMin: number;
  maxActivityMin: number;
}

/** The minimal party-source shape partyProfile reads (a pool entry /
 *  structured intake record): traveler counts plus the request's
 *  party sentence and access asks, as free text. */
export interface PartySource {
  travelers?: TravelersDTO;
  request?: { party?: string; access?: string[] };
}

const NUMWORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};

function wordNum(w: string | null | undefined): number | null {
  if (w == null) return null;
  if (/^\d+$/.test(w)) return Number(w);
  return NUMWORDS[String(w).toLowerCase()] ?? null;
}

export function partyProfile(entry: PartySource | null | undefined, requestText = ""): PartyProfile {
  const travelers: TravelersDTO = entry?.travelers || { adults: 2, children: 0, infants: 0 };
  const party = String(entry?.request?.party || "");
  const text = `${party} ${requestText}`.toLowerCase();
  const access = (entry?.request?.access || []).join(" ").toLowerCase();

  const kidAges: number[] = [];
  const aged = text.match(/aged?\s+([a-z0-9]+)(?:\s*(?:,|and)\s*([a-z0-9]+))?/);
  if (aged) {
    for (const g of [aged[1], aged[2]]) {
      const n = wordNum(g);
      if (n != null && n < 18) kidAges.push(n);
    }
  }
  const yo = text.match(/([a-z0-9]+)[ -]year[ -]old/);
  if (yo) {
    const n = wordNum(yo[1]);
    if (n != null && n < 18 && !kidAges.includes(n)) kidAges.push(n);
  }
  if (!kidAges.length && (travelers.children || 0) > 0) kidAges.push(8); // a child is declared but unaged — assume school-age, labeled below

  const hasInfant = (travelers.infants || 0) > 0 || /\b(baby|infant|toddler)\b/.test(text);
  const senior =
    /elderly|seventies|eighties|\b(7[0-9]|8[0-9])\s*(year|yr|-year)/.test(text) ||
    /elderly/.test(party.toLowerCase());
  const mature = !senior && /fifties|sixties|in (our|my) (50s|60s)/.test(text);
  const youngest = kidAges.length ? Math.min(...kidAges) : null;
  const hasYoungKid = kidAges.some((a) => a >= 4 && a <= 11);
  const stepFree = /step\s*free|few stairs|elevator|ground floor/.test(access) || /stroller/.test(access);

  interface Tier {
    walkFull: number;
    walkLight: number;
    breakEvery: number;
    maxActivity: number;
  }
  const tiers: Tier[] = [];
  tiers.push({ walkFull: 7.0, walkLight: 3.5, breakEvery: 150, maxActivity: 480 });
  if (mature) tiers.push({ walkFull: 5.5, walkLight: 3.0, breakEvery: 135, maxActivity: 450 });
  if (senior) tiers.push({ walkFull: 3.5, walkLight: 2.0, breakEvery: 90, maxActivity: 300 });
  if (hasYoungKid) tiers.push({ walkFull: 5.5, walkLight: 3.0, breakEvery: 120, maxActivity: 390 });
  if (hasInfant || (youngest != null && youngest <= 3))
    tiers.push({ walkFull: 4.5, walkLight: 2.5, breakEvery: 105, maxActivity: 360 });

  const labels: string[] = [];
  if (kidAges.length)
    labels.push(
      `children aged ${kidAges.join(" and ")}${(travelers.children || 0) > kidAges.length ? " (plus unaged child — school-age assumed)" : ""}`
    );
  if (hasInfant) labels.push("an infant in the party");
  if (senior) labels.push("an elderly traveler");
  if (mature) labels.push("travelers in their fifties/sixties");
  if (!labels.length) labels.push("adults, no tempo constraints stated");

  return {
    labels,
    kidAges,
    hasInfant,
    senior,
    mature,
    energyBurn: hasYoungKid,
    slopeTolerance: senior || stepFree ? "low" : "normal",
    walkBudgetKm: {
      FULL: Math.min(...tiers.map((t) => t.walkFull)),
      LIGHT: Math.min(...tiers.map((t) => t.walkLight))
    },
    maxLegKm: senior ? 0.7 : 1.0,
    breakEveryMin: Math.min(...tiers.map((t) => t.breakEvery)),
    sitBreakMin: senior ? 20 : 15,
    maxActivityMin: Math.min(...tiers.map((t) => t.maxActivity))
  };
}

export const BASE_PROFILE: PartyProfile = partyProfile({
  travelers: { adults: 2, children: 0, infants: 0 },
  request: {}
});

/* ------------------------------------------------------------------ */
/* Rest & refresh after a journey (owner's rule):                      */
/*   short hop < 2 h        optional 30 min, day shape untouched       */
/*   2–5 h                  ~1 h, then at most a LIGHT fill            */
/*   > 5 h or overnight     2 h+, then at most a LIGHT fill            */
/* "Journey" = door to door: leaving home -> standing at the hotel.    */
/* ------------------------------------------------------------------ */

export interface RestRule {
  minutes: number;
  cap: "LIGHT" | null;
  tier: string;
  optional?: boolean;
}

export function restRuleFor(journeyMin: number, overnight = false): RestRule {
  if (overnight || journeyMin > 300)
    return { minutes: 120, cap: "LIGHT", tier: overnight ? "overnight / red-eye" : "over 5 hours" };
  if (journeyMin >= 120) return { minutes: 60, cap: "LIGHT", tier: "2–5 hours" };
  return { minutes: 30, cap: null, tier: "under 2 hours", optional: true };
}

export const CHECKIN_DEFAULT_MIN: PlanMinutes = 15 * 60; // 15:00 — conservative, labeled assumed
export const CHECKOUT_DEFAULT_MIN: PlanMinutes = 11 * 60; // 11:00 — only a bound; departure math runs off the flight

/* ------------------------------------------------------------------ */
/* Arrival / departure chains                                          */
/* ------------------------------------------------------------------ */

export interface ArrivalJourneySpec {
  mode?: "fly" | "drive";
  leaveHomeMin: number;
  toAirportMin?: number;
  bufferMin?: number;
  travelMin: number;
  transferMin?: number;
  checkInMin?: number;
  checkInProvenance?: string;
  overnight?: boolean;
}

export interface ArrivalChain {
  items: EngineItem[];
  arriveBaseMin: number;
  checkInMin: number;
  effCheckInMin: number;
  checkInProvenance: string;
  journeyMin: number;
  rest: RestRule;
  waitWindow: [number, number] | null;
  checkInItem: EngineItem;
  restItem: (start: number) => EngineItem;
}

/**
 * The arrival chain for a fly/drive-in day. All times are stated inputs
 * (a booking's facts in production; a labeled scenario here).
 * Returns the timed items plus the windows the solver fills around.
 */
export function buildArrival(
  journey: ArrivalJourneySpec,
  opts: { date: LocalDate; baseName: string }
): ArrivalChain {
  const { date, baseName } = opts;
  const mode = journey.mode || "fly";
  const t0 = journey.leaveHomeMin;
  const items: EngineItem[] = [];
  let t = t0;
  const leg = (part: string, title: string, dur: number, sub?: string): void => {
    items.push({
      type: "journey",
      part,
      title,
      start: t,
      end: t + dur,
      key: `journey-${part}-${date}`,
      sub: sub || null,
      pos: null
    });
    t += dur;
  };
  if (mode === "fly") {
    leg("to-airport", "To the airport", journey.toAirportMin ?? 45, "leave home — the trip starts at your own door");
    leg("buffer", "Airport buffer", journey.bufferMin ?? 90, "check in, security, and time to breathe — never cut");
    leg("travel", "Flight", journey.travelMin);
  } else {
    leg("travel", "The drive in", journey.travelMin, "the road is part of the journey, not a gap in it");
  }
  leg("transfer", `Transfer to ${baseName}`, journey.transferMin ?? 40, "arrival transfer — bags in hand");
  const arriveBaseMin = t;
  const checkInMin = journey.checkInMin ?? CHECKIN_DEFAULT_MIN;
  const checkInProvenance =
    journey.checkInMin != null
      ? journey.checkInProvenance || "hotel/booking data"
      : "assumed — conservative 15:00 default; no hotel data in the open sources, and an earlier room is never invented";
  // Arriving after the room opens is normal: check-in happens on arrival.
  const effCheckInMin = Math.max(checkInMin, arriveBaseMin);
  const journeyMin = arriveBaseMin - t0;
  const rest = restRuleFor(journeyMin, !!journey.overnight);
  return {
    items,
    arriveBaseMin,
    checkInMin,
    effCheckInMin,
    checkInProvenance,
    journeyMin,
    rest,
    waitWindow: effCheckInMin > arriveBaseMin ? [arriveBaseMin, effCheckInMin] : null,
    checkInItem: {
      type: "checkin",
      part: "checkin",
      title: `Check in — ${baseName}`,
      start: effCheckInMin,
      end: effCheckInMin + 15,
      key: `checkin-${date}`,
      sub: `room from ${fmt(checkInMin)} · ${checkInProvenance}`,
      pos: null
    },
    restItem: (start: number): EngineItem => ({
      type: "rest",
      part: "refresh",
      title: "Rest & refresh — travel takes something out of you",
      start,
      end: start + rest.minutes,
      key: `refresh-${date}`
    })
  };
}

export interface DepartureJourneySpec {
  flightMin: number;
  transferMin?: number;
  bufferMin?: number;
}

export interface DepartureChain {
  flightMin: number;
  transferMin: number;
  bufferMin: number;
  leaveBaseMin: number;
  checkOutMin: number;
  packMin: number;
  packOnEve: boolean;
  packWindow: [number, number] | null;
  gentleUntil: number | null;
  emptyMorning: boolean;
  eveWindDownBy: number;
  packEveItem: EngineItem | null;
  items: (packStart: number | null) => EngineItem[];
}

/**
 * The departure shape for the last day, derived backwards from the
 * flight: pack-up (45 min, protected) -> checkout -> transfer -> buffer
 * -> wheels up. A dawn flight pushes pack-up to the evening before and
 * empties the last morning entirely.
 */
export function buildDeparture(
  journey: DepartureJourneySpec,
  opts: { date: LocalDate }
): DepartureChain {
  const { date } = opts;
  const flightMin = journey.flightMin;
  const transferMin = journey.transferMin ?? 40;
  const bufferMin = journey.bufferMin ?? 90;
  const leaveBaseMin = flightMin - bufferMin - transferMin;
  const checkOutMin = leaveBaseMin - 15;
  const packMin = 45;
  const packOnEve = leaveBaseMin < 8 * 60;
  return {
    flightMin,
    transferMin,
    bufferMin,
    leaveBaseMin,
    checkOutMin,
    packMin,
    packOnEve,
    packWindow: packOnEve ? null : [checkOutMin - packMin, checkOutMin],
    gentleUntil: packOnEve ? null : checkOutMin - packMin - 15,
    emptyMorning: flightMin < 10 * 60,
    eveWindDownBy: 21 * 60,
    packEveItem: packOnEve
      ? {
          type: "pack",
          part: "pack",
          title: "Pack up tonight — dawn start tomorrow",
          start: 19 * 60 + 30,
          end: 20 * 60 + 15,
          key: `pack-eve-${date}`,
          sub: "the flight is early; the bags close tonight so the morning is only essentials",
          pos: null
        }
      : null,
    items: (packStart: number | null): EngineItem[] => {
      const out: EngineItem[] = [];
      if (!packOnEve && packStart != null)
        out.push({
          type: "pack",
          part: "pack",
          title: "Pack up — close the bags, check the room",
          start: packStart,
          end: checkOutMin,
          key: `pack-${date}`,
          sub: "protected time: nothing is scheduled against it",
          pos: null
        });
      out.push({
        type: "checkout",
        part: "checkout",
        title: "Check out",
        start: checkOutMin,
        end: leaveBaseMin,
        key: `checkout-${date}`,
        sub: null,
        pos: null
      });
      out.push({
        type: "transfer",
        part: "transfer",
        title: "Transfer to the airport",
        start: leaveBaseMin,
        end: leaveBaseMin + transferMin,
        key: `transfer-${date}`,
        sub: `leaves ${fmt(leaveBaseMin)} for a ${fmt(flightMin)} flight — ${transferMin} min transfer + ${bufferMin} min buffer, never cut`,
        pos: null
      });
      return out;
    }
  };
}

export interface JourneyEnvelopeSpec {
  arrival?: ArrivalJourneySpec;
  departure?: DepartureJourneySpec;
}
