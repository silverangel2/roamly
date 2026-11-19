// Step 4 confirmation-code preservation proof (§3.3.4): a traveler
// re-saving a booking WITHOUT a confirmation code (or provider booking id)
// must NOT wipe the stored code. The live defect: a hotel saved with code
// HFX8842, re-saved matched by title+start without a code, came back
// confirmation_number null. Root cause: createTripBooking's matched-update
// path wrote normalizeTripBookingInput's output verbatim, and the normalizer
// turns an omitted code/id into null. Fix: on update, an omitted
// confirmation_number / provider_booking_id preserves the stored value
// (the same omitted-vs-explicit rule U2 fixed for money); only an explicit
// value replaces it. There is no clear-code signal in the API, so explicit
// null preserves too. The F4 guard (both codes present and differing →
// refuse the match) is unchanged and still covered here. The Gmail-revision
// RPC itself needs no change: it applies the patch with coalesce, so a null
// patch value keeps the stored code — but the TS-side revision patch now
// preserves the stored code too, so changed_fields no longer falsely
// records the code as changed. Runs the REAL createTripBooking /
// listTripBookings from lib/roamly/bookingWallet.ts (transpiled, sandboxed
// like roamly-u2-price-preservation-checks.mjs) against an in-memory
// Supabase stand-in.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- source-contract assertions: the fix must be wired into the update ----
const walletSource = read("lib/roamly/bookingWallet.ts");
assert.match(walletSource, /preserveOmittedMoneyFieldsOnUpdate/, "update path must route through the omitted-preserves helper");
assert.match(walletSource, /\.\.\.updatePayload/, "matched update must write the preserved payload, not the raw normalized booking");
assert.match(
  walletSource,
  /next\.confirmation_number =\s*\n?\s*booking\.confirmation_number \?\? textValue\(previous\.confirmation_number\)/,
  "matched update must preserve the stored confirmation code when the input omits it"
);
assert.match(
  walletSource,
  /next\.provider_booking_id =\s*\n?\s*booking\.provider_booking_id \?\? textValue\(previous\.provider_booking_id\)/,
  "matched update must preserve the stored provider booking id when the input omits it"
);
assert.match(walletSource, /no clear-code signal/i, "the no-clear-code rule must be documented at the helper");

// ---- the Gmail-revision RPC must keep the stored code on a null patch ----
// (read, not run: the RPC is SQL; the coalesce is the guarantee).
const migration = read("supabase/migrations/20260908_roamly_gmail_booking_reconciliation.sql");
assert.match(
  migration,
  /confirmation_number = coalesce\(p_booking_patch->>'confirmation_number', b\.confirmation_number\)/,
  "RPC must coalesce a null patch confirmation_number to the stored value"
);
assert.match(
  migration,
  /provider_booking_id = coalesce\(p_booking_patch->>'provider_booking_id', b\.provider_booking_id\)/,
  "RPC must coalesce a null patch provider_booking_id to the stored value"
);

// ---- in-memory Supabase stand-in (same shape as the U2 suite) ----
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
          if (av > bv) return opts?.ascending === false ? 1 : 1;
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
      if (name === "roamly_apply_gmail_booking_revision") {
        // Stand-in for the SQL function: it applies the patch with
        // coalesce (null patch values keep the stored row), exactly as
        // the migration does, and reports the revision applied.
        const row = bookings.find((b) => b.id === args.p_booking_id);
        if (row) {
          for (const [k, v] of Object.entries(args.p_booking_patch || {})) {
            if (v !== null && v !== undefined) row[k] = v;
          }
        }
        return {
          data: [{ applied: true, duplicate: false, stale: false, needs_review: false, reconciliation_version: 1 }],
          error: null
        };
      }
      return { data: null, error: null };
    }
  };
  return { supabase, bookings, ctx };
}

