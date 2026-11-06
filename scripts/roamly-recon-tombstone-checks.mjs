// Recon tombstone checks (Tombstone workstream, 2026-10-31).
//
// Proves durable suppression of discarded email imports, end to end
// at the code layer, against the REAL modules:
//   - the REAL discard / email-imports GET / attach routes
//     (VM-transpiled, the roamly-gmail-live-fixture pattern, with
//     next/server + auth stubbed and an in-process fake Supabase);
//   - the REAL sync funnel extractAndMatchTravelEmailBooking
//     (VM-transpiled with the wallet writer mocked onto the same
//     fake DB — ordinary sync and reconnect backfill both re-feed
//     through this one function, so re-feeding it IS the simulation);
//   - the REAL bookingEmailTombstone helpers, bookingTruth,
//     extractionCredibility, bookingWallet presentation helpers,
//     itineraryBookingOverrides read-path reconcile, and
//     notificationBookingAttribution (direct imports).
//
// Cases: (a) discard -> reconnect/backfill re-feed: NOT resurfaced
// in imports, NOT re-applied to the wallet; (b) discard -> ordinary
// sync re-feed: same; (c) a cancelled (not discarded) booking keeps
// RC X1 behaviour; (d) a DIFFERENT email from the same provider
// imports + applies normally; (e) a genuinely new email about the
// SAME stay is NOT suppressed. TZ-safe: every instant is derived
// from explicit-zone labelled dates or UTC date-only math.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { filterTravelEmail } from "../lib/roamly/travelEmailFiltering.ts";
import { hotelEmailFacts } from "../lib/roamly/emailBookingFacts.ts";
import {
  bookingTruthState,
  isInactiveTruthState,
  isTravelerDiscardedBooking,
  titleForTruth
} from "../lib/roamly/bookingTruth.ts";
import { evaluateExtractionCredibility } from "../lib/roamly/extractionCredibility.ts";
import {
  bookingCarriesDiscardMark,
  parseEmailSourceReference,
  sourceReferenceForEmail
} from "../lib/roamly/bookingEmailTombstone.ts";
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
// In-process fake Supabase (the surface the exercised code uses)
// ---------------------------------------------------------------------------
const USER = "user-tombstone";
const TRIP = "trip-montreal";

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
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.pendingPatch = null;
    this.limitCount = null;
  }
  rows() { return this.db[this.table] || []; }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  lte(col, val) { this.filters.push((r) => String(r[col] ?? "") <= String(val)); return this; }
  is(col, val) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  not(col, _op, val) { this.filters.push((r) => (val === null ? r[col] != null : r[col] !== val)); return this; }
  or(clause) {
    // Supports the two shapes the exercised code issues:
    // "trip_id.eq.<id>,trip_id.is.null" and the trip-window
    // "end_date.gte.<d>,and(end_date.is.null,start_date.gte.<d>)".
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
    const rows = Array.isArray(row) ? row : [row];
    for (const r of rows) this.rows().push({ ...r });
    return Promise.resolve({ data: rows, error: null });
  }
  upsert(payload, options = {}) {
    const keys = String(options.onConflict || "").split(",").map((k) => k.trim()).filter(Boolean);
    const existing = keys.length
      ? this.rows().find((r) => keys.every((k) => r[k] === payload[k]))
      : null;
    if (existing) Object.assign(existing, payload);
    else this.rows().push({ ...payload });
    return Promise.resolve({ data: null, error: null });
  }
  async maybeSingle() {
    const rows = this.matched();
    return { data: rows[0] ?? null, error: null };
  }
  async single() {
    const rows = this.matched();
    if (!rows[0]) return { data: null, error: { message: "No rows" } };
    return { data: rows[0], error: null };
  }
  then(resolve) {
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

function makeSupabase(db) {
  return { from: (table) => new Query(db, table) };
}

// ---------------------------------------------------------------------------
// VM loading of the real TS modules (gmail-live-fixture pattern)
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

// ---- Pure identity helpers ----
eq("source reference mints email:gmail:<id>", sourceReferenceForEmail("gmail", "1a16f3b4a79c3bdf"), "email:gmail:1a16f3b4a79c3bdf");
assert.deepEqual(parseEmailSourceReference("email:gmail:1a16f3b4a79c3bdf"), { provider: "gmail", messageId: "1a16f3b4a79c3bdf" });
passed += 1; console.log("ok - source reference parses back to provider + message id");
eq("non-email reference does not parse", parseEmailSourceReference("manual:123"), null);
check("discard mark detected on booking metadata", bookingCarriesDiscardMark({ metadata: { emailImportDiscarded: { discardedAt: "2026-10-31T00:00:00.000Z" } } }));
check("no discard mark on a plain booking", !bookingCarriesDiscardMark({ metadata: {} }));

// ===========================================================================
// (a) Auto-applied import -> discard -> reconnect/backfill re-feed
// ===========================================================================
db = emptyDb();
activeSupabase = makeSupabase(db);
walletWrites.length = 0;
overrideCalls.length = 0;

const MSG_A = "1a16f3b4a79c3bdf";
const REF_A = `email:gmail:${MSG_A}`;
const firstSync = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_A, agodaBody("AGD8X42K")));
eq("(a) first sync auto-applies the genuine Agoda email", firstSync.status, "attached");
eq("(a) first sync wrote exactly one wallet booking", walletWrites.length, 1);
const extractionA = extractionByRef(REF_A);
check("(a) extraction row persisted as attached", Boolean(extractionA) && extractionA.match_status === "attached");
extractionA.id = "extraction-a";
const bookingA = db.roamly_bookings.find((r) => r.source_reference === REF_A);
check("(a) wallet booking exists for the import", Boolean(bookingA));

