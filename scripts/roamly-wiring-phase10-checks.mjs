// Phase 10 checks (DESIGN-PRODUCTION.md Phase 10 proof):
//   A — frontdoor reconciliation, STATIC dependency proof (no local
//       Postgres exists in this environment): every object the
//       fyi/frontdoor pair references is created by the pair or
//       earlier in the chain; the filename-sort order trap is real
//       and the ship checklist orders FYI before frontdoor; M9
//       statics (restrict link, one-per-trip, no itinerary column).
//   B — the shadow post-trip scenario re-run against the WIRED
//       modules: production-shaped inputs (plan items, M2 ledger
//       entries, booking facts) rebuilt from the shadow as-lived
//       fixture reconstruct the lived record faithfully (a skipped
//       item is not lived; actual times beat planned times); the
//       review email composes from it; the outstanding gate ingests
//       the 5/5 trip with the full owner index (CAD 876 honest
//       subtotal) and refuses the 4/5 and <3-check-in variants with
//       recorded reasons.
//   C — no-duplicate-copy law: the stored library row carries no
//       itinerary document (no plan/schedule fields at any depth)
//       and links at the archived trip by id.
//   D — budget-vs-real AFTER leg: the reckoning on the bot's fixture
//       trip reproduces the AFTER verdict (real 237, variance
//       +34.7%, OVER + loud) and the calibration sequence writes the
//       3 booking-time records in VERIFIED shape, ending in the
//       Phase 1 golden library state; bias proposals fire at >=5
//       observations and stay silent at 4.
//   E — pattern aggregation consumes an ingested record (in-memory):
//       a pattern row with budget_band populated; publishability
//       still demands >= 3 distinct trips; unknown would-use-again
//       fails closed; the M9 reader and the Gmail recipient resolver
//       fail soft / refuse exactly as designed.
//   F — statics: post-trip flag default off + the tripFeedback seam
//       gated on it; zero any / zero eslint-disable in the phase's
//       new module; the confirmed cron slots still exist.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InMemoryLibraryTripStore,
  buildKnownPriceIndex,
  buildPostTripReviewEmail,
  composePostTripReviewAsk,
  ingestAsLivedTrip,
  libraryTripRowToContextRecord,
  readLibraryTripExperienceRecords,
  reconstructAsLivedRecord,
  resolveConnectedGmailAddress,
  runPostTripReckoning,
  verifiedCheckIns
} from "@/lib/roamly/libraryIngest.ts";
import {
  buildLedgerEntryDTO,
  panelActionProvenance
} from "@/lib/roamly/companionLedger.ts";
import { localToInstantString } from "@/lib/roamly/engine/time.ts";
import {
  calibrate,
  createLibraryStore,
  runCheckpoint
} from "@/lib/roamly/engine/budgetVsReal.ts";
import {
  aggregateSuccessfulTripExperiencePatterns,
  isPublishableSuccessfulTripPattern
} from "@/lib/roamly/successfulTripExperiencePatterns.ts";
import { build2PostTripEnabled } from "@/lib/roamly/build2Flags.ts";

const here = dirname(fileURLToPath(import.meta.url));
const treeRoot = join(here, "..");
const wiringRoot = join(treeRoot, "..");

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

/* ------------------------------------------------------------------ */
/* A — frontdoor static dependency proof + M9 statics                  */
/* ------------------------------------------------------------------ */

