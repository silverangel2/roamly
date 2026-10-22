// Phase 9 checks (DESIGN-PRODUCTION.md Phase 9 proof):
//   A — silent alignment: the four clean Phase 8-classified signals
//       apply transactionally to the shadow plan fixture — EXACTLY
//       the shadow updater's 31 field changes (field-for-field),
//       every one provenance-carrying, ZERO alerts; a re-delivered
//       signal is a duplicate no-op.
//   B — the spike scenario re-run (Halifax +120 min) through the
//       wired planner + delay path: the affected set is computed
//       from the FULL day state (lunch + Citadel present — the two
//       items production V1's title filter missed); the anchor is
//       the BOOKED stay; no proposed plan puts dinner inside the
//       prepaid cruise; the cruise never moves; approval applies
//       under the hash guard with reload verification.
//   C — loud lane: the Phase 8-classified delayed flight writes
//       NOTHING (plan byte-identical), emits exactly one alert, and
//       parks the candidate; approval applies it; rejection (fresh
//       run) discards it and records the LEARN outcome.
//   D — hash-guard rollback: a tampered write fails reload
//       verification, the apply rolls back, and the failure is
//       reported — never asserted as success.
//   E — anchor law: a higher-scored unbooked candidate NEVER becomes
//       the day anchor; the booked stay does.
//   F — planner bound: a pathological 12-survivor day terminates at
//       the evaluation cap with the bound recorded.
//   G — room-ready events (shadow early/late check-in proofs): the
//       wait rule has teeth (a timed commitment inside the wait
//       refuses loud); an early room dissolves the wait, preserves
//       the rest, and offers the freed time; a late room extends
//       the wait, preserves the rest, and owes EXACTLY ONE
//       notification however often the event is delivered.
//   H — the companionImpactAnalysis affected-set fix: the spike day
//       evaluated by the production impact function now includes
//       lunch + Citadel (and a keyword-free title), where V1's
//       `title || description` regex dropped them.
//   I — Flight Watch trust seam: an INFERRED delay produces a
//       proposal only — the plan is byte-identical afterwards.
//   J — statics: flag default off, the 410 stub preserved behind the
//       flag, no chain.mjs import anywhere, zero any / zero
//       eslint-disable in the phase's files.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InMemoryUpdaterStore,
  applyRoomReadyEvent,
  approveParkedProposal,
  itineraryHash,
  processClassifiedSignal,
  processDelayEvent,
  rejectParkedProposal
} from "@/lib/roamly/updater.ts";
import {
  proposeRepairs,
  resolveDayAnchor
} from "@/lib/roamly/repairPlanner.ts";
import { classifySignalLane } from "@/lib/roamly/reconciliationLane.ts";
import { deterministicImpact } from "@/lib/roamly/companionImpactAnalysis.ts";
import { build2UpdaterEnabled } from "@/lib/roamly/build2Flags.ts";

