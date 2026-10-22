// Phase 11 checks (DESIGN-PRODUCTION.md Phase 11 proof; E2E tester
// Ch. 12 legs D1-D4 re-based to the 2026-10-21 19:39 owner ruling —
// purge the panel and live copies, archive the purchased itinerary):
//   A — statics: M4/M5 shapes (lifecycle table + tombstone posture,
//       the two purge helper functions; receipts table with NO FK
//       and a hash-shaped trip_ref), the executor's delete list is
//       the closed enumerated constant and excludes every protected
//       table, the lifecycle flag defaults OFF, the cron route + the
//       tripFeedback trigger seam are wired, zero any/eslint-disable.
//   B — shadow Scenario A re-run on production shapes (the 27/27
//       walk, review-submitted leg): ACTIVE with live copies ->
//       mid-trip purge REFUSED -> TRIP_ENDED (7-day window, labeled
//       Dylan's default) -> purge refused while the loop is open ->
//       POST_TRIP_PENDING -> REAL Phase 10 ingest (5/5, ingested
//       BEFORE purge) -> review submission closes + ARCHIVES ->
//       purge deletes exactly the ruled set with shadow-exact
//       receipt counts -> the archived itinerary document is
//       byte-identical, the library row survives byte-identical,
//       another trip's rows are untouched -> second purge is a
//       no-op with the same receipt. The lifecycle DTO parses at
//       every state of the walk.
//   C — shadow Scenario B: no review; the window does not close
//       early; expiry closes (reason: review-window-expired) and
//       the sweep purges with NO library record.
//   D — shadow Scenario C: a 4/5 review closes the trip, is NOT
//       ingested (Phase 10 gate), and purges with libraryRetained
//       false.
//   E — ingest-before-purge is a HARD ordering (shadow D + the
//       production decision seam): submitted review with NO
//       recorded decision refuses (INGEST_DECISION_OUTSTANDING,
//       recorded, retried successfully later); eligible decision
//       with the library row missing refuses (INGEST_BEFORE_PURGE)
//       and the closed trip stays intact until the row lands.
//   F — FK precondition gate: the verified live map purges fine;
//       a drifted confdeltype AND a vanished constraint each refuse
//       with an escalation recorded and ZERO deletes; restoring the
//       map purges.
//   G — the lived ledger deletes only under the purge flag at the
//       store seam (M2 trigger semantics): direct deletes without
//       the declaration throw and delete nothing.
//   H — flag posture + tombstone: with the purge flag OFF the sweep
//       still ends/closes/archives but purges nothing; after a
//       purge the tombstone reports purged + device-cache clearing,
//       acknowledges, blocks resurrection, and refuses late review
//       submissions.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InMemoryLifecycleStore,
  InMemoryPurgeDataStore,
  InMemoryPurgeReceiptStore,
  PURGE_DELETE_TABLES,
  PURGE_FK_EXPECTATIONS,
  PURGE_PROTECTED_TABLES,
  PURGE_SCOPE_TABLES,
  REVIEW_WINDOW_DAYS_DEFAULT,
  REVIEW_WINDOW_DEFAULT_SOURCE,
  acknowledgeTombstone,
  advanceLifecycle,
  ensureLifecycleRecord,
  executePurge,
  getTombstone,
  ingestGateFromStores,
  isTripPurged,
  loadLifecycleDTO,
  recordFeedbackReviewSubmission,
  recordIngestDecision,
  recordReviewEmailSent,
  recordReviewSubmission,
  runLifecycleSweep,
  toLifecycleDTO,
  tripRefForTrip,
  verifiedLiveFkCatalog
} from "@/lib/roamly/tripLifecycle.ts";
import {
  InMemoryLibraryTripStore,
  ingestAsLivedTrip
} from "@/lib/roamly/libraryIngest.ts";
import { sha256Hex } from "@/lib/roamly/engine/ids.ts";
import {
  parseLifecycleStateDTO,
  parsePurgeReceiptDTO
} from "@/lib/roamly/engine/types.ts";
import { build2LifecycleEnabled } from "@/lib/roamly/build2Flags.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}
function eq(actual, expected, label) {
  ok(
    actual === expected,
    `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`
  );
}

/* ------------------------------------------------------------------ */
/* World builder                                                       */
/* ------------------------------------------------------------------ */

const TZ = "America/Halifax";
const DATES = { start: "2026-10-23", end: "2026-10-25" };
const T_END = "2026-10-26T12:00:00.000Z"; // Oct 26 09:00 ADT — past the final day
const T_SENT = "2026-10-26T13:00:00.000Z";
const T_SUBMIT = "2026-10-27T10:00:00.000Z";
const T_PURGE = "2026-10-27T10:05:00.000Z";