function sectionA() {
  const migrationsDir = join(treeRoot, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const read = (name) => readFileSync(join(migrationsDir, name), "utf8");
  const FYI = "20261015_roamly_fyi_upsell_moments.sql";
  const FRONTDOOR = "20261015000100_roamly_itinerary_library_frontdoor.sql";
  const M9 = "20261022_roamly_library_trips.sql";
  ok(files.includes(FYI) && files.includes(FRONTDOOR) && files.includes(M9), "A: the pair + M9 exist in the tree");

  const createdTables = (sql) =>
    [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]).sort();
  eq(createdTables(read(FYI)), ["roamly_email_preferences", "roamly_fyi_digest_log", "roamly_trip_gap_cards"], "A: FYI creates exactly its three tables");
  eq(createdTables(read(FRONTDOOR)), ["item_verdicts", "itinerary_submissions"], "A: frontdoor creates exactly the two intake tables");
  ok(read(FRONTDOOR).includes("alter table public.roamly_email_preferences"), "A: frontdoor ALTERs the preferences table FYI creates (the ordering dependency)");
  ok(read(FRONTDOOR).includes("add column if not exists library_ask_opt_out"), "A: frontdoor adds library_ask_opt_out");
  ok(read(FRONTDOOR).includes("add column if not exists budget_band") && read(FRONTDOOR).includes("add column if not exists source_trip_count"), "A: frontdoor adds the two patterns columns");

  // Every pair table has exactly ONE creator across the whole chain.
  const pairTables = ["itinerary_submissions", "item_verdicts", "roamly_email_preferences", "roamly_fyi_digest_log", "roamly_trip_gap_cards", "roamly_library_trips"];
  for (const table of pairTables) {
    const creators = files.filter((f) => createdTables(read(f)).includes(table));
    eq(creators.length, 1, `A: exactly one migration creates ${table} (${creators.join(",")})`);
  }
  // Nothing else in the chain creates or alters the frontdoor intake
  // tables (DDL scan — a comment mention is not a touch).
  const alterers = files.filter((f) => f !== FRONTDOOR && /(create table if not exists public\.(itinerary_submissions|item_verdicts)|alter table public\.(itinerary_submissions|item_verdicts))/.test(read(f)));
  eq(alterers, [], "A: no other migration creates or alters the intake tables");

  // Dependency closure: every external object the pair leans on is
  // created earlier in the chain (or is platform surface).
  const schema = read("20260704_roamly_schema.sql");
  const budget = read("20260706_roamly_budget_booking_companion_notifications.sql");
  const patterns = read("20260926_roamly_successful_trip_experience_patterns.sql");
  ok(schema.includes("create table if not exists public.roamly_trips"), "A: roamly_trips is created in 20260704 (pair dependency)");
  ok(schema.includes("function public.roamly_set_updated_at"), "A: roamly_set_updated_at() is defined in 20260704 (pair + M9 dependency)");
  ok(budget.includes("create table if not exists public.roamly_bookings"), "A: roamly_bookings is created in 20260706 (item_verdicts FK target)");
  ok(patterns.includes("create table if not exists public.successful_trip_experience_patterns") && patterns.includes("sample_count"), "A: patterns table + sample_count exist from 20260926 (frontdoor backfill source)");

  // The order trap is real, and the checklist answers it.
  eq([FRONTDOOR, FYI].sort()[0], FRONTDOOR, "A: byte-wise filename sort puts frontdoor FIRST (the trap)");
  const checklist = readFileSync(join(wiringRoot, "FRONTDOOR-APPLICATION-CHECKLIST.md"), "utf8");
  const applyOrder = checklist.slice(checklist.indexOf("## Apply order"));
  ok(applyOrder.indexOf(FYI) >= 0 && applyOrder.indexOf(FYI) < applyOrder.indexOf(FRONTDOOR), "A: the checklist applies FYI before frontdoor");
  ok(checklist.includes("to_regclass('public.itinerary_submissions')") && checklist.includes("source_trip_count is null"), "A: the checklist carries read-back queries with expected values");

  // M9 statics.
  const m9 = read(M9);
  const createBlock = m9.slice(m9.indexOf("create table"), m9.indexOf(");", m9.indexOf("create table")));
  ok(createBlock.includes("references public.roamly_trips (id) on delete restrict"), "A: M9 links at the trip with ON DELETE RESTRICT (archive law)");
  ok(createBlock.includes("unique (trip_id)"), "A: M9 enforces one ingest per trip");
  ok(!/daily_itinerary|full_json/.test(createBlock), "A: M9's table has NO itinerary-document column");
  ok(createBlock.includes("item_verdicts jsonb") && createBlock.includes("price_unknown_items"), "A: M9 stores verdicts + the honest-unknown list, not a plan");
}