const here = dirname(fileURLToPath(import.meta.url));
const treeRoot = join(here, "..");
const hidden = join(treeRoot, "..", "..");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}
function eq(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`
  );
}

const AT = "2026-10-23T14:41:00.000Z";
const planned = load(join(hidden, "part2-travel-days-2026-10-21", "fixtures", "planned-itinerary.json"));
const goldenSignals = load(join(here, "fixtures", "wiring-phase1", "part2-booking-signals.json")).data.signals;
const halifaxPack = load(join(here, "fixtures", "wiring-phase2", "packs", "pack-halifax.json")).data;

/* ---------------- fixture builders ---------------- */

function plannedItinerary() {
  const byDate = new Map();
  for (const item of planned.items) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push({
      ...item,
      item_id: item.id,
      title: item.name,
      start: item.startMin,
      end: item.endMin,
      startTime: item.start,
      endTime: item.end,
      bookingRef: item.bookingRef ?? null
    });
  }
  const days = [...byDate.entries()].map(([date, items], idx) => ({
    day_id: `day-${idx + 1}`,
    day_number: idx + 1,
    date,
    timeZone: "America/Halifax",
    items
  }));
  return {
    tripId: "trip-halifax-fixture",
    userId: "user-fixture",
    timeZone: "America/Halifax",
    revision: 0,
    hotel: {
      name: planned.hotel.name,
      address: planned.hotel.address,
      stars: planned.hotel.stars,
      price: planned.hotel.price,
      checkIn: null,
      checkOut: null
    },
    days
  };
}

const planView = {
  tripId: "trip-halifax-fixture",
  timeZone: "America/Halifax",
  items: planned.items.map((i) => ({
    itemRef: i.id,
    title: i.name,
    kind: i.kind,
    date: i.date,
    startMin: i.startMin,
    endMin: i.endMin,
    boardingMin: i.boardingMin ?? null,
    arrivalTransferMin: i.transferMinFromPriorArea ?? null,
    paid: !!i.paid,
    prepaid: !!i.prepaid,
    bookingRef: i.bookingRef ?? null
  }))
};

function classified(signal) {
  const c = classifySignalLane(signal, planView);
  return { signal, lane: c.lane, reason: c.reason, conflicts: c.conflicts, displaced: c.displaced, supersededFacts: [] };
}

const HOTEL_POS = { lat: 44.6488, lon: -63.5752 };
const AIRPORT_POS = { lat: 44.8808, lon: -63.5086 };
const CITADEL_POS = { lat: 44.6475, lon: -63.5804 };
const CAFE_POS = { lat: 44.6478, lon: -63.5735 };
const DINNER_POS = { lat: 44.6495, lon: -63.5745 };
const TERMINAL_POS = { lat: 44.647, lon: -63.571 };

function spikeItinerary() {
  const items = [
    { item_id: "flight-ac9999", title: "Flight AC 9999", kind: "flight", item_type: "flight", date: "2026-10-23", start: 605, end: 800, startTime: "10:05", endTime: "13:20", startMin: 605, endMin: 800, state: "in_progress", status: "booked", bookingRef: "SYN-AC-9999", paid: true, pos: AIRPORT_POS },
    { item_id: "arrival-transfer", title: "Arrival transfer to hotel", kind: "transfer", item_type: "transfer", date: "2026-10-23", start: 800, end: 840, startTime: "13:20", endTime: "14:00", startMin: 800, endMin: 840, status: "booked", booking: { ref: "SYN-TR-1" }, durationMin: 40, pos: HOTEL_POS, stay: { name: "Residence Inn Halifax Downtown", booked: true, selectedByTraveler: false, score: 88, pos: HOTEL_POS } },
    { item_id: "lunch-slow-mornings", title: "Slow Mornings Café & Restaurant", kind: "food", item_type: "food", date: "2026-10-23", start: 865, end: 925, startTime: "14:25", endTime: "15:25", startMin: 865, endMin: 925, status: "planned", pos: CAFE_POS },
    { item_id: "citadel", title: "Halifax Citadel", kind: "attraction", item_type: "activity", key: "spike-citadel", date: "2026-10-23", start: 935, end: 995, startTime: "15:35", endTime: "16:35", startMin: 935, endMin: 995, status: "planned", pos: CITADEL_POS, url: "https://www.openstreetmap.org/node/26286235", hours: { status: "unknown" } },
    { item_id: "dinner-five-guys", title: "Dinner at Five Guys", kind: "food", item_type: "food", key: "spike-dinner", date: "2026-10-23", start: 1140, end: 1200, startTime: "19:00", endTime: "20:00", startMin: 1140, endMin: 1200, status: "planned", pos: DINNER_POS, hours: { status: "known", open: 660, close: 1320 } },
    { item_id: "harbour-cruise", title: "Halifax Harbour Evening Cruise", kind: "cruise", item_type: "activity", date: "2026-10-23", start: 1230, end: 1320, startTime: "20:30", endTime: "22:00", startMin: 1230, endMin: 1320, status: "booked", bookingRef: "SYN-HC-2030", paid: true, prepaid: true, boardingMin: 1215, pos: TERMINAL_POS }
  ];
  return {
    tripId: "trip-spike",
    userId: "user-fixture",
    timeZone: "America/Halifax",
    revision: 0,
    hotel: null,
    days: [{ day_id: "day-1", day_number: 1, date: "2026-10-23", timeZone: "America/Halifax", items }]
  };
}

const SPIKE_EVENT = {
  eventId: "evt-spike-delay",
  subjectItemId: "flight-ac9999",
  transferItemId: "arrival-transfer",
  oldStartMin: 605,
  oldEndMin: 800,
  newStartMin: 605,
  newEndMin: 920,
  transferDurationMin: 40,
  nowMin: 700
};

/* ---------------- A. Silent alignment — 31 changes ---------------- */
{
  const store = new InMemoryUpdaterStore();
  store.seed(plannedItinerary());
  const clean = goldenSignals.filter((s) => s.booking.status !== "delayed");
  eq(clean.length, 4, "A: four clean signals in the golden fixture");
  let allChanges = [];
  let alertsSeen = 0;
  for (const [idx, signal] of clean.entries()) {
    const c = classified(signal);
    eq(c.lane, "silent", `A: ${signal.booking.kind} classifies silent`);
    const r = await processClassifiedSignal({ store, tripId: "trip-halifax-fixture", classified: c, trust: "OFFICIAL", at: AT, proposalId: `prop-a-${idx}` });
    eq(r.outcome, "applied-silent", `A: ${signal.booking.kind} applies silently`);
    if (r.outcome === "applied-silent") {
      allChanges = allChanges.concat(r.changes);
      alertsSeen += r.alerts;
    }
  }
  eq(allChanges.length, 31, "A: exactly the shadow updater's 31 field changes");
  const expectedFields = [
    "flight-ac1847.name", "flight-ac1847.start", "flight-ac1847.startMin", "flight-ac1847.end", "flight-ac1847.endMin", "flight-ac1847.status", "flight-ac1847.provider", "flight-ac1847.price",
    "arrival-transfer.start", "arrival-transfer.startMin", "arrival-transfer.end", "arrival-transfer.endMin",
    "hotel-check-in.start", "hotel-check-in.startMin", "hotel-check-in.end", "hotel-check-in.endMin", "hotel-check-in.address", "hotel-check-in.status", "hotel-check-in.provider",
    "trip.hotel.address", "trip.hotel.stars", "trip.hotel.price",
    "lou-pecou-dinner.start", "lou-pecou-dinner.startMin", "lou-pecou-dinner.address", "lou-pecou-dinner.status", "lou-pecou-dinner.provider",
    "harbour-cruise.address", "harbour-cruise.status", "harbour-cruise.provider", "harbour-cruise.price"
  ];
  eq(
    allChanges.map((c) => `${c.itemId}.${c.field}`).sort(),
    [...expectedFields].sort(),
    "A: the change set is field-for-field the shadow's"
  );
  ok(allChanges.every((c) => c.provenance && c.provenance.signalId && c.provenance.messageId), "A: every change carries provenance");
  eq(alertsSeen, 0, "A: zero alerts on the silent lane");
  eq((await store.listAlerts("trip-halifax-fixture")).length, 0, "A: no alert records written");
  const records = await store.listAdjustmentRecords("trip-halifax-fixture");
  eq(records.length, 31, "A: 31 adjustment records persisted in the transaction");
  const itin = await store.loadItinerary("trip-halifax-fixture");
  const flight = itin.days[0].items.find((i) => i.item_id === "flight-ac1847");
  eq([flight.startTime, flight.endTime], ["10:05", "13:20"], "A: plan facts == email facts (flight)");
  const cruise = itin.days[0].items.find((i) => i.item_id === "harbour-cruise");
  eq(cruise.price.amount, 96, "A: plan facts == email facts (cruise price)");
  // Duplicate delivery changes nothing twice.
  const dup = await processClassifiedSignal({ store, tripId: "trip-halifax-fixture", classified: classified(clean[1]), trust: "OFFICIAL", at: AT, proposalId: "prop-a-dup" });
  eq(dup.outcome, "duplicate-noop", "A: re-delivered signal is a duplicate no-op");
  eq((await store.listAdjustmentRecords("trip-halifax-fixture")).length, 31, "A: duplicate wrote no further records");
}

/* ---------------- B. Spike re-run ---------------- */
let spikeProposalId = "prop-spike-1";
{
  const store = new InMemoryUpdaterStore();
  store.seed(spikeItinerary());
  const r = await processDelayEvent({ store, tripId: "trip-spike", dayId: "day-1", event: SPIKE_EVENT, trust: "OFFICIAL", pack: halifaxPack, at: AT, proposalId: spikeProposalId });
  eq(r.outcome, "silent-retime-proposal-parked", "B: delay applies the fact and parks the re-solve");
  if (r.outcome === "silent-retime-proposal-parked") {
    const affectedIds = r.affectedSet.map((a) => a.itemId);
    ok(affectedIds.includes("lunch-slow-mornings"), "B: affected set includes lunch (V1's filter missed it)");
    ok(affectedIds.includes("citadel"), "B: affected set includes the Citadel (V1's filter missed it)");
    const cruiseAffected = r.affectedSet.find((a) => a.itemId === "harbour-cruise");
    ok(!!cruiseAffected && cruiseAffected.protected, "B: the cruise is in the affected set, flagged protected — analyzed, never a target");
    eq(r.changes.length, 3, "B: silent part = flight end + transfer start/end (3 provenance changes)");
    ok(r.changes.every((c) => c.provenance.signalId === "delay:evt-spike-delay"), "B: retime changes carry event provenance");
  }
  const parked = await store.loadProposal(spikeProposalId);
  ok(!!parked && parked.kind === "repair", "B: a repair proposal is parked");
  if (parked?.repair) {
    eq(parked.repair.anchor?.source, "booked-stay", "B: the day anchor is the BOOKED stay");
    for (const plan of parked.repair.plans) {
      for (const item of plan.items) {
        ok(!(item.start < 1320 && item.end > 1230), `B: plan ${plan.id} never places an item inside the prepaid cruise (${item.name} ${item.startTime}–${item.endTime})`);
        ok(item.end <= 1200 || item.start >= 1230, `B: plan ${plan.id} item ${item.name} ends by the cruise deadline`);
      }
      ok(plan.judges.full.pass && plan.judges.remainder.pass, `B: plan ${plan.id} passes both judge gates`);
    }
    const meal = parked.repair.plans.flatMap((p) => p.items).find((i) => i.stepType === "meal");
    ok(!!meal, "B: the re-solve fills the meal slot from the solver (not a bare delta shift)");
  }
  const before = await store.loadItinerary("trip-spike");
  const cruiseBefore = before.days[0].items.find((i) => i.item_id === "harbour-cruise");
  eq([cruiseBefore.startTime, cruiseBefore.endTime], ["20:30", "22:00"], "B: cruise untouched before approval");
  const flightNow = before.days[0].items.find((i) => i.item_id === "flight-ac9999");
  eq(flightNow.endTime, "15:20", "B: the flight fact itself was retimed silently (+120)");
  const decision = await approveParkedProposal({ store, proposalId: spikeProposalId, at: AT });
  eq(decision.outcome, "applied", "B: traveler approval applies the parked repair");
  const after = await store.loadItinerary("trip-spike");
  const cruiseAfter = after.days[0].items.find((i) => i.item_id === "harbour-cruise");
  eq([cruiseAfter.startTime, cruiseAfter.endTime], ["20:30", "22:00"], "B: the cruise NEVER moves");
  const lunchAfter = after.days[0].items.find((i) => i.item_id === "lunch-slow-mornings");
  eq(lunchAfter.state, "superseded_by_repair", "B: the impossible lunch is superseded, not silently shifted");
  const citadelAfter = after.days[0].items.find((i) => i.item_id === "citadel");
  ok(citadelAfter.startTime !== "15:35", "B: the Citadel was re-solved to a feasible time");
  const mealAfter = after.days[0].items.find((i) => i.item_id === "dinner-five-guys");
  ok(!(mealAfter.start < 1320 && mealAfter.end > 1230), "B: applied dinner does not land inside the cruise (the V1 defect, disproven)");
  const dupEvent = await processDelayEvent({ store, tripId: "trip-spike", dayId: "day-1", event: SPIKE_EVENT, trust: "OFFICIAL", pack: halifaxPack, at: AT, proposalId: "prop-spike-dup" });
  eq(dupEvent.outcome, "duplicate-noop", "B: the same delay event re-delivered is a no-op (E2E duplicate-delay leg)");
}

/* ---------------- C. Loud lane ---------------- */
{
  const delaySignal = goldenSignals.find((s) => s.booking.status === "delayed");
  // approve path
  const store = new InMemoryUpdaterStore();
  store.seed(plannedItinerary());
  const c = classified(delaySignal);
  eq(c.lane, "loud", "C: the delayed flight classifies LOUD (Phase 8)");
  const hashBefore = itineraryHash(await store.loadItinerary("trip-halifax-fixture"));
  const jsonBefore = JSON.stringify((await store.loadItinerary("trip-halifax-fixture")).days);
  const r = await processClassifiedSignal({ store, tripId: "trip-halifax-fixture", classified: c, trust: "OFFICIAL", at: AT, proposalId: "prop-c-1" });
  eq(r.outcome, "loud-parked", "C: loud lane parks the candidate");
  eq(itineraryHash(await store.loadItinerary("trip-halifax-fixture")), hashBefore, "C: plan hash byte-identical on the loud lane");
  eq(JSON.stringify((await store.loadItinerary("trip-halifax-fixture")).days), jsonBefore, "C: plan JSON byte-identical on the loud lane");
  eq((await store.listAlerts("trip-halifax-fixture")).length, 1, "C: exactly ONE loud alert");
  eq((await store.listAdjustmentRecords("trip-halifax-fixture")).length, 0, "C: zero adjustment records on the loud lane");
  const decision = await approveParkedProposal({ store, proposalId: "prop-c-1", at: AT });
  eq(decision.outcome, "applied", "C: approval applies the parked candidate");
  const itin = await store.loadItinerary("trip-halifax-fixture");
  const flight = itin.days[0].items.find((i) => i.item_id === "flight-ac1847");
  eq(flight.endMin, 1195, "C: after approval the flight carries the verified delayed arrival");
  // reject path (fresh run)
  const store2 = new InMemoryUpdaterStore();
  store2.seed(plannedItinerary());
  const hash2 = itineraryHash(await store2.loadItinerary("trip-halifax-fixture"));
  await processClassifiedSignal({ store: store2, tripId: "trip-halifax-fixture", classified: c, trust: "OFFICIAL", at: AT, proposalId: "prop-c-2" });
  const rej = await rejectParkedProposal({ store: store2, proposalId: "prop-c-2", at: AT });
  eq(rej.outcome, "rejected", "C: rejection discards the candidate");
  eq(itineraryHash(await store2.loadItinerary("trip-halifax-fixture")), hash2, "C: rejection leaves the plan untouched");
  const outcomes = await store2.listOutcomes("trip-halifax-fixture");
  ok(outcomes.some((o) => o.kind === "alignment-rejected"), "C: the rejection is recorded as a LEARN outcome");
  eq((await store2.loadProposal("prop-c-2")).status, "rejected", "C: proposal status records the rejection");
}

/* ---------------- D. Hash-guard rollback ---------------- */
{
  const store = new InMemoryUpdaterStore();
  store.seed(plannedItinerary());
  const hashBefore = itineraryHash(await store.loadItinerary("trip-halifax-fixture"));
  store.tamperAfterCommit = (itin) => {
    const item = itin.days[0].items.find((i) => i.item_id === "hotel-check-in");
    item.start += 5;
    item.startMin = item.start;
    item.startTime = "15:05";
  };
  const hotelSignal = goldenSignals.find((s) => s.booking.kind === "hotel");
  const r = await processClassifiedSignal({ store, tripId: "trip-halifax-fixture", classified: classified(hotelSignal), trust: "OFFICIAL", at: AT, proposalId: "prop-d-1" });
  eq(r.outcome, "failed", "D: a tampered write is reported as failed, never as applied");
  eq(r.error, "RELOAD_VERIFY_FAILED", "D: reload verification caught the tampered write");
  eq(r.rolledBack, true, "D: the apply was rolled back");
  eq(itineraryHash(await store.loadItinerary("trip-halifax-fixture")), hashBefore, "D: the plan reads back as the original after rollback");
  eq((await store.listAdjustmentRecords("trip-halifax-fixture")).length, 0, "D: no adjustment records survive a rolled-back apply");
  ok((await store.listOutcomes("trip-halifax-fixture")).some((o) => o.kind === "apply-rolled-back"), "D: the rollback itself is on the record");
}

/* ---------------- E. Anchor law ---------------- */
{
  const day = {
    day_id: "day-anchor",
    day_number: 1,
    date: "2026-10-23",
    timeZone: "America/Halifax",
    items: [
      { item_id: "stay-scored", title: "Top-scored candidate hotel", kind: "hotel", start: 900, end: 930, startTime: "15:00", endTime: "15:30", pos: { lat: 44.65, lon: -63.58 }, stay: { name: "Top-scored candidate hotel", booked: false, selectedByTraveler: false, score: 99, pos: { lat: 44.65, lon: -63.58 } } },
      { item_id: "stay-booked", title: "The traveler's booked stay", kind: "hotel", start: 900, end: 930, startTime: "15:00", endTime: "15:30", pos: HOTEL_POS, stay: { name: "The traveler's booked stay", booked: true, selectedByTraveler: false, score: 41, pos: HOTEL_POS } }
    ]
  };
  const anchor = resolveDayAnchor(day);
  eq(anchor?.source, "booked-stay", "E: anchor source is the booked stay");
  eq(anchor?.name, "The traveler's booked stay", "E: the booked stay anchors even at score 41 vs the candidate's 99");
}

/* ---------------- F. Planner bound ---------------- */
{
  const items = [
    { item_id: "stay", title: "Booked stay", kind: "hotel", start: 600, end: 630, startTime: "10:00", endTime: "10:30", bookingRef: "SYN-HH-BOUND", paid: true, pos: HOTEL_POS }
  ];
  for (let n = 0; n < 12; n++) {
    const start = 700 + n * 45;
    items.push({
      item_id: `stop-${n}`,
      title: `Stop ${n}`,
      kind: "attraction",
      key: `bound-stop-${n}`,
      start,
      end: start + 30,
      startTime: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
      endTime: `${String(Math.floor((start + 30) / 60)).padStart(2, "0")}:${String((start + 30) % 60).padStart(2, "0")}`,
      pos: { lat: 44.6488 + n * 0.001, lon: -63.5752 + n * 0.001 },
      hours: { status: "unknown" }
    });
  }
  const day = { day_id: "day-bound", day_number: 1, date: "2026-10-23", timeZone: "America/Halifax", items };
  const result = proposeRepairs({
    day,
    disruption: { type: "closure", subjectItemId: null, oldStart: null, oldEnd: 600, newStart: null, newEnd: 660, anchorMin: 700, nowMin: 650 },
    proposalId: "prop-bound"
  });
  const bound = result.ok ? result.proposal.searchBound : result.escalation.context.searchBound;
  ok(!!bound, "F: the search bound is recorded either way");
  if (bound) {
    eq(bound.strategy, "bounded-insertion", "F: 12 survivors run the bounded heuristic, never factorial enumeration");
    ok(bound.evaluated <= bound.cap, `F: evaluations ${bound.evaluated} <= cap ${bound.cap}`);
    eq(bound.truncated, true, "F: truncation is recorded honestly");
  }
}

/* ---------------- G. Room-ready events ---------------- */
function roomFixture(extraItems = []) {
  const items = [
    { item_id: "flight", title: "Flight AC 1847", kind: "flight", item_type: "flight", date: "2026-10-23", start: 600, end: 800, startTime: "10:00", endTime: "13:20", status: "booked", pos: AIRPORT_POS },
    { item_id: "transfer", title: "Arrival transfer", kind: "transfer", item_type: "transfer", date: "2026-10-23", start: 800, end: 840, startTime: "13:20", endTime: "14:00", status: "booked", durationMin: 40, pos: HOTEL_POS },
    { item_id: "wait", title: "Settle in — bags and a breath", kind: "wait", part: "arrival-wait", date: "2026-10-23", start: 840, end: 870, startTime: "14:00", endTime: "14:30", status: "planned", interruptible: true, pos: HOTEL_POS },
    { item_id: "wait-lunch", title: "Five Fishermen", kind: "food", item_type: "food", date: "2026-10-23", start: 845, end: 865, startTime: "14:05", endTime: "14:25", status: "planned", interruptible: true, pos: HOTEL_POS },
    { item_id: "checkin", title: "Hotel check-in", kind: "hotel", item_type: "checkin", date: "2026-10-23", start: 870, end: 885, startTime: "14:30", endTime: "14:45", status: "booked", bookingRef: "SYN-HH-41KD", pos: HOTEL_POS },
    { item_id: "rest", title: "Rest & refresh", kind: "rest", part: "refresh", date: "2026-10-23", start: 885, end: 945, startTime: "14:45", endTime: "15:45", status: "planned", pos: HOTEL_POS },
    { item_id: "afternoon-stop", title: "Maritime Museum", kind: "museum", item_type: "activity", date: "2026-10-23", start: 1000, end: 1060, startTime: "16:40", endTime: "17:40", status: "planned", pos: CITADEL_POS },
    ...extraItems
  ];
  return {
    tripId: "trip-room",
    userId: "user-fixture",
    timeZone: "America/Halifax",
    revision: 0,
    hotel: null,
    days: [{ day_id: "day-1", day_number: 1, date: "2026-10-23", timeZone: "America/Halifax", items }]
  };
}
{
  // early room
  const store = new InMemoryUpdaterStore();
  store.seed(roomFixture());
  const r = await applyRoomReadyEvent({ store, tripId: "trip-room", dayId: "day-1", roomReadyMin: 840, at: AT });
  eq(r.outcome, "early-applied", "G: early room applies");
  if (r.outcome === "early-applied") eq(r.freedMin, 30, "G: freed time = the dissolved wait (30 min), offered not imposed");
  const itin = await store.loadItinerary("trip-room");
  const byId = Object.fromEntries(itin.days[0].items.map((i) => [i.item_id, i]));
  eq(byId.checkin.start, 840, "G: check-in moved up to the room-ready time");
  eq(byId.rest.end - byId.rest.start, 60, "G: rest duration preserved in full (60 min)");
  eq(byId.rest.start, 855, "G: rest follows the moved check-in");
  eq(byId["wait-lunch"].start, 915, "G: the wait-held interruptible lunch slides after the moved rest — same venue, not lost");
  eq(byId.wait.state, "dissolved-early-room", "G: the wait dissolves");
  eq((await store.listNotifications("trip-room")).length, 0, "G: an early room owes no notification — it is an offer");
  // teeth
  const store2 = new InMemoryUpdaterStore();
  store2.seed(roomFixture([
    { item_id: "wait-museum", title: "Prepaid Museum Slot", kind: "museum", item_type: "activity", date: "2026-10-23", start: 850, end: 865, startTime: "14:10", endTime: "14:25", status: "booked", prepaid: true, paid: true, pos: HOTEL_POS }
  ]));
  const hashT = itineraryHash(await store2.loadItinerary("trip-room"));
  const teeth = await applyRoomReadyEvent({ store: store2, tripId: "trip-room", dayId: "day-1", roomReadyMin: 840, at: AT });
  eq(teeth.outcome, "refused-loud", "G: a protected/timed commitment inside the wait refuses the re-flow loud");
  if (teeth.outcome === "refused-loud") ok(teeth.violation.includes("room wait"), "G: the judge's room-wait rule is the refusing authority");
  eq(itineraryHash(await store2.loadItinerary("trip-room")), hashT, "G: the refused re-flow changed nothing");
  // late room — exactly one notification
  const store3 = new InMemoryUpdaterStore();
  store3.seed(roomFixture());
  const late = await applyRoomReadyEvent({ store: store3, tripId: "trip-room", dayId: "day-1", roomReadyMin: 960, at: AT });
  eq(late.outcome, "late-applied", "G: late room applies");
  if (late.outcome === "late-applied") {
    eq(late.waitExtendedMin, 90, "G: the soft wait extends by the lateness (90 min)");
    eq(late.notificationOwed, true, "G: a late room owes a notification");
    ok(late.threatened.includes("Maritime Museum"), "G: the threatened timed item is named");
  }
  const itin3 = await store3.loadItinerary("trip-room");
  const byId3 = Object.fromEntries(itin3.days[0].items.map((i) => [i.item_id, i]));
  eq(byId3.rest.end - byId3.rest.start, 60, "G: rest duration preserved on the late mirror");
  eq(byId3.checkin.start, 960, "G: check-in moved to the late room-ready time");
  const again = await applyRoomReadyEvent({ store: store3, tripId: "trip-room", dayId: "day-1", roomReadyMin: 960, at: AT });
  eq((await store3.listNotifications("trip-room")).length, 1, "G: re-delivery of the same room event still owes EXACTLY ONE notification");
  ok(again.outcome === "no-change" || (again.outcome === "late-applied" && !again.notificationOwed), "G: the duplicate room event cannot create a second notification");
}

/* ---------------- H. Impact affected-set fix ---------------- */
{
  const itin = spikeItinerary();
  const fullJson = {
    daily_itinerary: itin.days.map((d) => ({
      day_id: d.day_id,
      day_number: d.day_number,
      date: d.date,
      live_timeline: d.items.map((i) => ({ item_id: i.item_id, title: i.title, start: i.start, end: i.end }))
    }))
  };
  const event = { id: "evt-1", trip_id: "trip-spike", user_id: "user-fixture", source_booking_id: null, event_type: "flight_delayed", severity: "important", title: "Flight delayed", summary: "", affected_layers: [], requires_user_approval: false };
  const impact = deterministicImpact(event, fullJson);
  const titles = impact.affectedItems.map((i) => i.title);
  ok(titles.includes("Slow Mornings Café & Restaurant"), "H: lunch is in the production impact affected set (V1 dropped it)");
  ok(titles.includes("Halifax Citadel"), "H: the Citadel is in the production impact affected set (V1 dropped it)");
  eq(titles.length, 6, "H: the affected set is the FULL day state (6 items), not a keyword sample");
}

/* ---------------- I. Flight Watch trust seam ---------------- */
{
  const store = new InMemoryUpdaterStore();
  store.seed(spikeItinerary());
  const hashBefore = itineraryHash(await store.loadItinerary("trip-spike"));
  const r = await processDelayEvent({ store, tripId: "trip-spike", dayId: "day-1", event: SPIKE_EVENT, trust: "INFERRED", pack: halifaxPack, at: AT, proposalId: "prop-i-1" });
  eq(r.outcome, "proposal-only", "I: an INFERRED movement signal yields a proposal only");
  eq(itineraryHash(await store.loadItinerary("trip-spike")), hashBefore, "I: the plan is byte-identical after an INFERRED signal");
  eq((await store.listAdjustmentRecords("trip-spike")).length, 0, "I: zero silent adjustments from an inference");
  ok(!!(await store.loadProposal("prop-i-1")), "I: the inference's re-solve proposal is parked for a traveler decision");
}

/* ---------------- J. Statics ---------------- */
{
  eq(build2UpdaterEnabled({}), false, "J: ROAMLY_BUILD2_UPDATER_ENABLED defaults OFF");
  eq(build2UpdaterEnabled({ ROAMLY_BUILD2_UPDATER_ENABLED: "on" }), true, "J: the updater flag parses on");
  const route = readFileSync(join(treeRoot, "app", "api", "trips", "[id]", "adjust-live-day", "route.ts"), "utf8");
  ok(route.includes("build2UpdaterEnabled"), "J: the adjust-live-day route is gated on the updater flag");
  ok(route.includes("ITINERARY_LOCKED") && route.includes("410"), "J: the legacy 410 stub posture is preserved behind the flag");
  const updaterSrc = readFileSync(join(treeRoot, "lib", "roamly", "updater.ts"), "utf8");
  const plannerSrc = readFileSync(join(treeRoot, "lib", "roamly", "repairPlanner.ts"), "utf8");
  for (const [name, src] of [["updater.ts", updaterSrc], ["repairPlanner.ts", plannerSrc], ["route.ts", route]]) {
    ok(!/\bas any\b|:\s*any\s*[;,)\]}=]|<any>|any\[\]|Record<string, any>/.test(src), `J: ${name} has zero any`);
    ok(!src.includes("eslint-disable"), `J: ${name} has zero eslint-disable`);
  }
  ok(!/from\s+["'][^"']*chain|import\(["'][^"']*chain/.test(updaterSrc + plannerSrc), "J: chain.mjs is not imported (its preserved defect stays in the shadow)");
  ok(!plannerSrc.includes("/airport|flight|arrival|dinner|transfer/") && !plannerSrc.includes(".test("), "J: the planner contains no title-keyword regex (the V1 filter pattern)");
}

console.log(`\nPhase 9 checks: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log("failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