// Companion event + notification + a stamped itinerary item for B1,
// so the discard's cross-surface propagation is observable.
db.roamly_trip_companion_events.push({ id: "event-a", booking_id: bookingA.id, trip_id: TRIP, user_id: USER, status: "scheduled" });
db.roamly_notifications.push({
  id: "notif-a", user_id: USER, trip_id: TRIP, event_id: "event-a", type: "booking_confirmed",
  title: bookingA.title, body: "Your booking is confirmed.", metadata: {}
});
db.roamly_itineraries.push({
  id: "itin-1", trip_id: TRIP, user_id: USER, created_at: "2026-10-31T00:00:00.000Z", repair_revision: 0,
  full_json: {
    daily_itinerary: [
      { day_number: 2, date: "2026-11-10", live_timeline: [
        { item_id: "item-a", booking_id: bookingA.id, title: "Confirmed · from your Agoda email: Maple Stay Montreal hotel booking", category: "Confirmed · from your Agoda email", factualStatus: "verified", timing_status: "FACTUAL", plan_role: "protected_anchor", booking_status: "confirmed" }
      ] }
    ]
  }
});

const discardA = await callDiscard("extraction-a");
eq("(a) discard succeeds", discardA.body.ok, true);
eq("(a) discard records the tombstone", discardA.body.tombstoneRecorded, true);
const tombstoneA = db.booking_email_suppressions.find((r) => r.source_reference === REF_A);
check("(a) tombstone row keyed to the Gmail message id survives", Boolean(tombstoneA) && tombstoneA.provider_message_id === MSG_A);
check("(a) extraction row NOT deleted (audit preserved)", db.booking_extraction_results.some((r) => r.id === "extraction-a"));
eq("(a) extraction row transitioned to rejected", extractionByRef(REF_A).match_status, "rejected");
check("(a) rejection carries the traveler_discarded reason", extractionByRef(REF_A).match_reasons.includes("traveler_discarded"));
check("(a) wallet booking NOT deleted (audit preserved)", db.roamly_bookings.some((r) => r.id === bookingA.id));
check("(a) wallet booking carries the discard mark", isTravelerDiscardedBooking(bookingA));
eq("(a) discarded booking truth state is discarded", bookingTruthState(bookingA), "discarded");
check("(a) discarded truth state is inactive", isInactiveTruthState(bookingTruthState(bookingA)));
const serializedA = serializeTripBookingRecord(bookingA);
eq("(a) serializer exposes is_discarded", serializedA.is_discarded, true);
check("(a) discarded booking is not active in the wallet", !isActiveTripBooking(serializedA));
check("(a) discarded booking is not confirmed", !isConfirmedBooking(serializedA));
eq("(a) wallet summary counts it nowhere live", bookingWalletSummary([serializedA]).active + bookingWalletSummary([serializedA]).confirmed + bookingWalletSummary([serializedA]).needsConfirmation, 0);
eq("(a) discarded booking does not anchor the itinerary", confirmedBookingsForItinerary([serializedA]).length, 0);
const { bookings: listedA } = await listTripBookings({ supabase: activeSupabase, userId: USER, tripId: TRIP });
check("(a) history still lists the preserved row", listedA.some((b) => b.id === bookingA.id));
eq("(a) itinerary re-stamp was invoked for the linked item", overrideCalls.filter((c) => c.booking?.id === bookingA.id).length, 1);
check("(a) re-stamp received the discard mark", isTravelerDiscardedBooking(overrideCalls.find((c) => c.booking?.id === bookingA.id).booking));
const reconciledA = reconcileItineraryItemsWithCurrentBookings(db.roamly_itineraries[0].full_json, [bookingA]);
const itemA = reconciledA.daily_itinerary[0].live_timeline[0];
check("(a) itinerary read-path strips the Confirmed stamp", !/^Confirmed/.test(itemA.title));
eq("(a) itinerary read-path drops verified factual status", itemA.factualStatus, "unknown");
eq("(a) itinerary read-path drops the protected anchor", itemA.plan_role, "supporting");
eq("(a) scheduled companion reminder cancelled by discard", db.roamly_trip_companion_events.find((e) => e.id === "event-a").status, "cancelled");
eq("(a) Alerts notification marked withdrawn by discard", db.roamly_notifications.find((n) => n.id === "notif-a").metadata.withdrawn, true);
const suppressedA = suppressedCancelledNotifications({
  notifications: db.roamly_notifications,
  bookings: [bookingA],
  eventBookingById: new Map([["event-a", bookingA.id]])
});
check("(a) Alerts attribution suppresses the discarded booking's rows", suppressedA.has("notif-a"));

