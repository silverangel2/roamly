// U2 price-preservation proof (baseline live E2E audit 2026-10-24): a traveler
// re-saving a booking WITHOUT a price must NOT wipe its stored price. The
// live defect: activity saved with USD 45, re-saved matched by title+start
// without a price, came back total_price null + currency XXX. Root cause:
// createTripBooking's matched-update path wrote normalizeTripBookingInput's
// output verbatim, and the normalizer turns an omitted price into null and
// an omitted currency into "XXX". Fix: on update, omitted money fields
// preserve the stored values (same omitted-vs-explicit rule B06 fixed for
// segments); only an explicit, valid value replaces. There is no clear-price
// signal in the API, so explicit null preserves too; explicit zero replaces
// with zero (B14 rule). Runs the REAL createTripBooking / listTripBookings
// from lib/roamly/bookingWallet.ts (transpiled, sandboxed like
// roamly-core-checks.mjs) against an in-memory Supabase stand-in.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- source-contract assertions: the fix must be wired into the update ----
const walletSource = read("lib/roamly/bookingWallet.ts");
assert.match(walletSource, /preserveOmittedMoneyFieldsOnUpdate/, "update path must route through the money-preservation helper");
assert.match(walletSource, /\.\.\.updatePayload/, "matched update must write the preserved payload, not the raw normalized booking");
assert.match(walletSource, /no clear-price signal/i, "the no-clear-signal rule must be documented at the helper");

