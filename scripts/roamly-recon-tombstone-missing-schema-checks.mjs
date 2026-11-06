// Recon tombstone MISSING-SCHEMA checks (Release gate item 3, 2026-10-31).
//
// The integration round shipped the tombstone code fail-open: while
// migration 20261031000100 (booking_email_suppressions) is not yet
// applied, every tombstone lookup degrades to an empty set and the
// discard reports tombstoneRecorded:false. The claimed guard for
// that window is the rejected-row layer: the discard still moves the
// booking_extraction_results row to match_status 'rejected'
// (already-shipped table), and persistExtraction refuses to upsert
// over a rejected row.
//
// This suite simulates that window end to end against the REAL
// modules (same VM-transpile + fake-Supabase pattern as
// roamly-recon-tombstone-checks.mjs), with the suppressions table
// (a) ABSENT — every operation returns PostgREST 42P01 — and
// (b) ERRORING — every operation returns a transient fetch error:
//
//   discard while absent -> reconnect/backfill re-feed of the SAME
//   email must NOT resurface in the wallet, the itinerary
//   presentation, Alerts, or auto-apply; the imports list and the
//   attach route must stay closed too. A different email, and a new
//   email about the same stay, must still flow normally.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { filterTravelEmail } from "../lib/roamly/travelEmailFiltering.ts";
import { hotelEmailFacts } from "../lib/roamly/emailBookingFacts.ts";
import {
  bookingTruthState,
  isTravelerDiscardedBooking
} from "../lib/roamly/bookingTruth.ts";
import {
  bookingWalletSummary,
  confirmedBookingsForItinerary,
  isActiveTripBooking,
  isConfirmedBooking,
  listTripBookings,
  serializeTripBookingRecord
} from "../lib/roamly/bookingWallet.ts";
import { reconcileItineraryItemsWithCurrentBookings } from "../lib/roamly/itineraryBookingOverrides.ts";
import { suppressedCancelledNotifications } from "../lib/roamly/notificationBookingAttribution.ts";

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------------------
// Fake Supabase with a switchable suppressions-table failure mode.
// mode "present": normal. mode "absent": 42P01 relation-does-not-exist.
// mode "erroring": transient fetch failure. All other tables behave.
// ---------------------------------------------------------------------------
const USER = "user-tombstone-missing";
const TRIP = "trip-montreal";

const ABSENT_ERROR = { message: 'relation "public.booking_email_suppressions" does not exist', code: "42P01" };
const TRANSIENT_ERROR = { message: "TypeError: fetch failed", code: undefined };

function emptyDb() {
  return {
    booking_extraction_results: [],
    booking_email_suppressions: [],
    travel_email_messages: [],
    roamly_bookings: [],
    roamly_trips: [
      { id: TRIP, user_id: USER, title: "Montreal trip", destination: "Montreal, Quebec, Canada", destination_name: "Montreal, Quebec, Canada", destination_city: "Montreal", start_date: "2026-11-09", end_date: "2026-11-13", status: "planned" }
    ],
    roamly_itineraries: [],
    roamly_trip_companion_events: [],
    roamly_notifications: []
  };
}

