import { DINNER_START, dateLong, fmt, mealNameFor, shortName } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem } from "@/lib/roamly/engine/util";
import type { TripArc } from "@/lib/roamly/engine/continuity";
import type { LedgerEntry, SeamDayLike } from "@/lib/roamly/engine/continuity";

/*
 * frames — frame library + narrative composer (Phase 2 port of the
 * shadow zero-engine's frames.mjs).
 *
 * RI-style discipline: grammar comes from frames, facts come only
 * from the context pack and solver arithmetic. Readability bar
 * (owner, 2026-10-21):
 *   - >= 40 frames; no frame repeats within a day;
 *   - full place name on first mention, short name after;
 *   - NO data labels in prose (no UNKNOWN / ESTIMATED / UNVERIFIED
 *     words) — caveats are soft human sentences, at most one per
 *     topic per day;
 *   - prices are simply absent when unknown.
 *
 * The composed narrative voice is preserved VERBATIM from the shadow
 * frames — every frame string below is the shadow's own sentence.
 */

/** The data a frame may read. Frames are pure functions of this bag. */
export type FrameData = Record<string, string | number>;

type FrameFn = (d: FrameData) => string;

// Faithful to the shadow's template interpolation: a missing field
// renders "undefined", a null renders "null" — never silently "".
const S = (d: FrameData, k: string): string => String(d[k]);