// ---- in-memory Supabase stand-in ----
function makeDb() {
  const trips = [{ id: "trip-1", user_id: "user-1" }];
  const bookings = [];
  const ctx = { seq: 0, lastInsert: null, lastUpdate: null, rpcCalls: [] };

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
      ctx.lastInsert = this.payload;
      const row = {
        id: `booking-${++ctx.seq}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload
      };
      bookings.push(row);
      return { data: row, error: null };
    }
    doUpdate() {
      ctx.lastUpdate = this.payload;
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

// INTEGRATION NOTE: the merged wallet also imports two pure, import-free
// modules these single-PR sandboxes never stubbed: bookingDateTime (#88)
// and bookingCorrections (#90). Load the REAL files (never a
// re-implementation) so the suites keep testing real code.
function loadRealTs(relativePath) {
  const compiledReal = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sb = {
    exports: {},
    module: { exports: {} },
    console,
    require(id) { throw new Error(`unexpected require(${id}) while loading ${relativePath}`); }
  };
  sb.exports = sb.module.exports;
  vm.runInNewContext(compiledReal, sb);
  return sb.module.exports;
}
const realBookingDateTime = loadRealTs("lib/roamly/bookingDateTime.ts");
const realBookingCorrections = loadRealTs("lib/roamly/bookingCorrections.ts");

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
    if (id === "@/lib/roamly/bookingDateTime") return realBookingDateTime;
    if (id === "@/lib/roamly/bookingCorrections") return realBookingCorrections;
    return require(id);
  }
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox);
const wallet = sandbox.module.exports;

async function save(supabase, input) {
  const result = await wallet.createTripBooking({ supabase, userId: "user-1", tripId: "trip-1", input });
  assert.equal(result.error, null, `save must succeed, got ${result.error}`);
  return result;
}

async function reload(supabase) {
  const reloaded = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1" });
  assert.equal(reloaded.error, null);
  assert.equal(reloaded.bookings.length, 1, "exactly one booking must exist after re-save (no duplicate row)");
  return reloaded.bookings[0];
}

// ---- case 1: the audit's exact case — USD 45 activity, title+start re-save, no price ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Intramuros walk", startTime: "2026-11-10T09:00:00", address: "Manila",
    totalPrice: 45, currency: "USD"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Intramuros walk", startTime: "2026-11-10T09:00:00", address: "Manila"
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 45, "audit case: USD 45 must survive a priceless title+start re-save");
  assert.equal(row.currency, "USD", "audit case: currency must survive, never reset to XXX");
  assert.equal(ctx.lastUpdate.total_price, 45, "update payload must carry the preserved price");
  assert.equal(ctx.lastUpdate.amount_cents, 4500, "update payload must carry the preserved minor-unit twin");
  assert.equal(ctx.lastUpdate.currency, "USD", "update payload must carry the preserved currency");
}

// ---- case 2: re-save by confirmation (audit change probe shape), no price ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "City tour", confirmationCode: "E2EBASE1",
    startTime: "2026-11-11T10:00:00", totalPrice: 120, currency: "EUR"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "City tour (edited)", confirmationCode: "E2EBASE1",
    startTime: "2026-11-11T10:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 120, "confirmation re-save: price must survive");
  assert.equal(row.currency, "EUR", "confirmation re-save: currency must survive");
  assert.equal(row.title, "City tour (edited)", "confirmation re-save: the edit itself must still apply");
}

// ---- case 3: explicit new price replaces; omitted currency preserves ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Museum", startTime: "2026-11-12T09:00:00", totalPrice: 45, currency: "USD"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Museum", startTime: "2026-11-12T09:00:00", totalPrice: 60
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 60, "explicit new price must replace");
  assert.equal(ctx.lastUpdate.amount_cents, 6000, "minor-unit twin must follow the new price");
  assert.equal(row.currency, "USD", "omitted currency must preserve while the price replaces");
}

// ---- case 4: explicit zero stays zero (B14 rule), never wiped, never fallback ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Free walk", startTime: "2026-11-13T09:00:00", totalPrice: 45, currency: "USD"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Free walk", startTime: "2026-11-13T09:00:00", totalPrice: 0
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 0, "explicit zero must be stored, not wiped");
  assert.equal(ctx.lastUpdate.amount_cents, 0, "explicit zero minor units must be 0");
  assert.equal(row.currency, "USD", "currency must preserve alongside an explicit zero");
}

// ---- case 5: explicit null is NOT a clear signal — it preserves ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Park visit", startTime: "2026-11-14T09:00:00", totalPrice: 45, currency: "USD"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Park visit", startTime: "2026-11-14T09:00:00", totalPrice: null, currency: null
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 45, "explicit null must preserve (no clear-price signal exists)");
  assert.equal(row.currency, "USD", "explicit null currency must preserve, never XXX");
}

// ---- case 6: currency-only change replaces currency, preserves price ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Harbor cruise", startTime: "2026-11-15T09:00:00", totalPrice: 45, currency: "USD"
  });
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Harbor cruise", startTime: "2026-11-15T09:00:00", currency: "EUR"
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, 45, "currency-only re-save must preserve the price");
  assert.equal(row.currency, "EUR", "explicit currency must replace");
}

// ---- case 7: creates are untouched — no price still stores null + XXX ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
    title: "Brand new", startTime: "2026-11-16T09:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.total_price, null, "create without price must still store null (no invented price)");
  assert.equal(row.currency, "XXX", "create without currency must still fall back to XXX");
}

// ---- case 8: confirmed-row guard still holds (pre-existing behavior) ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "activity", travelerConfirmed: true, sourceType: "manual",
    title: "Confirmed tour", startTime: "2026-11-17T09:00:00", totalPrice: 99, currency: "USD"
  });
  const result = await wallet.createTripBooking({
    supabase, userId: "user-1", tripId: "trip-1",
    input: {
      bookingType: "activity", travelerConfirmed: false, sourceType: "manual",
      title: "Confirmed tour", startTime: "2026-11-17T09:00:00"
    }
  });
  assert.equal(result.error, null);
  assert.equal(result.created, false, "confirmed row re-save must not create a duplicate");
  const row = await reload(supabase);
  assert.equal(row.total_price, 99, "confirmed row price must be untouched by an unconfirmed re-save");
  assert.equal(row.currency, "USD");
}

console.log("u2-price-preservation: audit case + confirmation re-save + explicit replace + explicit zero + explicit null + currency-only + create + confirmed guard OK");
