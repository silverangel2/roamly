import type { EngineDay } from "@/lib/roamly/engine/util";
import { fitScore } from "@/lib/roamly/engine/predict";

/*
 * continuity — CONTINUITY (Phase 2 port of the shadow zero-engine's
 * continuity.mjs; owner sequence, 2026-10-21: envelope/emotion
 * first, continuity after) — the trip is ONE continuous journey, not
 * a stack of separate days. This module is the trip-level layer:
 *
 *   1. TRIP ARC — a shape above the pacing calendar:
 *      SETTLE (arrival-shaped opening) -> EXPLORE (the body) -> PEAK
 *      (the single highest-fit day, chosen from PREDICT scores; never
 *      day 1, never the last full day) -> LAND (the descent: the last
 *      full day is demoted below the peak's weight; the departure
 *      envelope closes). Pacing emits day types; continuity assigns
 *      arc roles and may DEMOTE a FULL to LIGHT to protect the
 *      landing. It never upgrades past pacing — the day counter's
 *      word is a ceiling.
 *   2. COMMITMENT LEDGER — every promised item (named must-sees,
 *      prepaid/protected bookings, envelope anchors) is tracked with
 *      a home day. Nothing promised may vanish silently (see the
 *      ledger + judge below).
 *   3. RE-HOME POLICY — when a day can no longer hold a commitment
 *      (weather closure, a repair), the commitment is re-homed to
 *      the first later compatible day a trial re-solve proves
 *      feasible, or ESCALATED as an explicit unresolved commitment.
 *      Silent loss is impossible by construction: the ledger is
 *      reconciled against the final plan, and the continuity judge
 *      FAILS any gap.
 *   4. CONTINUITY JUDGE — the gate over all of it, in the Make-Sense
 *      style: hard violations fail the trip; the unprovable is
 *      labeled.
 *
 * Deterministic throughout. No model calls, no network. Facts come
 * from the plan, the pacing calendar, the predictions record, and
 * stated scenario inputs.
 *
 * Production change (DESIGN-PRODUCTION Phase 2): ledger entries are
 * keyed by STABLE ITEM IDs — the solver's must-see results carry the
 * candidate key (`itemKey`), the ledger matches on it, and names are
 * carried only as display labels / a fallback for declared scenario
 * commitments that predate stable keys. The re-home trial callback
 * stays a pure policy input here; in production it becomes a bounded
 * service call (Phase 9) — the policy (first later FULL day a trial
 * proves feasible, else escalate) is unchanged.
 */

export const ARC_ROLES: readonly string[] = ["SETTLE", "EXPLORE", "PEAK", "LAND"];

const isBased = (t: string): boolean => t !== "MOVE";

/* ------------------------------------------------------------------ */
/* 1. Trip arc                                                         */
/* ------------------------------------------------------------------ */

export interface TripArcAdjustment {
  day: number;
  from: string;
  to: string;
  reason: string;
}

export interface TripArc {
  roles: string[];
  types: string[];
  peakDay: number | null;
  landDay: number | null;
  settleDay: number | null;
  adjustments: TripArcAdjustment[];
  notes: string[];
}

export interface BuildTripArcOptions {
  types: string[];
  envelopeArrival?: boolean;
  envelopeDeparture?: boolean;
  peakScoreByDay?: Map<number, number> | null;
  adjust?: boolean;
}

/**
 * Assign arc roles over a day-type list.
 * Peak candidates: FULL days that are not day 1, not the settle day,
 * not the departure day, and not the last FULL day (the peak must
 * have a landing after it). Ties break toward the middle of the trip.
 * Trips of <= 3 days compress: settle / peak / land share the few
 * days — documented in the returned notes.
 * When `adjust` is true, also compute the landing demotion (the
 * caller applies it; this function never mutates input).
 */