/* ------------------------------------------------------------------ */
/* B — shadow post-trip scenario against the wired modules             */
/* ------------------------------------------------------------------ */

const TZ = "America/Halifax";
const TRIP_ID = "trip-halifax-fixture";
const USER_ID = "user-avery-fixture";

function shadowFixture() {
  const raw = JSON.parse(readFileSync(join(here, "fixtures", "wiring-phase10", "as-lived-halifax.json"), "utf8"));
  return raw.data;
}

function buildInputs(fixture, { checkInKeys = null, overallRating = 5 } = {}) {
  const stateFor = { kept: "completed", skipped: "skipped", changed: "missed" };
  const planItems = fixture.items.map((item) => ({
    itemKey: item.itemKey,
    name: item.name,
    day: item.day,
    itemType: item.itemKey === "flight-ac1847" ? "flight" : "activity",
    plannedStart: item.planned?.start ?? null,
    plannedEnd: item.planned?.end ?? null,
    state: stateFor[item.outcome] || "completed",
    actualStart: item.actual?.start ?? null,
    actualEnd: item.actual?.end ?? item.actual?.left ?? null,
    bookingRef:
      item.itemKey === "flight-ac1847" ? "SYN-AC-7Q2M"
        : item.itemKey === "harbour-cruise" ? "SYN-CRUISE-96"
          : item.itemKey === "lou-pecou-dinner" ? "SYN-LOU-PEC"
            : null
  }));
  const ledgerEntries = [];
  const dateForDay = (day) => fixture.dates[day - 1];
  for (const item of fixture.items) {
    if (item.evidence?.type !== "check-in") continue;
    if (checkInKeys && !checkInKeys.includes(item.itemKey)) continue;
    const [hh, mm] = item.actual.checkedIn.split(":").map(Number);
    const at = localToInstantString(dateForDay(item.day), hh * 60 + mm, TZ);
    ledgerEntries.push(buildLedgerEntryDTO({
      tripId: TRIP_ID,
      activityRef: item.itemKey,
      classification: "CHECKED_IN",
      at,
      timezone: TZ,
      provenance: panelActionProvenance(at),
      dwellMinutes: item.actual.dwellMin
    }));
  }
  for (const [key, classification, day, clock] of [
    ["art-gallery-day2", "SKIPPED", 2, 9 * 60 + 42],
    ["royal-artillery-day2", "MISSED", 2, 14 * 60 + 5]
  ]) {
    const at = localToInstantString(dateForDay(day), clock, TZ);
    ledgerEntries.push(buildLedgerEntryDTO({
      tripId: TRIP_ID,
      activityRef: key,
      classification,
      at,
      timezone: TZ,
      provenance: panelActionProvenance(at)
    }));
  }
  const bookings = [
    { kind: "flight", reference: "SYN-AC-7Q2M", itemKey: null, title: "Flight AC 1847 to Halifax", provider: "Air Canada", flightNumber: "AC 1847", fromLabel: "Toronto Pearson (YYZ)", toLabel: "Halifax Stanfield (YHZ)", departureLabel: "2026-10-23 10:05 America/Toronto", arrivalLabel: "2026-10-23 13:20 America/Halifax", stars: null, amount: 412, currency: "CAD", priceStatus: "booked", checkInActual: null, checkOutActual: null },
    { kind: "hotel", reference: "SYN-HTL-368", itemKey: null, title: "Harbourlight Hotel & Suites", provider: null, flightNumber: null, fromLabel: null, toLabel: null, departureLabel: null, arrivalLabel: null, stars: 4, amount: 368, currency: "CAD", priceStatus: "booked", checkInActual: "2026-10-23 15:04", checkOutActual: "2026-10-25 10:52" },
    { kind: "activity", reference: "SYN-CRUISE-96", itemKey: "harbour-cruise", title: "Halifax Harbour Evening Cruise", provider: null, flightNumber: null, fromLabel: null, toLabel: null, departureLabel: null, arrivalLabel: null, stars: null, amount: 96, currency: "CAD", priceStatus: "booked", checkInActual: null, checkOutActual: null }
  ];
  const itemRatings = {};
  const likedByItem = {};
  for (const item of fixture.items) {
    if (item.travelerRating !== null && item.travelerRating !== undefined) itemRatings[item.itemKey] = item.travelerRating;
    if (item.liked) likedByItem[item.itemKey] = item.liked;
  }
  return {
    trip: { id: TRIP_ID, userId: USER_ID, destination: "Halifax", destinationCity: "Halifax", destinationCountry: "Canada", startDate: fixture.dates[0], endDate: fixture.dates[fixture.dates.length - 1], timezone: TZ },
    planItems,
    ledgerEntries,
    bookings,
    weather: fixture.weather.map((w) => ({ date: w.date, conditions: w.conditions, highC: w.highC, lowC: w.lowC, source: w.source })),
    feedback: { overallRating, itemRatings, likedByItem, wouldUseRoamlyAgain: true },
    evidenceStatus: fixture.evidenceStatus
  };
}