function makeWorld() {
  const lifecycle = new InMemoryLifecycleStore();
  const receipts = new InMemoryPurgeReceiptStore();
  const data = new InMemoryPurgeDataStore();
  const library = new InMemoryLibraryTripStore();
  const fkCatalog = verifiedLiveFkCatalog();
  const deps = {
    lifecycle,
    receipts,
    data,
    fkCatalog,
    ingestGate: ingestGateFromStores({ library, lifecycle })
  };
  return { deps, lifecycle, receipts, data, library, fkCatalog };
}

function seedTrip(world, tripId, counts) {
  const { data } = world;
  data.addTrip(tripId, {
    userId: "user-1",
    status: "activated",
    timezone: TZ,
    startDate: DATES.start,
    endDate: DATES.end
  });
  data.addItinerary(tripId, {
    id: `itin-${tripId}`,
    fullJson: JSON.stringify({ daily_itinerary: [{ day: 1, title: "Arrival" }], marker: tripId })
  });
  for (let i = 0; i < counts.notifications; i++)
    data.addRow("notifications", { id: `n-${tripId}-${i}`, tripId, payload: `notification ${i}` });
  for (let i = 0; i < counts.deliveries; i++)
    data.addRow("notificationDeliveries", { id: `d-${tripId}-${i}`, tripId, payload: `delivery ${i}` });
  for (let i = 0; i < counts.panel; i++)
    data.addRow("panelState", { id: `p-${tripId}-${i}`, tripId, payload: `panel item ${i}` });
  for (let i = 0; i < counts.days; i++)
    data.addRow("cachedDays", { id: `cd-${tripId}-${i}`, tripId, payload: `cached day ${i}` });
  for (let i = 0; i < counts.activities; i++)
    data.addRow("itineraryItems", { id: `ai-${tripId}-${i}`, tripId, payload: `activity copy ${i}` });
  for (let i = 0; i < counts.ledger; i++)
    data.addRow("ledger", { id: `le-${tripId}-${i}`, tripId, payload: `ledger entry ${i}` });
  for (let i = 0; i < counts.liveCopies; i++)
    data.addLiveCopy(tripId, `live-copy-${tripId}-${i}`);
}

async function seedActiveTrip(world, tripId, counts) {
  seedTrip(world, tripId, counts);
  await ensureLifecycleRecord(world.deps, {
    tripId,
    userId: "user-1",
    timezone: TZ,
    dates: DATES,
    now: "2026-10-23T12:00:00.000Z"
  });
}

function livedItem(key, name) {
  return {
    itemKey: key,
    name,
    day: 1,
    itemType: "activity",
    outcome: "kept",
    planned: { start: "10:00", end: "11:00" },
    actual: { checkedIn: "10:05", dwellMin: 40 },
    evidence: { type: "check-in", verified: true },
    signal: null,
    travelerRating: 5,
    liked: "loved it",
    bookingRef: null,
    price: null
  };
}

function asLived(tripId, rating) {
  return {
    tripId,
    userId: "user-1",
    destination: "Halifax, Canada",
    destinationCity: "Halifax",
    destinationCountry: "Canada",
    dates: ["2026-10-23", "2026-10-24", "2026-10-25"],
    timezone: TZ,
    hotel: null,
    flights: [],
    weather: [],
    items: [livedItem("a1", "Item One"), livedItem("a2", "Item Two"), livedItem("a3", "Item Three")],
    overallTravelerRating: rating,
    ratingScale: 5,
    evidenceStatus: null
  };
}

async function scopeCounts(world, tripId) {
  const { data } = world;
  return {
    notificationDeliveries: await data.countScope(tripId, "notificationDeliveries"),
    notifications: await data.countScope(tripId, "notifications"),
    panelState: await data.countScope(tripId, "panelState"),
    cachedDays: await data.countScope(tripId, "cachedDays"),
    itineraryItems: await data.countScope(tripId, "itineraryItems"),
    ledgerEntries: await data.countScope(tripId, "ledger"),
    liveCopies: await data.countScope(tripId, "liveCopies")
  };
}

async function dtoOk(world, tripId, label) {
  const record = await world.lifecycle.get(tripId);
  const parsed = parseLifecycleStateDTO(toLifecycleDTO(record));
  ok(parsed.ok, `${label} (errors: ${parsed.ok ? "" : parsed.errors.join("; ")})`);
}

