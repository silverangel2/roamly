import type { GeoPointDTO } from "@/lib/roamly/engine/types";
import type { LocalDate, PlanMinutes } from "@/lib/roamly/engine/time";
import {
  addCalendarDays,
  minutesToClock,
  weekdayOf as weekdayIndexOf
} from "@/lib/roamly/engine/time";
import type { PriceEvidenceRecord } from "@/lib/roamly/engine/prices";

/*
 * util — shared deterministic utilities for the TS domain core
 * (Phase 2 port of the shadow zero-engine's util.mjs).
 *
 * Plain arithmetic and parsing only. No external calls live here.
 * Clock/date primitives delegate to the Phase 1 time adapter
 * (time.ts) wherever the adapter already carries the shadow
 * semantics, so "date + minutes" never stays ambiguous: a plan date
 * is a trip-local civil date (LocalDate) and a plan time is minutes
 * after trip-local midnight (PlanMinutes).
 *
 * This module also carries the engine's WORKING types (EnginePack,
 * EngineCandidate, EngineItem, EngineDay) — the solver-shaped
 * records the core passes between its own stages. They are the
 * in-memory domain shapes, deliberately distinct from the Phase 1
 * boundary DTOs in types.ts: application services translate between
 * the two at the wiring boundary.
 */

/* ------------------------------------------------------------------ */
/* Working types                                                       */
/* ------------------------------------------------------------------ */

export type EnginePos = GeoPointDTO;

/** Google enrichment as the solver/judges read it (fixture or live
 *  provenance rides in `source`). Attached to pack candidates by the
 *  enrichment stage (Phase 4 in production); the core only reads. */
export interface EngineGoogleData {
  source: string;
  priceLevel: string | null;
  rating: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  wheelchairEntrance?: boolean | null;
  hoursByDay?: Record<string, { open: number; close: number }>;
  fetchedAt?: string;
  refreshDue?: string;
}

export interface EngineCandidate {
  key: string;
  name: string;
  kind: string;
  pos: EnginePos;
  hoursRaw: string | null;
  tags: Record<string, string>;
  url: string;
  google?: EngineGoogleData | null;
}

export interface EngineWeatherDay {
  date: LocalDate;
  tMax?: number | null;
  tMin?: number | null;
  precipProb: number | null;
}

export interface EnginePack {
  destination: string;
  country: string;
  center: EnginePos;
  startIso?: LocalDate;
  endIso?: LocalDate;
  counts: {
    total: number;
    sights: number;
    foods: number;
    stays: number;
    transport: number;
  };
  stays: EngineCandidate[];
  sights: EngineCandidate[];
  excursions: EngineCandidate[];
  foods: EngineCandidate[];
  transport: EngineCandidate[];
  weather: EngineWeatherDay[];
}

export type EngineHours =
  | { status: "known"; open: number; close: number; provenance?: string; raw?: string }
  | { status: "closed"; provenance?: string; raw?: string }
  | { status: "unknown"; provenance?: string; raw?: string };

export interface EngineDietInfo {
  tier: number;
  labels: string[];
  strong: boolean;
  veganOnly: boolean;
  evidenceText: string;
}

export interface EngineItem {
  type: string;
  key?: string;
  name?: string;
  title?: string;
  sub?: string | null;
  part?: string;
  kind?: string;
  role?: string;
  start: number;
  end: number;
  pos?: EnginePos | null;
  hours?: EngineHours;
  hoursRaw?: string | null;
  url?: string;
  /** The shadow sentinel: items never carry an invented price. */
  price?: string;
  priceEvidence?: PriceEvidenceRecord;
  priceBand?: { level: string; source: string };
  google?: EngineGoogleData;
  diet?: EngineDietInfo;
  mealName?: string;
  repeat?: boolean;
  firstDay?: number;
  interruptible?: boolean;
  protected?: boolean;
  /** Reflow option items carry their walk provenance openly. */
  walkKmFromPrev?: number;
  fromKeyPrev?: string;
  fromNamePrev?: string;
  priceProvenance?: string;
  /** MOVE-day items carry their endpoints (pacing buildMoveDay). */
  fromName?: string;
  toName?: string;
}