class Query {
  constructor(db, table, mode) {
    this.db = db;
    this.table = table;
    this.mode = mode;
    this.filters = [];
    this.pendingPatch = null;
    this.limitCount = null;
  }
  broken() {
    return this.table === "booking_email_suppressions" && this.mode !== "present";
  }
  brokenError() {
    return this.mode === "absent" ? ABSENT_ERROR : TRANSIENT_ERROR;
  }
  rows() { return this.db[this.table] || (this.db[this.table] = []); }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  lte(col, val) { this.filters.push((r) => String(r[col] ?? "") <= String(val)); return this; }
  is(col, val) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  not(col, _op, val) { this.filters.push((r) => (val === null ? r[col] != null : r[col] !== val)); return this; }
  or(clause) {
    const gte = clause.match(/end_date\.gte\.([0-9-]+)/)?.[1];
    if (gte && clause.includes("start_date.gte")) {
      this.filters.push((r) => (r.end_date || r.start_date) >= gte);
      return this;
    }
    const parts = clause.split(",");
    const predicates = parts.map((part) => {
      const m = part.match(/^([a-z_]+)\.eq\.(.+)$/);
      if (m) return (r) => String(r[m[1]]) === m[2];
      const n = part.match(/^([a-z_]+)\.is\.null$/);
      if (n) return (r) => r[n[1]] == null;
      return () => false;
    });
    this.filters.push((r) => predicates.some((p) => p(r)));
    return this;
  }
  order() { return this; }
  limit(n) { this.limitCount = n; return this; }
  matched() {
    let out = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.limitCount != null) out = out.slice(0, this.limitCount);
    return out;
  }
  update(patch) { this.pendingPatch = patch; return this; }
  insert(row) {
    if (this.broken()) return Promise.resolve({ data: null, error: this.brokenError() });
    const rows = Array.isArray(row) ? row : [row];
    for (const r of rows) this.rows().push({ ...r });
    return Promise.resolve({ data: rows, error: null });
  }
  upsert(payload, options = {}) {
    if (this.broken()) return Promise.resolve({ data: null, error: this.brokenError() });
    const keys = String(options.onConflict || "").split(",").map((k) => k.trim()).filter(Boolean);
    const existing = keys.length
      ? this.rows().find((r) => keys.every((k) => r[k] === payload[k]))
      : null;
    if (existing) Object.assign(existing, payload);
    else this.rows().push({ ...payload });
    return Promise.resolve({ data: null, error: null });
  }
  async maybeSingle() {
    if (this.broken()) return { data: null, error: this.brokenError() };
    const rows = this.matched();
    return { data: rows[0] ?? null, error: null };
  }
  async single() {
    if (this.broken()) return { data: null, error: this.brokenError() };
    const rows = this.matched();
    if (!rows[0]) return { data: null, error: { message: "No rows" } };
    return { data: rows[0], error: null };
  }
  then(resolve) {
    if (this.broken()) {
      resolve({ data: null, error: this.brokenError() });
      return;
    }
    if (this.pendingPatch) {
      const matchedRows = this.matched();
      for (const r of matchedRows) Object.assign(r, this.pendingPatch);
      this.pendingPatch = null;
      resolve({ data: matchedRows, error: null });
      return;
    }
    resolve({ data: this.matched(), error: null });
  }
}

function makeSupabase(db, mode) {
  return { from: (table) => new Query(db, table, mode) };
}

// ---------------------------------------------------------------------------
// VM loading of the real TS modules (same pattern as the base suite)
// ---------------------------------------------------------------------------
function loadModule(relPath, mocks) {
  const source = fs.readFileSync(relPath, "utf8");
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText,
    {
      exports: compiled.exports,
      module: compiled,
      require: (name) => {
        assert.ok(name in mocks, `Unexpected import ${name} in ${relPath}`);
        return mocks[name];
      },
      Date,
      console
    }
  );
  return compiled.exports;
}

let activeSupabase = null;
const overrideCalls = [];
const walletWrites = [];

const tombstoneModule = loadModule("lib/roamly/bookingEmailTombstone.ts", {});
const withdrawalModule = loadModule("lib/roamly/bookingNotificationWithdrawal.ts", {});
const credibilityModule = loadModule("lib/roamly/extractionCredibility.ts", {});

let db = emptyDb();
let bookingSeq = 0;
async function fakeCreateTripBooking(params) {
  walletWrites.push(params);
  bookingSeq += 1;
  const input = params.input;
  const row = {
    id: `booking-${bookingSeq}`,
    trip_id: params.tripId,
    user_id: params.userId,
    booking_type: input.bookingType === "hotel" ? "hotel" : input.bookingType === "flight" ? "flight" : "other",
    booking_status: "unknown",
    provider_name: input.provider || null,
    provider_booking_id: null,
    confirmation_number: input.confirmationCode || null,
    source_type: "email",
    source_reference: input.sourceReference || null,
    title: input.title || "Trip booking",
    start_at: input.startTime || input.checkInTime || null,
    end_at: input.endTime || input.checkOutTime || null,
    start_date: null,
    end_date: null,
    origin: input.origin || null,
    destination: input.destination || null,
    flight_number: input.flightNumber || null,
    terminal: null,
    gate: null,
    room_type: null,
    check_in_at: input.checkInTime || null,
    check_out_at: input.checkOutTime || null,
    total_price: typeof input.totalPrice === "number" ? input.totalPrice : null,
    currency: input.currency || null,
    traveler_confirmed: false,
    metadata: {},
    reservation_requirements: input.reservationRequirements || {},
    last_synced_at: input.lastSyncedAt || null,
    created_at: "2026-10-31T00:00:00.000Z",
    updated_at: "2026-10-31T00:00:00.000Z",
    superseded_by_booking_id: null
  };
  db.roamly_bookings.push(row);
  return { booking: { id: row.id }, reconciliation: { applied: true }, error: null };
}