// Load the REAL wallet (never a re-implementation), same as the U2 suite.
function loadRealTs(relativePath) {
  const compiledReal = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sb = {
    exports: {},
    module: { exports: {} },
    console,
    require(id) {
      if (id === "@/lib/roamly/testBooking") return loadRealTs("lib/roamly/testBooking.ts");
      throw new Error(`unexpected require(${id}) while loading ${relativePath}`);
    }
  };
  sb.exports = sb.module.exports;
  vm.runInNewContext(compiledReal, sb);
  return sb.module.exports;
}
const realBookingDateTime = loadRealTs("lib/roamly/bookingDateTime.ts");
const realBookingCorrections = loadRealTs("lib/roamly/bookingCorrections.ts");
const realBookingTruth = loadRealTs("lib/roamly/bookingTruth.ts");
const realBookingNotificationWithdrawal = loadRealTs("lib/roamly/bookingNotificationWithdrawal.ts");

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
    if (id === "@/lib/roamly/bookingTruth") return realBookingTruth;
    if (id === "@/lib/roamly/bookingNotificationWithdrawal") return realBookingNotificationWithdrawal;
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

async function reloadAll(supabase) {
  const reloaded = await wallet.listTripBookings({ supabase, userId: "user-1", tripId: "trip-1" });
  assert.equal(reloaded.error, null);
  return reloaded.bookings;
}

// ---- case (a): the step-4 defect — code-less title+start re-save must preserve code + provider id ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-101", confirmationCode: "HFX8842",
    title: "Harbor Hotel", startTime: "2026-11-20T15:00:00", address: "Pier 1",
    totalPrice: 180, currency: "USD"
  });
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda",
    title: "Harbor Hotel", startTime: "2026-11-20T15:00:00", address: "Pier 2"
  });
  const row = await reload(supabase);
  assert.equal(row.confirmation_code, "HFX8842", "code-less re-save must preserve the stored confirmation code");
  assert.equal(row.provider_booking_id, "PB-101", "code-less re-save must preserve the stored provider booking id");
  assert.equal(ctx.lastUpdate.confirmation_number, "HFX8842", "update payload must carry the preserved code");
  assert.equal(ctx.lastUpdate.provider_booking_id, "PB-101", "update payload must carry the preserved provider id");
  assert.equal(row.total_price, 180, "money preserve (U2) must still hold in the same save");
  assert.equal(row.address, "Pier 2", "the edit itself must still apply");
}

// ---- case (b1): matched by provider id, a NEW code still replaces the old one ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-201", confirmationCode: "OLD123",
    title: "Bay Hotel", startTime: "2026-11-21T15:00:00"
  });
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-201", confirmationCode: "NEW456",
    title: "Bay Hotel (edited)", startTime: "2026-11-21T15:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.confirmation_code, "NEW456", "an explicitly supplied code must replace the stored one");
  assert.equal(row.provider_booking_id, "PB-201", "the matching provider id must stay");
}

// ---- case (b2): matched by confirmation code, a NEW provider id still replaces the old one ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-301", confirmationCode: "KEEP777",
    title: "Cliff Hotel", startTime: "2026-11-22T15:00:00"
  });
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-302", confirmationCode: "KEEP777",
    title: "Cliff Hotel (edited)", startTime: "2026-11-22T15:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.provider_booking_id, "PB-302", "an explicitly supplied provider id must replace the stored one");
  assert.equal(row.confirmation_code, "KEEP777", "the matching code must stay");
}

// ---- case (c): code-less stored row + incoming code via title+start → the code lands ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda",
    title: "Dune Hotel", startTime: "2026-11-23T15:00:00"
  });
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", confirmationCode: "FIRST999",
    title: "Dune Hotel", startTime: "2026-11-23T15:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.confirmation_code, "FIRST999", "a code supplied against a code-less row must be stored");
}

// ---- case (d): F4 guard — both codes present and differing → refuse the match ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", confirmationCode: "AAA111",
    title: "Palm Hotel", startTime: "2026-11-24T15:00:00"
  });
  const second = await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", confirmationCode: "BBB222",
    title: "Palm Hotel", startTime: "2026-11-24T15:00:00"
  });
  assert.equal(second.created, true, "a differing-code re-save must insert, never overwrite");
  const rows = await reloadAll(supabase);
  assert.equal(rows.length, 2, "F4 refusal must leave two rows, not one overwritten row");
  const codes = rows.map((r) => r.confirmation_code).sort();
  assert.deepEqual(codes, ["AAA111", "BBB222"], "the original code must be untouched and the new code stored on its own row");
}