async function sectionB() {
  const fixture = shadowFixture();
  const asLived = reconstructAsLivedRecord(buildInputs(fixture));
  eq(asLived.items.length, 10, "B: reconstruction carries all 10 lived items");
  eq(verifiedCheckIns(asLived).length, 6, "B: 6 verified check-ins derive from the ledger");
  const citadel = asLived.items.find((i) => i.itemKey === "citadel");
  eq(citadel.actual.checkedIn, "15:40", "B: citadel check-in reads back at its true time");
  eq(citadel.actual.dwellMin, 62, "B: dwell comes from the ledger row");
  const museum = asLived.items.find((i) => i.itemKey === "maritime-museum-day2");
  eq(museum.planned.start, "11:30", "B: the plan said 11:30");
  eq(museum.actual.checkedIn, "11:34", "B: the as-lived record carries the ACTUAL 11:34, not the plan");
  const gallery = asLived.items.find((i) => i.itemKey === "art-gallery-day2");
  eq(gallery.outcome, "skipped", "B: the skipped gallery is skipped in the as-lived record");
  ok(!asLived.items.filter((i) => i.outcome === "kept").some((i) => i.itemKey === "art-gallery-day2"), "B: a skipped item is NOT in the lived/kept set");
  const artillery = asLived.items.find((i) => i.itemKey === "royal-artillery-day2");
  eq(artillery.outcome, "changed", "B: the missed park is 'changed', never a taste skip");
  eq(artillery.signal.classification, "MISSED", "B: MISSED stays distinct from SKIP");
  eq(asLived.items.find((i) => i.itemKey === "lou-pecou-dinner").price, null, "B: the unpriced dinner stays UNKNOWN");
  eq(asLived.items.find((i) => i.itemKey === "harbour-cruise").price.amount, 96, "B: the cruise carries its booked price");

  const prices = buildKnownPriceIndex(asLived);
  eq(prices.totalKnown, 876, "B: known subtotal is CAD 876 (412 + 368 + 96, flight counted once)");
  eq(prices.knownItems.length, 3, "B: exactly three known price entries");
  eq(prices.unknownItems, ["Lou Pécou"], "B: the unknown item is named, never zeroed");
  eq(prices.estimatedPrice.isCompleteTripTotal, false, "B: the subtotal is honestly flagged incomplete");

  const email = buildPostTripReviewEmail(asLived, { travelerName: "Avery" });
  eq(email.reviewPrompts.length, 9, "B: one prompt per reviewable lived item (rest block excluded)");
  ok(email.reviewPrompts.find((p) => p.itemKey === "art-gallery-day2").prompt.startsWith("You skipped"), "B: the skip prompt asks taste vs timing");
  ok(email.reviewPrompts.find((p) => p.itemKey === "royal-artillery-day2").prompt.includes("was missed because of circumstances"), "B: the missed prompt names circumstance");
  eq(email.liked.length, 6, "B: the email leads with the six things the traveler said they liked");
  eq(email.subject, "How was Halifax? Tell us what you loved", "B: subject matches the shadow composition");
  ok(email.generatedFrom.includes("as-lived"), "B: the email states it was generated from the as-lived record");

  // Ingest: the 5/5 trip enters the library.
  const store = new InMemoryLibraryTripStore();
  const result = await ingestAsLivedTrip(store, asLived, { now: "2026-10-26T13:00:00Z", budgetAmount: 1100 });
  eq(result.ingested, true, "B: the outstanding verified trip ingests");
  const row = await store.getByTripId(TRIP_ID);
  ok(row !== null, "B: the library row is stored");
  eq(row.destination_key, "halifax,canada", "B: index key = place");
  eq(row.hotel_name, "Harbourlight Hotel & Suites", "B: index carries the hotel");
  eq(row.hotel_stars, 4, "B: index carries the hotel stars");
  eq(row.flights[0].flight, "AC 1847", "B: index carries the flight");
  eq(row.flights[0].price.amount, 412, "B: index carries the flight price");
  eq(row.weather.map((w) => w.date), fixture.dates, "B: index carries the weather days");
  eq(row.price_known_subtotal, 876, "B: index price is the honest known subtotal");
  eq(row.price_unknown_items, ["Lou Pécou"], "B: index names the unknown price");
  eq(row.price_is_complete, false, "B: index flags the price incomplete");
  eq(row.verified_checkin_count, 6, "B: index records the verified check-in count");
  eq(row.overall_rating, 5, "B: index records the rating");
  eq(row.budget_band, "budget", "B: index carries the budget band (trip budget 1100)");
  eq(row.item_verdicts.length, 10, "B: index carries per-item verdicts");

  // Idempotency: a second ingest writes no second row.
  const again = await ingestAsLivedTrip(store, asLived, { now: "2026-10-26T14:00:00Z", budgetAmount: 1100 });
  eq(again.ingested, true, "B: re-ingest is an idempotent success");
  ok((await store.listDecisions(TRIP_ID)).length >= 2, "B: decisions accumulate on the record");

  // Refusal 1: 4/5 is not outstanding.
  const fourStar = reconstructAsLivedRecord(buildInputs(fixture, { overallRating: 4 }));
  const refusedRating = await ingestAsLivedTrip(store, fourStar, { now: "2026-10-26T15:00:00Z" });
  eq(refusedRating.ingested, false, "B: a 4/5 trip is refused");
  ok(refusedRating.reason.includes("below the outstanding threshold"), "B: the refusal names the rating reason");
  const decisions = await store.listDecisions(TRIP_ID);
  ok(decisions.some((d) => !d.eligible && d.reasons.some((r) => r.includes("below the outstanding threshold"))), "B: the refusal is RECORDED as a decision with its reason");

  // Refusal 2: rating alone never ingests — strip to 2 verified check-ins.
  const twoCheckIns = reconstructAsLivedRecord(buildInputs(fixture, { checkInKeys: ["citadel", "maritime-museum-day2"] }));
  eq(verifiedCheckIns(twoCheckIns).length, 2, "B: the stripped variant has exactly 2 verified check-ins");
  const refusedThin = await ingestAsLivedTrip(store, twoCheckIns, { now: "2026-10-26T16:00:00Z" });
  eq(refusedThin.ingested, false, "B: 5/5 with <3 verified check-ins is refused");
  ok(refusedThin.reason.includes("only 2 verified check-ins"), "B: the refusal names the evidence reason");

  // Unavailable: M9 not applied yet — the gate runs, nothing writes, no throw.
  const missingTableStore = {
    async upsertRow() { throw Object.assign(new Error('relation "public.roamly_library_trips" does not exist'), { code: "42P01" }); },
    async getByTripId() { return null; },
    async recordDecision() {},
    async listDecisions() { return []; }
  };
  const unavailable = await ingestAsLivedTrip(missingTableStore, asLived, { now: "2026-10-26T17:00:00Z" });
  eq(unavailable.ingested, false, "B: with M9 missing nothing ingests");
  eq(unavailable.unavailable, true, "B: the missing-table state is reported as unavailable, not an error");

  return row;
}

