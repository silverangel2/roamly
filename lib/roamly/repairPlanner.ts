/*
 * Phase 9 — BOUNDED REPAIR PLANNER (DESIGN-PRODUCTION.md Phase 9;
 * audit resolution C8: the planner is ported, apply is redesigned
 * transactionally in updater.ts).
 *
 * The planner takes a production-shaped live day + a disruption and
 * produces judge-validated repair proposals by the rules the travel-
 * day spike proved:
 *   · the affected set is computed from the FULL day state — every
 *     item's times, state, and protection flags. It is NEVER built by
 *     matching title/description keywords. (The production V1 filter
 *     in companionImpactAnalysis.ts read `title || description`, so
 *     the spike day's lunch and Citadel never entered its affected
 *     set at all; that defect is fixed there and is not reproduced
 *     here. chain.mjs — which preserves the defect — is not ported.)
 *   · fixed past is untouchable (production's BLOCKED_ITEM_STATES,
 *     companionShiftTiming.ts); started/finished items never move.
 *   · paid / prepaid / booking-anchored commitments are anchors,
 *     never targets.
 *   · the day anchor is the traveler's BOOKED stay (then a traveler-
 *     selected stay, then an explicitly labeled destination-centre
 *     fallback). A candidate's score is never consulted — the engine
 *     never silently "chooses a hotel" by geometry or rating.
 *   · the remainder is RE-SOLVED (permutation walk over the day's own
 *     surviving items + a solver meal pick, feasibility-checked with
 *     the Phase 2 core's primitives: hours windows, durations,
 *     haversine travel times) — never shifted by a bare delta.
 *   · the permutation search is BOUNDED: exact enumeration only up
 *     to the evaluation cap; beyond it a chronological-insertion
 *     heuristic runs under the same cap, and the bound (strategy,
 *     evaluations, cap, truncation) is recorded on the proposal.
 *   · every presented plan passes judgeTrip on the full repaired day
 *     AND on the remainder-from-anchor, under the production-booking
 *     gate profile (real bookings are never rejected for lacking an
 *     OSM URL or carrying a real price).
 *   · a repair is a PROPOSAL: nothing in this module mutates the day.
 */

import { createHash } from "node:crypto";

import type { LocalDate, PlanMinutes } from "@/lib/roamly/engine/time";
import { fmt, haversineKm, travelMin } from "@/lib/roamly/engine/util";
import type { EngineHours, EnginePack, EnginePos } from "@/lib/roamly/engine/util";
import { judgeTrip } from "@/lib/roamly/engine/judges";
import type { JudgeDay, JudgeItem } from "@/lib/roamly/engine/judges";
import { solveEveningRemainder } from "@/lib/roamly/engine/solver";
import { DURATIONS } from "@/lib/roamly/engine/solver";

/* ------------------------------------------------------------------ */
/* Live day model — the production full_json daily_itinerary shape,    */
/* normalized: a day's items are its live_timeline rows.               */
/* ------------------------------------------------------------------ */

export interface LiveItemStay {
  name: string;
  /** The traveler holds a confirmed booking for this stay. */
  booked: boolean;
  /** The traveler picked this stay themselves (no booking yet). */
  selectedByTraveler: boolean;
  /** Candidate score — carried for provenance, NEVER an anchor input. */
  score?: number;
  pos?: EnginePos | null;
}

export interface LiveItem {
  item_id: string;
  title: string;
  name?: string;
  item_type?: string;
  kind?: string;
  key?: string;
  /** Minutes after trip-local midnight (canonical geometry). */
  start: PlanMinutes;
  end: PlanMinutes;
  startTime: string; // "HH:MM"
  endTime: string;
  state?: string;
  status?: string;
  date?: LocalDate;
  startMin?: PlanMinutes;
  endMin?: PlanMinutes;
  place?: string | null;
  address?: string | null;
  provider?: string | null;
  pos?: EnginePos | null;
  url?: string;
  hours?: EngineHours;
  price?: unknown;
  paid?: boolean;
  prepaid?: boolean;
  protected?: boolean;
  bookingRef?: string | null;
  booking?: unknown;
  anchor_id?: string;
  boardingMin?: PlanMinutes | null;
  transferMinFromPriorArea?: number | null;
  requiresCheckIn?: boolean;
  interruptible?: boolean;
  part?: string;
  role?: string;
  durationMin?: number;
  delayed?: boolean;
  provenance?: unknown;
  stay?: LiveItemStay;
}