/* ------------------------------------------------------------------ */
/* A — statics                                                         */
/* ------------------------------------------------------------------ */
{
  const m4 = readFileSync(join(root, "supabase/migrations/20261022_roamly_trip_lifecycle.sql"), "utf8");
  const m5 = readFileSync(join(root, "supabase/migrations/20261022_roamly_purge_receipts.sql"), "utf8");
  ok(m4.includes("create table if not exists public.roamly_trip_lifecycle"), "A: M4 creates roamly_trip_lifecycle");
  ok(/roamly_trip_lifecycle[\s\S]*?references public\.roamly_trips \(id\) on delete restrict/.test(m4), "A: M4's trip FK is RESTRICT (tombstone cannot be orphaned)");
  ok(m4.includes("roamly_fk_delete_action") && m4.includes("pg_constraint"), "A: M4 carries the FK catalog helper for the precondition gate");
  ok(m4.includes("roamly_purge_companion_ledger") && m4.includes("roamly.allow_purge"), "A: M4 carries the purge-flagged ledger delete (M2 trigger contract)");
  ok(m4.includes("FILES ONLY"), "A: M4 is files-only (never executed by the build)");
  ok(m5.includes("create table if not exists public.roamly_purge_receipts"), "A: M5 creates roamly_purge_receipts");
  ok(!/references\s+public/i.test(m5) && !/trip_id\s+uuid/.test(m5), "A: M5 has NO foreign key and NO trip_id column — the receipt cannot cascade or be joined back");
  ok(m5.includes("unique (trip_ref)") && m5.includes("^[0-9a-f]{64}$"), "A: M5 keys receipts by the one-way hash, one per trip");
  ok(m5.includes("FILES ONLY"), "A: M5 is files-only");

  eq(
    JSON.stringify([...PURGE_DELETE_TABLES].sort()),
    JSON.stringify(
      [
        "roamly_companion_ledger",
        "roamly_companion_notification_deliveries",
        "roamly_itinerary_days",
        "roamly_notifications",
        "roamly_trip_activities",
        "roamly_trip_companion_events"
      ].sort()
    ),
    "A: the executor's delete list is exactly the enumerated scope tables"
  );
  ok(
    PURGE_PROTECTED_TABLES.every((table) => !PURGE_DELETE_TABLES.includes(table)),
    "A: no protected table (trips, itineraries, bookings, entitlements, email logs, library, lifecycle, receipts) is deletable by construction"
  );
  eq(PURGE_SCOPE_TABLES.ledger, "roamly_companion_ledger", "A: the ledger scope maps to the M2 table");
  eq(PURGE_FK_EXPECTATIONS.length, 3, "A: three FK expectations gate the purge");

  eq(build2LifecycleEnabled({}), false, "A: the lifecycle flag defaults OFF (trips close, nothing purges)");
  eq(build2LifecycleEnabled({ ROAMLY_BUILD2_LIFECYCLE_ENABLED: "true" }), true, "A: the sub-flag turns the purge job on");
  eq(build2LifecycleEnabled({ ROAMLY_BUILD2_ENABLED: "on" }), true, "A: the umbrella flag defaults the sub-flag");

  const route = readFileSync(join(root, "app/api/cron/roamly-lifecycle/route.ts"), "utf8");
  ok(route.includes("isCronRequestAuthorized") && route.includes("runLifecycleSweep") && route.includes("build2LifecycleEnabled"), "A: the cron route is CRON_SECRET-guarded and runs the sweep behind the flag");
  const feedback = readFileSync(join(root, "lib/roamly/tripFeedback.ts"), "utf8");
  ok(feedback.includes("recordFeedbackReviewSubmission") && feedback.includes("build2LifecycleEnabled"), "A: the tripFeedback trigger seam records the review submission behind the lifecycle flag");
  const lifecycleSrc = readFileSync(join(root, "lib/roamly/tripLifecycle.ts"), "utf8");
  ok(!lifecycleSrc.includes("eslint-disable") && !route.includes("eslint-disable"), "A: zero eslint-disable in the phase's new files");
  ok(!/: any\b|as any\b|<any>/.test(lifecycleSrc), "A: zero any in tripLifecycle.ts");
  eq(REVIEW_WINDOW_DAYS_DEFAULT, 7, "A: the review window default is 7 days");
  ok(REVIEW_WINDOW_DEFAULT_SOURCE.includes("Dylan's default"), "A: the window is labeled Dylan's default, never an owner ruling");
}