export function buildTripArc(opts: BuildTripArcOptions): TripArc {
  const {
    types,
    envelopeDeparture = false,
    peakScoreByDay = null,
    adjust = false
  } = opts;
  // opts.envelopeArrival rides the shadow signature; the arc math
  // itself keys off the day types + the departure flag only.
  const n = types.length;
  const notes: string[] = [];
  const effTypes = [...types];
  const roles = new Array<string>(n).fill("EXPLORE");
  if (!n)
    return { roles, types: effTypes, peakDay: null, landDay: null, settleDay: null, adjustments: [], notes };

  const settleIdx = 0;
  roles[settleIdx] = "SETTLE";
  // The landing: the departure day when the envelope closes the trip,
  // else the last based day that is not the settle day.
  let landIdx = n - 1;
  while (landIdx > settleIdx && !isBased(types[landIdx])) landIdx--;
  if (landIdx <= settleIdx) landIdx = settleIdx;
  roles[landIdx] = "LAND";

  const fullIdx = types.map((t, i) => (t === "FULL" ? i : -1)).filter((i) => i >= 0);
  const lastFullIdx = fullIdx.length ? fullIdx[fullIdx.length - 1] : -1;

  // Peak: highest PREDICT fit among eligible FULL days.
  let peakIdx = -1;
  if (n <= 3) {
    // Compressed arc: with three days or fewer there is no room for a
    // separate explore body — settle, peak and land share the days.
    // The peak is the highest-fit based day that is not the settle day
    // (on a 2–3 day trip it may be the landing day itself; on a 1-day
    // trip there is no peak at all).
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === settleIdx || !isBased(types[i])) continue;
      const s = peakScoreByDay?.get(i + 1) ?? 0;
      if (s > best) {
        best = s;
        peakIdx = i;
      }
    }
    notes.push(
      n === 1
        ? "compressed arc (1 day): the single day carries SETTLE and LAND together; there is no peak day"
        : `compressed arc (${n} days): settle / peak / land share the days — no separate explore body fits`
    );
  } else {
    const mid = (n - 1) / 2;
    let bestScore = -Infinity, bestDist = Infinity;
    for (const i of fullIdx) {
      if (i === settleIdx || i === lastFullIdx) continue;
      if (envelopeDeparture && i === n - 1) continue;
      const s = peakScoreByDay?.get(i + 1) ?? 0;
      const dist = Math.abs(i - mid);
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && dist < bestDist)) {
        bestScore = s;
        bestDist = dist;
        peakIdx = i;
      }
    }
    if (peakIdx < 0)
      notes.push(
        "no eligible FULL day for a peak (every full day is the settle, the landing, or the departure) — the arc runs settle -> explore -> land"
      );
  }
  if (peakIdx >= 0 && peakIdx !== landIdx) roles[peakIdx] = "PEAK";
  else if (peakIdx >= 0)
    notes.push(
      `peak day ${peakIdx + 1} is also the landing on this compressed arc — the trip's high point and its descent share a day`
    );

  // Landing protection: the last FULL day after the peak is demoted to
  // LIGHT, so the trip descends instead of ending at full throttle.
  // The demotion is an adjustment the CALLER applies (solver) or
  // verifies (judge) — it is never an upgrade, and it never touches
  // the peak, the excursion/ferry days (protected by the caller's
  // exclusions), or a day the envelope owns.
  const adjustments: TripArcAdjustment[] = [];
  if (adjust && peakIdx >= 0 && lastFullIdx > peakIdx) {
    adjustments.push({
      day: lastFullIdx + 1,
      from: "FULL",
      to: "LIGHT",
      reason:
        "landing protection — the last full day steps down so the trip descends from its peak instead of ending at full throttle"
    });
    effTypes[lastFullIdx] = "LIGHT";
  }

  return {
    roles,
    types: effTypes,
    peakDay: peakIdx >= 0 ? peakIdx + 1 : null,
    landDay: landIdx + 1,
    settleDay: settleIdx + 1,
    adjustments,
    notes
  };
}

/**
 * Per-day peak scores from a solved plan, from PREDICT fit scores.
 * The peak is the trip's biggest day, and "biggest" has a precise
 * meaning here: meals never count (they are essentials, not peaks —
 * a well-tagged lunch must not outscore the Falls), ordinary stops
 * count at face value, and the EXCURSION — the one item class the
 * engine itself treats as the trip's headline outing — counts
 * triple. So the peak is the excursion day whenever the trip has
 * one, and otherwise the day of the strongest sightseeing.
 */
