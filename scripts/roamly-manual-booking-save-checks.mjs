// Manual-booking save proof (audit B16/PH01): a signed-in manual booking with
// no price and no currency must persist and reload — for activity, hotel and
// flight — without writing null into the NOT NULL currency column and without
// inventing a price. Currency resolution: explicit input wins, then the trip's
// own currency, then "XXX" (the ISO 4217 no-currency marker) when nothing is
// known. Runs the REAL normalizeTripBookingInput / createTripBooking /
// listTripBookings from lib/roamly/bookingWallet.ts (transpiled, sandboxed
// like roamly-core-checks.mjs) against an in-memory Supabase stand-in that
// enforces the real roamly_bookings constraints: currency NOT NULL, default
// 'cad' when the column is omitted, and a 23502 error on an explicit null.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- source-contract assertions (form + route + normalizer must agree) ----
const form = read("components/companion/ManualBookingForm.tsx");
const route = read("app/api/trips/[id]/bookings/route.ts");
const walletSource = read("lib/roamly/bookingWallet.ts");
const addPage = read("app/trip/[id]/bookings/add/page.tsx");
const enMessages = read("messages/en.json");

assert.match(form, /currency: tripCurrency \|\| null/, "form payload must carry one currency field for every manual kind");
assert.match(form, /tripCurrency\?: string \| null/, "form must accept the trip currency as a prop");
assert.match(form, /ui\.booking\.saveFailed/, "form must map the save-failure code to plain words");
assert.match(addPage, /tripCurrency=\{bundle\.data\.trip\.budget_currency/, "add page must pass the trip currency to the form");
assert.match(route, /BOOKING_SAVE_FAILED/, "route must map save errors to one stable customer-safe code");
assert.match(route, /TRIP_NOT_FOUND/, "route must still pass the not-found code through");
assert.doesNotMatch(route, /error: result\.error \}, \{ status \}/, "route must not return the raw error for saves");
assert.match(enMessages, /saveFailed/, "plain-word save-failure text must exist in the message catalog");
JSON.parse(enMessages);
assert.match(walletSource, /error: "BOOKING_SAVE_FAILED"/, "writer must map persistence failures to the stable code, never raw DB text");
assert.match(walletSource, /\?\?\s*"XXX"/, "unknown currency must fall back to the ISO no-currency marker, never null");
assert.match(walletSource, /amount_cents: nullableMoney\(input\.totalPrice\)/, "writer must keep the amount_cents write so cost readers see the price");

