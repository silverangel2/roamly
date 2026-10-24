// B02–B06 fix checks: amount units/idempotency, provider-scoped identity,
// date-only preservation + zone conversion, confirmation-filtered totals,
// omitted-vs-explicit segments.
// Loads the real lib/roamly/bookings.ts + lib/roamly/bookingWallet.ts via
// the repo's transpile loader. Two downstream modules NOT under test here
// are stubbed so the wallet logic can run without a database: the
// companion orchestrator and the itinerary override engine (their results
// only flow into the return object, never into rows or segments).
// All persistence goes through an in-memory fake Supabase client below.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

const STUBS = {
  "lib/roamly/companionOrchestrator": {
    processCompanionBookingChange: async () => ({ ok: true, stage: "stubbed" })
  },
  "lib/roamly/itineraryBookingOverrides": {
    applyStoredItineraryBookingOverride: async () => ({ ok: true, changed: false })
  }
};

function loadTsModule(entryFile) {
  const cache = new Map();
  const hasKnownExtension = (file) => /\.(?:json|ts|mjs)$/.test(file);
  function load(file) {
    const normalized = file.replace(/^\.\//, "");
    if (STUBS[normalized]) return STUBS[normalized];
    const absolute = path.join(root, normalized);
    if (absolute.endsWith(".json")) return JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      process,
      require(id) {
        // "server-only" is a Next.js marker with no runtime exports; it is
        // absent from this checkout's node_modules (the same gap that
        // breaks the monetary-truth suite), so it stubs to an empty module.
        if (id === "server-only") return {};
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(hasKnownExtension(local) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(hasKnownExtension(resolved) ? resolved : `${resolved}.ts`);
        }
        return require(id);
      }
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { normalizeExtractedBooking, evaluateConfirmedBookingCost, saveConfirmedBooking } = loadTsModule("lib/roamly/bookings.ts");
const { normalizeTripBookingInput, normalizeBookingSegments, createTripBooking } = loadTsModule("lib/roamly/bookingWallet.ts");

// ---- In-memory fake Supabase client ------------------------------------
function createFakeSupabase() {
  const tables = {
    roamly_trips: [{ id: "trip-1", user_id: "user-1" }],
    roamly_bookings: [],
    booking_segments: [],
    roamly_trip_events: []
  };
  let idCounter = 1;

  function matches(row, filters) {
    return filters.every(([kind, col, val]) => {
      if (kind === "eq") return row[col] === val;
      if (kind === "neq") return row[col] !== val;
      if (kind === "is") return val === null ? row[col] == null : row[col] === val;
      if (kind === "in") return Array.isArray(val) && val.includes(row[col]);
      if (kind === "contains") {
        const hay = row[col];
        if (!hay || typeof hay !== "object") return false;
        return Object.entries(val).every(([k, v]) => hay[k] === v);
      }
      return true;
    });
  }

  function chain(table) {
    const state = { table, filters: [], order: null, limitN: null, op: "select", payload: null, done: false, result: null };
    const rows = () => tables[table] || [];
    function run() {
      if (state.done) return state.result;
      state.done = true;
      let data = rows().filter((row) => matches(row, state.filters));
      if (state.order) {
        const [col, asc] = state.order;
        data = [...data].sort((a, b) => {
          if (a[col] < b[col]) return asc ? -1 : 1;
          if (a[col] > b[col]) return asc ? 1 : -1;
          return 0;
        });
      }
      if (state.limitN != null) data = data.slice(0, state.limitN);
      if (state.op === "insert") {
        const payload = state.payload;
        const row = { ...payload, id: `fake-${idCounter++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        rows().push(row);
        data = [row];
      } else if (state.op === "update") {
        for (const row of data) Object.assign(row, state.payload, { updated_at: new Date().toISOString() });
      }
      state.result = { data, error: null };
      return state.result;
    }
    const api = {
      select() { return api; },
      eq(col, val) { state.filters.push(["eq", col, val]); return api; },
      neq(col, val) { state.filters.push(["neq", col, val]); return api; },
      is(col, val) { state.filters.push(["is", col, val]); return api; },
      in(col, vals) { state.filters.push(["in", col, vals]); return api; },
      contains(col, val) { state.filters.push(["contains", col, val]); return api; },
      order(col, opts) { state.order = [col, opts?.ascending !== false]; return api; },
      limit(n) { state.limitN = n; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      maybeSingle() {
        const { data } = run();
        if (data.length > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } });
        return Promise.resolve({ data: data[0] || null, error: null });
      },
      single() {
        const { data } = run();
        if (data.length !== 1) return Promise.resolve({ data: null, error: { message: data.length === 0 ? "no rows" : "multiple rows" } });
        return Promise.resolve({ data: data[0], error: null });
      },
      then(resolve) { return Promise.resolve(run()).then(resolve); }
    };
    return api;
  }

  const client = {
    tables,
    from(table) { return chain(table); },
    async rpc(name, args) {
      if (name === "roamly_replace_booking_segments") {
        tables.booking_segments = tables.booking_segments.filter((row) => row.booking_id !== args.p_booking_id);
        for (const segment of args.p_segments || []) {
          tables.booking_segments.push({ ...segment, id: `seg-${idCounter++}`, booking_id: args.p_booking_id });
        }
        return { data: [], error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    }
  };
  return client;
}

const USER = "user-1";
const TRIP = "trip-1";

// ---- B02: amount units + idempotency -----------------------------------
{
  assert.equal(normalizeExtractedBooking({ amount_cents: 499 }).amount_cents, 499, "B02: 499 cents stays 499, not 49900");
  assert.equal(normalizeExtractedBooking({ amount_cents: 0 }).amount_cents, 0, "B02: zero stays zero");
  assert.equal(normalizeExtractedBooking({ amount_cents: 1000 }).amount_cents, 1000, "B02: 1000 cents stays 1000");
  assert.equal(normalizeExtractedBooking({ amount_cents: 1001 }).amount_cents, 1001, "B02: 1001 cents stays 1001");
  assert.equal(normalizeExtractedBooking({ amount: 4.99 }).amount_cents, 499, "B02: major-unit 4.99 converts once to 499");
  assert.equal(normalizeExtractedBooking({ amount_cents: 0, amount: 9.99 }).amount_cents, 0, "B02: explicit minor units win over major");
  const once = normalizeExtractedBooking({ amount_cents: 499 });
  const twice = normalizeExtractedBooking(once);
  assert.equal(twice.amount_cents, 499, "B02: normalization is idempotent");
  const onceMajor = normalizeExtractedBooking({ amount: 12.5 });
  const twiceMajor = normalizeExtractedBooking(onceMajor);
  assert.equal(onceMajor.amount_cents, 1250, "B02: major converts once");
  assert.equal(twiceMajor.amount_cents, 1250, "B02: major-converted value re-normalizes unchanged");
  assert.equal(normalizeExtractedBooking({ amount_cents: "499" }).amount_cents, null, "B02: non-number stays null");
  console.log("B02 amount unit/idempotency checks passed.");
}

// ---- B05: confirmation-filtered totals ---------------------------------
{
  const pending = { amount_cents: 12000, currency: "CAD", booking_status: "unknown", traveler_confirmed: false, superseded_by_booking_id: null };
  const pendingOnly = evaluateConfirmedBookingCost([pending], "CAD");
  assert.equal(pendingOnly.amountCents, 0, "B05: pending row does not count as committed");
  assert.equal(pendingOnly.status, "known_compatible", "B05: pending-only totals read as zero committed");
  const confirmed = { amount_cents: 12000, currency: "CAD", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: null };
  assert.equal(evaluateConfirmedBookingCost([confirmed], "CAD").amountCents, 12000, "B05: confirmed row counts");
  const mixed = evaluateConfirmedBookingCost([
    { amount_cents: 5000, currency: "CAD", booking_status: "paid", traveler_confirmed: true, superseded_by_booking_id: null },
    { amount_cents: 7000, currency: "USD", booking_status: "unknown", traveler_confirmed: false, superseded_by_booking_id: null }
  ], "CAD");
  assert.equal(mixed.amountCents, 5000, "B05: pending foreign row neither counts nor poisons");
  assert.equal(mixed.status, "known_compatible", "B05: mixed confirmed+pending stays compatible");
  const mismatch = evaluateConfirmedBookingCost([
    { amount_cents: 5000, currency: "CAD", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: null },
    { amount_cents: 7000, currency: "USD", booking_status: "reserved", traveler_confirmed: true, superseded_by_booking_id: null }
  ], "CAD");
  assert.equal(mismatch.status, "currency_mismatch", "B05: confirmed cross-currency still mismatches");
  assert.equal(mismatch.amountCents, null, "B05: mismatch yields no total");
  assert.equal(mismatch.knownAmountCents, 5000, "B05: mismatch keeps the budget-currency subtotal");
  const unknownAmount = evaluateConfirmedBookingCost([
    { amount_cents: null, currency: "CAD", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: null },
    { amount_cents: null, currency: "CAD", booking_status: "unknown", traveler_confirmed: false, superseded_by_booking_id: null }
  ], "CAD");
  assert.equal(unknownAmount.status, "unknown_amount", "B05: confirmed row without amount stays unknown, not zero");
  assert.equal(unknownAmount.amountCents, null, "B05: unknown amount yields no total");
  const historical = evaluateConfirmedBookingCost([
    { currency: "CAD", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: null }
  ], "CAD");
  assert.equal(historical.status, "unknown_amount", "B05: historical row lacking amount_cents stays unknown");
  const supersededConfirmed = evaluateConfirmedBookingCost([
    { amount_cents: 9000, currency: "CAD", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: "next" }
  ], "CAD");
  assert.equal(supersededConfirmed.amountCents, 0, "B05: superseded confirmed row excluded");
  const unconfirmedBooked = evaluateConfirmedBookingCost([
    { amount_cents: 9000, currency: "CAD", booking_status: "booked", traveler_confirmed: false, superseded_by_booking_id: null }
  ], "CAD");
  assert.equal(unconfirmedBooked.amountCents, 0, "B05: booked-but-unconfirmed row excluded");
  console.log("B05 confirmation-filtered total checks passed.");
}

// ---- B04: date-only + zone conversion ----------------------------------
{
  const dateOnly = normalizeTripBookingInput({ bookingType: "attraction", title: "Museum", startDate: "2026-11-10" });
  assert.equal(dateOnly.start_date, "2026-11-10", "B04: date-only activity keeps its date");
  assert.equal(dateOnly.start_at, null, "B04: date-only activity has no fabricated instant");
  const hotel = normalizeTripBookingInput({
    bookingType: "hotel", title: "Hotel", startDate: "2026-11-10", endDate: "2026-11-12",
    checkInTime: "15:00", checkOutTime: "11:00"
  });
  assert.equal(hotel.start_date, "2026-11-10", "B04: hotel start date preserved");
  assert.equal(hotel.end_date, "2026-11-12", "B04: hotel end date preserved");
  assert.equal(hotel.check_in_at, null, "B04: zone-less hotel clock is not stamped as UTC");
  const manila = normalizeTripBookingInput({
    bookingType: "flight", title: "Flight", startTime: "2026-11-10T09:00", timezone: "Asia/Manila"
  });
  assert.equal(manila.start_at, "2026-11-10T01:00:00.000Z", "B04: Manila 09:00 converts to 01:00Z");
  const noZone = normalizeTripBookingInput({
    bookingType: "flight", title: "Flight", startTime: "2026-11-10T09:00", startDate: "2026-11-10"
  });
  assert.equal(noZone.start_at, null, "B04: zone-less wall clock yields no instant");
  assert.equal(noZone.start_date, "2026-11-10", "B04: zone-less wall clock still keeps its date");
  const offsetBearing = normalizeTripBookingInput({
    bookingType: "flight", title: "Flight", startTime: "2026-11-10T09:00:00+08:00"
  });
  assert.equal(offsetBearing.start_at, "2026-11-10T01:00:00.000Z", "B04: offset-bearing clock parses directly");
  // Overnight flight: Manila departure evening, Toronto arrival next morning.
  const overnight = normalizeTripBookingInput({
    bookingType: "flight", title: "Overnight",
    startTime: "2026-11-10T22:30", endTime: "2026-11-11T06:15",
    departureTimezone: "Asia/Manila", arrivalTimezone: "America/Toronto"
  });
  assert.equal(overnight.start_at, "2026-11-10T14:30:00.000Z", "B04: overnight departure converts");
  assert.equal(overnight.end_at, "2026-11-11T11:15:00.000Z", "B04: overnight arrival converts (EST, UTC-5)");
  const segments = normalizeBookingSegments([{
    sequence: 1, origin: "MNL", destination: "YYZ",
    departureTime: "2026-11-10T22:30", arrivalTime: "2026-11-11T06:15"
  }], { departureTimeZone: "Asia/Manila", arrivalTimeZone: "America/Toronto" });
  assert.equal(segments[0].departure_time, "2026-11-10T14:30:00.000Z", "B04: segment departure uses departure zone");
  assert.equal(segments[0].arrival_time, "2026-11-11T11:15:00.000Z", "B04: segment arrival uses arrival zone");
  // International date line: Auckland evening departure, Los Angeles same-day arrival.
  const dateline = normalizeTripBookingInput({
    bookingType: "flight", title: "Dateline",
    startTime: "2026-11-10T23:00", endTime: "2026-11-10T15:00",
    departureTimezone: "Pacific/Auckland", arrivalTimezone: "America/Los_Angeles"
  });
  assert.equal(dateline.start_at, "2026-11-10T10:00:00.000Z", "B04: Auckland NZDT (+13) departure converts");
  assert.equal(dateline.end_at, "2026-11-10T23:00:00.000Z", "B04: Los Angeles PST (-8) arrival converts");
  // DST gap (spring forward) and ambiguity (fall back) both refuse an instant.
  const dstGap = normalizeTripBookingInput({
    bookingType: "flight", title: "DST gap", startTime: "2026-03-08T02:30", timezone: "America/Toronto", startDate: "2026-03-08"
  });
  assert.equal(dstGap.start_at, null, "B04: DST gap clock yields no instant");
  assert.equal(dstGap.start_date, "2026-03-08", "B04: DST gap clock still keeps its date");
  const dstAmbiguous = normalizeTripBookingInput({
    bookingType: "flight", title: "DST ambiguous", startTime: "2026-11-01T01:30", timezone: "America/Toronto", startDate: "2026-11-01"
  });
  assert.equal(dstAmbiguous.start_at, null, "B04: DST ambiguous clock yields no instant");
  console.log("B04 date-only + zone conversion checks passed.");
}

// ---- B03 + B06: provider-scoped identity + omitted-vs-explicit segments
{
  const supabase = createFakeSupabase();
  const flightA = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline A", confirmationCode: "ABC123",
      title: "Flight A", startTime: "2026-11-10T01:00:00.000Z", travelerConfirmed: false
    }
  });
  assert.equal(flightA.error, null, "B03 setup: flight insert succeeds");
  assert.equal(flightA.created, true, "B03 setup: flight created");
  assert.equal(supabase.tables.roamly_bookings.length, 1, "B03 setup: one row");

  // Hotel B shares the confirmation string but is a different provider/type:
  // it must NOT overwrite the flight.
  const hotelB = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "hotel", provider: "Hotel B", confirmationCode: "ABC123",
      title: "Hotel B", startTime: "2026-11-10T01:00:00.000Z", travelerConfirmed: false
    }
  });
  assert.equal(hotelB.error, null, "B03: hotel import succeeds");
  assert.equal(hotelB.created, true, "B03: shared confirmation string inserts a distinct row, not an overwrite");
  assert.equal(supabase.tables.roamly_bookings.length, 2, "B03: two distinct reservations remain");
  assert.equal(supabase.tables.roamly_bookings[0].title, "Flight A", "B03: original flight untouched");

  // Same provider + type + confirmation re-imported: still matches (update).
  const flightA2 = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline A", confirmationCode: "ABC123",
      title: "Flight A updated", startTime: "2026-11-10T01:00:00.000Z", travelerConfirmed: false
    }
  });
  assert.equal(flightA2.created, false, "B03: same-provider same-identity re-import updates");
  assert.equal(supabase.tables.roamly_bookings.length, 2, "B03: re-import does not duplicate");

  // Confirmed-row preservation guard still holds.
  const confirmed = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline C", confirmationCode: "CONF1",
      title: "Confirmed flight", travelerConfirmed: true
    }
  });
  assert.equal(confirmed.created, true, "B03 setup: confirmed row created");
  const unconfirmedOverwrite = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline C", confirmationCode: "CONF1",
      title: "Unconfirmed overwrite", travelerConfirmed: false
    }
  });
  assert.equal(unconfirmedOverwrite.created, false, "B03: unconfirmed import does not replace a confirmed row");
  const kept = supabase.tables.roamly_bookings.find((row) => row.confirmation_number === "CONF1");
  assert.equal(kept.title, "Confirmed flight", "B03: confirmed row preserved");

  // Ambiguity: two legacy rows share provider + type + provider_booking_id.
  supabase.tables.roamly_bookings.push(
    { id: "legacy-1", user_id: USER, trip_id: TRIP, booking_type: "flight", provider_name: "Airline D", provider_booking_id: "DUP9", confirmation_number: null, title: "Legacy 1", traveler_confirmed: false, booking_status: "unknown", superseded_by_booking_id: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", metadata: {} },
    { id: "legacy-2", user_id: USER, trip_id: TRIP, booking_type: "flight", provider_name: "Airline D", provider_booking_id: "DUP9", confirmation_number: null, title: "Legacy 2", traveler_confirmed: false, booking_status: "unknown", superseded_by_booking_id: null, created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", metadata: {} }
  );
  const beforeAmbiguous = supabase.tables.roamly_bookings.length;
  const ambiguous = await createTripBooking({
    supabase, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline D", providerBookingId: "DUP9",
      title: "Ambiguous import", travelerConfirmed: true
    }
  });
  assert.equal(ambiguous.error, null, "B03: ambiguous import succeeds as a new row");
  assert.equal(ambiguous.created, true, "B03: ambiguous import inserts, never overwrites");
  assert.equal(ambiguous.ambiguousMatch, true, "B03: ambiguous import is flagged");
  assert.equal(supabase.tables.roamly_bookings.length, beforeAmbiguous + 1, "B03: exactly one new row for the ambiguous import");
  const reviewRow = supabase.tables.roamly_bookings.find((row) => row.title === "Ambiguous import");
  assert.equal(reviewRow.booking_status, "unknown", "B03: ambiguous row is needs-review, not confirmed");
  assert.equal(reviewRow.traveler_confirmed, false, "B03: ambiguous row is not traveler-confirmed");
  assert.equal(reviewRow.metadata.ambiguousMatch, true, "B03: ambiguous row carries the flag");
  assert.equal(supabase.tables.roamly_bookings.find((row) => row.id === "legacy-1").title, "Legacy 1", "B03: legacy rows untouched");
  assert.equal(supabase.tables.roamly_bookings.find((row) => row.id === "legacy-2").title, "Legacy 2", "B03: legacy rows untouched");
  console.log("B03 provider-scoped identity checks passed.");

  // B06: segments on a fresh flight, then omitted / explicit-empty / explicit.
  const supabase2 = createFakeSupabase();
  const withSegments = await createTripBooking({
    supabase: supabase2, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline E", confirmationCode: "SEG1",
      title: "Segmented flight", travelerConfirmed: false,
      segments: [{ sequence: 1, origin: "YUL", destination: "YYZ", departureTime: "2026-11-10T14:00:00.000Z", arrivalTime: "2026-11-10T15:30:00.000Z" }]
    }
  });
  assert.equal(withSegments.error, null, "B06 setup: segmented insert succeeds");
  const bookingId = withSegments.booking.id;
  assert.equal(supabase2.tables.booking_segments.length, 1, "B06 setup: one segment stored");
  assert.equal(supabase2.tables.booking_segments[0].origin, "YUL", "B06 setup: segment origin stored");

  // Omitted segments on update: existing segments preserved.
  const omitted = await createTripBooking({
    supabase: supabase2, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline E", confirmationCode: "SEG1",
      title: "Segmented flight renamed", travelerConfirmed: false
    }
  });
  assert.equal(omitted.error, null, "B06: omitted-segments update succeeds");
  assert.equal(supabase2.tables.booking_segments.length, 1, "B06: omitted segments preserve existing segments");
  assert.equal(supabase2.tables.booking_segments[0].origin, "YUL", "B06: preserved segment unchanged");

  // Explicit empty segments on update: replacement clears them.
  const cleared = await createTripBooking({
    supabase: supabase2, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline E", confirmationCode: "SEG1",
      title: "Segmented flight renamed", travelerConfirmed: false, segments: []
    }
  });
  assert.equal(cleared.error, null, "B06: explicit-empty update succeeds");
  assert.equal(supabase2.tables.booking_segments.length, 0, "B06: explicit empty list replaces (clears) segments");

  // Explicit non-empty segments on update: replacement stores them.
  const replaced = await createTripBooking({
    supabase: supabase2, userId: USER, tripId: TRIP,
    input: {
      bookingType: "flight", provider: "Airline E", confirmationCode: "SEG1",
      title: "Segmented flight renamed", travelerConfirmed: false,
      segments: [
        { sequence: 1, origin: "YUL", destination: "YVR" },
        { sequence: 2, origin: "YVR", destination: "YYZ" }
      ]
    }
  });
  assert.equal(replaced.error, null, "B06: explicit replacement succeeds");
  assert.equal(supabase2.tables.booking_segments.length, 2, "B06: explicit replacement stores the new list");
  assert.equal(supabase2.tables.booking_segments.filter((row) => row.booking_id === bookingId).length, 2, "B06: segments belong to the same booking");

  // New booking without segments: no segments stored, no error.
  const noSegments = await createTripBooking({
    supabase: supabase2, userId: USER, tripId: TRIP,
    input: { bookingType: "attraction", provider: "Museum", title: "Museum visit", startDate: "2026-11-10", travelerConfirmed: false }
  });
  assert.equal(noSegments.error, null, "B06: segment-less insert succeeds");
  assert.equal(noSegments.booking.start_date, "2026-11-10", "B04: segment-less manual insert keeps its date");
  assert.equal(supabase2.tables.booking_segments.length, 2, "B06: segment-less insert adds no segments");
  console.log("B06 omitted-vs-explicit segment checks passed.");
}

// ---- B04: screenshot confirmation path ---------------------------------
{
  const supabase = createFakeSupabase();
  const extracted = {
    booking_type: "hotel", provider_name: "Hotel F", title: "Hotel F stay",
    confirmation_number: "HF1", flight_number: "", airline_code: "", terminal: "", gate: "",
    baggage: "", duration: "", origin: "", destination: "", booking_status: "unknown",
    amount_cents: null, currency: "cad", start_date: "2026-11-10", end_date: "2026-11-12",
    start_time: "15:00", end_time: "11:00", address: "", city: "", region: "", country: "",
    latitude: null, longitude: null, extraction_confidence: "high", metadata: {}
  };
  const noZone = await saveConfirmedBooking(supabase, { userId: USER, tripId: TRIP, booking: extracted, sourceType: "screenshot" });
  assert.equal(noZone.error, null, "B04 screenshot: zone-less save succeeds");
  const noZoneRow = supabase.tables.roamly_bookings[0];
  assert.equal(noZoneRow.start_date, "2026-11-10", "B04 screenshot: zone-less save keeps the start date");
  assert.equal(noZoneRow.end_date, "2026-11-12", "B04 screenshot: zone-less save keeps the end date");
  assert.equal(noZoneRow.check_in_at, null, "B04 screenshot: zone-less clock is NOT stamped as UTC");

  const withZone = await saveConfirmedBooking(supabase, {
    userId: USER, tripId: TRIP,
    booking: { ...extracted, confirmation_number: "HF2", metadata: { timezone: "Asia/Manila" } },
    sourceType: "screenshot"
  });
  assert.equal(withZone.error, null, "B04 screenshot: zoned save succeeds");
  const zonedRow = supabase.tables.roamly_bookings.find((row) => row.confirmation_number === "HF2");
  assert.equal(zonedRow.check_in_at, "2026-11-10T07:00:00.000Z", "B04 screenshot: Manila 15:00 converts to 07:00Z");
  assert.equal(zonedRow.start_date, "2026-11-10", "B04 screenshot: zoned save also keeps the date");
  console.log("B04 screenshot confirmation checks passed.");
}

console.log("B02–B06 checks passed.");