/* ------------------------------------------------------------------ */
/* C — no-duplicate-copy law                                           */
/* ------------------------------------------------------------------ */

function sectionC(row) {
  const keys = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        walk(child);
      }
    }
  };
  walk(row);
  ok(!keys.some((k) => /itinerary|full_json|daily|planned|schedule/i.test(k)), "C: no itinerary-document key exists at any depth of the library row");
  ok(!JSON.stringify(row.item_verdicts).includes("19:00") && !JSON.stringify(row.item_verdicts).includes("planned"), "C: verdicts carry outcomes + ratings only — no schedule");
  eq(row.trip_id, TRIP_ID, "C: the row LINKS at the archived trip by id");
  eq(row.provenance.archivedTripId, TRIP_ID, "C: provenance names the archived-trip link");
}

/* ------------------------------------------------------------------ */
/* D — budget-vs-real AFTER leg                                        */
/* ------------------------------------------------------------------ */

function sectionD() {
  const scenario = JSON.parse(readFileSync(join(here, "fixtures", "wiring-phase2", "budget-vs-real-scenario.json"), "utf8")).data;
  const golden = JSON.parse(readFileSync(join(here, "fixtures", "wiring-phase1", "budget-vs-real-checkpoints.json"), "utf8")).data;
  const store = createLibraryStore(scenario.seed);

  const before = runCheckpoint(scenario.itinerary, "BEFORE", { now: scenario.nowBefore, library: store, liveChecks: scenario.liveChecks });
  eq(before.rollups.trip.realTotal, 70, "D: BEFORE real total 70 (the stale lighthouse check excluded)");

  const during = runCheckpoint(scenario.itinerary, "DURING", { now: scenario.nowDuring, library: store, liveChecks: scenario.liveChecks, bookingFacts: scenario.bookingFacts });
  const writtenDuring = calibrate(during.items, store, { now: scenario.nowDuring });
  eq(writtenDuring.length, 3, "D: booking time calibrates exactly the 3 PAID records");
  eq(writtenDuring.map((w) => w.key).sort(), ["bistro-lunch", "harbour-ferry", "museum"], "D: the 3 records are the three booking confirmations");
  for (const write of writtenDuring) {
    eq(Object.keys(write).sort(), ["amount", "currency", "evidenceCount", "key", "per", "recordedAt", "source"], `D: ${write.key} is written in the exact VERIFIED shape`);
    eq(write.per, "party", `D: ${write.key} is a party-total record`);
  }
  eq(writtenDuring.find((w) => w.key === "harbour-ferry").amount, 95, "D: the ferry's real 95 is the calibrated record");

  const reckoning = runPostTripReckoning({
    itinerary: scenario.itinerary,
    bookingFacts: scenario.bookingFacts,
    actuals: scenario.actuals,
    library: store,
    now: scenario.nowAfter
  });
  eq(reckoning.report.checkpoint, "AFTER", "D: the reckoning runs the AFTER checkpoint");
  eq(reckoning.report.rollups.trip.realTotal, 237, "D: AFTER real spend is 237");
  eq(reckoning.report.rollups.trip.variancePct, 34.7, "D: final variance is +34.7%");
  eq(reckoning.report.regrade.verdict, "OVER", "D: the final verdict is OVER");
  eq(reckoning.report.loud.length, 1, "D: exactly one loud flag");
  eq(reckoning.report.loud[0].type, "BUDGET_BUSTED_BY_REAL_PRICES", "D: the loud flag is the budget-busted law");
  const citadelWrite = reckoning.calibrationWrites.find((w) => w.key === "citadel");
  eq(citadelWrite.amount, 44, "D: the door actual (44) outranks the library record at AFTER");
  eq(citadelWrite.evidenceCount, 4, "D: citadel evidence accumulates 3 -> 4");
  ok(reckoning.calibrationWrites.some((w) => w.key === "gallery" && w.amount === 28), "D: the gallery's door actual calibrates");

  const libraryAfter = Object.entries(store.records).map(([key, rec]) => ({ candidateKey: key, amount: rec.amount, currency: rec.currency, per: rec.per, source: rec.source, recordedAt: rec.recordedAt, evidenceCount: rec.evidenceCount }));
  const byKey = (a, b) => a.candidateKey.localeCompare(b.candidateKey);
  eq([...libraryAfter].sort(byKey), [...golden.libraryAfter].sort(byKey), "D: the calibrated library state equals the Phase 1 golden records");

  const mealObs = (n) => Array.from({ length: n }, () => ({ key: null, category: "meal", tier: "BAND", modeledRange: { low: 12, high: 30, currency: "CAD" }, realPerPerson: 35 }));
  const withFive = runPostTripReckoning({ itinerary: { tripRef: "bias-fixture", days: [] }, library: createLibraryStore(), now: scenario.nowAfter, priorObservations: mealObs(5) });
  eq(withFive.biasProposals.length, 1, "D: 5 meal observations fire exactly one bias proposal");
  eq(withFive.biasProposals[0].category, "meal", "D: the proposal names the meal band");
  ok(withFive.biasProposals[0].status.includes("never applied"), "D: the proposal is a record for review, never an application");
  const withFour = runPostTripReckoning({ itinerary: { tripRef: "bias-fixture", days: [] }, library: createLibraryStore(), now: scenario.nowAfter, priorObservations: mealObs(4) });
  eq(withFour.biasProposals.length, 0, "D: 4 observations stay silent");
}