export interface EngineLeg {
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
  mode: string;
  km: number;
  minutes: number;
  depart: number;
  arrive: number;
  departTime?: string;
  arriveTime?: string;
}

export interface EngineIdea {
  key: string;
  name: string;
  kind: string;
  km: number;
  walkMin: number;
}

export interface ArrivalEnvelope {
  journeyMin: number;
  arriveBaseMin: number;
  checkInMin: number;
  checkInProvenance: string;
  restMinutes: number;
  restTier?: string;
  cap?: string | null;
  mode?: string;
  via?: string;
  reflowed?: string;
}

export interface DepartureEnvelope {
  flightMin: number;
  leaveBaseMin: number;
  packOnEve: boolean;
  emptyMorning: boolean;
}

export interface EngineEnvelope {
  arrival?: ArrivalEnvelope;
  departure?: DepartureEnvelope;
  windDown?: { by: number; reason: string };
}

export interface SeamRecord {
  day: number;
  fromBase: string;
  toBase: string;
  checkoutMin: number;
  transferStart: number;
  transferEnd: number;
  checkInMin: number;
  checkInLabel: string;
  restEndMin: number | null;
  luggageNote: string;
  orphanMin: number;
  chain: string;
}

export interface EngineDay {
  dayNumber: number;
  date: LocalDate;
  role: string;
  dayType?: string;
  items: EngineItem[];
  legs: EngineLeg[];
  ideas?: EngineIdea[];
  envelope?: EngineEnvelope | null;
  move?: { fromName: string; toName: string };
  seam?: SeamRecord | null;
  narrative?: string[];
  reflow?: { earlyCheckIn?: boolean; lateCheckIn?: boolean; roomReadyMin?: number };
  endMin: number;
}

/* ------------------------------------------------------------------ */
/* Geometry + travel time                                              */
/* ------------------------------------------------------------------ */

export const WALK_KMH = 4.5;
export const ROAD_KMH = 40;

export function coordsOf(e: { lat?: number; lon?: number; center?: EnginePos }): EnginePos {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lon: e.lon };
  if (e.center) return { lat: e.center.lat, lon: e.center.lon };
  throw new Error("coordsOf: element carries neither lat/lon nor a center");
}

export function osmUrl(e: { type: string; id: string | number }): string {
  return `https://www.openstreetmap.org/${e.type}/${e.id}`;
}

export function haversineKm(a: EnginePos, b: EnginePos): number {
  const R = 6371, p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p, dLon = (b.lon - a.lon) * p;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const walkMin = (km: number): number => Math.max(2, Math.ceil((km / WALK_KMH) * 60));
export const roadMin = (km: number): number => Math.max(3, Math.ceil((km / ROAD_KMH) * 60));
export const travelMin = (km: number, mode: string): number =>
  mode === "drive" ? roadMin(km) : walkMin(km);

/* ------------------------------------------------------------------ */
/* Clock + civil dates (via the Phase 1 time adapter)                  */
/* ------------------------------------------------------------------ */

/** Minutes after midnight -> "HH:MM" (hours may exceed 23). */
export const fmt = (min: number): string => minutesToClock(min);

export const WEEKDAY_CODES: readonly string[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Two-letter weekday code for a civil date (shadow weekdayOf). */
export function weekdayOf(iso: LocalDate): string {
  return WEEKDAY_CODES[weekdayIndexOf(iso)];
}

/** Civil-date add (shadow isoPlus) — pure Y/M/D arithmetic. */
export const isoPlus = (iso: LocalDate, days: number): LocalDate => addCalendarDays(iso, days);

export const dateLong = (iso: LocalDate): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });

export function parseHhmm(value: unknown): PlanMinutes | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/* ------------------------------------------------------------------ */
/* Meal naming by the clock (owner fix, 2026-10-21): a meal's name is */
/* a fact about WHEN it happens, everywhere it is named — solver,     */
/* composer, cards, briefs. A meal at 17:17 is Dinner, and no surface  */
/* may call it Lunch. Windows: Breakfast before 10:30, Lunch from     */
/* 10:30, Dinner from 17:00.                                          */
/* ------------------------------------------------------------------ */