// Reconnect/backfill re-feed of the SAME message (the resurrection path).
const writesBeforeRefeed = walletWrites.length;
const extractionsBeforeRefeed = db.booking_extraction_results.length;
const refeedA = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_A, agodaBody("AGD8X42K")));
eq("(a) reconnect/backfill re-feed is suppressed", refeedA.status, "suppressed");
eq("(a) re-feed created no wallet booking", walletWrites.length, writesBeforeRefeed);
eq("(a) re-feed created no new extraction row", db.booking_extraction_results.length, extractionsBeforeRefeed);
eq("(a) extraction row still rejected after re-feed", extractionByRef(REF_A).match_status, "rejected");
const listAfterA = await callListImports();
check("(a) discarded import NOT resurfaced in imports", !listAfterA.body.imports.some((i) => i.id === "extraction-a"));
check("(a) discarded import NOT resurfaced in keptAside", !listAfterA.body.keptAside.some((i) => i.id === "extraction-a"));

// ===========================================================================
// (b) Needs-confirmation import -> discard -> ordinary sync re-feed
// ===========================================================================
const MSG_B = "2b27g4c5b80d4ce0";
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
eq("(b) incomplete flight email lands in needs_confirmation", syncB.status, "needs_confirmation");
const extractionB = extractionByRef(REF_B);
check("(b) needs-confirmation extraction persisted", Boolean(extractionB));
extractionB.id = "extraction-b";
const listBeforeB = await callListImports();
check("(b) import is listed before discard", listBeforeB.body.imports.some((i) => i.id === "extraction-b") || listBeforeB.body.keptAside.some((i) => i.id === "extraction-b"));

const discardB = await callDiscard("extraction-b");
eq("(b) discard succeeds", discardB.body.ok, true);
eq("(b) no wallet booking was involved", discardB.body.discardedBookingIds.length, 0);
const refeedB = await extractionModule.extractAndMatchTravelEmailBooking(
  emailParams(MSG_B, flightBody, "Your booking confirmation", "Air Canada <reservations@aircanada.com>")
);
eq("(b) ordinary sync re-feed is suppressed", refeedB.status, "suppressed");
eq("(b) extraction row still rejected after re-feed", extractionByRef(REF_B).match_status, "rejected");
const listAfterB = await callListImports();
check("(b) discarded import NOT in imports after re-feed", !listAfterB.body.imports.some((i) => i.id === "extraction-b"));
check("(b) discarded import NOT in keptAside after re-feed", !listAfterB.body.keptAside.some((i) => i.id === "extraction-b"));
const attachB = await callAttach("extraction-b");
check("(b) attach after discard is refused", attachB.body.ok === false && attachB.status >= 400);

// Credibility layer: even a credible-looking stored row for the
// tombstoned identity is judged discarded when handed the set.
const verdictB = evaluateExtractionCredibility({
  extracted_booking_json: { provider: "Air Canada", title: "Your booking confirmation", confirmationCode: "AC98765" },
  source_reference: REF_B,
  suppressedSourceReferences: new Set([REF_B])
});
check("(b) credibility verdict for tombstoned row is not credible", !verdictB.credible && verdictB.reasons.includes("traveler_discarded"));