/* ------------------------------------------------------------------ */
/* E — aggregation bridge + fail-soft reads + Gmail rule               */
/* ------------------------------------------------------------------ */

async function sectionE(row) {
  const tripFields = { travelers_count: 2, travel_style: null, accommodation_preference: null, transportation_preference: null, budget_amount: 1100 };
  const record = libraryTripRowToContextRecord(row, tripFields, { wouldUseRoamlyAgain: true });
  ok(record !== null, "E: the ingested row converts to an aggregation record");
  eq(record.weight, 2, "E: the record carries the booking-proven weight");
  eq(record.budgetBand, "budget", "E: the record carries its budget band");
  eq(record.experienceContext.destinationKey, "halifax,canada", "E: the context is keyed by destination");

  const variants = [0, 1, 2].map((n) => libraryTripRowToContextRecord({ ...row, trip_id: `${TRIP_ID}-${n}` }, tripFields, { wouldUseRoamlyAgain: true }));
  const patterns = aggregateSuccessfulTripExperiencePatterns(variants);
  eq(patterns.length, 1, "E: three same-shape trips aggregate into one pattern");
  eq(patterns[0].budgetBand, "budget", "E: the pattern row has budget_band populated");
  eq(patterns[0].sourceTripCount, 3, "E: the pattern counts 3 distinct source trips");
  eq(isPublishableSuccessfulTripPattern(patterns[0]), true, "E: 3 distinct trips publish");
  const single = aggregateSuccessfulTripExperiencePatterns([record]);
  eq(isPublishableSuccessfulTripPattern(single[0]), false, "E: one trip alone never publishes (small-sample caution)");

  const unknownWouldUse = libraryTripRowToContextRecord(row, tripFields, { wouldUseRoamlyAgain: null });
  eq(aggregateSuccessfulTripExperiencePatterns([unknownWouldUse]).length, 0, "E: an unknown would-use-again fails closed in aggregation");

  // Fail-soft: M9 missing -> the reader returns [] (a thenable stub
  // whose every chain step resolves to the missing-table error).
  const missing = { data: null, error: { message: 'relation "public.roamly_library_trips" does not exist', code: "42P01" } };
  const chain = () => {
    const self = {
      select: () => self, eq: () => self, in: () => self, not: () => self,
      order: () => self, limit: () => self,
      then: (resolve) => resolve(missing)
    };
    return self;
  };
  eq(await readLibraryTripExperienceRecords({ from: chain }), [], "E: the M9 reader fails soft to [] when the table is missing");

  // Gmail rule: the recipient is the connected Gmail, only.
  const gmailAdmin = {
    from: () => {
      const self = {
        select: () => self, eq: () => self, not: () => self,
        limit: () => Promise.resolve({ data: [{ email_address: "avery@gmail.example" }], error: null }),
        then: (resolve) => resolve({ data: [{ email_address: "avery@gmail.example" }], error: null })
      };
      return self;
    }
  };
  eq(await resolveConnectedGmailAddress(gmailAdmin, USER_ID), "avery@gmail.example", "E: the connected Gmail is the recipient");
  const fixture = shadowFixture();
  const asLived = reconstructAsLivedRecord(buildInputs(fixture));
  const composed = await composePostTripReviewAsk(gmailAdmin, asLived, { travelerName: "Avery" });
  eq(composed.ok, true, "E: the review ask composes for the connected Gmail");
  eq(composed.to, "avery@gmail.example", "E: the ask is addressed to the Gmail");
  const noGmailAdmin = {
    from: () => {
      const self = {
        select: () => self, eq: () => self, not: () => self,
        limit: () => Promise.resolve({ data: [], error: null }),
        then: (resolve) => resolve({ data: [], error: null })
      };
      return self;
    }
  };
  const refused = await composePostTripReviewAsk(noGmailAdmin, asLived, {});
  eq(refused.ok, false, "E: no connected Gmail -> no review ask (an Outlook connection never satisfies it)");
  eq(refused.reason, "NO_CONNECTED_GMAIL", "E: the refusal is named");
}

