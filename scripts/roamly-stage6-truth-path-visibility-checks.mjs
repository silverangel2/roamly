// Stage 6 checks — truth-path swallow cleanup (2026-11-11).
//
// Assessment part C §6.3 named the booking-truth minority of the
// tree's swallow-to-null idioms. Each named site is pinned here
// BEHAVIOURALLY (real modules, in-memory fake store, no network):
//
//  bookingExtraction.ts
//   - :772 existing-booking lookup: a failed read used to present
//     as "no existing booking" and matching proceeded half-blind
//     (the duplicate-creation shape). Now the lookup's error throws
//     EXISTING_BOOKING_LOOKUP_FAILED and aborts the funnel BEFORE
//     any extraction is persisted or booking created; the healthy
//     no-match path is unchanged (extraction persists "unmatched").
//   - :980 AI lane: a failed AI extraction used to collapse to
//     null silently. The deterministic fallback is unchanged, but
//     the failure is now logged with context (captured here).
//  brain/bookingReconciliation.ts
//   - :214 duplicate-merge write and :232 itinerary-override
//     write: failures used to vanish (the helper even returned
//     true unconditionally). Now both land in the run's
//     writeFailures — returned to the caller AND recorded on the
//     booking_reconciliation_runs row — and are logged. The happy
//     path records an empty writeFailures, exactly as before.
import assert from "node:assert/strict";

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.ROAMLY_BUILD2_ENABLED;
delete process.env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED;
delete process.env.ROAMLY_BUILD2_GATES_ENABLED;

const { reconcileTripBookings } = await import("../lib/roamly/brain/bookingReconciliation.ts");
const { extractAndMatchTravelEmailBooking } = await import("../lib/roamly/bookingExtraction.ts");
const { filterTravelEmail } = await import("../lib/roamly/travelEmailFiltering.ts");
const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts");
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let count = 0;
function check(name, condition) {
  count += 1;
  assert.ok(condition, name);
  console.log(`ok - ${name}`);
}

/* ------------------------------------------------ fake store */
function makeFake(tables, injectedErrors = {}) {
  // injectedErrors: { "<table>:<op>": { message } } — op in
  // select|insert|update|upsert.
  class FakeQuery {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = "select";
      this.payload = null;
      this.conflict = null;
      this.limitN = null;
      this.single = false;
    }
    select() { return this; }
    eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
    neq(field, value) { this.filters.push((row) => row[field] !== value); return this; }
    is(field, value) { this.filters.push((row) => (row[field] ?? null) === value); return this; }
    in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; }
    gte(field, value) { this.filters.push((row) => row[field] >= value); return this; }
    lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
    or() { return this; }
    order() { return this; }
    limit(n) { this.limitN = n; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    upsert(payload, opts) { this.op = "upsert"; this.payload = payload; this.conflict = opts?.onConflict ? opts.onConflict.split(",") : null; return this; }
    maybeSingle() { this.single = true; return this; }
    single() { this.single = true; return this; }
    then(resolve, reject) {
      try { resolve(this.exec()); } catch (error) { reject(error); }
    }
    exec() {
      const injected = injectedErrors[`${this.table}:${this.op}`];
      if (injected) return { data: null, error: injected };
      const rows = tables[this.table] || (tables[this.table] = []);
      const matched = rows.filter((row) => this.filters.every((f) => f(row)));
      if (this.op === "update") {
        matched.forEach((row) => Object.assign(row, this.payload));
        return { data: this.single ? matched[0] || null : matched, error: null };
      }
      if (this.op === "insert") {
        const row = { id: `fake-${this.table}-${rows.length + 1}`, ...this.payload };
        rows.push(row);
        return { data: this.single ? row : [row], error: null };
      }
      if (this.op === "upsert") {
        const key = this.conflict || [];
        const existing = key.length ? rows.find((row) => key.every((field) => row[field] === this.payload[field])) : undefined;
        if (existing) {
          Object.assign(existing, this.payload);
          return { data: this.single ? existing : null, error: null };
        }
        const row = { id: `fake-${this.table}-${rows.length + 1}`, ...this.payload };
        rows.push(row);
        return { data: this.single ? row : null, error: null };
      }
      let out = matched;
      if (this.limitN !== null) out = out.slice(0, this.limitN);
      return { data: this.single ? out[0] || null : out, error: null };
    }
  }
  return { from: (table) => new FakeQuery(table) };
}