/* ------------------------------------------------------------------ */
/* B — Scenario A: review submitted, outstanding, ingest before purge  */
/* ------------------------------------------------------------------ */
const TRIP_A = "trip-halifax-a";
const TRIP_OTHER = "trip-other-b";
{
  const world = makeWorld();
  const counts = { notifications: 4, deliveries: 5, panel: 12, days: 3, activities: 12, ledger: 3, liveCopies: 1 };
  await seedActiveTrip(world, TRIP_A, counts);
  await seedActiveTrip(world, TRIP_OTHER, { notifications: 2, deliveries: 1, panel: 3, days: 2, activities: 3, ledger: 1, liveCopies: 1 });

  let record = await world.lifecycle.get(TRIP_A);
  eq(record.state, "ACTIVE", "B: the trip starts ACTIVE");
  eq((await scopeCounts(world, TRIP_A)).notifications, 4, "B: live copies are present while ACTIVE");
  await dtoOk(world, TRIP_A, "B: lifecycle DTO parses at ACTIVE");

  const midTrip = await executePurge(world.deps, TRIP_A, "2026-10-24T12:00:00.000Z");
  ok(!midTrip.ok && midTrip.code === "PURGE_BEFORE_TRIP_END", "B: purge mid-trip is REFUSED (never before TRIP_ENDED)");
  eq((await scopeCounts(world, TRIP_A)).notifications, 4, "B: the refused purge changed nothing");
  eq(world.receipts.size, 0, "B: no receipt exists after a refused purge");

  const ended = await advanceLifecycle(world.deps, TRIP_A, T_END, { purgeEnabled: true });
  eq(ended.to, "TRIP_ENDED", "B: final day complete -> TRIP_ENDED");
  record = await world.lifecycle.get(TRIP_A);
  eq(record.reviewWindowEndsAt, "2026-11-02T12:00:00.000Z", "B: the review window ends exactly 7 days after trip end");
  await dtoOk(world, TRIP_A, "B: lifecycle DTO parses at TRIP_ENDED");

  const atEnded = await executePurge(world.deps, TRIP_A, "2026-10-26T13:30:00.000Z");
  ok(!atEnded.ok && atEnded.code === "PURGE_BEFORE_CLOSE", "B: purge at TRIP_ENDED is refused — the post-trip loop is still owed");

  const sent = await recordReviewEmailSent(world.deps, TRIP_A, T_SENT);
  ok(sent.ok, "B: the review email send is recorded");
  record = await world.lifecycle.get(TRIP_A);
  eq(record.state, "POST_TRIP_PENDING", "B: review email sent from the as-lived record -> POST_TRIP_PENDING");
  const atPending = await executePurge(world.deps, TRIP_A, "2026-10-26T14:00:00.000Z");
  ok(!atPending.ok && atPending.code === "PURGE_BEFORE_CLOSE", "B: purge while the review is pending is refused");
  await dtoOk(world, TRIP_A, "B: lifecycle DTO parses at POST_TRIP_PENDING");

  // Phase 10 ingest runs BEFORE any purge (hard ordering), through
  // the real gate: 5/5 + 3 verified check-ins ingests.
  const ingest = await ingestAsLivedTrip(world.library, asLived(TRIP_A, 5), { now: T_SUBMIT });
  ok(ingest.ingested === true, "B: the outstanding trip ingests through the real Phase 10 gate");
  await recordIngestDecision(world.deps, TRIP_A, { eligible: ingest.decision.eligible, ingested: ingest.ingested }, T_SUBMIT);
  const libraryBefore = JSON.stringify(await world.library.getByTripId(TRIP_A));
  const docBefore = (await world.data.getItineraryDocument(TRIP_A)).fullJson;

  const submitted = await recordReviewSubmission(world.deps, TRIP_A, T_SUBMIT);
  ok(submitted.ok && submitted.state === "CLOSED", "B: review submission -> CLOSED (reason: review-submitted)");
  record = await world.lifecycle.get(TRIP_A);
  eq(record.closedReason, "review-submitted", "B: close reason is review-submitted");
  ok(record.archive !== null && record.archive.itineraryRef === `itin-${TRIP_A}`, "B: at CLOSED the purchased itinerary is ARCHIVED in the account (never deleted)");
  eq(await world.data.getTripStatus(TRIP_A), "archived", "B: the trip row reads ARCHIVED");
  ok((await world.library.getByTripId(TRIP_A)) !== null, "B: the library copy exists while the live copies still live (ingest BEFORE purge)");
  await dtoOk(world, TRIP_A, "B: lifecycle DTO parses at CLOSED");

  const res = await executePurge(world.deps, TRIP_A, T_PURGE, { actor: "phase11-checks" });
  ok(res.ok === true && res.alreadyPurged === false, "B: purge runs from CLOSED");
  record = await world.lifecycle.get(TRIP_A);
  eq(record.state, "PURGED", "B: the trip is PURGED (live copies) with its archive intact");
  eq(res.receipt.deletedCounts.notifications, counts.notifications, "B: receipt counts the deleted notifications");
  eq(res.receipt.deletedCounts.cachedDays, counts.days, "B: receipt counts the deleted cached day rows");
  eq(res.receipt.deletedCounts.ledgerEntries, counts.ledger, "B: receipt counts the deleted ledger entries");
  eq(res.receipt.deletedCounts.itineraryItems, counts.activities, "B: receipt counts the deleted live item copies");
  eq(res.receipt.deletedCounts.liveCopies, 1, "B: receipt counts the retired live copy");
  eq(res.detail.panelState, counts.panel, "B: purge detail counts the deleted panel state");
  eq(res.detail.notificationDeliveries, counts.deliveries, "B: purge detail counts the deleted delivery rows");
  eq(res.receipt.libraryRetained, true, "B: the receipt records that the library copy was retained");
  eq(res.receipt.closedReason, "review-submitted", "B: the receipt carries the close reason");

  const after = await scopeCounts(world, TRIP_A);
  ok(
    Object.values(after).every((n) => n === 0),
    "B: every live copy is GONE (panel, cache, notifications, deliveries, ledger, item copies, live copy)"
  );
  eq(JSON.stringify(await world.library.getByTripId(TRIP_A)), libraryBefore, "B: the library record SURVIVES the purge, byte-identical, linked to the archived trip");
  eq((await world.data.getItineraryDocument(TRIP_A)).fullJson, docBefore, "B: the archived itinerary DOCUMENT is byte-identical after purge");
  eq(await world.data.getTripStatus(TRIP_A), "archived", "B: the trip still reads ARCHIVED after purge (absent from live surfaces, present in the account)");
  eq((await scopeCounts(world, TRIP_OTHER)).notifications, 2, "B: another trip's live copies are untouched");
  await dtoOk(world, TRIP_A, "B: lifecycle DTO parses at PURGED (archive + receipt present, per the 19:39 ruling)");

  const logLength = world.data.deleteLog.length;
  const again = await executePurge(world.deps, TRIP_A, "2026-12-01T00:00:00.000Z");
  ok(again.ok && again.alreadyPurged === true, "B: second purge is a no-op");
  eq(JSON.stringify(again.receipt), JSON.stringify(res.receipt), "B: the receipt is unchanged by the second purge");
  eq(world.receipts.size, 1, "B: exactly ONE receipt exists after a double purge");
  eq(world.data.deleteLog.length, logLength, "B: the second purge deleted nothing");

  // Receipt content-freedom (also section B: the M5/DTO contract).
  ok(/^[0-9a-f]{64}$/.test(res.receipt.tripRef) && res.receipt.tripRef !== TRIP_A, "B: the receipt references the trip only by its one-way hash");
  eq(res.receipt.tripRef, sha256Hex(TRIP_A), "B: tripRef is the SHA-256 of the trip id (engine ids)");
  eq(tripRefForTrip(TRIP_A), res.receipt.tripRef, "B: tripRefForTrip agrees with the stored receipt");
  const receiptJson = JSON.stringify(res.receipt);
  ok(
    ["Halifax", "Citadel", "Avery", TRIP_A].every((marker) => !receiptJson.includes(marker)),
    "B: the receipt is content-free (no place, no names, no raw trip id)"
  );
  ok(parsePurgeReceiptDTO(res.receipt).ok, "B: the stored receipt passes its own content-free parser");
  ok(
    !parsePurgeReceiptDTO({ ...res.receipt, destination: "Halifax" }).ok,
    "B: the DTO parser REJECTS a receipt carrying any extra (content) field"
  );

  // Tombstone behaviors ride on trip A (full treatment in H too).
  const tombstone = await getTombstone(world.deps, TRIP_A);
  ok(tombstone.purged && tombstone.clearOnDeviceCaches, "H: the tombstone reports purged + device caches must clear");
  ok(await isTripPurged(world.deps, TRIP_A), "H: the late-event guard sees the purged trip");
  ok(await acknowledgeTombstone(world.deps, TRIP_A, "2026-12-02T00:00:00.000Z"), "H: the device cache-clearing is acknowledged back");
  const advanced = await advanceLifecycle(world.deps, TRIP_A, "2026-12-03T00:00:00.000Z", { purgeEnabled: true });
  eq(advanced.to, "PURGED", "H: advancing a purged trip is a no-op — the tombstone cannot be resurrected");
  const ensured = await ensureLifecycleRecord(world.deps, { tripId: TRIP_A, userId: "user-1", timezone: TZ, dates: DATES, now: "2026-12-03T00:00:00.000Z" });
  ok(!ensured.created && ensured.record.state === "PURGED", "H: ensure never recreates a purged trip as ACTIVE");
  const lateSubmit = await recordReviewSubmission(world.deps, TRIP_A, "2026-12-03T00:00:00.000Z");
  ok(!lateSubmit.ok && lateSubmit.code === "TRIP_PURGED", "H: a late review submission cannot resurrect a purged trip");
}