// Layer-2 proof: a tombstoned identity whose row was re-created as a
// live suggestion (sync raced the gate) is filtered by the GET route
// itself via the tombstone set.
db.booking_extraction_results.push({
  id: "extraction-b-zombie", user_id: USER, trip_id: TRIP, email_message_id: null,
  source_reference: REF_B, match_status: "needs_confirmation", overall_confidence: 0.95,
  match_reasons: [], extracted_booking_json: { provider: "Air Canada", title: "Your booking confirmation", confirmationCode: "AC98765", sourceReference: REF_B },
  field_confidence_json: {}, created_at: "2026-10-31T01:00:00.000Z"
});
const listZombie = await callListImports();
check("(b) GET route filters a re-created tombstoned row from imports", !listZombie.body.imports.some((i) => i.id === "extraction-b-zombie"));
check("(b) GET route filters a re-created tombstoned row from keptAside", !listZombie.body.keptAside.some((i) => i.id === "extraction-b-zombie"));
eq("(b) GET route counts it as discarded", listZombie.body.discardedCount >= 1, true);
db.booking_extraction_results = db.booking_extraction_results.filter((r) => r.id !== "extraction-b-zombie");

// ===========================================================================
// (c) Cancelled (not discarded) booking keeps RC X1 behaviour
// ===========================================================================
const cancelledRow = {
  id: "booking-cancelled", trip_id: TRIP, user_id: USER, booking_type: "hotel",
  booking_status: "cancelled", provider_name: "Agoda", provider_booking_id: null,
  confirmation_number: "AGD5T66R", source_type: "email", source_reference: "email:gmail:cancelledmsg1",
  title: "Maple Stay Montreal hotel booking", start_at: "2026-11-10T20:00:00.000Z", end_at: "2026-11-12T16:00:00.000Z",
  start_date: null, end_date: null, origin: null, destination: "Montreal", flight_number: null,
  terminal: null, gate: null, room_type: null, check_in_at: null, check_out_at: null,
  total_price: 300, currency: "CAD", traveler_confirmed: true,
  metadata: {}, reservation_requirements: { email_import: { attached_by: "traveler" } },
  last_synced_at: null, created_at: "2026-10-31T00:00:00.000Z", updated_at: "2026-10-31T00:00:00.000Z",
  superseded_by_booking_id: null
};
eq("(c) cancelled booking truth state is cancelled (not discarded)", bookingTruthState(cancelledRow), "cancelled");
check("(c) cancelled booking carries NO discard mark", !isTravelerDiscardedBooking(cancelledRow));
check("(c) cancelled booking is inactive truth", isInactiveTruthState(bookingTruthState(cancelledRow)));
check("(c) cancelled booking is never presented Confirmed", !isConfirmedBooking(serializeTripBookingRecord(cancelledRow)));
eq("(c) cancelled title re-stamps as Cancelled, never Confirmed", titleForTruth("Confirmed · from your Agoda email: Maple Stay Montreal hotel booking", bookingTruthState(cancelledRow), cancelledRow), "Cancelled: Maple Stay Montreal hotel booking");
check("(c) cancelled booking has no tombstone", !db.booking_email_suppressions.some((r) => r.source_reference === "email:gmail:cancelledmsg1"));
const suppressedC = suppressedCancelledNotifications({
  notifications: [{ id: "notif-c", user_id: USER, trip_id: TRIP, event_id: "event-c", type: "booking_confirmed", title: cancelledRow.title, metadata: {} }],
  bookings: [cancelledRow],
  eventBookingById: new Map([["event-c", "booking-cancelled"]])
});
check("(c) Alerts still suppress the cancelled booking's rows (X1)", suppressedC.has("notif-c"));

// ===========================================================================
// (d) A DIFFERENT email from the same provider imports + applies
// ===========================================================================
const MSG_D = "3c38h5d6c91e5df1";
const writesBeforeD = walletWrites.length;
const syncD = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_D, agodaBody("AGD9Y77Z")));
eq("(d) different message id from same provider auto-applies", syncD.status, "attached");
eq("(d) different message id wrote a wallet booking", walletWrites.length, writesBeforeD + 1);
check("(d) different message id has its own extraction row", Boolean(extractionByRef(`email:gmail:${MSG_D}`)));

// ===========================================================================
// (e) A genuinely new email about the SAME stay is NOT suppressed
// ===========================================================================
const MSG_E = "4d49i6e7d02f6e02";
const syncE = await extractionModule.extractAndMatchTravelEmailBooking(emailParams(MSG_E, agodaBody("AGD8X42K")));
check("(e) new message id about the same stay is NOT suppressed", syncE.status !== "suppressed");
check("(e) new message id produced its own extraction row", Boolean(extractionByRef(`email:gmail:${MSG_E}`)));
eq("(e) the original tombstone still stands untouched", db.booking_email_suppressions.filter((r) => r.source_reference === REF_A).length, 1);

console.log(`\n${passed} recon-tombstone checks passed`);