export const FRAMES: Record<string, FrameFn> = {
  // Day-open frames (final local round, 2026-10-27): plain plan facts
  // only. The previous wording judged the plan's times and pacing
  // in words the plan data does not carry. Each replacement names
  // only what the plan itself says: the day's real first stop + its
  // real time, or the plan's own day type. No time or activity is
  // ever invented here; the frame data bag comes from the solver's
  // day items.
  dayOpen1: (d) => `${S(d, "dateLong")} starts with ${S(d, "firstName")} at ${S(d, "firstTime")}.`,
  dayOpen2: (d) => `${S(d, "dateLong")} is built around ${S(d, "anchorName")}.`,
  dayOpen3: (d) => `Day ${S(d, "dayNumber")} — ${S(d, "dateLong").toLowerCase()} — starts at ${S(d, "earliest")} with ${S(d, "anchorName")}.`,
  dayOpenRest: (d) => `${S(d, "dateLong")} starts slowly, with the morning left open.`,
  // Pacing day types (owner, 2026-10-21): the composer narrates the
  // shape honestly — a slow day is a feature of the plan, never an
  // apology.
  dayOpenLight: (d) => `${S(d, "dateLong")} is a light day.`,
  dayOpenRestDay: (d) => `${S(d, "dateLong")} is a slow day, on purpose: nothing is booked, and nothing needs booking.`,
  dayOpenOpen: (d) => `${S(d, "dateLong")} is an open day, on purpose — no fixed plans at all.`,
  openIdeas: (d) => `If the mood strikes, the day has gentle options: ${S(d, "ideas")}. Nothing is booked and nothing is expected — they are simply there if wanted.`,
  suggestSoft: (d) => `If the mood strikes, ${S(d, "name")} is a gentle option about ${S(d, "minutes")} minutes away. But the day is yours either way.`,
  dayOpenMove: (d) => `${S(d, "dateLong")} is moving day — ${S(d, "fromName")} to ${S(d, "toName")}. The transfer is pencilled in below; your booking has the final word on times.`,
  moveStop: (d) => `Once you are in, ${S(d, "name")} is a gentle first wander near the new base, ${S(d, "start")}–${S(d, "end")} — only if the travel day has been kind.`,
  dayOpenExcursion: (d) => `${S(d, "dateLong")} is the day for ${S(d, "excursionName")} — the trip's headline outing, given the room it deserves.`,
  weatherDry: (d) => `The forecast helps today: ${S(d, "tMax")}° and only a ${S(d, "precip")}% chance of rain, which is why the outdoor outing sits here.`,
  weatherWet: (d) => `Rain is likelier today (${S(d, "precip")}% chance), so the plan leans indoors and keeps the outdoor time short.`,
  weatherMild: (d) => `Expect a mild ${S(d, "tMax")}° — good walking weather, with layers for the shade.`,
  anchorStay: (d) => `The base for the night is ${S(d, "stayName")}, picked for what surrounds it: ${S(d, "sightCount")} sights within a short walk.`,
  walk1: (d) => `From ${S(d, "from")}, it is a ${S(d, "minutes")}-minute walk to ${S(d, "to")} — close enough to stroll without watching the clock.`,
  walk2: (d) => `${S(d, "to")} is next, just ${S(d, "minutes")} minutes on foot from ${S(d, "from")}.`,
  walk3: (d) => `The walk from ${S(d, "from")} to ${S(d, "to")} takes about ${S(d, "minutes")} minutes — a breather between stops, not a hike.`,
  walk4: (d) => `A short wander of ${S(d, "minutes")} minutes brings you to ${S(d, "to")}.`,
  walk5: (d) => `${S(d, "from")} to ${S(d, "to")} is an easy ${S(d, "minutes")}-minute amble.`,
  drive1: (d) => `Then the day's one longer leg: about ${S(d, "minutes")} minutes by road to ${S(d, "to")}.`,
  drive2: (d) => `A drive of roughly ${S(d, "minutes")} minutes takes you out to ${S(d, "to")}.`,
  driveBack1: (d) => `The drive back to base runs about ${S(d, "minutes")} minutes.`,
  driveBack2: (d) => `Afterwards, the return trip to ${S(d, "baseName")} takes around ${S(d, "minutes")} minutes.`,
  museum1: (d) => `${S(d, "name")} gets the morning's main slot, ${S(d, "start")} to ${S(d, "end")} — unhurried, with time to double back to favourites.`,
  museum2: (d) => `Give ${S(d, "name")} a full ${S(d, "dur")} minutes (${S(d, "start")}–${S(d, "end")}); rushing it would miss the point.`,
  attraction1: (d) => `${S(d, "name")} fills ${S(d, "start")}–${S(d, "end")} — long enough to enjoy properly, short enough to keep the day light.`,
  attraction2: (d) => `Next up is ${S(d, "name")}, from ${S(d, "start")} to ${S(d, "end")}.`,
  park1: (d) => `${S(d, "name")} is the day's green pause, ${S(d, "start")}–${S(d, "end")} — no tickets, no timetable to chase.`,
  park2: (d) => `A slower stretch follows at ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")}.`,
  historic1: (d) => `${S(d, "name")} adds the day's history, ${S(d, "start")}–${S(d, "end")}.`,
  gallery1: (d) => `${S(d, "name")} offers a quieter hour indoors, ${S(d, "start")}–${S(d, "end")}.`,
  market1: (d) => `${S(d, "name")} is the place to browse like a local, ${S(d, "start")}–${S(d, "end")} — go hungry.`,
  venue1: (d) => `${S(d, "name")} anchors the stop from ${S(d, "start")} to ${S(d, "end")}.`,
  generic1: (d) => `${S(d, "name")} is scheduled for ${S(d, "start")}–${S(d, "end")}.`,
  generic2: (d) => `Then ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")}.`,
  falls1: (d) => `${S(d, "name")} — the outing named in the request — gets a full ${S(d, "dur")} minutes, ${S(d, "start")}–${S(d, "end")}.`,
  lighthouse1: (d) => `${S(d, "name")} rewards the drive: ${S(d, "dur")} minutes there, ${S(d, "start")}–${S(d, "end")}, with the coast doing the talking.`,
  ferry1: (d) => `The ferry crossing is the morning's small adventure: board at ${S(d, "name")} around ${S(d, "start")} and give the round trip until ${S(d, "end")}. Sailing times weren't listed in the map data, so treat the start as flexible and check the board at the terminal.`,
  ferry2: (d) => `${S(d, "name")} is where the ferry leaves from — the crossing and back are pencilled for ${S(d, "start")}–${S(d, "end")}, with the terminal board as the final word on times.`,
  lunch1: (d) => `Lunch is at ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")}.`,
  lunch2: (d) => `By ${S(d, "start")} it is time to eat — ${S(d, "name")}, until about ${S(d, "end")}.`,
  // Meals are named by the clock (owner fix, 2026-10-21): breakfast
  // and dinner get their own frames so an evening meal is never
  // called lunch.
  breakfast1: (d) => `Breakfast is at ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")} — the day starts at the table.`,
  dinner1: (d) => `Dinner is at ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")}.`,
  dinner2: (d) => `By ${S(d, "start")} the day has earned its dinner — ${S(d, "name")}, until about ${S(d, "end")}.`,
  dietStrong: (d) => `The choice is backed by the restaurant's own listing, which marks it ${S(d, "evidence")} — the dietary need is provided for, not hoped for.`,
  dietVeganBonus: () => `Because the kitchen is vegan-only, its menu carries no egg either; only shared-surface cross-contact can't be confirmed from listings, so a quick word on arrival is still wise.`,
  dietSoft: () => `Listings don't spell out the dietary details here, so a quick word with the kitchen on arrival is the safe move.`,
  hoursKnown1: (d) => `${S(d, "name")} lists its hours as ${S(d, "open")}–${S(d, "close")} today, and the visit sits comfortably inside them.`,
  hoursSoft1: (d) => `Opening hours weren't listed for ${S(d, "name")} — worth a glance at the door, though the visit is set mid-day when places are likeliest to be open.`,
  restPm1: () => `After lunch the plan stops on purpose: the afternoon is rest — back at base, with nothing booked and nowhere to be.`,
  restPm2: () => `The afternoon belongs to rest. Nothing is scheduled, and that is the schedule.`,
  restAm1: () => `The morning is deliberately empty — a slow start with nothing booked at all, exactly as asked.`,
  evening1: (d) => `The day winds down back at base by ${S(d, "end")} — ${S(d, "stopCount")} stops, no long walks, and the evening left free.`,
  evening2: (d) => `By ${S(d, "end")} you are back near base, with the evening unscheduled and dinner wherever looks good.`,
  // Evening-aware closes (owner fix, 2026-10-21): when the day carries
  // a timed evening commitment, the close NAMES it — "the evening
  // left free" may only be said when the evening is actually free.
  eveningPlan1: (d) => `By ${S(d, "end")} the planned part of the day is done — what remains is the evening, and it is spoken for: ${S(d, "name")} at ${S(d, "time")}.`,
  eveningPlan2: (d) => `The day itself winds down by ${S(d, "end")}; the evening belongs to ${S(d, "name")} at ${S(d, "time")}.`,
  dayNoteFerry: () => `If the terminal board shows a long wait, swap the crossing to tomorrow morning — everything else on this day still holds.`,
  // Journey envelope (owner, 2026-10-21): the day begins at the front
  // door and ends at the gate. Facts only — chain times, check-in
  // truth, protected pack-up; the feelings are in the shapes, not in
  // adjectives.
  arriveFlyOpen: (d) => `${S(d, "dateLong")} starts at your own front door: out at ${S(d, "leave")}, the airport buffer kept whole, a flight of about ${S(d, "flightDur")}, and into ${S(d, "base")} around ${S(d, "arrive")}.`,
  arriveDriveOpen: (d) => `${S(d, "dateLong")} starts at your own front door: the drive in takes about ${S(d, "driveDur")}, and you reach ${S(d, "base")} around ${S(d, "arrive")}.`,
  checkinWaitLine: (d) => `The room is not promised until ${S(d, "checkIn")} — no room access is assumed before then, so the plan waits gently near base.`,
  checkinLine: (d) => `Check-in is at ${S(d, "checkIn")} — bags down, keys in hand.`,
  restRefreshLine: (d) => `Then the plan stops on purpose: ${S(d, "restDur")} to rest and refresh. Travel is part of the trip, and it takes something out of you — the sights will keep.`,
  breakLine: () => `A short pause is built in here — sit down, water, nowhere to be for a few minutes.`,
  mealWindowLine: (d) => `${S(d, "meal")} is a window, not a booking — the plan holds the hour and lets you eat where you find a spot you like.`,
  departOpen: (d) => `${S(d, "dateLong")} is the last day, and the plan bends around the ${S(d, "flightTime")} flight: gentle things first, the bags packed in good time, and out of the hotel at ${S(d, "leave")}.`,
  dawnOpen: (d) => `${S(d, "dateLong")} is the last day, and the flight leaves at ${S(d, "flightTime")} — so the morning is only the essentials: check out, transfer, go. Nothing is scheduled, and that is the plan.`,
  packLine: (d) => `Pack-up is protected time, ${S(d, "start")}–${S(d, "end")}: close the bags, check the room twice — nothing is scheduled against it.`,
  packEveLine: (d) => `Tonight the bags get packed, ${S(d, "start")}–${S(d, "end")}, and the evening winds down early — tomorrow's start is at dawn, and it will be only essentials.`,
  souvenirLine: (d) => `${S(d, "name")} is the morning's gentle business — souvenirs and browsing, ${S(d, "start")}–${S(d, "end")}; anything in your hands can simply be put down.`,
  strollLine: (d) => `A last stroll at ${S(d, "name")}, ${S(d, "start")}–${S(d, "end")} — the trip ends the way it should: unhurried.`,
  // Continuity — narrative memory (owner, 2026-10-21): the story
  // knows what the trip has already done. Every frame below fires
  // ONLY on a deterministic trigger from the ledger / arc / seam
  // state — a place the ledger says returned, a commitment the
  // ledger says moved, the arc's peak and landing. Nothing here is
  // decoration.
  peakDayOpen: (d) => `If this trip has a high point, today is it — ${S(d, "dateLong")} is built around ${S(d, "name")}, the stop everything else has been leading toward.`,
  returnVisit: (d) => `${S(d, "name")} again — first visited on ${S(d, "firstDateLong")}, and some places earn a second visit. A favourite now, not just a stop.`,
  keptForToday: (d) => `${S(d, "name")} was meant for ${S(d, "fromDateLong")} — ${S(d, "reason")} — so it was kept for today instead, and given the room it deserves.`,
  movedOnLine: (d) => `${S(d, "name")} was meant for today — ${S(d, "reason")} — so it has been kept for ${S(d, "toDateLong")}, where it gets a proper day. Nothing promised is quietly dropped on this trip.`,
  windingDown: (d) => `The trip is winding down now — ${S(d, "remaining")} — and the plan lets it: today is not trying to outdo what came before.`,
  seamChain: (d) => `Leaving ${S(d, "fromName")} and arriving in ${S(d, "toName")} is one motion, not two journeys: out of the old base, the transfer, and into the new one — no orphaned hours in between.`,
  seamBags: (d) => `Your bags stay with you the whole way, until check-in at ${S(d, "checkIn")} — and once they are down, the rest comes before anything else. Travel days ask enough without asking for a performance at the end of them.`
};