export const BREAKFAST_END = 10 * 60 + 30;
export const DINNER_START = 17 * 60;

export function mealNameFor(startMin: number | null | undefined): "Breakfast" | "Lunch" | "Dinner" {
  if (startMin == null) return "Lunch";
  if (startMin < BREAKFAST_END) return "Breakfast";
  if (startMin < DINNER_START) return "Lunch";
  return "Dinner";
}

/* ------------------------------------------------------------------ */
/* Opening-hours parser (subset of the OSM opening_hours syntax).     */
/* Anything unparseable -> UNKNOWN. Never guessed.                    */
/* ------------------------------------------------------------------ */

const DAY_IDX: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };

export type ParsedHours =
  | { status: "known"; open: number; close: number }
  | { status: "closed"; raw: string }
  | { status: "unknown"; raw?: string };

export function parseHoursForDay(raw: string | null | undefined, weekday: string): ParsedHours {
  if (!raw) return { status: "unknown" };
  const s = String(raw).trim();
  if (s === "24/7") return { status: "known", open: 0, close: 24 * 60 };
  const target = DAY_IDX[weekday];
  let result: ParsedHours | null = null;
  for (const partRaw of s.split(";")) {
    const part = partRaw.trim();
    if (!part) continue;
    const m = part.match(
      /^(?:((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+)?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/
    );
    if (!m) return { status: "unknown", raw };
    const days = new Set<number>();
    if (m[1]) {
      for (const tok of m[1].split(",")) {
        const t = tok.trim();
        if (t.includes("-")) {
          const [a, b] = t.split("-").map((x) => DAY_IDX[x.trim()]);
          if (a == null || b == null) return { status: "unknown", raw };
          for (let d = a; ; d = (d + 1) % 7) {
            days.add(d);
            if (d === b) break;
          }
        } else days.add(DAY_IDX[t]);
      }
    } else {
      for (let d = 0; d < 7; d++) days.add(d);
    }
    if (days.has(target)) {
      result = { status: "known", open: Number(m[2]) * 60 + Number(m[3]), close: Number(m[4]) * 60 + Number(m[5]) };
    }
  }
  return result ?? { status: "closed", raw };
}

/* ------------------------------------------------------------------ */
/* Short display names: full name on first mention, short after.      */
/* ------------------------------------------------------------------ */

const NAME_PREFIXES = [
  "Lieu historique national du ",
  "Lieu historique national des ",
  "Lieu historique national de ",
  "National Historic Site of ",
  "The "
];

export function shortName(name: unknown): string {
  let n = String(name ?? "");
  for (const p of NAME_PREFIXES) {
    if (n.startsWith(p)) {
      n = n.slice(p.length);
      break;
    }
  }
  if (n.length > 34) {
    const cut = Math.max(
      n.lastIndexOf(" des "),
      n.lastIndexOf(" du "),
      n.lastIndexOf(" de "),
      n.lastIndexOf(" of ")
    );
    if (cut > 4) n = n.slice(cut + 4);
  }
  if (n.length > 34) {
    const comma = n.indexOf(",");
    if (comma > 6) n = n.slice(0, comma);
  }
  return n.length > 38 ? n.slice(0, 37).trimEnd() + "…" : n;
}

/* ------------------------------------------------------------------ */
/* English number words -> value (for "under nine hundred dollars").  */
/* ------------------------------------------------------------------ */

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90
};

export function parseNumberWords(text: unknown): number | null {
  const tokens = String(text ?? "")
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let total = 0, current = 0, seen = false;
  for (const tok of tokens) {
    if (tok in SMALL) {
      current += SMALL[tok];
      seen = true;
    } else if (tok in TENS) {
      current += TENS[tok];
      seen = true;
    } else if (tok === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (tok === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      seen = true;
    } else if (tok === "and") {
      /* skip */
    } else break;
  }
  return seen ? total + current : null;
}

export const slug = (s: unknown): string =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const normText = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