/* ------------------------------------------------------------------ */
/* C — Scenario B: no review; window expiry; sweep purges              */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_B = "trip-window-expiry";
  await seedActiveTrip(world, TRIP_B, { notifications: 2, deliveries: 1, panel: 2, days: 3, activities: 2, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_B, T_END, { purgeEnabled: true });
  await recordReviewEmailSent(world.deps, TRIP_B, T_SENT);

  const early = await advanceLifecycle(world.deps, TRIP_B, "2026-11-02T11:00:00.000Z", { purgeEnabled: true });
  eq(early.to, "POST_TRIP_PENDING", "C: the window still open before its end — no early close");
  const swept = await runLifecycleSweep(world.deps, "2026-11-02T12:00:00.000Z", { purgeEnabled: true });
  eq(swept.closed, 1, "C: window expiry closes the trip in the sweep");
  eq(swept.purged, 1, "C: the sweep purges the closed trip");
  const record = await world.lifecycle.get(TRIP_B);
  eq(record.state, "PURGED", "C: the trip is PURGED after expiry");
  eq(record.closedReason, "review-window-expired", "C: close reason is review-window-expired");
  eq(record.reviewSubmitted, false, "C: no review was submitted");
  const receipt = await world.receipts.getByTripRef(tripRefForTrip(TRIP_B));
  ok(receipt !== null && receipt.libraryRetained === false, "C: no review means no ingest — the receipt records no library retention");
  eq(await world.library.getByTripId(TRIP_B), null, "C: no library record exists for the unrated trip");
  ok(Object.values(await scopeCounts(world, TRIP_B)).every((n) => n === 0), "C: purge after expiry deleted exactly the ruled set");
}

