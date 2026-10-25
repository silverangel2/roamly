// U1 (baseline live E2E audit, 2026-10-24): flight segments must survive
// save -> reload. The audit sent a YUL->YYZ segment with a flight save and
// found no segments on reload. This script runs the REAL createTripBooking /
// listTripBookings from lib/roamly/bookingWallet.ts against a faithful
// in-memory Supabase stand-in: booking_segments is a SEPARATE table (as in
// production), the RPC models the checked-in roamly_replace_booking_segments
// function (ownership gate, delete+insert, count), and the list embed
// `*,booking_segments(*)` attaches rows from that table — exactly like
// PostgREST. A fake that stores segments on the booking row would prove
// nothing; this one does not.
// Contract under test:
//  - save with segments -> the POST-shaped booking AND the GET reload both
//    carry those segments intact (origin, destination, times, provider,
//    service number, sequence order);
//  - save with no segments -> reload shows [] (present, empty — never a
//    phantom segment, never a dropped key masquerading as data);
//  - re-save with segments OMITTED -> stored segments preserved (B06 rule);
//  - re-save with explicit [] -> segments cleared;
//  - re-save with an explicit new list -> segments replaced;
//  - an RPC failure surfaces as an error, never a silent success.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- structural: route must pass segments through, writer must call the RPC
// with the ownership triplet, and the RPC routing must stay intact ----
const route = read("app/api/trips/[id]/bookings/route.ts");
const walletSource = read("lib/roamly/bookingWallet.ts");
assert.match(route, /segments: segmentInput\(body\.segments\)/, "route must pass body.segments through segmentInput");
assert.match(route, /departureTime: text\(segment, "departureTime", "departure_time"\)/, "route segment mapping must carry departure time");
assert.match(route, /serviceNumber: text\(segment, "serviceNumber", "service_number"\)/, "route segment mapping must carry service number");
assert.match(walletSource, /"roamly_replace_booking_segments"/, "writer must call the segment-replacement RPC");
assert.match(walletSource, /p_booking_id: String\(savedRow\.id\)/, "RPC call must carry the booking id");
assert.match(walletSource, /p_user_id: params\.userId/, "RPC call must carry the user id");
assert.match(walletSource, /p_trip_id: params\.tripId/, "RPC call must carry the trip id");
assert.match(walletSource, /p_segments: segments/, "RPC call must carry the normalized segments");