export const FRAME_COUNT: number = Object.keys(FRAMES).length;

/* ------------------------------------------------------------------ */

export interface ComposerState {
  mentions: Map<string, number>;
  usedToday: Set<string>;
}

/** Composer state shared across a whole trip: mentions persist,
 *  frame use resets per day. */
export function newComposerState(): ComposerState {
  return { mentions: new Map(), usedToday: new Set() };
}

export interface ComposeContext {
  earliestLabel: string;
  stay: { name: string; walkableSights: number } | null;
  weatherByDate?: Record<string, { tMax?: number | null; precipProb: number | null }>;
  baseName: string;
  hasDietary: boolean;
}

/* ------------------------------------------------------------------ */
/* Narrative memory (continuity, owner 2026-10-21).                    */
/* The composer above writes each day as it is built; this pass gives  */
/* the ASSEMBLED trip a story-so-far. buildStoryState reads the plan,  */
/* the arc, the commitment ledger, and the seam records — nothing      */
/* else — and annotateNarrative weaves the memory lines into the      */
/* days' existing prose. Triggers are deterministic state only: a      */
/* return is a key the ledger saw twice; a re-home is a ledger entry   */
/* with status 'rehomed'; the peak and landing are the arc's words.    */
/* ------------------------------------------------------------------ */