const extractionModule = loadModule("lib/roamly/bookingExtraction.ts", {
  "@/lib/roamly/emailBookingFacts": { hotelEmailFacts },
  openai: { default: class { constructor() { throw new Error("AI must not run in this suite"); } } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/bookingWallet": { createTripBooking: fakeCreateTripBooking },
  "@/lib/roamly/brain/bookingReconciliation": { reconcileTripBookings: async () => ({ ok: true }) },
  "@/lib/roamly/reconciliationLane": { build2ReconciliationLaneActive: () => true }
});

const nextServerStub = {
  NextResponse: {
    json: (body, init) => ({ status: init?.status ?? 200, body })
  },
  NextRequest: class {}
};
const authStub = {
  requireUser: async () => ({ ok: true, user: { id: USER }, supabase: activeSupabase })
};

const discardRoute = loadModule("app/api/trips/[id]/bookings/email-imports/discard/route.ts", {
  "next/server": nextServerStub,
  "@/lib/roamly/auth": authStub,
  "@/lib/roamly/bookingEmailTombstone": tombstoneModule,
  "@/lib/roamly/bookingNotificationWithdrawal": withdrawalModule,
  "@/lib/roamly/itineraryBookingOverrides": {
    applyStoredItineraryBookingOverride: async (params) => {
      overrideCalls.push(params);
      return { ok: true, changed: true };
    }
  }
});
const importsRoute = loadModule("app/api/trips/[id]/bookings/email-imports/route.ts", {
  "next/server": nextServerStub,
  "@/lib/roamly/auth": authStub,
  "@/lib/roamly/extractionCredibility": credibilityModule,
  "@/lib/roamly/bookingEmailTombstone": tombstoneModule
});
const attachRoute = loadModule("app/api/trips/[id]/bookings/email-imports/attach/route.ts", {
  "next/server": nextServerStub,
  "@/lib/roamly/auth": authStub,
  "@/lib/roamly/bookingWallet": { createTripBooking: fakeCreateTripBooking },
  "@/lib/roamly/extractionCredibility": credibilityModule,
  "@/lib/roamly/bookingEmailTombstone": tombstoneModule,
  "@/lib/roamly/brain/bookingReconciliation": { reconcileTripBookings: async () => ({ ok: true }) }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CONNECTION = { id: "conn-1", user_id: USER, provider: "gmail" };

function agodaBody(code) {
  return [
    "Provider: Agoda",
    `Confirmation number: ${code}`,
    "Hotel: Maple Stay Montreal",
    "Destination: Montreal, Quebec, Canada",
    "Check-in: November 10, 2026 at 15:00 (America/Toronto, UTC-05:00)",
    "Check-out: November 12, 2026 at 11:00 (America/Toronto, UTC-05:00)"
  ].join("\n");
}
function emailParams(messageId, body, subject = "Your booking confirmation", sender = "Agoda <bookings@agoda.com>") {
  const metadata = { provider: "gmail", messageId, sender, subject, bodyText: body };
  return { supabase: activeSupabase, connection: CONNECTION, metadata, filter: filterTravelEmail(metadata), emailMessageId: null };
}
async function callDiscard(extractionId) {
  return discardRoute.POST(
    { json: async () => ({ extractionId }) },
    { params: Promise.resolve({ id: TRIP }) }
  );
}
async function callListImports() {
  return importsRoute.GET({}, { params: Promise.resolve({ id: TRIP }) });
}
async function callAttach(extractionId) {
  return attachRoute.POST(
    { json: async () => ({ extractionId }) },
    { params: Promise.resolve({ id: TRIP }) }
  );
}
function extractionByRef(ref) {
  return db.booking_extraction_results.find((r) => r.source_reference === ref);
}
function liveWalletCount() {
  const serialized = db.roamly_bookings.map((b) => serializeTripBookingRecord(b));
  const summary = bookingWalletSummary(serialized);
  return summary.active + summary.confirmed + summary.needsConfirmation;
}

// ===========================================================================
// Phase A — table ABSENT: auto-applied import -> discard -> re-feed
// ===========================================================================
async function phaseAbsent(mode) {
  const tag = mode === "absent" ? "A-absent" : "C-erroring";
  db = emptyDb();
  activeSupabase = makeSupabase(db, mode);
  walletWrites.length = 0;
  overrideCalls.length = 0;

  const MSG = mode === "absent" ? "absentmsg0000001" : "errormsg00000001";
  const REF = `email:gmail:${MSG}`;

  const firstSync = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG, agodaBody("AGD8X42K")));
  eq(`(${tag}) sync still works while suppressions lookup fails open`, firstSync.status, "attached");
  eq(`(${tag}) first sync wrote exactly one wallet booking`, walletWrites.length, 1);
  const extraction = extractionByRef(REF);
  check(`(${tag}) extraction row persisted as attached`, Boolean(extraction) && extraction.match_status === "attached");
  extraction.id = `extraction-${mode}`;
  const booking = db.roamly_bookings.find((r) => r.source_reference === REF);
  check(`(${tag}) wallet booking exists for the import`, Boolean(booking));

  db.roamly_trip_companion_events.push({ id: `event-${mode}`, booking_id: booking.id, trip_id: TRIP, user_id: USER, status: "scheduled" });
  db.roamly_notifications.push({
    id: `notif-${mode}`, user_id: USER, trip_id: TRIP, event_id: `event-${mode}`, type: "booking_confirmed",
    title: booking.title, body: "Your booking is confirmed.", metadata: {}
  });
  db.roamly_itineraries.push({
    id: "itin-1", trip_id: TRIP, user_id: USER, created_at: "2026-10-31T00:00:00.000Z", repair_revision: 0,
    full_json: {
      daily_itinerary: [
        { day_number: 2, date: "2026-11-10", live_timeline: [
          { item_id: `item-${mode}`, booking_id: booking.id, title: "Confirmed · from your Agoda email: Maple Stay Montreal hotel booking", category: "Confirmed · from your Agoda email", factualStatus: "verified", timing_status: "FACTUAL", plan_role: "protected_anchor", booking_status: "confirmed" }
        ] }
      ]
    }
  });

  const discard = await callDiscard(`extraction-${mode}`);
  eq(`(${tag}) discard itself still succeeds without the table`, discard.body.ok, true);
  eq(`(${tag}) discard honestly reports tombstoneRecorded:false`, discard.body.tombstoneRecorded, false);
  eq(`(${tag}) NO tombstone row could be written`, db.booking_email_suppressions.length, 0);
  eq(`(${tag}) extraction row transitioned to rejected (shipped-table guard)`, extractionByRef(REF).match_status, "rejected");
  check(`(${tag}) rejection carries the traveler_discarded reason`, extractionByRef(REF).match_reasons.includes("traveler_discarded"));
  check(`(${tag}) wallet booking carries the discard mark`, isTravelerDiscardedBooking(booking));
  eq(`(${tag}) discarded booking truth state is discarded`, bookingTruthState(booking), "discarded");
  eq(`(${tag}) scheduled companion reminder cancelled by discard`, db.roamly_trip_companion_events.find((e) => e.id === `event-${mode}`).status, "cancelled");
  eq(`(${tag}) Alerts notification marked withdrawn by discard`, db.roamly_notifications.find((n) => n.id === `notif-${mode}`).metadata.withdrawn, true);

  // Reconnect backfill re-feed of the SAME message — the resurrection path.
  const writesBefore = walletWrites.length;
  const extractionsBefore = db.booking_extraction_results.length;
  const bookingsBefore = db.roamly_bookings.length;
  const refeed = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG, agodaBody("AGD8X42K")));
  eq(`(${tag}) reconnect/backfill re-feed is SUPPRESSED without the tombstone table`, refeed.status, "suppressed");
  eq(`(${tag}) re-feed created NO wallet booking (auto-apply stays off)`, walletWrites.length, writesBefore);
  eq(`(${tag}) re-feed created NO new wallet row`, db.roamly_bookings.length, bookingsBefore);
  eq(`(${tag}) re-feed created NO new extraction row`, db.booking_extraction_results.length, extractionsBefore);
  eq(`(${tag}) extraction row still rejected after re-feed`, extractionByRef(REF).match_status, "rejected");

  // Ordinary sync re-feed — same funnel, same expectation.
  const refeed2 = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG, agodaBody("AGD8X42K")));
  eq(`(${tag}) ordinary sync re-feed is SUPPRESSED too`, refeed2.status, "suppressed");
  eq(`(${tag}) second re-feed still wrote no wallet booking`, walletWrites.length, writesBefore);

  // Customer surfaces after the re-feeds.
  eq(`(${tag}) wallet shows ZERO live bookings after re-feed`, liveWalletCount(), 0);
  const serializedAll = db.roamly_bookings.map((b) => serializeTripBookingRecord(b));
  check(`(${tag}) no booking is active in the wallet`, serializedAll.every((b) => !isActiveTripBooking(b)));
  check(`(${tag}) no booking is confirmed in the wallet`, serializedAll.every((b) => !isConfirmedBooking(b)));
  eq(`(${tag}) discarded booking does not anchor the itinerary`, confirmedBookingsForItinerary(serializedAll).length, 0);
  const { bookings: listed } = await listTripBookings({ supabase: activeSupabase, userId: USER, tripId: TRIP });
  check(`(${tag}) history still lists only the preserved discarded row`, listed.length === bookingsBefore && listed.every((b) => b.id === booking.id));
  const reconciled = reconcileItineraryItemsWithCurrentBookings(db.roamly_itineraries[0].full_json, db.roamly_bookings);
  const item = reconciled.daily_itinerary[0].live_timeline[0];
  check(`(${tag}) itinerary read-path still strips the Confirmed stamp`, !/^Confirmed/.test(item.title));
  eq(`(${tag}) itinerary read-path still drops verified factual status`, item.factualStatus, "unknown");
  const suppressed = suppressedCancelledNotifications({
    notifications: db.roamly_notifications,
    bookings: db.roamly_bookings,
    eventBookingById: new Map([[`event-${mode}`, booking.id]])
  });
  check(`(${tag}) Alerts attribution still suppresses the discarded booking's rows`, suppressed.has(`notif-${mode}`));
  eq(`(${tag}) no new companion events were created by re-feed`, db.roamly_trip_companion_events.length, 1);
  eq(`(${tag}) no new notifications were created by re-feed`, db.roamly_notifications.length, 1);

  const listAfter = await callListImports();
  check(`(${tag}) discarded import NOT resurfaced in imports`, !listAfter.body.imports.some((i) => i.id === `extraction-${mode}`));
  check(`(${tag}) discarded import NOT resurfaced in keptAside`, !listAfter.body.keptAside.some((i) => i.id === `extraction-${mode}`));
  const attach = await callAttach(`extraction-${mode}`);
  check(`(${tag}) attach after discard is refused without the table`, attach.body.ok === false && attach.status >= 400);

  // Zombie layer: a live duplicate row for the same identity (sync
  // raced the gate before the fix, or a manual repair) must still be
  // filtered by the GET route via the rejected-row fallback.
  db.booking_extraction_results.push({
    id: `extraction-${mode}-zombie`, user_id: USER, trip_id: TRIP, email_message_id: null,
    source_reference: REF, match_status: "needs_confirmation", overall_confidence: 0.95,
    match_reasons: [], extracted_booking_json: { provider: "Agoda", title: "Maple Stay Montreal hotel booking", confirmationCode: "AGD8X42K", sourceReference: REF },
    field_confidence_json: {}, created_at: "2026-10-31T01:00:00.000Z"
  });
  const listZombie = await callListImports();
  check(`(${tag}) GET route filters a zombie tombstoned row from imports`, !listZombie.body.imports.some((i) => i.id === `extraction-${mode}-zombie`));
  check(`(${tag}) GET route filters a zombie tombstoned row from keptAside`, !listZombie.body.keptAside.some((i) => i.id === `extraction-${mode}-zombie`));
  check(`(${tag}) GET route counts the zombie as discarded`, listZombie.body.discardedCount >= 1);
  db.booking_extraction_results = db.booking_extraction_results.filter((r) => r.id !== `extraction-${mode}-zombie`);

  // The guard is identity-scoped, not a blanket sync shutdown.
  const MSG_D = mode === "absent" ? "absentmsg0000002" : "errormsg00000002";
  const writesBeforeD = walletWrites.length;
  const syncD = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_D, agodaBody("AGD9Y77Z")));
  eq(`(${tag}) a DIFFERENT email from the same provider still auto-applies`, syncD.status, "attached");
  eq(`(${tag}) different email wrote its wallet booking`, walletWrites.length, writesBeforeD + 1);

  const MSG_E = mode === "absent" ? "absentmsg0000003" : "errormsg00000003";
  const syncE = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_E, agodaBody("AGD8X42K")));
  check(`(${tag}) a NEW email about the SAME stay is NOT suppressed`, syncE.status !== "suppressed");
  check(`(${tag}) new same-stay email produced its own extraction row`, Boolean(extractionByRef(`email:gmail:${MSG_E}`)));
}