export function peakScoresFromDays(days: EngineDay[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of days) {
    let s = 0;
    for (const i of d.items || []) if (i.type === "stop") s += fitScore(i).score * (i.role === "excursion" ? 3 : 1);
    m.set(d.dayNumber, s);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* 2. Commitment ledger                                                */
/* ------------------------------------------------------------------ */

export type LedgerStatus = "kept" | "rehomed" | "unmet" | "unresolved";
export type LedgerKind = "must-see" | "protected" | "envelope-anchor";

export interface LedgerEntry {
  id: string;
  label: string;
  kind: LedgerKind;
  itemKey: string | null;
  itemName: string | null;
  homeDay: number | null;
  status: LedgerStatus;
  toDay?: number;
  reason?: string;
}

/** The must-see result shape the ledger reads (the solver's record;
 *  `itemKey` is the stable candidate key — the ledger's identity). */
export interface MustSeeResultLike {
  id: string;
  label: string;
  status: string;
  day?: number | null;
  item?: string | null;
  itemKey?: string | null;
  reason?: string;
}

/**
 * Build the ledger from a solved plan + its must-see results.
 * Also accepts scenario commitments declared ahead of the plan (a
 * traveler's prepaid booking pinned to a day): they are reconciled
 * against the plan like any other promise.
 */
export function buildCommitmentLedger(
  days: EngineDay[],
  opts: { mustSeeResults?: MustSeeResultLike[]; declared?: LedgerEntry[] } = {}
): LedgerEntry[] {
  const { mustSeeResults = [], declared = [] } = opts;
  const entries: LedgerEntry[] = [];
  const findItem = (ms: MustSeeResultLike): { day: number; item: EngineDay["items"][number] } | null => {
    for (const d of days) {
      const it = (d.items || []).find(
        (i) =>
          (i.type === "stop" || i.type === "food") &&
          ((ms.itemKey != null && i.key === ms.itemKey) || (ms.item != null && i.name === ms.item))
      );
      if (it) return { day: d.dayNumber, item: it };
    }
    return null;
  };
  for (const ms of mustSeeResults) {
    const found = ms.item || ms.itemKey ? findItem(ms) : null;
    entries.push({
      id: `ms:${ms.id}`,
      label: ms.label,
      kind: "must-see",
      itemKey: found?.item.key || ms.itemKey || null,
      itemName: ms.item || null,
      homeDay: found ? found.day : ms.day || null,
      status: ms.status && ms.status.startsWith("scheduled") && found ? "kept" : "unmet",
      ...(ms.reason ? { reason: ms.reason } : {})
    });
  }
  for (const d of days) {
    for (const i of d.items || []) {
      if (i.protected === true || i.role === "commitment") {
        entries.push({
          id: `prot:${i.key || i.name}`,
          label: i.name || i.title || "",
          kind: "protected",
          itemKey: i.key || null,
          itemName: i.name || null,
          homeDay: d.dayNumber,
          status: "kept"
        });
      }
    }
    if (d.envelope?.arrival) {
      entries.push({
        id: `env:arrival:${d.dayNumber}`,
        label: `arrival chain + check-in (${d.envelope.arrival.checkInProvenance?.startsWith("assumed") ? "check-in assumed 15:00" : "check-in from hotel data"})`,
        kind: "envelope-anchor",
        itemKey: null,
        itemName: null,
        homeDay: d.dayNumber,
        status: "kept"
      });
    }
    if (d.envelope?.departure) {
      entries.push({
        id: `env:departure:${d.dayNumber}`,
        label: "pack-up + checkout + airport buffer (protected departure chain)",
        kind: "envelope-anchor",
        itemKey: null,
        itemName: null,
        homeDay: d.dayNumber,
        status: "kept"
      });
    }
  }
  for (const c of declared) {
    if (!entries.some((e) => e.id === c.id)) entries.push({ ...c, status: c.status ?? "kept" });
  }
  return entries;
}

/**
 * Reconcile the ledger against the FINAL plan (after any repair or
 * re-solve). An entry whose item is not on its home day is either
 * rehomed (the repair recorded where it went) or UNRESOLVED — there
 * is no fourth state, and unresolved is what the judge fails on.
 * Matching is by stable item key first, name only as fallback.
 */
export function reconcileLedger(
  entries: LedgerEntry[],
  days: EngineDay[],
  opts: { rehomed?: { id: string; toDay: number; reason: string }[] } = {}
): LedgerEntry[] {
  const { rehomed = [] } = opts;
  const onDay = (dayNumber: number | null, entry: LedgerEntry): boolean => {
    if (dayNumber == null) return false;
    const d = days.find((x) => x.dayNumber === dayNumber);
    if (!d) return false;
    return (d.items || []).some(
      (i) => (entry.itemKey && i.key === entry.itemKey) || (entry.itemName && i.name === entry.itemName)
    );
  };
  return entries.map((e) => {
    if (e.kind === "envelope-anchor") return e; // anchors are structural; the judges own their checks
    if (e.status === "unmet") return e;
    if (onDay(e.homeDay, e)) return { ...e, status: e.status === "rehomed" ? ("rehomed" as const) : ("kept" as const) };
    const rh = rehomed.find((r) => r.id === e.id);
    if (rh && onDay(rh.toDay, e))
      return { ...e, status: "rehomed" as const, toDay: rh.toDay, reason: rh.reason };
    if (rh)
      return {
        ...e,
        status: "unresolved" as const,
        toDay: rh.toDay,
        reason: `${rh.reason} — but the re-homed item is not on day ${rh.toDay} in the final plan`
      };
    return {
      ...e,
      status: "unresolved" as const,
      reason: `promised for day ${e.homeDay} and absent from the final plan, with no re-home recorded — a silent loss the ledger exists to prevent`
    };
  });
}

/* ------------------------------------------------------------------ */
/* 3. Re-home policy                                                   */
/* ------------------------------------------------------------------ */

export interface RehomeOutcome<TPlan> {
  entry: LedgerEntry;
  plan: TPlan | null;
  toDay: number | null;
  escalated: boolean;
}

/**
 * The repair path for a displaced commitment, reusing the travel-day
 * spike's discipline: fixed past, proposals not silent edits, verify
 * after apply. `solveWith(pinDay)` is the caller's trial re-solve
 * with the commitment pinned to a candidate day (and banned from its
 * closed day); it must return the plan or null when infeasible.
 * Policy: the FIRST later day that (a) is FULL in the effective arc,
 * (b) comes after the closed day, and (c) a trial re-solve proves can
 * hold the commitment. No such day -> escalate.
 * (In production the callback is a bounded service call — Phase 9;
 * the pure policy here is unchanged.)
 */
export function rehomeCommitment<TPlan>(args: {
  entry: LedgerEntry;
  closedDay: number;
  candidateDays: { dayNumber: number; type: string }[];
  solveWith: (pinDay: number) => TPlan | null;
}): RehomeOutcome<TPlan> {
  const { entry, closedDay, candidateDays, solveWith } = args;
  const later = candidateDays.filter((d) => d.dayNumber > closedDay && d.type === "FULL");
  for (const cand of later) {
    const plan = solveWith(cand.dayNumber);
    if (plan) return { entry, plan, toDay: cand.dayNumber, escalated: false };
  }
  return { entry, plan: null, toDay: null, escalated: true };
}

/* ------------------------------------------------------------------ */
/* 4. Continuity judge                                                 */
/* ------------------------------------------------------------------ */

export interface ContinuityCheck {
  leg: string;
  status: "DONE" | "NOT DONE" | "UNVERIFIABLE";
  detail: string;
}

export interface ContinuityVerdict {
  pass: boolean;
  hardViolations: string[];
  warnings: string[];
  checks: ContinuityCheck[];
}

export interface StoryExpectation {
  expected: {
    peakDay?: number | null;
    landDay?: number | null;
    returns?: { day: number; name: string }[];
    rehomedIn?: { day: number; name: string }[];
    rehomedOut?: { day: number; name: string }[];
  };
  inserted: { day: number; kind: string }[];
}

export interface SeamDayLike {
  day: number;
  orphanMin: number;
  luggageNote?: string;
  restEndMin?: number | null;
}

/**
 * The continuity gate. days = final plan days; arc = buildTripArc
 * result (+ the effective types actually solved); ledger = reconciled
 * entries; story = the narrative-memory record (omit on trips where
 * the pass does not run — the judge then reports the narrative leg as
 * not-run, never as passed).
 */
export function judgeContinuity(
  days: EngineDay[],
  opts: {
    arc?: TripArc | null;
    ledger?: LedgerEntry[];
    story?: StoryExpectation | null;
    seamDays?: SeamDayLike[];
  } = {}
): ContinuityVerdict {
  const { arc = null, ledger = [], story = null, seamDays = [] } = opts;
  const hard: string[] = [], warnings: string[] = [], checks: ContinuityCheck[] = [];

  /* ledger: nothing promised may be silently gone */
  const unresolved = ledger.filter((e) => e.status === "unresolved");
  const unmet = ledger.filter((e) => e.status === "unmet");
  for (const e of unresolved)
    hard.push(`commitment "${e.label}" (day ${e.homeDay}) is UNRESOLVED: ${e.reason}`);
  checks.push({
    leg: "continuity:commitment-ledger",
    status: unresolved.length ? "NOT DONE" : "DONE",
    detail: `${ledger.length} commitments tracked — ${ledger.filter((e) => e.status === "kept").length} kept on their home day, ${ledger.filter((e) => e.status === "rehomed").length} rehomed with the move recorded, ${unmet.length} unmet-and-reported at solve time, ${unresolved.length} unresolved`
  });

  /* arc: the peak is real, placed by the rules, and the landing holds */
  if (arc) {
    const problems: string[] = [];
    if (arc.peakDay === 1) problems.push("the peak sits on day 1 — the trip would open at its highest point");
    const fullDays = days.filter((d) => (d.dayType || "FULL") === "FULL").map((d) => d.dayNumber);
    if (arc.peakDay && fullDays.length && arc.peakDay === fullDays[fullDays.length - 1] && days.length > 3)
      problems.push(`the peak (day ${arc.peakDay}) is the last full day — there is no landing after it`);
    for (const adj of arc.adjustments || []) {
      const d = days.find((x) => x.dayNumber === adj.day);
      if (d && (d.dayType || "FULL") !== adj.to)
        problems.push(
          `arc adjustment for day ${adj.day} (${adj.from} -> ${adj.to}) was not honored in the solved plan (solved as ${d.dayType || "FULL"})`
        );
    }
    for (const p of problems) hard.push(`arc: ${p}`);
    checks.push({
      leg: "continuity:trip-arc",
      status: problems.length ? "NOT DONE" : "DONE",
      detail: `settle day ${arc.settleDay} · peak ${arc.peakDay ? `day ${arc.peakDay}` : "none (compressed arc)"} · land day ${arc.landDay}${(arc.adjustments || []).length ? ` · adjustments: ${arc.adjustments.map((a) => `day ${a.day} ${a.from}->${a.to}`).join("; ")}` : " · no demotion needed"}`
    });
  } else {
    checks.push({
      leg: "continuity:trip-arc",
      status: "UNVERIFIABLE",
      detail: "no arc was computed for this trip (informational run)"
    });
  }

  /* narrative memory: the story must KNOW what the ledger knows */
  if (story) {
    const missing: string[] = [];
    const has = (day: number, kind: string): boolean =>
      story.inserted.some((x) => x.day === day && x.kind === kind);
    if (story.expected.peakDay && !has(story.expected.peakDay, "peak"))
      missing.push(`day ${story.expected.peakDay} is the peak but its story never says so`);
    if (story.expected.landDay && !has(story.expected.landDay, "land"))
      missing.push(`day ${story.expected.landDay} is the landing but its story never winds down`);
    for (const r of story.expected.returns || [])
      if (!has(r.day, "return")) missing.push(`"${r.name}" returns on day ${r.day} and the story does not name it as a return`);
    for (const r of story.expected.rehomedIn || [])
      if (!has(r.day, "rehomed-in")) missing.push(`"${r.name}" was re-homed to day ${r.day} and that day's story does not acknowledge it`);
    for (const r of story.expected.rehomedOut || [])
      if (!has(r.day, "rehomed-out")) missing.push(`"${r.name}" left day ${r.day} and that day's story does not say where it went`);
    for (const m of missing) hard.push(`narrative memory: ${m}`);
    checks.push({
      leg: "continuity:narrative-memory",
      status: missing.length ? "NOT DONE" : "DONE",
      detail: missing.length
        ? missing.join(" | ")
        : `${story.inserted.length} memory lines woven in (peak, landing, returns, re-homes) — every one triggered by ledger/arc state, none invented`
    });
  } else {
    checks.push({
      leg: "continuity:narrative-memory",
      status: "UNVERIFIABLE",
      detail: "narrative-memory pass not run on this trip (informational) — the ledger and arc legs above still bind"
    });
  }

  /* seam chaining: a base change is one motion, with no orphaned hours */
  if (seamDays.length) {
    const problems: string[] = [];
    for (const s of seamDays) {
      if (s.orphanMin > 0)
        problems.push(`day ${s.day}: ${s.orphanMin} min of the move are unaccounted between checkout and check-in — orphaned hours`);
      if (!s.luggageNote)
        problems.push(`day ${s.day}: the luggage state is never stated (bags must be accounted for until check-in)`);
      if (s.restEndMin == null) problems.push(`day ${s.day}: no rest & refresh at the new base after the move`);
    }
    for (const p of problems) hard.push(`seam: ${p}`);
    checks.push({
      leg: "continuity:seam-chaining",
      status: problems.length ? "NOT DONE" : "DONE",
      detail: problems.length
        ? problems.join(" | ")
        : seamDays
            .map((s) => `day ${s.day}: checkout -> transfer -> check-in (${s.luggageNote}) -> rest, one motion, 0 orphaned minutes`)
            .join("; ")
    });
  }

  return { pass: hard.length === 0, hardViolations: hard, warnings, checks };
}
