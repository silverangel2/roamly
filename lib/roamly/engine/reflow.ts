import { fmt, haversineKm, parseHoursForDay, walkMin, weekdayOf } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem, EngineLeg, EnginePack, EnginePos } from "@/lib/roamly/engine/util";
import { DURATIONS } from "@/lib/roamly/engine/solver";
import type { LocalDate } from "@/lib/roamly/engine/time";

/*
 * reflow — REFLOW (Phase 2 port of the shadow zero-engine's
 * reflow.mjs): travel-day events against an arrival day —
 * EARLY CHECK-IN and its mirror, LATE CHECK-IN. Same repair pattern
 * as the travel-day spike: the day is re-shaped by deterministic
 * transforms on the plan, never by a model.
 *
 * The law underneath (owner hard rule): a room wait may only contain
 * interruptible content — so when the room opens early, NOTHING
 * promised is lost by accepting it. The rest & refresh block MOVES
 * UP with the anchor (rest is preserved — the travel still
 * happened), and the freed time becomes an OFFER: a fuller afternoon
 * exists as a proposal beside the gentle standing plan; the traveler
 * chooses. Early check-in is never an excuse to cram (the Emotion
 * bot's early-checkin-stuffing finding guards the afternoon).
 *
 * The mirror: a late room extends the soft wait (bags held at the
 * desk — a LABELED assumption), rest shifts with the anchor, the
 * afternoon softens, and a notification fires only if a timed item
 * is actually threatened.
 *
 * Port note (PORTABILITY: "normalize the item/hours DTO first"):
 * the shadow read a spike-era `cand.hours` field that pack
 * candidates do not carry, so its hours check never engaged. The
 * port reads the pack's one candidate-hours shape (hoursRaw) —
 * unknown hours never block an offer (stated plainly), known hours
 * are honored with the shadow's own slack (-15/+30 min).
 */

const SOFT_END_AFTER_LATE = 17 * 60 + 30; // a softened day lets go by 17:30

type CandHours =
  | { status: "known"; open: number; close: number }
  | { status: "closed" }
  | { status: "unknown" };

function hoursForCand(cand: { hoursRaw: string | null }, dateIso: LocalDate): CandHours {
  const parsed = parseHoursForDay(cand.hoursRaw, weekdayOf(dateIso));
  if (parsed.status === "known") return { status: "known", open: parsed.open, close: parsed.close };
  if (parsed.status === "closed") return { status: "closed" };
  return { status: "unknown" };
}

function fitsHours(cand: { hoursRaw: string | null }, dateIso: LocalDate, start: number, dur: number): boolean {
  const h = hoursForCand(cand, dateIso);
  if (h.status === "unknown") return true; // unknown hours never block an offer; stated plainly on the card
  if (h.status === "closed") return false;
  return start >= h.open - 15 && start + dur <= h.close + 30;
}

export interface AfternoonOptions {
  fuller: EngineItem[];
  gentle: EngineItem[];
}

/**
 * A gentle afternoon chain from the base, built from candidates the
 * trip has not used — the spike's greedy pattern: nearest feasible
 * next, hours-respecting, walking legs only (an offer you stroll
 * to). fuller = the chain up to maxStops; gentle = its first stop
 * only.
 */
