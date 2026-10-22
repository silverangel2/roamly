import { fmt, haversineKm, travelMin } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem } from "@/lib/roamly/engine/util";
import { BASE_PROFILE } from "@/lib/roamly/engine/journey";
import type { PartyProfile } from "@/lib/roamly/engine/journey";

/*
 * judges — the Make-Sense judges (Phase 2 port of the shadow
 * zero-engine's judges.mjs): a deterministic release gate.
 *
 * Nothing reaches the traveler unless the arithmetic coheres: times
 * are possible, distances are possible, every item is grounded in
 * the data, and the request's verdicts are attached. The gate FAILS
 * on hard violations; things the data cannot prove are warnings,
 * never hidden.
 *
 * Journey-envelope items (journey legs, check-in, pack-up, checkout,
 * transfer, move blocks) are logistics, not activities — they are
 * exempt from grounding, earliest-start, and the day-end cap (a dawn
 * pack-up is early on purpose). Meals and breaks are essentials: the
 * gate FAILS a plan that starves the traveler (a waking span over
 * 5 h with no meal) or never rests them (an activity span far beyond
 * the party's break cadence with no pause at all).
 *
 * GATE PROFILES (DESIGN-PRODUCTION Phase 2 — the one deliberate
 * behavior split): the shadow gate assumes every grounded item has
 * an OSM key/url and that any carried price is a fabrication. Those
 * are ENGINE-plan rules.
 *   - "engine-plan" (default): the shadow gate, verbatim.
 *   - "production-booking": real bookings are never rejected for
 *     lacking an OSM URL or carrying a real price — an item carrying
 *     a booking reference is exempt from the grounding and
 *     carried-price failures (its truth is the booking, not the
 *     pack). Every other check is identical in both profiles.
 */

export const LOGISTICS_TYPES: ReadonlySet<string> = new Set([
  "journey",
  "checkin",
  "checkout",
  "pack",
  "transfer",
  "move"
]);
const MEAL_GAP_LIMIT = 300; // minutes of waking day with no meal window

export type GateProfile = "engine-plan" | "production-booking";

export interface JudgeTripOptions {
  earliestMin: number;
  dayEndLimit?: number;
  profile?: PartyProfile;
  gateProfile?: GateProfile;
}

export interface JudgeTripResult {
  pass: boolean;
  hardViolations: string[];
  warnings: string[];
}

/** Judge-side item: the engine item plus the production booking
 *  reference a real booking carries (ItineraryItemDTO field). */
export interface JudgeItem extends EngineItem {
  bookingReference?: string | null;
}

export interface JudgeDay extends Omit<EngineDay, "items"> {
  items: JudgeItem[];
}