export interface LiveDay {
  day_id: string;
  day_number: number;
  date: LocalDate;
  timeZone: string;
  items: LiveItem[];
}

/** Keep the redundant time spellings of a live item in sync. */
export function syncLiveItemTimes(item: LiveItem): LiveItem {
  item.startTime = fmt(item.start);
  item.endTime = fmt(item.end);
  item.startMin = item.start;
  item.endMin = item.end;
  return item;
}

/** Content hash over the day's applied geometry — the CAS guard. */
export function liveDayHash(day: LiveDay): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        day.items.map((i) => [i.item_id, i.startTime, i.endTime, i.state ?? i.status ?? ""])
      )
    )
    .digest("hex");
}

/* ------------------------------------------------------------------ */
/* Protection + fixed-past law (production's own sets)                 */
/* ------------------------------------------------------------------ */

/** Production's untouchable states (companionShiftTiming.ts). */
export const BLOCKED_ITEM_STATES: ReadonlySet<string> = new Set([
  "started",
  "in_progress",
  "completed",
  "done",
  "skipped",
  "missed",
  "checked_in",
  "cancelled"
]);

export function isProtectedItem(item: LiveItem): boolean {
  return Boolean(
    item.protected ||
      item.paid ||
      item.prepaid ||
      item.booking !== undefined ||
      item.anchor_id !== undefined ||
      item.bookingRef
  );
}

export function isFixedPast(item: LiveItem, nowMin: PlanMinutes): boolean {
  const state = String(item.state ?? item.status ?? "").toLowerCase();
  if (BLOCKED_ITEM_STATES.has(state)) return true;
  return item.end <= nowMin;
}

/* ------------------------------------------------------------------ */
/* The day anchor — BOOKED stay first, never the top-scored candidate */
/* ------------------------------------------------------------------ */

export type DayAnchorSource = "booked-stay" | "traveler-selected" | "destination-centre";

export interface DayAnchor {
  source: DayAnchorSource;
  name: string;
  pos: EnginePos | null;
  itemId: string | null;
  /** True only for the destination-centre fallback — always labeled. */
  labeledFallback: boolean;
}