/* ------------------------------------------------------------------ */
/* D — Scenario C: 4/5 review closes, never ingests, purges            */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_C = "trip-four-star";
  await seedActiveTrip(world, TRIP_C, { notifications: 1, deliveries: 0, panel: 2, days: 3, activities: 2, ledger: 2, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_C, T_END, { purgeEnabled: true });
  await recordReviewEmailSent(world.deps, TRIP_C, T_SENT);
  const ingest = await ingestAsLivedTrip(world.library, asLived(TRIP_C, 4), { now: T_SUBMIT });
  ok(ingest.ingested === false && ingest.decision.eligible === false, "D: a 4/5 review is NOT ingested (the Phase 10 gate refuses, reasons recorded)");
  await recordIngestDecision(world.deps, TRIP_C, { eligible: false, ingested: false }, T_SUBMIT);
  const submitted = await recordReviewSubmission(world.deps, TRIP_C, T_SUBMIT);
  ok(submitted.ok && submitted.state === "CLOSED", "D: the 4/5 review still closes the trip");
  const res = await executePurge(world.deps, TRIP_C, T_PURGE);
  ok(res.ok && res.receipt.libraryRetained === false, "D: after purge, a non-outstanding trip leaves only the receipt + tombstone + archive");
  eq(await world.library.getByTripId(TRIP_C), null, "D: no library record was ever written");
}