export interface StoryReturn {
  day: number;
  key: string;
  name: string | undefined;
  firstDay: number;
  firstDate: string;
}

export interface StoryRehome {
  day: number | null;
  key: string | null;
  name: string;
  fromDay: number | null;
  fromDate?: string;
  toDay?: number | null;
  toDate?: string;
  reason?: string;
}

export interface StoryState {
  returns: StoryReturn[];
  rehomedIn: StoryRehome[];
  rehomedOut: StoryRehome[];
  peakDay: number | null;
  landDay: number | null;
  settleDay: number | null;
  peakName?: string;
  arcRoles: Record<number, string>;
  seams: Record<number, SeamDayLike & { fromBase: string; toBase: string; checkInLabel: string }>;
  totalDays: number;
}

export function buildStoryState(
  days: EngineDay[],
  opts: {
    arc?: TripArc | null;
    ledger?: LedgerEntry[];
    seams?: (SeamDayLike & { fromBase: string; toBase: string; checkInLabel: string })[];
  } = {}
): StoryState {
  const { arc = null, ledger = [], seams = [] } = opts;
  const seen = new Map<string, { day: number; date: string; name: string | undefined }>(); // item key -> first visit
  const returns: StoryReturn[] = [];
  for (const day of [...days].sort((a, b) => a.dayNumber - b.dayNumber)) {
    for (const item of day.items || []) {
      if (!item.key || (item.type !== "stop" && item.type !== "food")) continue;
      const prior = seen.get(item.key);
      if (prior && prior.day !== day.dayNumber) {
        returns.push({ day: day.dayNumber, key: item.key, name: item.name, firstDay: prior.day, firstDate: prior.date });
      } else if (!prior) seen.set(item.key, { day: day.dayNumber, date: day.date, name: item.name });
    }
  }
  const byDay = (n: number | null): EngineDay | undefined =>
    n == null ? undefined : days.find((d) => d.dayNumber === n);
  const rehomedIn: StoryRehome[] = [], rehomedOut: StoryRehome[] = [];
  for (const e of ledger.filter((x) => x.status === "rehomed")) {
    rehomedIn.push({
      day: e.toDay ?? null, key: e.itemKey, name: e.itemName || e.label,
      fromDay: e.homeDay, fromDate: byDay(e.homeDay)?.date, reason: e.reason
    });
    rehomedOut.push({
      day: e.homeDay, key: e.itemKey, name: e.itemName || e.label,
      fromDay: e.homeDay, toDay: e.toDay, toDate: byDay(e.toDay ?? null)?.date, reason: e.reason
    });
  }
  return {
    returns,
    rehomedIn,
    rehomedOut,
    peakDay: arc?.peakDay ?? null,
    landDay: arc?.landDay ?? null,
    settleDay: arc?.settleDay ?? null,
    arcRoles: arc ? Object.fromEntries(days.map((d) => [d.dayNumber, arc.roles[d.dayNumber - 1]])) : {},
    seams: Object.fromEntries(seams.map((s) => [s.day, s])),
    totalDays: days.length
  };
}