export function judgeTrip(days: JudgeDay[], opts: JudgeTripOptions): JudgeTripResult {
  const {
    earliestMin,
    dayEndLimit = 17 * 60 + 30,
    profile = BASE_PROFILE,
    gateProfile = "engine-plan"
  } = opts;
  const hard: string[] = [], warnings: string[] = [];
  for (const day of days) {
    const items = [...day.items].sort((a, b) => a.start - b.start);
    // grounding: every scheduled thing must trace to a data element
    for (const item of items) {
      if (item.type === "rest" || LOGISTICS_TYPES.has(item.type)) continue;
      // production-booking profile: a real booking's grounding is the
      // booking itself — no OSM URL is required, and its real price
      // is a fact, not a fabrication.
      const isBooking = gateProfile === "production-booking" && !!item.bookingReference;
      if (!isBooking && (!item.url || !item.key))
        hard.push(`day ${day.dayNumber}: "${item.name}" has no data source — ungrounded items cannot exist`);
      if (!isBooking && item.price !== "UNKNOWN" && item.price != null)
        hard.push(`day ${day.dayNumber}: "${item.name}" carries a price the data never provided`);
      // WS-PRICES: price EVIDENCE is a separate record, never a price.
      // If it rides on an item it must be well-formed and labeled: a
      // known tier, a basis, and for BAND/COSTED a true range labeled
      // ESTIMATED — a range may never be a disguised point price.
      if (item.priceEvidence) {
        const ev = item.priceEvidence;
        if (!["VERIFIED", "BAND", "COSTED", "UNKNOWN"].includes(ev.tier))
          hard.push(`day ${day.dayNumber}: "${item.name}" carries price evidence with an unknown tier`);
        if (!ev.basis)
          hard.push(`day ${day.dayNumber}: "${item.name}" carries price evidence with no basis — evidence must be labeled`);
        if (
          (ev.tier === "BAND" || ev.tier === "COSTED") &&
          (!ev.range || ev.range.high <= ev.range.low || !/ESTIMATED/.test(ev.basis))
        )
          hard.push(`day ${day.dayNumber}: "${item.name}" carries ${ev.tier} evidence that is not a labeled ESTIMATED range`);
        if (ev.tier === "UNKNOWN" && ev.range)
          hard.push(`day ${day.dayNumber}: "${item.name}" is UNKNOWN-tier yet carries a range — unknown means unknown`);
      }
    }
    // no overlaps, starts/ends sane
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type !== "rest" && !LOGISTICS_TYPES.has(it.type) && it.start < earliestMin)
        hard.push(`day ${day.dayNumber}: "${it.name}" starts ${fmt(it.start)}, before the earliest allowed ${fmt(earliestMin)}`);
      if (it.type !== "rest" && !LOGISTICS_TYPES.has(it.type) && it.end > dayEndLimit + 60)
        hard.push(`day ${day.dayNumber}: "${it.name}" ends ${fmt(it.end)}, past any sane family day`);
      if (i > 0 && it.start < items[i - 1].end)
        hard.push(
          `day ${day.dayNumber}: "${it.name || it.title}" (${fmt(it.start)}) overlaps "${items[i - 1].name || items[i - 1].title}" (ends ${fmt(items[i - 1].end)})`
        );
      if (it.hours?.status === "known" && (it.start < it.hours.open || it.end > it.hours.close)) {
        hard.push(`day ${day.dayNumber}: "${it.name}" is scheduled outside its listed hours`);
      }
      if (it.hours?.status === "unknown")
        warnings.push(`day ${day.dayNumber}: "${it.name}" — opening hours not in the data (labeled, not invented)`);
      if (it.hours?.status === "closed")
        hard.push(`day ${day.dayNumber}: "${it.name}" is listed closed that day`);
    }
    // travel feasibility: consecutive positioned items need enough gap
    const positioned = items.filter((i) => i.pos);
    for (let i = 1; i < positioned.length; i++) {
      const prev = positioned[i - 1], cur = positioned[i];
      if (!prev.pos || !cur.pos) continue;
      const km = haversineKm(prev.pos, cur.pos);
      const mode = km > 1.2 ? "drive" : "walk";
      const need = travelMin(km, mode);
      const gap = cur.start - prev.end;
      if (gap < need)
        hard.push(
          `day ${day.dayNumber}: only ${gap} min between "${prev.name}" and "${cur.name}" but the ${km.toFixed(1)} km ${mode} needs ~${need} min`
        );
    }
    // repeats are judged in gradeRequirements; here: within-day
    // duplicates
    const names = items
      .filter((i) => i.type !== "rest" && !LOGISTICS_TYPES.has(i.type))
      .map((i) => (i.name || "").toLowerCase());
    if (new Set(names).size !== names.length)
      hard.push(`day ${day.dayNumber}: a place appears twice in one day`);

    /* ---- meals & breaks are essentials: starve / never-rest checks ----
       Quiet day shapes (REST / OPEN / a full-day rest) carry no timed
       slate at all — the traveler eats and rests on their own time
       and the plan does not pretend otherwise. */
    const quietDay =
      day.dayType === "REST" ||
      day.dayType === "OPEN" ||
      items.some((i) => i.type === "rest" && i.part === "day");
    const waking = items.filter(
      (i) => !LOGISTICS_TYPES.has(i.type) && !(i.type === "rest" && i.part === "day")
    );
    if (!quietDay && waking.length) {
      const isMeal = (i: JudgeItem): boolean => i.type === "food" || (i.type === "rest" && i.part === "meal");
      // A ferry crossing is seated time by nature — it gives rest even
      // though it is also the day's adventure.
      const isRestGiver = (i: JudgeItem): boolean => isMeal(i) || i.type === "rest" || i.kind === "ferry";
      const spanStart = waking[0].start, spanEnd = waking[waking.length - 1].end;
      // starve: no waking span over 5 h without a meal window
      const meals = waking.filter(isMeal);
      if (!meals.length) {
        if (spanEnd - spanStart > MEAL_GAP_LIMIT)
          hard.push(`day ${day.dayNumber}: ${spanEnd - spanStart} min of planned day with no meal at all — the plan starves the traveler`);
      } else {
        let prevEnd = spanStart;
        for (const m of meals) {
          if (m.start - prevEnd > MEAL_GAP_LIMIT)
            hard.push(`day ${day.dayNumber}: ${m.start - prevEnd} min between ${fmt(prevEnd)} and the meal at ${fmt(m.start)} — over the 5 h hunger limit`);
          prevEnd = Math.max(prevEnd, m.end);
        }
        if (spanEnd - prevEnd > MEAL_GAP_LIMIT)
          hard.push(`day ${day.dayNumber}: ${spanEnd - prevEnd} min after the last meal with the day still running — over the 5 h hunger limit`);
      }
      // never rests: an activity span far beyond the break cadence
      // with no rest-giver (meal, pause, rest block) inside it. An
      // idle gap of 30+ min between items is de facto rest — the
      // traveler is unscheduled then, and unscheduled time is not
      // exertion.
      const restLimit = profile.breakEveryMin + 45;
      let segStart: number | null = null, prevEnd: number | null = null;
      for (const it of waking) {
        if (isRestGiver(it)) {
          if (segStart != null && it.start - segStart > restLimit)
            hard.push(`day ${day.dayNumber}: ${it.start - segStart} min of unbroken activity before "${it.title || it.name}" — this party needs a pause every ~${profile.breakEveryMin} min`);
          segStart = null;
        } else {
          if (segStart == null) segStart = it.start;
          else if (prevEnd != null && it.start - prevEnd >= 30) segStart = it.start;
        }
        prevEnd = Math.max(prevEnd ?? it.end, it.end);
      }
      if (segStart != null && spanEnd - segStart > restLimit)
        hard.push(`day ${day.dayNumber}: ${spanEnd - segStart} min of unbroken activity to close the day — this party needs a pause every ~${profile.breakEveryMin} min`);
    }

    /* ---- the room wait is sacred (owner hard rule, 2026-10-21) ----
       A room-wait window may never contain a protected or timed
       commitment. Wait content — a settle block, a meal window, an
       unbooked lunch the solver explicitly marks interruptible — must
       be abandonable mid-minute, so an early room costs the traveler
       nothing to accept. Anything else living in the wait fails. */
    const envA = day.envelope?.arrival;
    if (envA && envA.arriveBaseMin != null && envA.checkInMin > envA.arriveBaseMin) {
      for (const it of items) {
        if (it.start == null || it.end == null) continue;
        if (!(it.start < envA.checkInMin && it.end > envA.arriveBaseMin)) continue;
        if (LOGISTICS_TYPES.has(it.type) || it.type === "rest") continue;
        if (it.type === "food" && it.interruptible) continue;
        hard.push(
          `day ${day.dayNumber}: "${it.name || it.title}" (${fmt(it.start)}–${fmt(it.end)}) sits inside the room wait (${fmt(envA.arriveBaseMin)}–${fmt(envA.checkInMin)}) — wait content must be interruptible by design; no protected or timed commitment may live in a room wait`
        );
      }
    }
  }
  return { pass: hard.length === 0, hardViolations: hard, warnings };
}
