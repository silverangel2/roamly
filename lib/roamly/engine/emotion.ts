import { fmt, haversineKm, travelMin } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem } from "@/lib/roamly/engine/util";
import { LOGISTICS_TYPES } from "@/lib/roamly/engine/judges";
import type { PartyProfile } from "@/lib/roamly/engine/journey";

/*
 * emotion — the Emotion & Consideration bot (Phase 2 port of the
 * shadow zero-engine's emotion.mjs; owner, 2026-10-21).
 *
 * A judge with repairs, auditing every plan for how it FEELS. The
 * Make-Sense judges ask "is this day possible?"; this bot asks
 * "would a human being enjoy this day — or merely survive it?"
 * Travel is supposed to release stress, and booking it is the most
 * stressful part; this is the stage whose whole job is to keep the
 * smile on the traveler's face.
 *
 * Deterministic checks first (arithmetic over the plan + the party
 * profile). Every finding carries a concrete REPAIR. This bot
 * reports — it never silently rewrites a plan in this pass.
 */

const HEADLINE_KINDS: ReadonlySet<string> = new Set(["museum", "falls", "lighthouse"]);
const HIGHLIGHT_KINDS: ReadonlySet<string> = new Set(["museum", "falls", "lighthouse", "market"]);
const isHighlight = (i: EngineItem): boolean =>
  i.role === "mustsee" || i.role === "excursion" || HIGHLIGHT_KINDS.has(i.kind || "");
const isHeadline = (i: EngineItem): boolean =>
  i.role === "excursion" || HEADLINE_KINDS.has(i.kind || "");
const label = (i: EngineItem): string => i.name || i.title || "(unnamed)";
const isProtected = (i: EngineItem): boolean => i.protected === true || i.role === "commitment";
const isMeal = (i: EngineItem): boolean => i.type === "food" || (i.type === "rest" && i.part === "meal");

export interface EmotionFinding {
  day: number;
  check: string;
  severity: "hard" | "soft";
  evidence: string;
  repair: string;
}

export interface EmotionAudit {
  verdict: "FAIL" | "PASS";
  hard: number;
  soft: number;
  findings: EmotionFinding[];
}