// ---- in-memory Supabase stand-in with the real column rules ----
function makeDb({ tripCurrency = null, planningCurrency = null } = {}) {
  const trips = [{
    id: "trip-1",
    user_id: "user-1",
    budget_currency: tripCurrency,
    metadata: planningCurrency ? { planning: { budgetCurrency: planningCurrency } } : {}
  }];
  const bookings = [];
  const ctx = { seq: 0, lastInsert: null, lastUpdate: null, rpcCalls: [], failNextWrite: false };

  class Query {
    constructor(rows) {
      this.rows = rows;
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.op = null;
      this.payload = null;
    }
    select() { return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    contains(col, obj) {
      this.filters.push([col, { __contains: obj }]);
      return this;
    }
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
      return out;
    }
    doInsert() {
      if (ctx.failNextWrite) {
        ctx.failNextWrite = false;
        return { data: null, error: { message: 'null value in column "currency" of relation "roamly_bookings" violates not-null constraint', code: "23502" } };
      }
      ctx.lastInsert = this.payload;
      if (Object.prototype.hasOwnProperty.call(this.payload, "currency") && this.payload.currency === null) {
        return { data: null, error: { message: 'null value in column "currency" of relation "roamly_bookings" violates not-null constraint', code: "23502" } };
      }
      const row = {
        id: `booking-${++ctx.seq}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload
      };
      // The real column default: omitted currency becomes 'cad'.
      if (!Object.prototype.hasOwnProperty.call(this.payload, "currency")) row.currency = "cad";
      bookings.push(row);
      return { data: row, error: null };
    }
    doUpdate() {
      ctx.lastUpdate = this.payload;
      const targets = this.applyFilters();
      if (!targets.length) return { data: null, error: { message: "0 rows" } };
      if (Object.prototype.hasOwnProperty.call(this.payload, "currency") && this.payload.currency === null) {
        return { data: null, error: { message: 'null value in column "currency" of relation "roamly_bookings" violates not-null constraint', code: "23502" } };
      }
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
      // Supabase builders are thenable: awaiting one runs the list query.
      return Promise.resolve({ data: this.applyFilters(), error: null }).then(resolve, reject);
    }
  }

  const supabase = {
    from(table) {
      if (table === "roamly_trips") return new Query(trips);
      if (table === "roamly_bookings") return new Query(bookings);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      ctx.rpcCalls.push({ name, args });
      if (name === "roamly_replace_booking_segments") {
        const row = bookings.find((b) => b.id === args.p_booking_id);
        if (row) row.booking_segments = args.p_segments;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
  };
  return { supabase, bookings, ctx };
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

// ---- normalizer unit: never null, trip fallback, explicit wins, XXX last ----
const bare = wallet.normalizeTripBookingInput({ bookingType: "activity", title: "Museum" });
assert.equal(bare.currency, "XXX", "no currency anywhere must fall back to the ISO no-currency marker, never null");
assert.equal(wallet.normalizeTripBookingInput({ bookingType: "activity", title: "M", currency: "usd" }).currency, "USD", "explicit currency still normalizes to uppercase");
assert.equal(wallet.normalizeTripBookingInput({ bookingType: "activity", title: "M" }, "php").currency, "PHP", "trip currency must fill an unknown currency");
assert.equal(wallet.normalizeTripBookingInput({ bookingType: "activity", title: "M", currency: "php" }, "CAD").currency, "PHP", "explicit currency must beat the trip fallback");

// ---- the old payload shape still fails against the real constraint ----
{
  const { supabase } = makeDb();
  const bad = await supabase.from("roamly_bookings").insert({ title: "Old shape", currency: null }).select("*").single();
  assert.ok(bad.error && bad.error.message.includes("not-null constraint"), "stand-in must reproduce the live NOT NULL failure for an explicit null");
}

// ---- case 1: activity, Philippines trip, no currency, no price ----
{
  const { supabase, ctx } = makeDb({ tripCurrency: "PHP" });
  const result = await wallet.createTripBooking({
    supabase, userId: "user-1", tripId: "trip-1",
    input: {
      bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
      title: "Intramuros walk", startTime: "2026-11-10T09:00:00", address: "Manila"
    }
  });
  assert.equal(result.error, null, `activity save must succeed, got ${result.error}`);
  assert.equal(ctx.lastInsert.currency, "PHP", "activity must resolve to the trip currency");
  assert.equal(ctx.lastInsert.total_price, null, "activity must not invent a price");
  const reloaded = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1" });
  assert.equal(reloaded.error, null);
  assert.equal(reloaded.bookings.length, 1);
  assert.equal(reloaded.bookings[0].title, "Intramuros walk");
  assert.ok(reloaded.bookings[0].start_time.startsWith("2026-11-10"), "activity date must survive persist + reload");
  assert.equal(reloaded.bookings[0].currency, "PHP", "activity currency must survive reload");
  assert.equal(reloaded.bookings[0].total_price, null, "reload must still show no price");
}

// ---- case 2: hotel, CAD trip, no currency, no price ----
{
  const { supabase, ctx } = makeDb({ tripCurrency: "CAD" });
  const result = await wallet.createTripBooking({
    supabase, userId: "user-1", tripId: "trip-1",
    input: {
      bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
      provider: "Harbour Hotel", title: "Harbour Hotel",
      checkInTime: "2026-11-10T15:00:00", checkOutTime: "2026-11-12T11:00:00", address: "Saint John"
    }
  });
  assert.equal(result.error, null, `hotel save must succeed, got ${result.error}`);
  assert.equal(ctx.lastInsert.currency, "CAD", "hotel must resolve to the trip currency");
  assert.equal(ctx.lastInsert.total_price, null, "hotel must not invent a price");
  const reloaded = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1" });
  assert.equal(reloaded.bookings.length, 1);
  assert.ok(reloaded.bookings[0].check_in_time.startsWith("2026-11-10"), "hotel check-in date must survive reload");
  assert.ok(reloaded.bookings[0].check_out_time.startsWith("2026-11-12"), "hotel check-out date must survive reload");
  assert.equal(reloaded.bookings[0].currency, "CAD");
}

// ---- case 3: flight, trip with NO currency anywhere, no currency, no price ----
{
  const { supabase, ctx } = makeDb({});
  const result = await wallet.createTripBooking({
    supabase, userId: "user-1", tripId: "trip-1",
    input: {
      bookingType: "flight", travelerConfirmed: false, sourceType: "manual",
      provider: "Air Canada", title: "AC 870", flightNumber: "AC870",
      origin: "YUL", destination: "CDG",
      startTime: "2026-11-10T20:30:00", endTime: "2026-11-11T08:00:00",
      segments: [{ sequence: 1, origin: "YUL", destination: "CDG", departureTime: "2026-11-10T20:30:00", arrivalTime: "2026-11-11T08:00:00", provider: "Air Canada", serviceNumber: "AC870", status: "unknown" }]
    }
  });
  assert.equal(result.error, null, `flight save must succeed, got ${result.error}`);
  assert.equal(ctx.lastInsert.currency, "XXX", "with no currency anywhere the ISO no-currency marker must be used, never null");
  assert.equal(ctx.lastInsert.total_price, null, "flight must not invent a price");
  assert.ok(ctx.rpcCalls.some((c) => c.name === "roamly_replace_booking_segments"), "flight segments must still be written");
  const reloaded = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1" });
  assert.equal(reloaded.bookings.length, 1);
  assert.ok(reloaded.bookings[0].start_time.startsWith("2026-11-10"), "flight date must survive reload");
  assert.equal(reloaded.bookings[0].currency, "XXX", "the no-currency marker must survive reload");
}

// ---- case 4: a persistence failure returns the stable code, never raw DB text ----
{
  const { supabase, ctx } = makeDb({ tripCurrency: "PHP" });
  ctx.failNextWrite = true;
  const result = await wallet.createTripBooking({
    supabase, userId: "user-1", tripId: "trip-1",
    input: { bookingType: "activity", travelerConfirmed: false, sourceType: "manual", title: "Doomed save", startTime: "2026-11-10T09:00:00" }
  });
  assert.equal(result.error, "BOOKING_SAVE_FAILED", "write failures must map to the stable customer-safe code");
  assert.doesNotMatch(result.error, /null value in column|relation "roamly_bookings"/, "no raw database text may leave the writer");
}

console.log("manual-booking-save: activity/hotel/flight persist + reload OK; unknown currency resolved (trip, else XXX); no invented price; failures map to BOOKING_SAVE_FAILED");