await phaseAbsent("absent");

// ===========================================================================
// Phase B — table ABSENT: needs-confirmation import -> discard -> re-feed
// ===========================================================================
{
  db = emptyDb();
  activeSupabase = makeSupabase(db, "absent");
  walletWrites.length = 0;

  const MSG_B = "absentflight00001";
  const REF_B = `email:gmail:${MSG_B}`;
  const flightBody = [
    "Provider: Air Canada",
    "Confirmation number: AC98765",
    "Destination: Montreal",
    "Flight to Montreal on November 10, 2026",
    "Departure: November 10, 2026"
  ].join("\n");
  const syncB = await extractionModule.extractAndMatchTravelEmailBooking(
    emailParams(MSG_B, flightBody, "Your booking confirmation", "Air Canada <reservations@aircanada.com>")
  );
  eq("(B-absent) incomplete flight email lands in needs_confirmation", syncB.status, "needs_confirmation");
  const extractionB = extractionByRef(REF_B);
  check("(B-absent) needs-confirmation extraction persisted", Boolean(extractionB));
  extractionB.id = "extraction-b-absent";

  const discardB = await callDiscard("extraction-b-absent");
  eq("(B-absent) discard succeeds without the table", discardB.body.ok, true);
  eq("(B-absent) discard reports tombstoneRecorded:false", discardB.body.tombstoneRecorded, false);
  eq("(B-absent) extraction row rejected", extractionByRef(REF_B).match_status, "rejected");

  const refeedB = await extractionModule.extractAndMatchTravelEmailBooking(
    emailParams(MSG_B, flightBody, "Your booking confirmation", "Air Canada <reservations@aircanada.com>")
  );
  eq("(B-absent) ordinary sync re-feed is SUPPRESSED", refeedB.status, "suppressed");
  eq("(B-absent) extraction row still rejected after re-feed", extractionByRef(REF_B).match_status, "rejected");
  eq("(B-absent) re-feed wrote no wallet booking", walletWrites.length, 0);
  const listAfterB = await callListImports();
  check("(B-absent) discarded import NOT in imports after re-feed", !listAfterB.body.imports.some((i) => i.id === "extraction-b-absent"));
  check("(B-absent) discarded import NOT in keptAside after re-feed", !listAfterB.body.keptAside.some((i) => i.id === "extraction-b-absent"));
  const attachB = await callAttach("extraction-b-absent");
  check("(B-absent) attach after discard is refused", attachB.body.ok === false && attachB.status >= 400);
}

// ===========================================================================
// Phase C — table ERRORING (transient): same end-to-end as Phase A
// ===========================================================================
await phaseAbsent("erroring");

console.log(`\n${passed} recon-tombstone missing-schema checks passed`);