/* ------------------------------------------------------------------ */
/* F — statics                                                         */
/* ------------------------------------------------------------------ */

function sectionF() {
  eq(build2PostTripEnabled({}), false, "F: ROAMLY_BUILD2_POSTTRIP_ENABLED defaults OFF");
  eq(build2PostTripEnabled({ ROAMLY_BUILD2_POSTTRIP_ENABLED: "true" }), true, "F: the post-trip flag parses on");
  const feedbackSrc = readFileSync(join(treeRoot, "lib", "roamly", "tripFeedback.ts"), "utf8");
  ok(feedbackSrc.indexOf("build2PostTripEnabled()") >= 0 && feedbackSrc.indexOf("build2PostTripEnabled()") < feedbackSrc.indexOf("maybeIngestCompletedTrip({"), "F: the ingest seam sits behind the flag in tripFeedback");
  const aggregationSrc = readFileSync(join(treeRoot, "lib", "roamly", "successfulTripExperiencePatternAggregation.ts"), "utf8");
  ok(aggregationSrc.includes("readLibraryTripExperienceRecords"), "F: the aggregation consumes the library-trip lane");
  const ingestSrc = readFileSync(join(treeRoot, "lib", "roamly", "libraryIngest.ts"), "utf8");
  ok(!/\bas any\b|:\s*any\s*[;,)\]}=]|<any>|any\[\]|Record<string, any>/.test(ingestSrc), "F: libraryIngest.ts has zero any");
  ok(!ingestSrc.includes("eslint-disable"), "F: libraryIngest.ts has zero eslint-disable");
  const vercel = JSON.parse(readFileSync(join(treeRoot, "vercel.json"), "utf8"));
  const cronPaths = vercel.crons.map((c) => c.path);
  ok(cronPaths.includes("/api/cron/roamly-post-trip-ask"), "F: the confirmed post-trip-ask cron slot exists (12:17 UTC daily)");
  ok(cronPaths.includes("/api/cron/roamly-successful-trip-patterns"), "F: the patterns aggregation cron slot exists");
}

sectionA();
const row = await sectionB();
sectionC(row);
sectionD();
await sectionE(row);
sectionF();

console.log(`\nPhase 10 checks: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log("failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