/* ------------------------------------------------------------------ */
/* E — ingest-before-purge: both outstanding flavors refuse, then pass */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_D1 = "trip-decision-outstanding";
  await seedActiveTrip(world, TRIP_D1, { notifications: 1, deliveries: 0, panel: 1, days: 3, activities: 1, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_D1, T_END, { purgeEnabled: true });
  await recordReviewEmailSent(world.deps, TRIP_D1, T_SENT);
  await recordReviewSubmission(world.deps, TRIP_D1, T_SUBMIT); // NO decision recorded anywhere
  const refused = await executePurge(world.deps, TRIP_D1, T_PURGE);
  ok(!refused.ok && refused.code === "INGEST_DECISION_OUTSTANDING", "E: a submitted review with no recorded ingest decision REFUSES the purge");
  let record = await world.lifecycle.get(TRIP_D1);
  ok(
    record.history.some((e) => e.kind === "purge-refusal" && e.code === "INGEST_DECISION_OUTSTANDING"),
    "E: the refusal is recorded in the lifecycle history (the sweep will retry)"
  );
  eq(record.state, "CLOSED", "E: the refused purge left the closed trip intact");
  eq((await scopeCounts(world, TRIP_D1)).notifications, 1, "E: nothing was deleted by the refused purge");
  const ingest = await ingestAsLivedTrip(world.library, asLived(TRIP_D1, 5), { now: T_PURGE });
  await recordIngestDecision(world.deps, TRIP_D1, { eligible: ingest.decision.eligible, ingested: ingest.ingested }, T_PURGE);
  const retried = await executePurge(world.deps, TRIP_D1, "2026-10-27T11:00:00.000Z");
  ok(retried.ok && retried.receipt.libraryRetained === true, "E: once the decision + ingest land, the retried purge succeeds");

  const TRIP_D2 = "trip-ingest-lost";
  await seedActiveTrip(world, TRIP_D2, { notifications: 1, deliveries: 0, panel: 1, days: 3, activities: 1, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_D2, T_END, { purgeEnabled: true });
  await recordReviewEmailSent(world.deps, TRIP_D2, T_SENT);
  await recordIngestDecision(world.deps, TRIP_D2, { eligible: true, ingested: false }, T_SUBMIT);
  await recordReviewSubmission(world.deps, TRIP_D2, T_SUBMIT);
  const refused2 = await executePurge(world.deps, TRIP_D2, T_PURGE);
  ok(!refused2.ok && refused2.code === "INGEST_BEFORE_PURGE", "E: an eligible decision with NO library copy refuses (shadow D — the hard ordering at the gate)");
  record = await world.lifecycle.get(TRIP_D2);
  eq(record.state, "CLOSED", "E: the refused purge left the closed trip intact");
  eq((await scopeCounts(world, TRIP_D2)).ledgerEntries, 1, "E: the ledger is intact after the refused purge");
  const ingest2 = await ingestAsLivedTrip(world.library, asLived(TRIP_D2, 5), { now: T_PURGE });
  ok(ingest2.ingested, "E: the owed ingest lands");
  const retried2 = await executePurge(world.deps, TRIP_D2, "2026-10-27T11:00:00.000Z");
  ok(retried2.ok && retried2.receipt.libraryRetained === true, "E: the purge succeeds after the ingest, library retained");
}

/* ------------------------------------------------------------------ */
/* F — FK precondition gate                                            */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_F = "trip-fk-gate";
  await seedActiveTrip(world, TRIP_F, { notifications: 1, deliveries: 0, panel: 1, days: 3, activities: 1, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_F, T_END, { purgeEnabled: true });
  await recordReviewEmailSent(world.deps, TRIP_F, T_SENT);
  await advanceLifecycle(world.deps, TRIP_F, "2026-11-02T12:00:00.000Z", { purgeEnabled: false }); // closes on expiry, no purge
  eq((await world.lifecycle.get(TRIP_F)).state, "CLOSED", "F: the trip is CLOSED and awaiting purge");

  const [eventsFk] = PURGE_FK_EXPECTATIONS;
  world.fkCatalog.set(eventsFk.table, eventsFk.constraint, "c"); // drifted: CASCADE
  const drifted = await executePurge(world.deps, TRIP_F, "2026-11-02T13:00:00.000Z");
  ok(!drifted.ok && drifted.code === "FK_PRECONDITION_FAILED", "F: a drifted FK (SET NULL -> CASCADE) refuses the purge");
  let record = await world.lifecycle.get(TRIP_F);
  ok(
    record.history.some((e) => e.kind === "escalation" && e.code === "FK_PRECONDITION_FAILED"),
    "F: the drift is escalated in the lifecycle history, never improvised around"
  );
  eq(world.data.deleteLog.length, 0, "F: ZERO deletes happened under a drifted schema");
  eq((await scopeCounts(world, TRIP_F)).ledgerEntries, 1, "F: the ledger is intact after the FK refusal");

  world.fkCatalog.set(eventsFk.table, eventsFk.constraint, "n"); // restored
  const [, revisionsFk] = PURGE_FK_EXPECTATIONS;
  world.fkCatalog.set(revisionsFk.table, revisionsFk.constraint, null); // vanished
  const vanished = await executePurge(world.deps, TRIP_F, "2026-11-02T14:00:00.000Z");
  ok(!vanished.ok && vanished.code === "FK_PRECONDITION_FAILED", "F: a vanished FK constraint also refuses (absent is not permission)");
  world.fkCatalog.set(revisionsFk.table, revisionsFk.constraint, "a"); // restored
  const healed = await executePurge(world.deps, TRIP_F, "2026-11-02T15:00:00.000Z");
  ok(healed.ok, "F: with the live map verified again, the purge proceeds");
}

/* ------------------------------------------------------------------ */
/* G — the ledger deletes only under the purge flag                    */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_G = "trip-ledger-flag";
  seedTrip(world, TRIP_G, { notifications: 0, deliveries: 0, panel: 0, days: 0, activities: 0, ledger: 2, liveCopies: 0 });
  let threw = null;
  try {
    await world.data.deleteScope(TRIP_G, "ledger");
  } catch (error) {
    threw = error;
  }
  ok(threw && threw.code === "LEDGER_PURGE_FLAG_REQUIRED", "G: a direct ledger delete without the purge declaration is REFUSED at the store seam (M2 trigger semantics)");
  eq(await world.data.countScope(TRIP_G, "ledger"), 2, "G: the refused delete removed nothing");
  let threw2 = null;
  try {
    await world.data.deleteScope(TRIP_G, "ledger", { allowPurge: false });
  } catch (error) {
    threw2 = error;
  }
  ok(threw2 && threw2.code === "LEDGER_PURGE_FLAG_REQUIRED", "G: an explicit non-purge delete is refused too");
  const deleted = await world.data.deleteScope(TRIP_G, "ledger", { allowPurge: true });
  eq(deleted, 2, "G: the purge-flagged path deletes (the executor's one legitimate route)");
}