export function resolveDayAnchor(
  day: LiveDay,
  opts: { destinationCentre?: { name: string; pos: EnginePos | null } } = {}
): DayAnchor | null {
  // (1) A confirmed booked stay — including the day's hotel check-in
  // item carrying the booking reference.
  for (const item of day.items) {
    if (item.stay?.booked) {
      return {
        source: "booked-stay",
        name: item.stay.name,
        pos: item.stay.pos ?? item.pos ?? null,
        itemId: item.item_id,
        labeledFallback: false
      };
    }
  }
  for (const item of day.items) {
    if ((item.kind === "hotel" || item.item_type === "hotel") && item.bookingRef) {
      return {
        source: "booked-stay",
        name: item.title,
        pos: item.pos ?? null,
        itemId: item.item_id,
        labeledFallback: false
      };
    }
  }
  // (2) A stay the traveler selected themselves.
  for (const item of day.items) {
    if (item.stay?.selectedByTraveler) {
      return {
        source: "traveler-selected",
        name: item.stay.name,
        pos: item.stay.pos ?? item.pos ?? null,
        itemId: item.item_id,
        labeledFallback: false
      };
    }
  }
  // (3) Explicitly labeled destination-centre fallback.
  if (opts.destinationCentre) {
    return {
      source: "destination-centre",
      name: opts.destinationCentre.name,
      pos: opts.destinationCentre.pos,
      itemId: null,
      labeledFallback: true
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The affected set — from the FULL day state, never from titles       */
/* ------------------------------------------------------------------ */

export interface AffectedItem {
  itemId: string;
  name: string;
  reasons: string[];
  protected: boolean;
  fixedPast: boolean;
  kind: string;
}

export interface Disruption {
  type: string;
  /** The item the disruption is ABOUT (the delayed flight, ...). */
  subjectItemId: string | null;
  oldStart: PlanMinutes | null;
  oldEnd: PlanMinutes | null;
  newStart: PlanMinutes | null;
  newEnd: PlanMinutes | null;
  /** The moment the re-solve starts from (e.g. new arrival + transfer). */
  anchorMin: PlanMinutes;
  nowMin: PlanMinutes;
  retime?: Record<string, { start: PlanMinutes; end: PlanMinutes }>;
  closedKeys?: ReadonlySet<string>;
  dayEndMin?: PlanMinutes;
}

/**
 * Every item whose timing feasibility the disruption touches: any
 * item overlapping the changed window, any item that starts before
 * the new subject end (it was planned against the old timing), and
 * any item at/after the re-solve anchor whose placement the re-solve
 * may move. Protected and fixed-past items are IN the set — flagged,
 * never silently dropped from the analysis — they are just never
 * targets.
 */
export function computeAffectedSet(day: LiveDay, disruption: Disruption): AffectedItem[] {
  const affected: AffectedItem[] = [];
  const windowStart =
    disruption.oldStart !== null && disruption.newStart !== null
      ? Math.min(disruption.oldStart, disruption.newStart)
      : disruption.oldEnd;
  const subjectEnd = disruption.newEnd ?? disruption.oldEnd;
  for (const item of day.items) {
    if (disruption.subjectItemId && item.item_id === disruption.subjectItemId) continue;
    const reasons: string[] = [];
    if (windowStart !== null && item.start < disruption.oldEnd! && windowStart < item.end) {
      reasons.push("overlaps the changed window");
    }
    if (subjectEnd !== null && item.start < subjectEnd && item.end > (disruption.oldEnd ?? subjectEnd)) {
      reasons.push("starts before the subject's new end — it was planned against the old timing");
    }
    if (item.start >= disruption.anchorMin || item.end > disruption.anchorMin) {
      reasons.push("sits in the re-solve remainder at/after the anchor");
    }
    if (!reasons.length) continue;
    affected.push({
      itemId: item.item_id,
      name: item.title,
      reasons,
      protected: isProtectedItem(item),
      fixedPast: isFixedPast(item, disruption.nowMin),
      kind: item.kind || item.item_type || "item"
    });
  }
  return affected;
}

/* ------------------------------------------------------------------ */
/* Partition                                                             */
/* ------------------------------------------------------------------ */

export interface DayPartition {
  retimed: LiveItem[];
  fixedPast: LiveItem[];
  protectedAnchors: LiveItem[];
  killed: LiveItem[];
  mealSlots: LiveItem[];
  survivors: LiveItem[];
  nextAnchor: LiveItem | null;
  hardEndMin: PlanMinutes;
  arrivalDeadline: PlanMinutes | null;
}

export function partitionDay(day: LiveDay, disruption: Disruption): DayPartition {
  const P: DayPartition = {
    retimed: [],
    fixedPast: [],
    protectedAnchors: [],
    killed: [],
    mealSlots: [],
    survivors: [],
    nextAnchor: null,
    hardEndMin: disruption.dayEndMin ?? 22 * 60 + 30,
    arrivalDeadline: null
  };
  for (const item of day.items) {
    if (disruption.retime?.[item.item_id]) {
      P.retimed.push(item);
      continue;
    }
    if (isFixedPast(item, disruption.nowMin)) {
      P.fixedPast.push(item);
      continue;
    }
    if (isProtectedItem(item)) {
      P.protectedAnchors.push(item);
      continue;
    }
    if (item.key && disruption.closedKeys?.has(item.key)) {
      P.killed.push(item);
      continue;
    }
    if (item.end <= disruption.nowMin) {
      P.fixedPast.push(item);
      continue;
    }
    // A planned meal in the remainder is a SLOT to be re-filled by the
    // re-solve (the spike's lunch), not a survivor to be re-timed.
    if (item.kind === "food" || item.item_type === "food") {
      P.mealSlots.push(item);
      continue;
    }
    P.survivors.push(item);
  }
  const nextAnchor =
    P.protectedAnchors
      .filter((a) => a.start >= disruption.anchorMin)
      .sort((a, b) => a.start - b.start)[0] || null;
  P.nextAnchor = nextAnchor;
  if (nextAnchor) {
    P.hardEndMin = nextAnchor.start - 30;
    P.arrivalDeadline = (nextAnchor.boardingMin ?? nextAnchor.start) - 15;
  }
  return P;
}

/* ------------------------------------------------------------------ */
/* Bounded ordering search                                             */
/* ------------------------------------------------------------------ */

export interface SearchBound {
  strategy: "exact-permutation" | "bounded-insertion";
  evaluated: number;
  cap: number;
  truncated: boolean;
}

export const DEFAULT_MAX_EVALUATIONS = 720;

interface Step {
  stepType: "keep" | "meal";
  itemId?: string;
  replacesItemId?: string;
  key: string;
  name: string;
  kind: string;
  pos: EnginePos | null;
  hours?: EngineHours;
  url?: string;
  dur: number;
}

interface PlacedStep extends Step {
  start: PlanMinutes;
  end: PlanMinutes;
  walkIn: number;
}

function slotOk(hours: EngineHours | undefined, start: PlanMinutes, dur: number): boolean {
  if (!hours) return true;
  if (hours.status === "closed") return false;
  if (hours.status === "known") {
    if (start < hours.open) return false;
    if (start + dur > hours.close) return false;
  }
  return true;
}

function legBetween(fromPos: EnginePos | null, toPos: EnginePos | null): { km: number; minutes: number } {
  if (!fromPos || !toPos) return { km: 0, minutes: 0 };
  const km = haversineKm(fromPos, toPos);
  return { km, minutes: travelMin(km, km > 1.2 ? "drive" : "walk") };
}

interface OrderContext {
  anchorMin: PlanMinutes;
  anchorPos: EnginePos | null;
  hardEndMin: PlanMinutes;
  arrivalDeadline: PlanMinutes | null;
  terminalPos: EnginePos | null;
}

function tryOrder(steps: Step[], ctx: OrderContext): { items: PlacedStep[]; endMin: PlanMinutes; totalWalk: number } | null {
  let t = ctx.anchorMin;
  let pos = ctx.anchorPos;
  const items: PlacedStep[] = [];
  for (const step of steps) {
    const leg = legBetween(pos, step.pos);
    t += leg.minutes;
    if (!slotOk(step.hours, t, step.dur)) return null;
    items.push({ ...step, start: t, end: t + step.dur, walkIn: leg.minutes });
    t += step.dur;
    pos = step.pos;
  }
  let terminalWalk = 0;
  if (ctx.terminalPos) {
    const leg = legBetween(pos, ctx.terminalPos);
    terminalWalk = leg.minutes;
    if (t > ctx.hardEndMin || (ctx.arrivalDeadline !== null && t + terminalWalk > ctx.arrivalDeadline)) return null;
  } else if (t > ctx.hardEndMin) {
    return null;
  }
  return { items, endMin: t, totalWalk: items.reduce((s, i) => s + i.walkIn, 0) + terminalWalk };
}

function permutationsOf<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) =>
    permutationsOf([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])
  );
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

export interface RepairPlanItem {
  stepType: "keep" | "meal";
  itemId: string | null;
  replacesItemId: string | null;
  key: string;
  name: string;
  kind: string;
  start: PlanMinutes;
  end: PlanMinutes;
  startTime: string;
  endTime: string;
}

export interface RepairPlan {
  id: string;
  label: string;
  items: RepairPlanItem[];
  score: { itemsKept: number; totalWalk: number; endMin: PlanMinutes };
  judges: {
    full: { pass: boolean; hardViolations: string[] };
    remainder: { pass: boolean; hardViolations: string[] };
  };
}

export interface RepairProposal {
  proposalId: string;
  dayId: string;
  status: "proposed";
  requiresApproval: true;
  dayHashBefore: string;
  anchor: DayAnchor | null;
  affectedSet: AffectedItem[];
  partition: {
    fixedPast: string[];
    retimed: string[];
    protectedAnchors: string[];
    stranded: string[];
    killed: string[];
    survivors: string[];
    nextAnchor: string | null;
    hardEndMin: PlanMinutes;
  };
  retime: Record<string, { start: PlanMinutes; end: PlanMinutes }>;
  plans: RepairPlan[];
  close: boolean;
  chosenPlanId: string;
  searchBound: SearchBound;
  fallbackOptions: string[];
}

export type ProposeRepairsResult =
  | { ok: true; proposal: RepairProposal }
  | {
      ok: false;
      reason: "REMAINDER_EMPTIED_BY_DISRUPTION" | "NO_FEASIBLE_REPAIR" | "NO_ANCHOR";
      feasibleBeforeJudges: number;
      escalation: { kind: "repair-unresolved"; summary: string; context: Record<string, unknown> };
    };

function judgeTypeOf(item: LiveItem): string {
  if (item.item_type === "flight" || item.kind === "flight") return "journey";
  if (item.item_type === "transfer" || item.kind === "transfer") return "transfer";
  if (item.kind === "hotel" || item.item_type === "checkin") return "checkin";
  if (item.kind === "food" || item.item_type === "food") return "food";
  return "stop";
}

const LOGISTICS_JUDGE_TYPES: ReadonlySet<string> = new Set([
  "journey",
  "transfer",
  "checkin",
  "checkout",
  "pack",
  "move"
]);

function toJudgeItem(item: LiveItem, placed?: PlacedStep): JudgeItem {
  const type = judgeTypeOf(item);
  const base: JudgeItem = {
    type,
    key: item.key,
    name: item.title,
    kind: item.kind,
    start: item.start,
    end: item.end,
    // Logistics items (flight, transfer, check-in) carry endpoint
    // positions in production data, but their timing IS the travel —
    // handing those positions to the judges' stop-to-stop feasibility
    // check would convict every flight→transfer seam (gap 0 against a
    // 40-minute drive the transfer item itself occupies). The Phase 2
    // judge proofs use the same convention: logistics items enter
    // position-free.
    pos: LOGISTICS_JUDGE_TYPES.has(type) ? undefined : item.pos ?? undefined,
    hours: item.hours,
    url: item.url,
    price: "UNKNOWN",
    bookingReference: item.bookingRef ?? null
  };
  if (placed) {
    base.start = placed.start;
    base.end = placed.end;
    base.name = placed.name;
    base.key = placed.key;
    base.kind = placed.kind;
    base.pos = placed.pos ?? undefined;
    base.hours = placed.hours;
    base.url = placed.url;
    base.type = placed.kind === "food" ? "food" : base.type;
  }
  return base;
}

const shortStop = (name: string): string => name.replace(/^Halifax /, "");

function planLabel(items: RepairPlanItem[]): string {
  if (items.length === 2 && items[0].stepType === "meal") {
    return `Dinner first, then the ${shortStop(items[1].name)}`;
  }
  if (items.length === 2 && items[1].stepType === "meal") {
    return `The ${shortStop(items[0].name)} first, then dinner`;
  }
  return items.map((x) => x.name).join(" → ");
}

/**
 * Propose judge-validated repairs for a disrupted day. Pure: the day
 * is read, never written. An infeasible day escalates UNRESOLVED —
 * nothing is fabricated.
 */
export function proposeRepairs(params: {
  day: LiveDay;
  disruption: Disruption;
  pack?: EnginePack;
  proposalId: string;
  destinationCentre?: { name: string; pos: EnginePos | null };
  maxEvaluations?: number;
  judgeEarliestMin?: PlanMinutes;
}): ProposeRepairsResult {
  const { day, disruption } = params;
  const cap = params.maxEvaluations ?? DEFAULT_MAX_EVALUATIONS;
  const anchor = resolveDayAnchor(day, { destinationCentre: params.destinationCentre });
  if (!anchor && !params.destinationCentre) {
    return {
      ok: false,
      reason: "NO_ANCHOR",
      feasibleBeforeJudges: 0,
      escalation: {
        kind: "repair-unresolved",
        summary: `No day anchor exists for ${day.date}: no booked stay, no traveler-selected stay, and no destination-centre fallback was supplied. The day stands as planned and the traveler must be told plainly.`,
        context: { date: day.date }
      }
    };
  }
  const anchorPos = anchor?.pos ?? null;
  const P = partitionDay(day, disruption);
  const affectedSet = computeAffectedSet(day, disruption);

  // The solver's own evening pick fills the meal slot (Phase 2 core).
  let mealStep: Step | null = null;
  if (P.mealSlots.length && params.pack) {
    const protectedItems = P.protectedAnchors
      .filter((a) => a.start >= disruption.anchorMin && a.pos)
      .map((a) => ({ key: a.key, name: a.title, kind: a.kind, start: a.start, end: a.end, pos: a.pos as EnginePos, url: a.url }));
    const evening = solveEveningRemainder(params.pack, {
      date: day.date,
      anchorMin: disruption.anchorMin,
      anchorPos: anchorPos ?? { lat: 0, lon: 0 },
      anchorName: anchor?.name || "base",
      keeps: [{ meal: true }],
      protectedItems,
      arriveProtectedByMin: P.arrivalDeadline !== null ? P.arrivalDeadline + 15 : null,
      hardEndMin: P.hardEndMin
    });
    const food = evening.chosen?.items.find((i) => i.type === "food") || evening.plans[0]?.items.find((i) => i.type === "food");
    if (food) {
      const slot = P.mealSlots[P.mealSlots.length - 1];
      mealStep = {
        stepType: "meal",
        replacesItemId: slot.item_id,
        key: food.key || slot.key || "meal",
        name: food.name || slot.title,
        kind: "food",
        pos: food.pos ?? null,
        hours: food.hours,
        url: food.url,
        dur: DURATIONS.food || (slot.end - slot.start)
      };
    }
  }
  const stranded = P.mealSlots.filter((m) => m.item_id !== mealStep?.replacesItemId);
  const keepSteps: Step[] = P.survivors.map((item) => ({
    stepType: "keep",
    itemId: item.item_id,
    key: item.key || item.item_id,
    name: item.title,
    kind: item.kind || "stop",
    pos: item.pos ?? null,
    hours: item.hours,
    url: item.url,
    dur: item.end - item.start
  }));
  const fullSet: Step[] = [...keepSteps, ...(mealStep ? [mealStep] : [])];
  if (!fullSet.length && (stranded.length || P.killed.length)) {
    return {
      ok: false,
      reason: "REMAINDER_EMPTIED_BY_DISRUPTION",
      feasibleBeforeJudges: 0,
      escalation: {
        kind: "repair-unresolved",
        summary: `The ${disruption.type} stranded or removed the entire remainder of ${day.date}; there is nothing left to re-solve and the traveler must be told plainly.`,
        context: {
          stranded: stranded.map((s) => s.title),
          killed: P.killed.map((k) => k.title),
          anchorMin: disruption.anchorMin,
          hardEndMin: P.hardEndMin
        }
      }
    };
  }

  const ctx: OrderContext = {
    anchorMin: disruption.anchorMin,
    anchorPos,
    hardEndMin: P.hardEndMin,
    arrivalDeadline: P.arrivalDeadline,
    terminalPos: P.nextAnchor?.pos ?? null
  };

  // BOUNDED search: exact permutations under the cap; beyond it, a
  // chronological order + best-insertion + adjacent-swap heuristic
  // under the same cap. The bound is recorded either way.
  let evaluated = 0;
  let truncated = false;
  const feasible: { items: PlacedStep[]; endMin: PlanMinutes; totalWalk: number }[] = [];
  const seen = new Set<string>();
  const consider = (steps: Step[]): void => {
    const sig = steps.map((s) => s.key).join(">");
    if (seen.has(sig)) return;
    seen.add(sig);
    if (evaluated >= cap) {
      truncated = true;
      return;
    }
    evaluated += 1;
    const r = tryOrder(steps, ctx);
    if (r) feasible.push(r);
  };
  let strategy: SearchBound["strategy"];
  if (fullSet.length <= 6) {
    strategy = "exact-permutation";
    for (const order of permutationsOf(fullSet)) consider(order);
  } else {
    strategy = "bounded-insertion";
    truncated = true; // the full permutation space is never enumerated
    const chronological = [...fullSet].sort((a, b) => a.name.localeCompare(b.name));
    consider(chronological);
    // Best insertion: start from the first step, insert each remaining
    // step at its best-scoring position.
    let current: Step[] = chronological.slice(0, 1);
    for (const step of chronological.slice(1)) {
      let best: { order: Step[]; score: number } | null = null;
      for (let i = 0; i <= current.length; i++) {
        const order = [...current.slice(0, i), step, ...current.slice(i)];
        const sig = order.map((s) => s.key).join(">");
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (evaluated >= cap) {
          truncated = true;
          break;
        }
        evaluated += 1;
        const r = tryOrder(order, ctx);
        const score = r ? r.totalWalk * 10000 + r.endMin : Number.POSITIVE_INFINITY;
        if (!best || score < best.score) best = { order, score };
      }
      if (best && Number.isFinite(best.score)) {
        current = best.order;
        const r = tryOrder(current, ctx);
        if (r) feasible.push(r);
      }
    }
    // Adjacent-swap improvement passes under the same cap.
    let improved = true;
    while (improved && evaluated < cap) {
      improved = false;
      for (let i = 0; i + 1 < current.length; i++) {
        const order = [...current];
        const tmp = order[i];
        order[i] = order[i + 1];
        order[i + 1] = tmp;
        const sig = order.map((s) => s.key).join(">");
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (evaluated >= cap) {
          truncated = true;
          break;
        }
        evaluated += 1;
        const r = tryOrder(order, ctx);
        if (r) {
          feasible.push(r);
          current = order;
          improved = true;
        }
      }
    }
  }
  const searchBound: SearchBound = { strategy, evaluated, cap, truncated };

  // Score + pre-registered ranking: items kept desc, walk asc, finish asc.
  const scored = feasible.map((p) => ({
    ...p,
    keptOriginals: p.items.filter((i) => i.stepType === "keep").length
  }));
  scored.sort(
    (a, b) =>
      b.items.length - a.items.length ||
      a.totalWalk - b.totalWalk ||
      a.endMin - b.endMin
  );

  // Judge-validate: full repaired day + remainder-from-anchor.
  const retime = disruption.retime || {};
  const judged: RepairPlan[] = [];
  for (const plan of scored) {
    const placedByItemId = new Map<string, PlacedStep>();
    for (const p of plan.items) if (p.itemId) placedByItemId.set(p.itemId, p);
    const mealPlaced = plan.items.find((i) => i.stepType === "meal");
    const fullItems: JudgeItem[] = [];
    const remainderItems: JudgeItem[] = [];
    for (const item of day.items) {
      if (P.killed.some((k) => k.item_id === item.item_id)) continue;
      if (stranded.some((s) => s.item_id === item.item_id)) continue;
      if (P.mealSlots.some((m) => m.item_id === item.item_id) && item.item_id !== mealStep?.replacesItemId) continue;
      if (retime[item.item_id]) {
        const r = retime[item.item_id];
        const ji = toJudgeItem({ ...item, start: r.start, end: r.end });
        fullItems.push(ji);
        if (judgeTypeOf(item) !== "journey") remainderItems.push(ji);
        continue;
      }
      if (placedByItemId.has(item.item_id)) {
        const ji = toJudgeItem(item, placedByItemId.get(item.item_id));
        fullItems.push(ji);
        remainderItems.push(ji);
        continue;
      }
      if (mealStep && item.item_id === mealStep.replacesItemId && mealPlaced) {
        const ji = toJudgeItem(item, mealPlaced);
        fullItems.push(ji);
        remainderItems.push(ji);
        continue;
      }
      fullItems.push(toJudgeItem(item));
    }
    const fullDay: JudgeDay = {
      dayNumber: day.day_number,
      date: day.date,
      role: "standard",
      items: fullItems,
      legs: [],
      endMin: P.hardEndMin
    };
    const judgeFull = judgeTrip([fullDay], {
      earliestMin: params.judgeEarliestMin ?? 540,
      dayEndLimit: 22 * 60 + 30,
      gateProfile: "production-booking"
    });
    const remainderStart = remainderItems.length
      ? Math.min(...remainderItems.map((i) => i.start))
      : disruption.anchorMin;
    const remainderDay: JudgeDay = { ...fullDay, items: remainderItems };
    const judgeRemainder = judgeTrip([remainderDay], {
      earliestMin: remainderStart,
      dayEndLimit: P.hardEndMin,
      gateProfile: "production-booking"
    });
    if (!judgeFull.pass || !judgeRemainder.pass) continue;
    const items: RepairPlanItem[] = plan.items.map((p) => ({
      stepType: p.stepType,
      itemId: p.itemId ?? null,
      replacesItemId: p.replacesItemId ?? null,
      key: p.key,
      name: p.name,
      kind: p.kind,
      start: p.start,
      end: p.end,
      startTime: fmt(p.start),
      endTime: fmt(p.end)
    }));
    judged.push({
      id: "",
      label: planLabel(items),
      items,
      score: { itemsKept: plan.items.length, totalWalk: plan.totalWalk, endMin: plan.endMin },
      judges: {
        full: { pass: judgeFull.pass, hardViolations: judgeFull.hardViolations },
        remainder: { pass: judgeRemainder.pass, hardViolations: judgeRemainder.hardViolations }
      }
    });
  }
  if (!judged.length) {
    return {
      ok: false,
      reason: "NO_FEASIBLE_REPAIR",
      feasibleBeforeJudges: feasible.length,
      escalation: {
        kind: "repair-unresolved",
        summary: `No judge-validated repair exists for the ${disruption.type} on ${day.date}; the day stands as planned and the traveler must be told plainly.`,
        context: {
          killed: P.killed.map((k) => k.title),
          survivors: P.survivors.map((s) => s.title),
          anchorMin: disruption.anchorMin,
          hardEndMin: P.hardEndMin,
          searchBound
        }
      }
    };
  }
  // Pre-registered closeness: equal items kept + finish within 45 min
  // -> present the top two; otherwise the best plan alone.
  let presented = [judged[0]];
  let close = false;
  if (
    judged.length > 1 &&
    judged[0].score.itemsKept === judged[1].score.itemsKept &&
    Math.abs(judged[0].score.endMin - judged[1].score.endMin) <= 45
  ) {
    presented = [judged[0], judged[1]];
    close = true;
  }
  presented.forEach((p, i) => {
    p.id = String.fromCharCode(65 + i);
  });
  const chosen = [...presented].sort(
    (a, b) => b.score.itemsKept - a.score.itemsKept || a.score.totalWalk - b.score.totalWalk || a.score.endMin - b.score.endMin
  )[0];
  const proposal: RepairProposal = {
    proposalId: params.proposalId,
    dayId: day.day_id,
    status: "proposed",
    requiresApproval: true,
    dayHashBefore: liveDayHash(day),
    anchor,
    affectedSet,
    partition: {
      fixedPast: P.fixedPast.map((i) => i.title),
      retimed: P.retimed.map((i) => i.title),
      protectedAnchors: P.protectedAnchors.map((i) => i.title),
      stranded: stranded.map((i) => i.title),
      killed: P.killed.map((i) => i.title),
      survivors: P.survivors.map((i) => i.title),
      nextAnchor: P.nextAnchor?.title || null,
      hardEndMin: P.hardEndMin
    },
    retime,
    plans: presented,
    close,
    chosenPlanId: chosen.id,
    searchBound,
    fallbackOptions: presented.map(
      (p) => `${p.label}: ${p.items.map((i) => `${i.name} ${i.startTime}–${i.endTime}`).join(", ")}`
    )
  };
  return { ok: true, proposal };
}

/* ------------------------------------------------------------------ */
/* Apply (pure) + reload verification                                  */
/* ------------------------------------------------------------------ */

export interface ExpectedPlacement {
  itemId: string;
  startTime: string;
  endTime: string;
}

/**
 * Build the repaired day for an approved plan. Pure — the caller
 * (updater.ts) owns persistence, the hash guard, and rollback.
 */
export function buildRepairedDay(
  day: LiveDay,
  proposal: RepairProposal,
  planId: string
): { ok: true; day: LiveDay; expected: ExpectedPlacement[] } | { ok: false; error: string } {
  const plan = proposal.plans.find((p) => p.id === planId);
  if (!plan) return { ok: false, error: "PLAN_NOT_FOUND" };
  const next: LiveDay = structuredClone(day);
  const byId = new Map(next.items.map((i) => [i.item_id, i]));
  const expected: ExpectedPlacement[] = [];
  for (const [itemId, r] of Object.entries(proposal.retime)) {
    const item = byId.get(itemId);
    if (!item) continue;
    item.start = r.start;
    item.end = r.end;
    syncLiveItemTimes(item);
    expected.push({ itemId, startTime: item.startTime, endTime: item.endTime });
  }
  for (const title of proposal.partition.stranded) {
    const item = next.items.find((i) => i.title === title);
    if (item) item.state = "superseded_by_repair";
  }
  for (const placed of plan.items) {
    if (placed.stepType === "meal") {
      const slot = placed.replacesItemId ? byId.get(placed.replacesItemId) : undefined;
      if (!slot) continue;
      slot.title = placed.name;
      slot.name = placed.name;
      slot.key = placed.key;
      slot.start = placed.start;
      slot.end = placed.end;
      syncLiveItemTimes(slot);
      expected.push({ itemId: slot.item_id, startTime: slot.startTime, endTime: slot.endTime });
    } else {
      const item = placed.itemId ? byId.get(placed.itemId) : undefined;
      if (!item) continue;
      item.start = placed.start;
      item.end = placed.end;
      syncLiveItemTimes(item);
      expected.push({ itemId: item.item_id, startTime: item.startTime, endTime: item.endTime });
    }
  }
  for (const title of proposal.partition.killed) {
    const item = next.items.find((i) => i.title === title);
    if (item) item.state = "removed_closed";
  }
  return { ok: true, day: next, expected };
}

/** Reload verification: every expected placement reads back identical. */
export function verifyRepairedDay(
  day: LiveDay,
  expected: ExpectedPlacement[]
): { verification: "resolved" | "still_affected"; mismatches: ExpectedPlacement[] } {
  const byId = new Map(day.items.map((i) => [i.item_id, i]));
  const mismatches = expected.filter((e) => {
    const item = byId.get(e.itemId);
    return !item || item.startTime !== e.startTime || item.endTime !== e.endTime;
  });
  return { verification: mismatches.length ? "still_affected" : "resolved", mismatches };
}