function captureConsoleError() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  return { lines, restore: () => { console.error = original; } };
}

/* ================= Part A — bookingReconciliation write failures */
const USER = "user-stage6";
const TRIP = "trip-stage6";
function reconBooking(overrides) {
  return {
    id: "bk-primary",
    trip_id: TRIP,
    user_id: USER,
    booking_type: "hotel",
    booking_status: "booked",
    provider_name: "Fixture Hotels",
    // Both rows carry the same provider booking id so they share
    // the reconciler's stable key (provider tier); they differ in
    // the confirmation number, which is the field the merge fills.
    provider_booking_id: "PB-1",
    confirmation_number: null,
    metadata: {},
    source_type: "manual",
    title: "Fixture Hotel stay",
    start_at: "2026-12-10T15:00:00.000Z",
    origin: null,
    destination: "Montreal",
    flight_number: null,
    traveler_confirmed: true,
    updated_at: "2026-11-10T00:00:00.000Z",
    ...overrides
  };
}
function reconTables() {
  return {
    roamly_trips: [{ id: TRIP, user_id: USER }],
    roamly_bookings: [
      reconBooking({ id: "bk-primary" }),
      reconBooking({
        id: "bk-duplicate",
        traveler_confirmed: false,
        updated_at: "2026-11-09T00:00:00.000Z",
        confirmation_number: "FIXTURE-1"
      })
    ],
    booking_reconciliation_runs: [],
    roamly_itineraries: []
  };
}

/* A1: both truth-path writes fail — both are recorded + logged */
{
  const tables = reconTables();
  const fake = makeFake(tables, {
    "roamly_bookings:update": { message: "merge write boom" },
    "roamly_itineraries:select": { message: "itinerary read boom" }
  });
  const cap = captureConsoleError();
  const result = await reconcileTripBookings({ supabase: fake, userId: USER, tripId: TRIP, sourceBookingId: "bk-primary" });
  cap.restore();
  check("A1: run still completes (failures are recorded, not fatal)", result.ok === true);
  check("A1: both write failures are returned to the caller", Array.isArray(result.writeFailures) && result.writeFailures.length === 2);
  check(
    "A1: failure steps are the two named truth-path writes",
    result.writeFailures.some((f) => f.step === "update_primary_from_duplicates" && f.error === "merge write boom") &&
      result.writeFailures.some((f) => f.step === "apply_stored_itinerary_booking_override" && f.error === "itinerary read boom")
  );
  const runRow = tables.booking_reconciliation_runs[0];
  check(
    "A1: failures are recorded on the reconciliation run row",
    Array.isArray(runRow?.output_json?.writeFailures) && runRow.output_json.writeFailures.length === 2
  );
  check(
    "A1: failures are logged with context",
    cap.lines.filter((line) => line.includes("[Roamly booking reconciliation]")).length >= 2
  );
}

/* A2: happy path — writes succeed, writeFailures empty, run recorded */
{
  const tables = reconTables();
  const fake = makeFake(tables, {});
  const cap = captureConsoleError();
  const result = await reconcileTripBookings({ supabase: fake, userId: USER, tripId: TRIP, sourceBookingId: "bk-primary" });
  cap.restore();
  check("A2: happy-path run completes", result.ok === true);
  check("A2: happy-path writeFailures is empty", Array.isArray(result.writeFailures) && result.writeFailures.length === 0);
  check(
    "A2: run row carries the empty writeFailures (shape is stable)",
    Array.isArray(tables.booking_reconciliation_runs[0]?.output_json?.writeFailures) &&
      tables.booking_reconciliation_runs[0].output_json.writeFailures.length === 0
  );
  check(
    "A2: the duplicate's facts were merged onto the primary",
    tables.roamly_bookings.find((row) => row.id === "bk-primary")?.confirmation_number === "FIXTURE-1"
  );
  check("A2: nothing was logged as an error", cap.lines.length === 0);
}