export interface NarrativeInsertion {
  day: number;
  kind: "peak" | "land" | "return" | "rehomed-in" | "rehomed-out" | "seam";
}

/**
 * Weave the memory lines into each day's narrative (mutates
 * day.narrative). Returns the insertion record the continuity judge
 * verifies. Insertion points are fixed: peak opens the day; returns
 * and re-homes land right after the opening paragraph; the landing
 * closes its day; seam lines close the move day.
 */
export function annotateNarrative(days: EngineDay[], story: StoryState): NarrativeInsertion[] {
  const inserted: NarrativeInsertion[] = [];
  const nameOf = (day: EngineDay, key: string | null, fallback: string | undefined): string => {
    const it = (day.items || []).find((i) => i.key === key);
    return shortName(it?.name || fallback || "");
  };
  for (const day of [...days].sort((a, b) => a.dayNumber - b.dayNumber)) {
    if (!Array.isArray(day.narrative)) day.narrative = [];
    const narr = day.narrative;
    const topName = shortName(
      (day.items || []).find((i) => i.type === "stop")?.name || story.peakName || "the day's headline"
    );
    let insertAt = Math.min(1, narr.length);
    if (story.peakDay === day.dayNumber && narr.length) {
      narr.unshift(FRAMES.peakDayOpen({ dateLong: dateLong(day.date), name: topName }));
      inserted.push({ day: day.dayNumber, kind: "peak" });
      insertAt = 2;
    }
    for (const r of story.returns.filter((x) => x.day === day.dayNumber)) {
      narr.splice(insertAt, 0, FRAMES.returnVisit({ name: nameOf(day, r.key, r.name), firstDateLong: dateLong(r.firstDate) }));
      inserted.push({ day: day.dayNumber, kind: "return" });
      insertAt++;
    }
    for (const r of story.rehomedIn.filter((x) => x.day === day.dayNumber)) {
      narr.splice(insertAt, 0, FRAMES.keptForToday({
        name: nameOf(day, r.key, r.name),
        fromDateLong: r.fromDate ? dateLong(r.fromDate) : `day ${r.fromDay}`,
        reason: r.reason ?? ""
      }));
      inserted.push({ day: day.dayNumber, kind: "rehomed-in" });
      insertAt++;
    }
    for (const r of story.rehomedOut.filter((x) => x.day === day.dayNumber)) {
      narr.splice(insertAt, 0, FRAMES.movedOnLine({
        name: nameOf(day, r.key, r.name),
        toDateLong: r.toDate ? dateLong(r.toDate) : `day ${r.toDay}`,
        reason: r.reason ?? ""
      }));
      inserted.push({ day: day.dayNumber, kind: "rehomed-out" });
      insertAt++;
    }
    const seam = story.seams[day.dayNumber];
    if (seam && narr.length) {
      narr.push(FRAMES.seamChain({ fromName: seam.fromBase, toName: seam.toBase }));
      narr.push(FRAMES.seamBags({ checkIn: seam.checkInLabel }));
      inserted.push({ day: day.dayNumber, kind: "seam" });
    }
    if (story.landDay === day.dayNumber && narr.length) {
      const left = story.totalDays - day.dayNumber;
      const remaining = left === 0 ? "this is the last day" : left === 1 ? "one day left after this one" : `${left} days left after this one`;
      narr.push(FRAMES.windingDown({ remaining }));
      inserted.push({ day: day.dayNumber, kind: "land" });
    }
  }
  return inserted;
}