export function buildAfternoonOptions(args: {
  pack: EnginePack;
  dateIso: LocalDate;
  basePos: EnginePos;
  usedKeys: ReadonlySet<string>;
  notBeforeMin: number;
  maxStops?: number;
  startPos?: EnginePos | null;
  startKey?: string;
  startName?: string | null;
}): AfternoonOptions {
  const {
    pack,
    dateIso,
    basePos,
    usedKeys,
    notBeforeMin,
    maxStops = 2,
    startPos = null,
    startKey = "base",
    startName = null
  } = args;
  const chain: EngineItem[] = [];
  let pos = startPos || basePos, t = notBeforeMin;
  const taken = new Set(usedKeys);
  while (chain.length < maxStops) {
    let best: { c: EnginePack["sights"][number]; km: number; start: number; dur: number } | null = null;
    for (const c of [...pack.sights]) {
      if (taken.has(c.key) || ["food", "restaurant", "cafe", "fast_food", "bar", "bakery"].includes(c.kind)) continue;
      const km = haversineKm(pos, c.pos);
      if (km > 1.2) continue;
      const start = t + walkMin(km);
      const dur = DURATIONS[c.kind] || 45;
      if (start + dur > 19 * 60) continue;
      if (!fitsHours(c, dateIso, start, dur)) continue;
      if (!best || km < best.km) best = { c, km, start, dur };
    }
    if (!best) break;
    chain.push({
      type: "stop",
      role: "option",
      key: best.c.key,
      name: best.c.name,
      kind: best.c.kind,
      start: best.start,
      end: best.start + best.dur,
      pos: best.c.pos,
      url: best.c.url || undefined,
      hours: hoursForCand(best.c, dateIso),
      priceProvenance: "UNKNOWN",
      walkKmFromPrev: Math.round(best.km * 100) / 100,
      fromKeyPrev: chain.length === 0 ? startKey : chain[chain.length - 1].key,
      fromNamePrev: chain.length === 0 ? startName || "the stay" : chain[chain.length - 1].name
    });
    taken.add(best.c.key);
    pos = best.c.pos;
    t = best.start + best.dur;
  }
  return { fuller: chain, gentle: chain.slice(0, 1) };
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

export interface EarlyCheckInRecord {
  event: "early-check-in";
  roomReadyMin: number;
  roomReadyLabel: string;
  originalCheckInMin: number;
  freedMin: number;
  restPreservedMin: number;
  lunchMoved: { name: string | undefined; from: string; to: string } | null;
  standingPlan: "gentle";
  options: { gentle: string[]; fuller: string[] };
  note: string;
}

/**
 * EARLY CHECK-IN: the room is ready at roomReadyMin (< the stated
 * check-in). The wait dissolves, check-in and rest & refresh move up
 * with the anchor (rest minutes preserved), a wait-held lunch that
 * collides with the moved rest slides to just after it (same venue —
 * it is a plan item, not a booking), and the afternoon is re-offered:
 * the standing plan is the GENTLE option; the FULLER option rides
 * alongside as a proposal. Returns { day, record }.
 */
export function applyEarlyCheckIn(
  day: EngineDay,
  args: { roomReadyMin: number; options: AfternoonOptions }
): { day: EngineDay; record: EarlyCheckInRecord } {
  const { roomReadyMin, options } = args;
  const envA = day.envelope?.arrival;
  if (!envA) throw new Error("applyEarlyCheckIn: day has no arrival envelope");
  const restDur = envA.restMinutes;
  const items: EngineItem[] = [];
  const record: EarlyCheckInRecord = {
    event: "early-check-in",
    roomReadyMin,
    roomReadyLabel: fmt(roomReadyMin),
    originalCheckInMin: envA.checkInMin,
    freedMin: envA.checkInMin - roomReadyMin,
    restPreservedMin: restDur,
    lunchMoved: null,
    standingPlan: "gentle",
    options: {
      gentle: options.gentle.map((i) => `${i.name} ${fmt(i.start)}–${fmt(i.end)}`),
      fuller: options.fuller.map((i) => `${i.name} ${fmt(i.start)}–${fmt(i.end)}`)
    },
    note: "the freed time is an OFFER, never stuffed: the gentle afternoon stands as the plan; the fuller one is proposed and the traveler chooses"
  };
  const checkInEnd = roomReadyMin + 15;
  const restStart = checkInEnd, restEnd = restStart + restDur;
  for (const it of day.items) {
    if (it.type === "journey") {
      items.push(clone(it));
      continue;
    }
    if (it.type === "rest" && it.part === "arrival-wait") continue; // the wait dissolves — its content was interruptible by design
    if (it.type === "checkin") {
      items.push({ ...clone(it), start: roomReadyMin, end: checkInEnd, sub: `the room was ready early — the desk had it for you at ${fmt(roomReadyMin)}` });
      continue;
    }
    if (it.type === "rest" && it.part === "refresh") {
      items.push({ ...clone(it), start: restStart, end: restEnd });
      continue;
    }
    if (it.type === "food") {
      const lunch = clone(it);
      if (lunch.start < restEnd && lunch.end > restStart) {
        // collides with the moved-up rest: slide to just after it
        record.lunchMoved = {
          name: lunch.name,
          from: `${fmt(lunch.start)}–${fmt(lunch.end)}`,
          to: `${fmt(restEnd)}–${fmt(restEnd + (lunch.end - lunch.start))}`
        };
        const dur = lunch.end - lunch.start;
        lunch.start = restEnd;
        lunch.end = restEnd + dur;
      }
      items.push(lunch);
      continue;
    }
    // the day's own post-refresh stops are replaced by the offered afternoon
  }
  for (const o of options.gentle) items.push(clone(o));
  items.sort((a, b) => a.start - b.start);
  const legs: EngineLeg[] = [];
  const checkinItem = day.items.find((i) => i.type === "checkin");
  const baseName = checkinItem?.name || "the stay";
  const basePos = checkinItem?.pos || null;
  for (const it of items) {
    if (it.type === "stop" && it.pos && it.walkKmFromPrev != null) {
      const km = it.walkKmFromPrev, wm = walkMin(km);
      legs.push({
        fromKey: it.fromKeyPrev || "base", toKey: it.key || "", fromName: it.fromNamePrev || baseName,
        toName: it.name || "", mode: "walk", km, minutes: wm,
        depart: it.start - wm, arrive: it.start, departTime: fmt(it.start - wm), arriveTime: fmt(it.start)
      });
      const backKm = basePos ? Math.round(haversineKm(it.pos, basePos) * 100) / 100 : km;
      const backMin = walkMin(backKm);
      legs.push({
        fromKey: it.key || "", toKey: "base", fromName: it.name || "", toName: baseName,
        mode: "walk", km: backKm, minutes: backMin,
        depart: it.end, arrive: it.end + backMin, departTime: fmt(it.end), arriveTime: fmt(it.end + backMin)
      });
    }
  }
  const newDay: EngineDay = {
    ...clone(day),
    items,
    legs,
    endMin: Math.max(...items.map((i) => i.end)),
    envelope: {
      ...clone(day.envelope),
      arrival: {
        ...envA,
        checkInMin: roomReadyMin,
        checkInProvenance:
          "hotel event — the room was ready early (a travel-day event, reported by the desk; not a plan input)",
        reflowed: "early-check-in"
      }
    },
    reflow: { earlyCheckIn: true, roomReadyMin }
  };
  return { day: newDay, record };
}

export interface LateCheckInRecord {
  event: "late-check-in";
  roomReadyMin: number;
  roomReadyLabel: string;
  originalCheckInMin: number;
  waitExtendedMin: number;
  luggage: string;
  restPreservedMin: number;
  threatened: string[];
  notify: boolean;
  notifyText: string | null;
}

/**
 * LATE CHECK-IN (the mirror): the room will not be ready until
 * roomReadyMin (> the stated check-in). The soft wait extends around
 * the (interruptible) lunch, bags are held at the desk — a labeled
 * assumption, never a promised fact — check-in and rest shift with
 * the anchor, and the afternoon SOFTENS: a post-rest stop survives
 * only if the softened day still lets go by 17:30. The record says
 * whether a notification is owed (only when a timed item is
 * threatened). Returns { day, record }.
 */
export function applyLateCheckIn(
  day: EngineDay,
  args: { roomReadyMin: number }
): { day: EngineDay; record: LateCheckInRecord } {
  const { roomReadyMin } = args;
  const envA = day.envelope?.arrival;
  if (!envA) throw new Error("applyLateCheckIn: day has no arrival envelope");
  const restDur = envA.restMinutes;
  const items: EngineItem[] = [];
  const threatened: string[] = [];
  const record: LateCheckInRecord = {
    event: "late-check-in",
    roomReadyMin,
    roomReadyLabel: fmt(roomReadyMin),
    originalCheckInMin: envA.checkInMin,
    waitExtendedMin: roomReadyMin - envA.checkInMin,
    luggage:
      "bags held at the front desk during the wait — LABELED ASSUMPTION (standard hotel practice; not data, never promised)",
    restPreservedMin: restDur,
    threatened,
    notify: false,
    notifyText: null
  };
  const checkInEnd = roomReadyMin + 15;
  const restEnd = checkInEnd + restDur;
  let lunchItem: EngineItem | null = null;
  for (const it of day.items) if (it.type === "food") lunchItem = it;
  // lay the soft wait: settle blocks fill [arriveBase, roomReady]
  // around the lunch
  const waits: EngineItem[] = [];
  const cursor = envA.arriveBaseMin;
  const spans: [number, number][] = [];
  if (lunchItem) spans.push([cursor, lunchItem.start], [lunchItem.end, roomReadyMin]);
  else spans.push([cursor, roomReadyMin]);
  spans
    .filter(([a, b]) => b - a >= 5)
    .forEach(([a, b], i) =>
      waits.push({
        type: "rest",
        part: "arrival-wait",
        key: `wait-late-${day.date}-${i}`,
        title: "Settle in near base — the room is not ready yet",
        sub: i === 0 ? record.luggage : undefined,
        start: a,
        end: b,
        pos: null
      })
    );
  for (const it of day.items) {
    if (it.type === "journey") {
      items.push(clone(it));
      continue;
    }
    if (it.type === "rest" && it.part === "arrival-wait") continue; // re-laid above
    if (it.type === "checkin") {
      items.push({ ...clone(it), start: roomReadyMin, end: checkInEnd, sub: "the desk confirmed the later time — the wait above is soft on purpose" });
      continue;
    }
    if (it.type === "rest" && it.part === "refresh") {
      items.push({ ...clone(it), start: checkInEnd, end: restEnd });
      continue;
    }
    if (it.type === "food") {
      items.push(clone(it));
      continue;
    } // interruptible by design — it rides the wait unchanged
    if (it.type === "stop") {
      const dur = it.end - it.start;
      const start = restEnd + 3, end = start + dur;
      if (end <= SOFT_END_AFTER_LATE) items.push({ ...clone(it), start, end });
      else
        threatened.push(
          `${it.name} (was ${fmt(it.start)}–${fmt(it.end)}; after a ${fmt(roomReadyMin)} room and a full rest it would end ${fmt(end)} — past the softened day's 17:30 let-go)`
        );
    }
  }
  items.push(...waits);
  items.sort((a, b) => a.start - b.start);
  record.notify = threatened.length > 0;
  if (record.notify)
    record.notifyText = `Your room will be ready at ${fmt(roomReadyMin)} instead of ${fmt(envA.checkInMin)}. Nothing you had booked is affected; one gentle stop no longer fits the softened day: ${threatened.join("; ")}. It is held for another day — reply if you would rather push on.`;
  const newDay: EngineDay = {
    ...clone(day),
    items,
    endMin: Math.max(...items.map((i) => i.end)),
    envelope: {
      ...clone(day.envelope),
      arrival: {
        ...envA,
        checkInMin: roomReadyMin,
        checkInProvenance:
          "hotel event — the room ran late (a travel-day event, reported by the desk; not a plan input)",
        reflowed: "late-check-in"
      }
    },
    reflow: { lateCheckIn: true, roomReadyMin }
  };
  return { day: newDay, record };
}