/* ================= Part B — bookingExtraction lookup + AI lane */
const connection = { id: "conn-stage6", user_id: USER, provider: "gmail" };
const metadata = {
  provider: "gmail",
  messageId: "msg-stage6-1",
  sender: "Fixture Travel <bookings@fixture-travel.test>",
  subject: "Your hotel booking confirmation",
  receivedAt: "2026-11-01T10:00:00.000Z",
  snippet: "Fixture hotel booking confirmation. Confirmation code FIXTURE-11111. Check-in 2026-11-05.",
  bodyText: "Fixture hotel booking confirmation. Confirmation code FIXTURE-11111. Check-in 2026-11-05. Fixture Hotel, Montreal."
};
const filter = filterTravelEmail(metadata);
check("B0: fixture email passes the travel filter", filter.shouldProcess === true);

function extractionTables() {
  return {
    booking_email_suppressions: [],
    booking_extraction_results: [],
    roamly_bookings: [],
    roamly_trips: []
  };
}

/* B1: the existing-booking lookup errors — matching aborts loudly */
{
  delete process.env.OPENAI_API_KEY;
  const tables = extractionTables();
  const fake = makeFake(tables, { "roamly_bookings:select": { message: "lookup boom" } });
  await assert.rejects(
    extractAndMatchTravelEmailBooking({ supabase: fake, connection, metadata, filter, emailMessageId: null }),
    /EXISTING_BOOKING_LOOKUP_FAILED/,
    "B1: a failed existing-booking lookup aborts matching with its code"
  );
  count += 1;
  console.log("ok - B1: a failed existing-booking lookup aborts matching with its code");
  check("B1: no extraction was persisted (no half-blind match recorded)", tables.booking_extraction_results.length === 0);
  check("B1: no booking was created", tables.roamly_bookings.length === 0);
}

/* B2: healthy lookup, no match — the funnel behaves exactly as before */
{
  const tables = extractionTables();
  const fake = makeFake(tables, {});
  const result = await extractAndMatchTravelEmailBooking({ supabase: fake, connection, metadata, filter, emailMessageId: null });
  check("B2: no-match funnel returns unmatched", result.attached === false && result.status === "unmatched");
  check(
    "B2: the extraction is persisted as unmatched (unchanged behaviour)",
    tables.booking_extraction_results.length === 1 && tables.booking_extraction_results[0].match_status === "unmatched"
  );
}

/* B3: AI lane fails — logged with context, deterministic path proceeds.
   The funnel takes its filter as a parameter; today's production
   filter scores processable mail ≥ ~0.58, which keeps the
   deterministic extraction at its 0.60 cap and the AI lane cold.
   The lane is driven here at the funnel's own contract with a
   low-confidence filter result — the exact condition
   (deterministic < 0.45, outside the Build 2 lane) under which the
   production code consults the AI extractor. */
{
  process.env.OPENAI_API_KEY = "fixture-test-only-key";
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("api.openai.com")) aiCalls += 1;
    return new Response(JSON.stringify({ error: { message: "fixture AI outage" } }), { status: 500 });
  };
  const tables = extractionTables();
  const fake = makeFake(tables, {});
  const cap = captureConsoleError();
  try {
    const lowConfidenceFilter = {
      shouldProcess: true,
      processingResult: "relevant",
      confidence: 0.2,
      reasons: ["fixture_low_confidence"],
      extractedFacts: {}
    };
    const result = await extractAndMatchTravelEmailBooking({
      supabase: fake,
      connection,
      metadata: { ...metadata, messageId: "msg-stage6-ai" },
      filter: lowConfidenceFilter,
      emailMessageId: null
    });
    check("B3: the AI lane was consulted under its firing condition", aiCalls >= 1);
    check("B3: funnel completes on the deterministic lane despite the AI outage", result.attached === false && result.status === "unmatched");
    check(
      "B3: the AI failure was logged with context (not swallowed to null)",
      cap.lines.some((line) => line.includes("AI extraction failed"))
    );
  } finally {
    cap.restore();
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  }
}

console.log(`Stage 6 truth-path-visibility checks passed (${count} checks).`);
