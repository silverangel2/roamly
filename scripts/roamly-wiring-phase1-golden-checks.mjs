import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUDGET_VERDICTS,
  parseBookingSignalDTO,
  parseBudgetVsRealComparisonDTO,
  parseCandidateDTO,
  parseCompanionItemDTO,
  parseCompanionLedgerEntryDTO,
  parseGateStateDTO,
  parseLifecycleStateDTO,
  parsePredictionRecordDTO,
  parseTripPlanDocumentDTO
} from "@/lib/roamly/engine/types.ts";
import { bookingSignalId } from "@/lib/roamly/engine/ids.ts";

// Phase 1 golden tests (DESIGN-PRODUCTION.md Phase 1 proof): the
// shadow packages' proven outputs, frozen under
// scripts/fixtures/wiring-phase1/, must conform to the canonical
// DTOs — and the DTO machinery must reproduce the shadow's own
// identities (the recon- signal IDs are recomputed from the fixture
// facts and must match byte-for-byte). Behavioral grading of the
// Phase 2 TS core runs against these same fixtures later; this
// runner is the schema-conformance gate.

const FIXTURES = new URL("./fixtures/wiring-phase1/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
function mustParse(result, label) {
  count += 1;
  assert.ok(result.ok, `${label}: ${result.ok ? "" : result.errors.join("; ")}`);
  return result.value;
}

/* --- Fixture headers: every fixture names its source --------------- */
const manifest = load("manifest.json");
eq(manifest.corpus, "wiring-phase1", "manifest names the corpus");
eq(manifest.fixtures.length, 7, "seven fixtures in the corpus");
for (const name of manifest.fixtures) {
  const fixture = load(name);
  ok(fixture._fixture?.source?.package, `${name}: source package recorded`);
  ok(fixture._fixture?.source?.note?.length > 40, `${name}: capture note recorded`);
  ok(Array.isArray(fixture._fixture?.source?.files), `${name}: source files recorded`);
}

/* --- 1. Zero-engine Quebec City trip + prediction ------------------- */
{
  const { plan, prediction } = load("engine-trip-quebec-city.json").data;
  const parsedPlan = mustParse(parseTripPlanDocumentDTO(plan), "Quebec plan conforms");
  eq(parsedPlan.days.length, 5, "Quebec plan has 5 days");
  eq(parsedPlan.source, "zero-engine", "plan carries the honest source label");
  // ALL-IN (2026-10-22): the anchor stay's recorded Google price level
  // (MODERATE) prices lodging at BAND 440–720 over 4 nights, so the
  // all-in verdict is OVER (range 1348–2724 vs cap 1100) where the
  // plan-only scope read AT RISK (908–2004). Coverage 19/20 lines.
  eq(parsedPlan.budgetCap.verdict, "OVER", "Quebec budget verdict is OVER under the all-in scope (cap 1100, all-in range 1348-2724)");
  const parsedPrediction = mustParse(parsePredictionRecordDTO(prediction), "Quebec prediction conforms");
  eq(parsedPrediction.budgetPosture.verdict, "OVER", "prediction posture agrees with the plan verdict");
  eq(parsedPrediction.budgetPosture.pricedItems, 18, "18 priced items");
  eq(parsedPrediction.budgetPosture.coverage, 0.95, "all-in evidence coverage 19/20 lines (18 items + lodging band; getting-there unevidenced)");
  eq(parsedPrediction.grades, null, "prediction ungraded at capture (LEARN grades later)");
  let priced = 0;
  const itemIds = new Set();
  for (const day of parsedPlan.days) {
    for (const item of day.items) {
      itemIds.add(item.itemId);
      if (item.priceEvidence) {
        priced += 1;
        ok(item.priceEvidence.tier !== "UNKNOWN" || item.priceEvidence.range === null, "UNKNOWN evidence never carries a range");
      }
    }
  }
  eq(priced, 18, "plan items carry the same 18 priced items the posture counts");
  const totalItems = parsedPlan.days.reduce((n, d) => n + d.items.length, 0);
  eq(itemIds.size, totalItems, "every plan item ID is unique (content IDs keyed on real placement fields)");
}

/* --- 2. Breadth verdicts -------------------------------------------- */
{
  const { trips } = load("engine-budget-verdicts.json").data;
  eq(trips.length, 8, "eight breadth destinations");
  for (const trip of trips) {
    ok(BUDGET_VERDICTS.includes(trip.budgetVerdict), `${trip.destination}: budget verdict in the canonical enum`);
    eq(trip.makeSense, "PASS", `${trip.destination}: make-sense PASS`);
    eq(trip.continuity, "PASS", `${trip.destination}: continuity PASS`);
  }
}

/* --- 3. Booking signals — and the ID scheme reproduces the shadow's - */
{
  const { signals, ignoredCount } = load("part2-booking-signals.json").data;
  eq(signals.length, 5, "five booking signals from five booking-pattern emails");
  eq(ignoredCount, 1, "the newsletter was ignored by the booking-pattern gate");
  for (const signal of signals) {
    const parsed = mustParse(parseBookingSignalDTO(signal), `signal ${signal.signalId} conforms`);
    eq(
      bookingSignalId({
        messageId: parsed.provenance.messageId,
        reference: parsed.booking.reference,
        status: parsed.booking.status,
        start: parsed.booking.start,
        end: parsed.booking.end
      }),
      parsed.signalId,
      "ids.bookingSignalId reproduces the shadow recon- ID byte-for-byte"
    );
  }
}

/* --- 4. Companion day + ledger -------------------------------------- */
{
  const { items, ledgerEntries } = load("part2-companion-day.json").data;
  eq(items.length, 3, "panel holds exactly Citadel, dinner, cruise at 14:52");
  for (const item of items) mustParse(parseCompanionItemDTO(item), `companion item ${item.title} conforms`);
  ok(items.some((i) => i.state === "leave-by"), "the Citadel leave-by item is present");
  eq(ledgerEntries.length, 3, "three ledger entries driven through the shadow machine");
  for (const entry of ledgerEntries) {
    mustParse(parseCompanionLedgerEntryDTO(entry), `ledger entry ${entry.classification} conforms`);
  }
  const checkedIn = ledgerEntries.find((e) => e.classification === "CHECKED_IN");
  eq(checkedIn.dwellMinutes, 41, "Citadel dwell measured at 41 minutes (15:36 -> 16:17)");
  ok(
    ledgerEntries.some((e) => e.classification === "DIRECTIONS_VIEWED"),
    "directions viewed recorded as its own non-terminal entry"
  );
  ok(
    ledgerEntries.some((e) => e.classification === "SKIPPED"),
    "the dinner skip is a SKIPPED taste signal, not a miss"
  );
}

/* --- 5. Gate sequences ------------------------------------------------ */
{
  const { sequences } = load("gates-sequence.json").data;
  eq(sequences.length, 2, "two gate walks frozen");
  for (const sequence of sequences) {
    for (const snapshot of sequence.snapshots) {
      mustParse(parseGateStateDTO(snapshot), `${sequence.name}: snapshot ${snapshot.installState}/${snapshot.gmailState} conforms`);
    }
    const last = sequence.snapshots[sequence.snapshots.length - 1];
    eq(last.installState, "READY", `${sequence.name}: ends READY`);
    eq(last.flowAllowed, true, `${sequence.name}: flow allowed only at READY`);
    ok(
      sequence.snapshots.slice(0, -1).every((s) => !s.flowAllowed || s.installState === "READY"),
      `${sequence.name}: no snapshot before the end lets the flow through early`
    );
  }
  const happy = sequences[0];
  ok(
    happy.snapshots.some((s) => s.installState === "MINIMIZED" && !s.flowAllowed),
    "happy path: Later minimized the popup and the gate stayed red"
  );
  eq(
    happy.snapshots[happy.snapshots.length - 1].gmailState,
    "RECONCILIATION_ARMED",
    "happy path: Gmail connected with consent, reconciliation armed"
  );
  const denied = sequences[1];
  ok(
    denied.snapshots.some((s) => s.installState === "NOTIFY_DENIED" && !s.flowAllowed),
    "denied path: alerts denial blocked the flow (owner ruling 19:14 ADT)"
  );
}

/* --- 6. Lifecycle sequences ------------------------------------------ */
{
  const { scenarios } = load("lifecycle-sequence.json").data;
  eq(scenarios.length, 2, "two lifecycle walks frozen");
  for (const scenario of scenarios) {
    for (const snapshot of scenario.snapshots) {
      mustParse(parseLifecycleStateDTO(snapshot), `${scenario.name}: ${snapshot.state} conforms`);
    }
    const final = scenario.snapshots[scenario.snapshots.length - 1];
    eq(final.state, "PURGED", `${scenario.name}: ends PURGED`);
    eq(
      final.history.map((h) => h.state).join(">"),
      "ACTIVE>TRIP_ENDED>POST_TRIP_PENDING>CLOSED>PURGED",
      `${scenario.name}: the full legal walk is in the final history`
    );
    ok(final.archive !== null, `${scenario.name}: purchased itinerary archived (owner ruling 19:39 ADT)`);
  }
  eq(scenarios[0].snapshots.at(-1).purgeReceipt.libraryRetained, true, "outstanding trip: library copy retained");
  eq(scenarios[0].snapshots.at(-1).purgeReceipt.closedReason, "review-submitted", "scenario A closed on review submission");
  eq(scenarios[1].snapshots.at(-1).purgeReceipt.libraryRetained, false, "window-expired trip: no library copy");
  eq(scenarios[1].snapshots.at(-1).purgeReceipt.closedReason, "review-window-expired", "scenario B closed on window expiry");
}

/* --- 7. Budget vs Real checkpoints ------------------------------------ */
{
  const { reports, libraryAfter } = load("budget-vs-real-checkpoints.json").data;
  eq(reports.length, 3, "three checkpoints frozen");
  for (const report of reports) {
    mustParse(parseBudgetVsRealComparisonDTO(report), `${report.checkpoint} comparison conforms`);
    const falls = report.items.find((i) => i.name === "Elm Falls");
    eq(falls.verdict, "UNVERIFIABLE", `${report.checkpoint}: Elm Falls stays UNVERIFIABLE`);
    eq(falls.real, null, `${report.checkpoint}: UNVERIFIABLE carries no real price — never zero, never guessed`);
    const lighthouse = report.items.find((i) => i.name === "Harbour Lighthouse");
    if (lighthouse.real) {
      eq(lighthouse.real.stale, true, `${report.checkpoint}: the 72h-old live check is STALE`);
      eq(lighthouse.real.excludedFromTotals, true, `${report.checkpoint}: STALE is excluded from totals`);
    }
  }
  const [before, during, after] = reports;
  eq(before.rollups.realTotal, 70, "BEFORE: real total 70 (library 40 + fresh live check 30; stale excluded)");
  eq(before.loud, false, "BEFORE: not loud — reality has not busted the cap yet");
  eq(during.regrade.verdict, "OVER", "DURING: real prices re-grade the trip OVER the cap");
  eq(during.loud, true, "DURING: BUDGET_BUSTED_BY_REAL_PRICES raised (collision law)");
  eq(after.rollups.realTotal, 237, "AFTER: as-lived real spend is 237");
  eq(during.calibrationWrites.length, 3, "DURING calibrated exactly the 3 PAID prices");
  const citadel = libraryAfter.find((r) => r.candidateKey === "citadel");
  eq(citadel.amount, 44, "library: the post-trip door actual (44) replaced the recorded price");
  eq(citadel.evidenceCount, 4, "library: citadel evidence count grew 3 -> 4");
}

/* --- Candidate guard smoke (pack DTOs join the corpus in Phase 3) --- */
{
  const verdict = parseCandidateDTO({
    candidateKey: "osm:node/283264348",
    kind: "museum",
    name: "Musée du Fort",
    pos: { lat: 46.8130715, lon: -71.2051909 },
    hours: { status: "unknown", raw: null },
    enrichment: null,
    provenance: { source: "osm", sourceRef: "osm:node/283264348", recordedAt: null, label: "fixture" }
  });
  mustParse(verdict, "candidate DTO guard accepts the Quebec headline candidate");
}

console.log(`roamly wiring phase1 golden checks: ${count}/${count} PASS`);