// ---- faithful in-memory Supabase stand-in ----
function makeDb() {
  const trips = [{ id: "trip-1", user_id: "user-1" }];
  const bookings = [];
  const segmentsTable = [];
  const ctx = { seq: 0, segSeq: 0, rpcCalls: [], failRpc: false };

  class Query {
    constructor(table, rows) {
      this.table = table;
      this.rows = rows;
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.op = null;
      this.payload = null;
      this.embedSegments = false;
    }
    select(sel) {
      if (typeof sel === "string" && sel.includes("booking_segments(")) this.embedSegments = true;
      return this;
    }
    eq(col, val) { this.filters.push([col, val]); return this; }
    contains(col, obj) { this.filters.push([col, { __contains: obj }]); return this; }
    order(col, opts) { this.orders.push([col, opts]); return this; }
    limit(n) { this.limitN = n; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    applyFilters() {
      let out = this.rows.filter((row) => this.filters.every(([col, val]) => {
        if (val && typeof val === "object" && val.__contains) {
          const hay = row[col] && typeof row[col] === "object" ? row[col] : {};
          return Object.entries(val.__contains).every(([k, v]) => hay[k] === v);
        }
        return row[col] === val;
      }));
      for (const [col, opts] of this.orders) {
        out = [...out].sort((a, b) => {
          const av = a[col]; const bv = b[col];
          if (av == null && bv == null) return 0;
          if (av == null) return opts?.nullsFirst ? -1 : 1;
          if (bv == null) return opts?.nullsFirst ? 1 : -1;
          if (av < bv) return opts?.ascending === false ? 1 : -1;
          if (av > bv) return opts?.ascending === false ? -1 : 1;
          return 0;
        });
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
      if (this.table === "roamly_bookings" && this.embedSegments) {
        out = out.map((row) => ({
          ...row,
          booking_segments: segmentsTable
            .filter((s) => s.booking_id === row.id)
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => ({ ...s }))
        }));
      }
      return out;
    }
    doInsert() {
      const row = { id: `booking-${++ctx.seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...this.payload };
      bookings.push(row);
      return { data: row, error: null };
    }
    doUpdate() {
      const targets = this.applyFilters();
      if (!targets.length) return { data: null, error: { message: "0 rows" } };
      for (const row of targets) {
        for (const [k, v] of Object.entries(this.payload)) {
          if (v !== undefined) row[k] = v;
        }
        row.updated_at = new Date().toISOString();
      }
      return { data: targets[0], error: null };
    }
    async maybeSingle() {
      const out = this.applyFilters();
      if (out.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: out[0] ?? null, error: null };
    }
    async single() {
      if (this.op === "insert") return this.doInsert();
      if (this.op === "update") return this.doUpdate();
      const out = this.applyFilters();
      if (!out.length) return { data: null, error: { message: "0 rows" } };
      return { data: out[0], error: null };
    }
    then(resolve, reject) {
      return Promise.resolve({ data: this.applyFilters(), error: null }).then(resolve, reject);
    }
  }

  const supabase = {
    from(table) {
      if (table === "roamly_trips") return new Query(table, trips);
      if (table === "roamly_bookings") return new Query(table, bookings);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      ctx.rpcCalls.push({ name, args });
      if (name !== "roamly_replace_booking_segments") return { data: null, error: null };
      if (ctx.failRpc) return { data: null, error: { message: "rpc exploded" } };
      // Model the checked-in SQL: ownership gate, then delete+insert.
      const owner = bookings.find((b) => b.id === args.p_booking_id && b.user_id === args.p_user_id && b.trip_id === args.p_trip_id);
      if (!owner) return { data: null, error: { message: "roamly_replace_booking_segments: booking not found for this user and trip." } };
      for (let i = segmentsTable.length - 1; i >= 0; i--) {
        if (segmentsTable[i].booking_id === args.p_booking_id) segmentsTable.splice(i, 1);
      }
      for (const s of args.p_segments || []) {
        segmentsTable.push({ id: `seg-${++ctx.segSeq}`, booking_id: args.p_booking_id, ...s });
      }
      return { data: [{ segment_count: (args.p_segments || []).length }], error: null };
    }
  };
  return { supabase, bookings, segmentsTable, ctx };
}

// ---- load the real wallet module, sandboxed ----
const compiled = ts.transpileModule(walletSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const sandbox = {
  exports: {},
  module: { exports: {} },
  console,
  require(id) {
    if (id === "@/lib/roamly/events") return { recordTripEvent: async () => ({ ok: true }) };
    if (id === "@/lib/roamly/companionOrchestrator") return { processCompanionBookingChange: async () => ({ ok: true }) };
    if (id === "@/lib/roamly/itineraryBookingOverrides") return { applyStoredItineraryBookingOverride: async () => ({ ok: true, changed: false }) };
    if (id === "@/lib/roamly/bookingSupersession") return { isOperationalCurrentBooking: (b) => !b.superseded_by_booking_id };
    return require(id);
  }
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox);
const wallet = sandbox.module.exports;

const seg1 = { sequence: 1, origin: "YUL", destination: "YYZ", departureTime: "2026-11-10T20:30:00", arrivalTime: "2026-11-10T22:00:00", provider: "E2E Baseline Air", serviceNumber: "EB100", status: "unknown" };
const flightBase = {
  bookingType: "flight", travelerConfirmed: false, sourceType: "manual",
  provider: "E2E Baseline Air", title: "E2E Baseline Flight YUL-YYZ", flightNumber: "EB100",
  origin: "YUL", destination: "YYZ",
  startTime: "2026-11-10T20:30:00", endTime: "2026-11-10T22:00:00",
  confirmationCode: "E2EBASE1", totalPrice: 249, currency: "CAD"
};

async function reload(supabase, id) {
  const re = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1", includeSegments: true });
  assert.equal(re.error, null, `reload must succeed, got ${re.error}`);
  const row = re.bookings.find((b) => b.id === id);
  assert.ok(row, "reload must find the saved booking");
  return row;
}

// ---- case 1: save with 1 segment -> POST shape AND reload carry it intact ----
{
  const { supabase, ctx } = makeDb();
  const result = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [seg1] } });
  assert.equal(result.error, null, `flight save must succeed, got ${result.error}`);
  assert.equal(ctx.rpcCalls.filter((c) => c.name === "roamly_replace_booking_segments").length, 1, "segment RPC must fire once on a segmented save");
  const post = result.booking;
  assert.ok(Array.isArray(post.booking_segments), "POST-shaped booking must carry booking_segments");
  assert.equal(post.booking_segments.length, 1, "POST-shaped booking must carry exactly the saved segment");
  assert.equal(post.booking_segments[0].origin, "YUL");
  assert.equal(post.booking_segments[0].destination, "YYZ");
  assert.equal(post.booking_segments[0].service_number, "EB100");
  assert.equal(post.booking_segments[0].provider, "E2E Baseline Air");
  const row = await reload(supabase, post.id);
  assert.ok(Array.isArray(row.booking_segments), "reload must carry booking_segments");
  assert.equal(row.booking_segments.length, 1, "reload must show exactly the saved segment");
  assert.equal(row.booking_segments[0].origin, "YUL");
  assert.equal(row.booking_segments[0].destination, "YYZ");
  assert.equal(row.booking_segments[0].service_number, "EB100");
  assert.ok(String(row.booking_segments[0].departure_time).startsWith("2026-11-10T20:30"), "segment departure time must survive");
  assert.ok(String(row.booking_segments[0].arrival_time).startsWith("2026-11-10T22:00"), "segment arrival time must survive");
}

// ---- case 2: save with 2 segments sent out of order -> reload in sequence order ----
{
  const { supabase } = makeDb();
  const seg2 = { sequence: 2, origin: "YYZ", destination: "YVR", departureTime: "2026-11-10T23:30:00", arrivalTime: "2026-11-11T02:00:00", provider: "E2E Baseline Air", serviceNumber: "EB101", status: "unknown" };
  const result = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, confirmationCode: "E2EBASE2", segments: [seg2, seg1] } });
  assert.equal(result.error, null);
  const row = await reload(supabase, result.booking.id);
  assert.equal(row.booking_segments.length, 2, "reload must show both segments");
  assert.equal(row.booking_segments[0].sequence, 1, "segments must reload in sequence order");
  assert.equal(row.booking_segments[1].sequence, 2);
  assert.equal(row.booking_segments[1].service_number, "EB101");
}

// ---- case 3: save with NO segments -> reload shows [] (present, empty) ----
{
  const { supabase, ctx } = makeDb();
  const result = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, confirmationCode: "E2EBASE3" } });
  assert.equal(result.error, null);
  assert.equal(ctx.rpcCalls.filter((c) => c.name === "roamly_replace_booking_segments").length, 0, "no RPC call is needed when a new booking has no segments");
  const row = await reload(supabase, result.booking.id);
  assert.ok(Array.isArray(row.booking_segments), "reload must present booking_segments as an array even when empty");
  assert.equal(row.booking_segments.length, 0, "reload must show no phantom segments");
}

// ---- case 4: re-save with segments OMITTED -> stored segments preserved (B06) ----
{
  const { supabase, ctx } = makeDb();
  const first = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [seg1] } });
  assert.equal(first.error, null);
  const rpcBefore = ctx.rpcCalls.length;
  const again = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, title: "E2E Baseline Flight YUL-YYZ CHANGED" } });
  assert.equal(again.error, null, `omitted-segment re-save must succeed, got ${again.error}`);
  assert.equal(ctx.rpcCalls.length, rpcBefore, "omitted segments must NOT fire the replace RPC (nothing to replace)");
  const row = await reload(supabase, first.booking.id);
  assert.equal(row.booking_segments.length, 1, "omitted segments must preserve the stored segment");
  assert.equal(row.booking_segments[0].service_number, "EB100");
  // The POST shape must not contradict storage: it states nothing here.
  assert.equal(again.booking.booking_segments, undefined, "omitted-segment re-save must not claim an empty segment list it did not write");
}

// ---- case 5: re-save with explicit [] -> segments cleared ----
{
  const { supabase } = makeDb();
  const first = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [seg1] } });
  assert.equal(first.error, null);
  const again = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [] } });
  assert.equal(again.error, null);
  const row = await reload(supabase, first.booking.id);
  assert.ok(Array.isArray(row.booking_segments), "cleared reload must still present the array");
  assert.equal(row.booking_segments.length, 0, "explicit [] must clear stored segments");
  assert.ok(Array.isArray(again.booking.booking_segments) && again.booking.booking_segments.length === 0, "POST shape must agree it cleared");
}

// ---- case 6: re-save with an explicit new list -> segments replaced ----
{
  const { supabase } = makeDb();
  const first = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [seg1] } });
  assert.equal(first.error, null);
  const segNew = { sequence: 1, origin: "YUL", destination: "YYZ", departureTime: "2026-11-10T21:30:00", arrivalTime: "2026-11-10T23:00:00", provider: "E2E Baseline Air", serviceNumber: "EB100", status: "unknown" };
  const again = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [segNew] } });
  assert.equal(again.error, null);
  const row = await reload(supabase, first.booking.id);
  assert.equal(row.booking_segments.length, 1, "replacement must leave exactly the new list");
  assert.ok(String(row.booking_segments[0].departure_time).startsWith("2026-11-10T21:30"), "replacement must carry the new time");
}

// ---- case 7: RPC failure surfaces as an error, never a silent success ----
{
  const { supabase, ctx } = makeDb();
  ctx.failRpc = true;
  const result = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input: { ...flightBase, segments: [seg1] } });
  assert.ok(result.error, "an RPC failure must surface as an error, never a silent success");
}

console.log("u1-segments: flight segments survive save -> reload; omitted preserved, explicit [] clears, explicit list replaces; RPC failure surfaces");