// ---- case (e): explicit null is NOT a clear signal — it preserves ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-401", confirmationCode: "NULL555",
    title: "Reef Hotel", startTime: "2026-11-25T15:00:00", address: "Reef Road 1"
  });
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: null, confirmationCode: null,
    title: "Reef Hotel", startTime: "2026-11-25T15:00:00", address: "Reef Road 2"
  });
  const row = await reload(supabase);
  assert.equal(row.confirmation_code, "NULL555", "explicit null code must preserve (no clear-code signal exists)");
  assert.equal(row.provider_booking_id, "PB-401", "explicit null provider id must preserve");
  assert.equal(ctx.lastUpdate.confirmation_number, "NULL555", "update payload must carry the preserved code on explicit null");
  assert.equal(row.address, "Reef Road 2", "the edit itself must still apply");
}

// ---- case (f): Gmail-revision path — a code-less revision keeps the code and the record honest ----
{
  const { supabase, ctx } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-501", confirmationCode: "REV888",
    title: "Coral Hotel", startTime: "2026-11-26T15:00:00", address: "Coral Street 1"
  });
  const result = await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda", providerBookingId: "PB-501",
    title: "Coral Hotel (revised)", startTime: "2026-11-26T15:00:00",
    reconciliation: {
      connectionId: "conn-1",
      sourceMessageId: "msg-1",
      sourceEventAt: "2026-11-26T10:00:00Z",
      decision: "applied"
    }
  });
  // The success return carries no reconciliation field; the revision
  // having applied is proven by the stored row itself: on this path the
  // RPC is the ONLY writer, so the revised title reaching the row means
  // the revision applied (a refused/stale revision returns early). The
  // match rides on the provider id so the revision can omit the code
  // while still editing the title (a title edit would break a
  // title+start match).
  assert.equal(result.error, null);
  const revisionCall = ctx.rpcCalls.find((c) => c.name === "roamly_apply_gmail_booking_revision");
  assert.ok(revisionCall, "the revision must go through the RPC");
  assert.equal(
    revisionCall.args.p_booking_patch.confirmation_number,
    "REV888",
    "the revision patch must carry the stored code when the revision omits it"
  );
  assert.equal(
    revisionCall.args.p_booking_patch.provider_booking_id,
    "PB-501",
    "the revision patch must carry the stored provider id when the revision omits it"
  );
  assert.ok(
    !revisionCall.args.p_changed_fields.includes("confirmation_number"),
    "changed_fields must not falsely list the code as changed"
  );
  assert.ok(
    !revisionCall.args.p_changed_fields.includes("provider_booking_id"),
    "changed_fields must not falsely list the provider id as changed"
  );
  assert.ok(
    revisionCall.args.p_changed_fields.includes("title"),
    "changed_fields must still record the real change (the title edit)"
  );
  const row = await reload(supabase);
  assert.equal(row.title, "Coral Hotel (revised)", "the revised title reaching the row proves the revision applied (the RPC is the only writer on this path)");
  assert.equal(row.confirmation_code, "REV888", "the stored code must survive the revision");
  assert.equal(row.provider_booking_id, "PB-501", "the stored provider id must survive the revision");
}

// ---- case (g): creates are untouched — no code still stores null ----
{
  const { supabase } = makeDb();
  await save(supabase, {
    bookingType: "hotel", travelerConfirmed: false, sourceType: "manual",
    provider: "Agoda",
    title: "Brand new hotel", startTime: "2026-11-27T15:00:00"
  });
  const row = await reload(supabase);
  assert.equal(row.confirmation_code, null, "create without a code must still store null (no invented code)");
  assert.equal(row.provider_booking_id, null, "create without a provider id must still store null");
}

console.log("confirmation-code-preservation: code-less re-save preserves + explicit replace + code-less landing + F4 refusal + explicit null + revision patch + create OK");