/* ------------------------------------------------------------------ */
/* The day composer                                                    */
/* ------------------------------------------------------------------ */

export function composeDay(day: EngineDay, ctx: ComposeContext, state: ComposerState): string[] {
  state.usedToday = new Set();
  const out: string[] = [];
  const name = (full: string): string => {
    const seen = state.mentions.get(full) || 0;
    state.mentions.set(full, seen + 1);
    return seen === 0 ? full : shortName(full);
  };
  const say = (keys: string | string[], data: FrameData): boolean => {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (!state.usedToday.has(k) && FRAMES[k]) {
        state.usedToday.add(k);
        out.push(FRAMES[k](data));
        return true;
      }
    }
    return false;
  };
  const stops = day.items.filter((i) => i.type === "stop");
  const first = stops[0];
  const excursion = day.items.find((i) => i.role === "excursion");
  const restItem = day.items.find((i) => i.type === "rest");

  // Pacing day types narrate themselves, briefly and honestly, then
  // stop — an unscheduled day does not get a scheduled day's worth of
  // prose.
  const joinNames = (ns: string[]): string =>
    ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
  if (day.dayType === "REST") {
    say("dayOpenRestDay", { dateLong: dateLong(day.date) });
    const idea = (day.ideas || [])[0];
    if (idea) say("suggestSoft", { name: name(idea.name), minutes: idea.walkMin });
    return out;
  }
  if (day.dayType === "OPEN") {
    say("dayOpenOpen", { dateLong: dateLong(day.date) });
    const ideas = day.ideas || [];
    if (ideas.length) say("openIdeas", { ideas: joinNames(ideas.map((i) => name(i.name))) });
    return out;
  }
  if (day.dayType === "MOVE") {
    say("dayOpenMove", { dateLong: dateLong(day.date), fromName: day.move?.fromName || "", toName: day.move?.toName || "" });
    const arr = day.items.find((i) => i.type === "stop");
    if (arr) say("moveStop", { name: name(arr.name || ""), start: fmt(arr.start), end: fmt(arr.end) });
    return out;
  }

  // Journey-envelope days open with the journey itself — the chain is
  // the day's first fact, ahead of any sight.
  const envA = day.envelope?.arrival;
  const envD = day.envelope?.departure;
  if (envA) {
    const chain = day.items.filter((i) => i.type === "journey");
    const travel = chain.find((i) => i.part === "travel");
    if (envA.mode === "drive")
      say("arriveDriveOpen", { dateLong: dateLong(day.date), driveDur: travel ? `${travel.end - travel.start} minutes` : "", base: ctx.baseName, arrive: fmt(envA.arriveBaseMin) });
    else
      say("arriveFlyOpen", { dateLong: dateLong(day.date), leave: chain.length ? fmt(chain[0].start) : "", flightDur: travel ? `${travel.end - travel.start} minutes` : "", base: ctx.baseName, arrive: fmt(envA.arriveBaseMin) });
  } else if (envD) {
    if (envD.emptyMorning) say("dawnOpen", { dateLong: dateLong(day.date), flightTime: fmt(envD.flightMin) });
    else say("departOpen", { dateLong: dateLong(day.date), flightTime: fmt(envD.flightMin), leave: fmt(envD.leaveBaseMin) });
  } else if (day.dayType === "LIGHT") {
    say("dayOpenLight", { dateLong: dateLong(day.date) });
  } else if (restItem && restItem.part === "morning") {
    say("dayOpenRest", { dateLong: dateLong(day.date) });
    say("restAm1", {});
  } else if (excursion) {
    say("dayOpenExcursion", { dateLong: dateLong(day.date), excursionName: name(excursion.name || "") });
  } else if (day.dayNumber === 1) {
    say("dayOpen1", { dateLong: dateLong(day.date), firstName: first ? name(first.name || "") : "the first stop", firstTime: first ? fmt(first.start) : "", earliest: ctx.earliestLabel });
  } else {
    say(["dayOpen2", "dayOpen3"], { dateLong: dateLong(day.date), anchorName: first ? name(first.name || "") : "a slow start", dayNumber: day.dayNumber, earliest: ctx.earliestLabel });
  }
  if (day.dayNumber === 1 && ctx.stay && !envA) {
    say("anchorStay", { stayName: name(ctx.stay.name), sightCount: ctx.stay.walkableSights });
  }
  const w = ctx.weatherByDate?.[day.date];
  if (w && w.precipProb != null) {
    if (excursion && w.precipProb <= 40) say("weatherDry", { tMax: Math.round(w.tMax ?? 0), precip: w.precipProb });
    else if (w.precipProb >= 60) say("weatherWet", { precip: w.precipProb });
    else if (day.dayNumber === 1) say("weatherMild", { tMax: Math.round(w.tMax ?? 0) });
  }

  let hoursCaveatUsed = false, dietCaveatUsed = false, waitLineUsed = false;
  let evePack: EngineItem | null = null;
  const legTo = new Map(day.legs.map((l) => [l.toKey, l]));
  for (const item of day.items) {
    if (item.type === "rest") {
      if (item.part === "afternoon") say(["restPm1", "restPm2"], {});
      else if (item.part === "break") say("breakLine", {});
      else if (item.part === "meal") say("mealWindowLine", { meal: mealNameFor(item.start) });
      else if (item.part === "refresh") say("restRefreshLine", { restDur: `${item.end - item.start} minutes` });
      else if (item.part === "arrival-wait" && !waitLineUsed && envA) {
        say("checkinWaitLine", { checkIn: fmt(envA.checkInMin) });
        waitLineUsed = true;
      }
      continue;
    }
    // Logistics items: the brief carries their times; the prose
    // speaks only where the traveler feels them (check-in, protected
    // pack-up).
    if (["journey", "checkin", "checkout", "pack", "transfer", "move"].includes(item.type)) {
      if (item.type === "checkin") say("checkinLine", { checkIn: fmt(item.start) });
      else if (item.type === "pack" && day.envelope?.windDown) evePack = item; // narrated after the evening line, in time order
      else if (item.type === "pack") say("packLine", { start: fmt(item.start), end: fmt(item.end) });
      continue;
    }
    const leg = item.key ? legTo.get(item.key) : undefined;
    if (leg && leg.fromKey !== "base") {
      if (leg.mode === "drive") say(["drive1", "drive2"], { to: name(item.name || ""), minutes: leg.minutes });
      else say(["walk1", "walk2", "walk3", "walk4", "walk5"], { from: name(leg.fromName), to: name(item.name || ""), minutes: leg.minutes });
    } else if (leg && leg.mode === "drive") {
      say(["drive1", "drive2"], { to: name(item.name || ""), minutes: leg.minutes });
    }
    if (item.type === "food") {
      // The meal is named by the clock, not by habit (owner fix,
      // 2026-10-21): a 17:17 meal composes as dinner.
      const mealFrames = {
        Breakfast: ["breakfast1", "lunch2"],
        Lunch: ["lunch1", "lunch2"],
        Dinner: ["dinner1", "dinner2", "lunch2"]
      }[mealNameFor(item.start)];
      say(mealFrames, { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
      if (item.diet?.strong) {
        say("dietStrong", { evidence: item.diet.evidenceText });
        if (item.diet.veganOnly) say("dietVeganBonus", {});
      } else if (!dietCaveatUsed && ctx.hasDietary) {
        say("dietSoft", {});
        dietCaveatUsed = true;
      }
      continue;
    }
    const dur = item.end - item.start;
    if (item.kind === "ferry") say(["ferry1", "ferry2"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.role === "excursion" && item.kind === "falls") say("falls1", { name: name(item.name || ""), dur, start: fmt(item.start), end: fmt(item.end) });
    else if (item.role === "excursion" && item.kind === "lighthouse") say("lighthouse1", { name: name(item.name || ""), dur, start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "museum" || item.kind === "gallery")
      say(item.kind === "museum" ? ["museum1", "museum2"] : ["gallery1", "generic1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end), dur });
    else if (envD && (item.kind === "park" || item.kind === "viewpoint")) say(["strollLine", "park1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "park") say(["park1", "park2"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "historic") say(["historic1", "generic1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "market" && envD) say(["souvenirLine", "market1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "market") say(["market1", "generic1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else if (item.kind === "venue") say(["venue1", "generic1"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    else say(["attraction1", "attraction2", "generic1", "generic2"], { name: name(item.name || ""), start: fmt(item.start), end: fmt(item.end) });
    if (item.hours?.status === "known") {
      say("hoursKnown1", { name: name(item.name || ""), open: fmt(item.hours.open), close: fmt(item.hours.close) });
    } else if (item.hours?.status === "unknown" && !hoursCaveatUsed) {
      say("hoursSoft1", { name: name(item.name || "") });
      hoursCaveatUsed = true;
    }
    if (item.kind === "ferry") say(["dayNoteFerry"], {});
  }
  const backLeg = day.legs.find((l) => l.toKey === "base");
  if (backLeg && backLeg.mode === "drive") say(["driveBack1", "driveBack2"], { minutes: backLeg.minutes, baseName: ctx.baseName });
  // A departure day ends at the airport, not back at base — the
  // generic evening frame would lie about it, so envelope days close
  // silently. Evening-aware close (owner fix, 2026-10-21): a timed
  // commitment at or after dinner time (a dinner booking, an evening
  // cruise, a show) owns the evening — the close names it, and the
  // free-evening frames may only fire when no such commitment exists.
  if (!envD) {
    const timed = day.items
      .filter((i) => (i.type === "stop" || i.type === "food") && i.start != null)
      .sort((a, b) => a.start - b.start);
    const eveItem = [...timed].reverse().find((i) => i.start >= DINNER_START);
    if (eveItem) {
      const priorEnd = Math.max(0, ...timed.filter((i) => i.end <= eveItem.start).map((i) => i.end));
      const eveName = eveItem.type === "food" ? `${mealNameFor(eveItem.start)} at ${name(eveItem.name || "")}` : name(eveItem.name || "");
      say(["eveningPlan1", "eveningPlan2"], { end: fmt(priorEnd || eveItem.start), stopCount: stops.length, name: eveName, time: fmt(eveItem.start) });
    } else {
      say(["evening1", "evening2"], { end: fmt(day.endMin), stopCount: stops.length });
    }
  }
  if (evePack) say("packEveLine", { start: fmt(evePack.start), end: fmt(evePack.end) });
  return out;
}