/* ------------------------------------------------------------------ */
/* H — flag OFF: trips close + archive, nothing purges                 */
/* ------------------------------------------------------------------ */
{
  const world = makeWorld();
  const TRIP_H = "trip-flag-off";
  await seedActiveTrip(world, TRIP_H, { notifications: 2, deliveries: 1, panel: 2, days: 3, activities: 2, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world.deps, TRIP_H, T_END, { purgeEnabled: false });
  await recordReviewEmailSent(world.deps, TRIP_H, T_SENT);
  const swept = await runLifecycleSweep(world.deps, "2026-11-02T12:00:00.000Z", { purgeEnabled: false });
  eq(swept.closed, 1, "H: with the flag OFF the sweep still closes the trip on window expiry");
  eq(swept.purged, 0, "H: with the flag OFF nothing purges (the safe default)");
  const record = await world.lifecycle.get(TRIP_H);
  eq(record.state, "CLOSED", "H: the trip sits CLOSED, archived, un-purged");
  ok(record.archive !== null, "H: the archive transition still happened with the flag off");
  eq((await scopeCounts(world, TRIP_H)).notifications, 2, "H: live copies are fully intact with the flag off");
  eq(world.receipts.size, 0, "H: no receipt exists with the flag off");
  const sweptOn = await runLifecycleSweep(world.deps, "2026-11-02T13:00:00.000Z", { purgeEnabled: true });
  eq(sweptOn.purged, 1, "H: turning the flag on purges the already-closed trip on the next sweep");

  // The feedback seam helper: seeds the record from the trip row,
  // records the decision, closes + archives — the production path
  // tripFeedback takes.
  const world2 = makeWorld();
  const TRIP_S = "trip-feedback-seam";
  seedTrip(world2, TRIP_S, { notifications: 1, deliveries: 0, panel: 1, days: 3, activities: 1, ledger: 1, liveCopies: 1 });
  await advanceLifecycle(world2.deps, TRIP_S, T_END, { purgeEnabled: true }).catch(() => null);
  const seam = await recordFeedbackReviewSubmission(world2.deps, {
    tripId: TRIP_S,
    decision: { eligible: false, ingested: false },
    now: T_SUBMIT
  });
  ok(seam.status === "closed" && seam.state === "CLOSED", "H: the feedback seam seeds + closes + archives a trip with no prior lifecycle record");
  const seamRecord = await world2.lifecycle.get(TRIP_S);
  ok(
    seamRecord.history.some((e) => e.kind === "ingest-decision"),
    "H: the seam records the ingest decision into the M4 history (its durable home)"
  );
  const dto = await loadLifecycleDTO(world2.deps, TRIP_S);
  ok(dto !== null && dto.state === "CLOSED", "H: the seam-closed trip loads as a valid lifecycle DTO");
}

console.log(`\nPhase 11 checks: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log("failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