export function auditTrip(days: EngineDay[], opts: { profile?: PartyProfile } = {}): EmotionAudit {
  const { profile } = opts;
  const findings: EmotionFinding[] = [];
  const push = (
    day: number,
    check: string,
    severity: "hard" | "soft",
    evidence: string,
    repair: string
  ): void => {
    findings.push({ day, check, severity, evidence, repair });
  };
  const sorted = [...days].sort((a, b) => a.dayNumber - b.dayNumber);
  const lastDay = sorted[sorted.length - 1];

  for (const day of sorted) {
    const items = [...(day.items || [])]
      .filter((i) => i.start != null)
      .sort((a, b) => a.start - b.start);
    const stops = items.filter((i) => i.type === "stop" || i.type === "food");
    const dn = day.dayNumber;

    /* the spike's disaster pattern: a timed item colliding with a
       protected commitment — the commitment always wins */
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) {
        const x = items[a], y = items[b];
        if (x.start < y.end && y.start < x.end && (isProtected(x) || isProtected(y))) {
          const prot = isProtected(x) ? x : y, other = isProtected(x) ? y : x;
          push(
            dn, "protected-collision", "hard",
            `"${label(other)}" (${fmt(other.start)}–${fmt(other.end)}) collides with the protected commitment "${label(prot)}" (${fmt(prot.start)}–${fmt(prot.end)})`,
            `the protected commitment wins: hold "${label(prot)}" fixed and re-solve the rest of day ${dn} around it — never shift the traveler into their own booking`
          );
        }
      }

    /* arrival truth: nothing real may be scheduled before the plane
       lands, and nothing real may start hard on a landing's heels */
    const flight = items.find((i) => i.type === "flight" || i.kind === "flight");
    if (flight) {
      for (const s of stops) {
        if (s.start < flight.end)
          push(
            dn, "impossible-order", "hard",
            `"${label(s)}" is scheduled at ${fmt(s.start)}, before the flight lands at ${fmt(flight.end)}`,
            `remove "${label(s)}" from the arrival slate — the traveler is still in the air`
          );
      }
      const firstStop = stops.find((s) => s.start >= flight.end);
      if (firstStop && firstStop.start - flight.end < 90 && !day.envelope?.arrival) {
        push(
          dn, "arrival-cruelty", "hard",
          `"${label(firstStop)}" starts ${firstStop.start - flight.end} min after wheels-down (${fmt(flight.end)}) — no check-in, no rest, no refresh in between`,
          "open the day with the journey envelope: transfer, check-in, and a rest & refresh block scaled to the journey before the first real activity"
        );
      }
    }
    if (day.envelope?.arrival) {
      const refresh = items.find((i) => i.type === "rest" && i.part === "refresh");
      if (refresh) {
        // A real STOP may not start before the rest block ends. A MEAL
        // is different: lunch held inside the pre-check-in wait is the
        // design (the day feeds the traveler first) — only a meal
        // scheduled inside the refresh block itself is cruelty.
        for (const s of items.filter((i) => i.type === "stop")) {
          if (s.start < refresh.end)
            push(
              dn, "arrival-cruelty", "hard",
              `"${label(s)}" starts at ${fmt(s.start)}, inside the rest & refresh block that runs to ${fmt(refresh.end)} after a ${day.envelope.arrival.journeyMin} min journey`,
              "move the stop after the rest block, or soften the day to LIGHT — arrival day content obeys the journey first"
            );
        }
        for (const f of items.filter((i) => i.type === "food")) {
          if (f.start >= refresh.start && f.start < refresh.end)
            push(
              dn, "arrival-cruelty", "hard",
              `the meal "${label(f)}" is scheduled inside the rest & refresh block (${fmt(refresh.start)}–${fmt(refresh.end)})`,
              "hold the meal inside the room wait, before check-in — never inside the rest it is meant to precede"
            );
        }
      }
    }

    /* rushing: slack beyond the bare travel time between stops */
    const legTo = new Map((day.legs || []).map((l) => [l.toKey, l]));
    const positioned = stops.filter((i) => i.pos);
    let tightLegs = 0, worst: { slack: number; prev: EngineItem; cur: EngineItem } | null = null;
    for (let i = 1; i < positioned.length; i++) {
      const prev = positioned[i - 1], cur = positioned[i];
      if (!prev.pos || !cur.pos) continue;
      const leg = cur.key ? legTo.get(cur.key) : undefined;
      const distKm = haversineKm(prev.pos, cur.pos);
      const need = leg ? leg.minutes : travelMin(distKm, distKm > 1.2 ? "drive" : "walk");
      const slack = cur.start - prev.end - need;
      if (slack < 0)
        push(
          dn, "rushing", "hard",
          `only ${cur.start - prev.end} min between "${label(prev)}" and "${label(cur)}" but the trip between them needs ~${need} min — the day cannot be lived at this pace`,
          "insert the missing minutes: shift the later stop or drop the lighter one"
        );
      else if (slack < 10) {
        tightLegs++;
        if (!worst || slack < worst.slack) worst = { slack, prev, cur };
      }
    }
    if (tightLegs >= 3 && worst)
      push(
        dn, "rushing", "soft",
        `${tightLegs} legs run at exactly travel pace (worst: ${worst.slack} min of slack into "${label(worst.cur)}") — the day is a timetable, not a holiday`,
        "build 10-minute buffers into the day, or trade the lightest stop for air"
      );

    /* hunger risk: meals are essentials, not gaps in the slate */
    const waking = items.filter(
      (i) => !LOGISTICS_TYPES.has(i.type) && !(i.type === "rest" && i.part === "day")
    );
    const quietDay =
      day.dayType === "REST" ||
      day.dayType === "OPEN" ||
      items.some((i) => i.type === "rest" && i.part === "day");
    if (!quietDay && waking.length && stops.length) {
      const meals = waking.filter(isMeal);
      const spanStart = waking[0].start, spanEnd = waking[waking.length - 1].end;
      if (!meals.length) {
        if (spanEnd - spanStart > 300)
          push(dn, "hunger-risk", "hard", `a ${spanEnd - spanStart} min planned day with no meal in it at all`, "hold a meal window at midday — a meal is an anchor, not an errand");
      } else {
        let prevEnd = spanStart;
        for (const m of meals) {
          const gap = m.start - prevEnd;
          if (gap > 300)
            push(dn, "hunger-risk", "hard", `${gap} min between ${fmt(prevEnd)} and the meal at ${fmt(m.start)} — hunger is a schedule failure, not a traveler failure`, "pull the meal earlier or hold a meal window inside the gap");
          else if (gap > 240)
            push(dn, "hunger-risk", "soft", `${gap} min stretches to the meal at ${fmt(m.start)} — a long, hungry edge`, "nudge the meal earlier, or set a café pause inside the stretch");
          prevEnd = Math.max(prevEnd, m.end);
        }
        const tail = spanEnd - prevEnd;
        if (tail > 300)
          push(dn, "hunger-risk", "hard", `${tail} min runs after the last meal with the day still going`, "close the day nearer the meal, or add an early dinner anchor");
      }
    }

    /* exhaustion vs the party profile */
    if (profile && stops.length) {
      const positionedPos = positioned.map((i) => i.pos as { lat: number; lon: number });
      const walkKm =
        (day.legs || []).filter((l) => l.mode === "walk").reduce((s, l) => s + (l.km || 0), 0) ||
        positionedPos.reduce((s, c, i) => (i ? s + haversineKm(positionedPos[i - 1], c) : s), 0);
      const dayType = day.dayType || "FULL";
      const budget = profile.walkBudgetKm[dayType] ?? profile.walkBudgetKm.FULL;
      if (walkKm > budget * 1.15)
        push(dn, "exhaustion", "hard", `${walkKm.toFixed(1)} km of walking against this party's ${budget} km day budget (${profile.labels.join("; ")})`, "soften the day: drop the farthest stop or re-anchor near base");
      else if (walkKm > budget)
        push(dn, "exhaustion", "soft", `${walkKm.toFixed(1)} km of walking nudges past this party's ${budget} km day budget`, "trim one leg — the budget exists so the day stays kind");
      const activityMin = stops.reduce((s, i) => s + (i.end - i.start), 0);
      if (activityMin > profile.maxActivityMin * 1.25)
        push(dn, "exhaustion", "hard", `${activityMin} min of scheduled activity against a ${profile.maxActivityMin} min ceiling for this party`, "cut the day down to its best stops — a shorter day, fully enjoyed");
      else if (activityMin > profile.maxActivityMin)
        push(dn, "exhaustion", "soft", `${activityMin} min of scheduled activity over this party's ${profile.maxActivityMin} min comfortable ceiling`, "consider softening this day to LIGHT");
      if (profile.energyBurn && dayType === "FULL") {
        const lunchEnd = items.find(isMeal)?.end;
        const afternoon = stops.filter((i) => i.start >= (lunchEnd ?? 13 * 60));
        const afternoonRests = items.some((i) => i.type === "rest" && (i.part === "afternoon" || i.part === "day"));
        if (!afternoonRests && stops.length >= 3 && !afternoon.some((i) => i.kind === "park" || i.kind === "viewpoint")) {
          push(dn, "energy-burn", "soft", "young kids aboard and no open-space stop after lunch — the energy has nowhere to go", "put a park or open space in the afternoon slot so energy burns outdoors");
        }
      }
    }

    /* stress stacking: logistics back to back to back. One journey
       envelope chain (door → airport → flight → transfer, or pack →
       checkout → transfer) is ONE travel act, not stacked stress — the
       stacking this hunts is separate errands piled mid-day. */
    let moments = 0, momentNames: string[] = [], prevChain = false;
    const flushRun = (): void => {
      if (moments >= 3)
        push(dn, "stress-stacking", "soft", `${moments} separate logistics moments in a row (${momentNames.join(" → ")}) with no pause between`, "insert a pause between the logistics errands — nobody should run a gauntlet on holiday");
      moments = 0;
      momentNames = [];
      prevChain = false;
    };
    for (const it of items) {
      if (LOGISTICS_TYPES.has(it.type)) {
        if (!prevChain) {
          moments++;
          momentNames.push(label(it));
        }
        prevChain = true;
      } else if (it.kind === "ferry") {
        moments++;
        momentNames.push(label(it));
        prevChain = false;
      } else if (it.type === "stop" || it.type === "food" || it.type === "rest") {
        flushRun();
      }
    }
    flushRun();

    /* early check-in is a gift, not a summons (owner, 2026-10-21):
       when the room opens early and the day re-flows, the freed time
       is an OFFER. A re-flowed afternoon stuffed past the gentle
       shape the arrival day was capped at is a finding — the
       traveler just traveled; the plan may not spend their windfall
       for them. */
    if (day.reflow?.earlyCheckIn && profile) {
      const refreshEnd = items.find((i) => i.type === "rest" && i.part === "refresh")?.end;
      const afternoon = items.filter(
        (i) => i.type === "stop" && (refreshEnd == null || i.start >= refreshEnd)
      ); // sightseeing only — the lunch is an essential that predates the event, not afternoon stuffing
      const actMin = afternoon.reduce((s, i) => s + (i.end - i.start), 0);
      const walkKmA = (day.legs || [])
        .filter((l) => l.mode === "walk" && l.depart >= (refreshEnd ?? 0))
        .reduce((s, l) => s + (l.km || 0), 0);
      if (afternoon.length > 2 || actMin > profile.maxActivityMin / 2 || walkKmA > profile.walkBudgetKm.LIGHT * 1.15) {
        push(
          dn, "early-checkin-stuffing", "hard",
          `the room opened early and the afternoon was stuffed in answer: ${afternoon.length} stops, ${actMin} min of activity, ${walkKmA.toFixed(1)} km of walking after the rest block — past the gentle (LIGHT) shape an arrival day is capped at`,
          "an early room is a gift of time, not a summons: keep the gentle afternoon as the plan and offer the fuller one — the traveler chooses"
        );
      }
    }

    /* departure cruelty, judged on the last day */
    if (day === lastDay) {
      for (const s of stops) {
        if (isHeadline(s))
          push(
            dn, "departure-cruelty", "hard",
            `the last day carries a headline sight — "${label(s)}" — when it should be winding down`,
            "move the headline into the body of the trip; the last day is for souvenirs, strolling, and leaving well"
          );
      }
    }
  }

  /* late night before an early flight (the eve of a dawn departure) */
  const dep = lastDay?.envelope?.departure;
  const dawnFlight = dep && dep.flightMin < 10 * 60;
  const eve = sorted[sorted.length - 2];
  if (dawnFlight && eve) {
    for (const it of eve.items || []) {
      if (it.start != null && !LOGISTICS_TYPES.has(it.type) && it.type !== "pack" && it.end > 21 * 60) {
        push(
          eve.dayNumber, "departure-cruelty", "hard",
          `"${label(it)}" runs to ${fmt(it.end)} the night before a ${fmt(dep.flightMin)} flight`,
          "wind the evening down by 21:00 — an early flight is paid for the night before"
        );
      }
    }
  }

  /* anticlimax + delight spacing, across the trip */
  // Envelope-shaped days are not "full days" for ending/delight math:
  // the arrival day is capped by the journey and the departure day is
  // gentle ON PURPOSE — an empty-feeling departure day is the design.
  const fullLike = (d: EngineDay): boolean =>
    !d.envelope?.arrival &&
    !d.envelope?.departure &&
    (d.dayType ? d.dayType === "FULL" : ["standard", "excursion", "ferry"].includes(d.role));
  const fullDays = sorted.filter(fullLike);
  const highlightsOf = (d: EngineDay): number => (d.items || []).filter(isHighlight).length;
  const stopsOf = (d: EngineDay): number => (d.items || []).filter((i) => i.type === "stop").length;
  const lastFull = fullDays[fullDays.length - 1];
  if (lastFull && fullDays.length >= 3) {
    const maxEarlier = Math.max(...fullDays.slice(0, -1).map(stopsOf));
    if (stopsOf(lastFull) <= 1 && maxEarlier >= 4)
      push(lastFull.dayNumber, "anticlimax", "soft", `the last full day carries ${stopsOf(lastFull)} stop(s) while an earlier day carries ${maxEarlier} — the trip ends with a shrug`, "move one good stop into the last full day so the trip ends near its best");
    if (highlightsOf(lastFull) === 0 && sorted.reduce((s, d) => s + highlightsOf(d), 0) >= 4)
      push(lastFull.dayNumber, "anticlimax", "soft", "the last full day holds no highlight at all, in a trip that has several", "give the last full day one memorable stop — endings are what travelers retell");
  }
  for (const d of fullDays) {
    if (highlightsOf(d) === 0 && stopsOf(d) >= 2)
      push(d.dayNumber, "delight-spacing", "soft", "a full day with no highlight in it — competent, forgettable", "trade one ordinary stop for the best unused candidate nearby");
  }
  const totalHighlights = sorted.reduce((s, d) => s + highlightsOf(d), 0);
  if (sorted.length && totalHighlights >= 5 && highlightsOf(sorted[0]) / totalHighlights >= 0.6) {
    push(
      sorted[0].dayNumber, "delight-spacing", "soft",
      `${highlightsOf(sorted[0])} of the trip's ${totalHighlights} highlights are stacked on day 1 — the rest of the trip lives in its shadow`,
      "spread the highlights: move one headline to a later day so every day has something to look forward to"
    );
  }

  const hard = findings.filter((f) => f.severity === "hard").length;
  return { verdict: hard ? "FAIL" : "PASS", hard, soft: findings.length - hard, findings };
}
