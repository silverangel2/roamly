// roamly-discovery-persistence-checks.mjs — DISCOVERY PERSISTENCE
// (2026-11-11 fix; ROOT-CAUSE in goals/roamly-october-4-repair/
// hidden_files/discovery-persistence/ROOT-CAUSE.md).
//
// The defect: since the 2026-10-22 zero-engine cutover, engine
// generations never ran the price-discovery segment — no discovery
// was saved, latest_price_discovery_id stayed NULL, and transport /
// stay selection 409'd on every real trip. The fix runs the
// incumbent's segment (extracted verbatim into
// lib/roamly/generationDiscovery.ts) from BOTH context preps, and
// makes save failures loud at all three formerly-unchecked sites.
//
// Pins, against an in-memory fake Supabase (no network: provider env
// scrubbed, fetch stubbed to a 503 so any provider attempt degrades
// to link-only results exactly as an unconfigured provider does):
//   - ENGINE prep: saves a discovery (insert payload carries the
//     discoveryToDatabaseRow shape), links the trip, threads id +
//     discovery + budget constraint into the initial state;
//   - INCUMBENT prep: same save + link via the shared helper, its
//     own context fields unchanged in shape;
//   - CARRY-FORWARD: a stored transport pick on the trip's discovery
//     survives a re-generation prep (stamp on the newly saved row);
//   - LOUD FAILURE, both preps: a forced insert error returns a
//     saveFailure (never a silent null), is diagnostic-logged with
//     the trip id, and lands on the generation state as
//     priceDiscoverySaveError; a successful prep leaves NO such key
//     on the state;
//   - REFRESH: success still returns the saved id and applies the
//     itinerary; a forced save failure throws PriceDiscoverySaveError
//     and NOTHING is applied or synced from the unsaved discovery;
//   - STATIC wiring: the market-search route converts that throw to
//     502 PRICE_DISCOVERY_SAVE_FAILED (selection routes' shape), the
//     staged start maps the failure onto the state, the engine prep
//     calls the shared helper.
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     --import ./scripts/roamly-test-server-only-register.mjs \
//     scripts/roamly-discovery-persistence-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Hermetic: no admin client, no provider keys — the market search
// must take its unconfigured, link-only path in this suite.
for (const key of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TRAVELPAYOUTS_TOKEN",
  "TRAVELPAYOUTS_API_TOKEN",
  "STAY22_API_KEY",
  "FIRECRAWL_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "OPENAI_API_KEY",
  "AMADEUS_API_KEY",
  "AMADEUS_API_SECRET",
  "DUFFEL_API_KEY"
]) delete process.env[key];

// Any provider fetch attempt degrades deterministically.
globalThis.fetch = async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } });

// Capture generation diagnostics (logGenerationDiagnostic -> console.info).
const diagnostics = [];
const originalInfo = console.info;
console.info = (...args) => {
  if (args[0] === "[Roamly generation trace]") diagnostics.push(args[1]);
  // stay quiet otherwise; the market module logs cache notes
};

const stagedLib = await import("../lib/roamly/stagedItineraryGeneration.ts");
const engineLib = await import("../lib/roamly/engine/generate.ts");
const refreshLib = await import("../lib/roamly/marketPriceRefresh.ts");
const discoveryLib = await import("../lib/roamly/priceDiscovery.ts");
const { discoveryToDatabaseRow } = discoveryLib;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    originalInfo(`ok ${passed + failed} - ${name}`);
  } catch (err) {
    failed++;
    originalInfo(`not ok ${passed + failed} - ${name}`);
    originalInfo(`  ${String((err && err.message) || err).split("\n").join("\n  ")}`);
  }
}

/* ---------------- fake Supabase (chainable, thenable) ---------------- */
let seq = 0;
function createFakeSupabase({ tables = {}, failInserts = new Set(), ops = [] } = {}) {
  function matches(row, filters) {
    return filters.every(([col, val]) => {
      if (col.startsWith("neq:")) return row[col.slice(4)] !== val;
      if (col.startsWith("is:")) return (row[col.slice(3)] ?? null) === val;
      if (col.startsWith("in:")) return val.includes(row[col.slice(3)]);
      if (col.startsWith("gt:")) return row[col.slice(3)] > val;
      return row[col] === val;
    });
  }
  function builder(table) {
    const st = { table, mode: "select", filters: [], payload: null, single: false, maybeSingle: false, limitN: null, afterSelect: false, conflict: null };
    const b = {
      select() { if (st.mode !== "select") st.afterSelect = true; return b; },
      insert(row) { st.mode = "insert"; st.payload = row; return b; },
      upsert(row, opts) { st.mode = "upsert"; st.payload = row; st.conflict = (opts && opts.onConflict) || "trip_id"; return b; },
      update(patch) { st.mode = "update"; st.payload = patch; return b; },
      delete() { st.mode = "delete"; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      neq(c, v) { st.filters.push([`neq:${c}`, v]); return b; },
      is(c, v) { st.filters.push([`is:${c}`, v]); return b; },
      in(c, v) { st.filters.push([`in:${c}`, v]); return b; },
      gt(c, v) { st.filters.push([`gt:${c}`, v]); return b; },
      order() { return b; },
      limit(n) { st.limitN = n; return b; },
      single() { st.single = true; return exec(); },
      maybeSingle() { st.maybeSingle = true; return exec(); },
      then(res, rej) { return exec().then(res, rej); }
    };
    async function exec() {
      const rows = (tables[table] ||= []);
      if (st.mode === "insert") {
        ops.push({ table, op: "insert", payload: st.payload });
        if (failInserts.has(table)) return { data: null, error: { message: `forced insert failure on ${table}` } };
        const payloadRows = Array.isArray(st.payload) ? st.payload : [st.payload];
        const inserted = payloadRows.map((p) => {
          const row = { ...p, id: p.id || `fake-${table}-${++seq}` };
          rows.push(row);
          return row;
        });
        if (st.single) return inserted[0] ? { data: inserted[0], error: null } : { data: null, error: { message: "Results contain 0 rows" } };
        return { data: inserted, error: null };
      }
      if (st.mode === "upsert") {
        ops.push({ table, op: "upsert", payload: st.payload });
        const key = st.conflict.split(",")[0].trim();
        const payloadRows = Array.isArray(st.payload) ? st.payload : [st.payload];
        const upserted = payloadRows.map((p) => {
          const idx = rows.findIndex((r) => r[key] === p[key]);
          const row = { ...p, id: (idx >= 0 && rows[idx].id) || p.id || `fake-${table}-${++seq}` };
          if (idx >= 0) rows[idx] = row; else rows.push(row);
          return row;
        });
        if (st.single) return upserted[0] ? { data: upserted[0], error: null } : { data: null, error: { message: "Results contain 0 rows" } };
        return { data: upserted, error: null };
      }
      if (st.mode === "update") {
        ops.push({ table, op: "update", payload: st.payload });
        const hit = rows.filter((r) => matches(r, st.filters));
        for (const r of hit) Object.assign(r, st.payload);
        if (st.maybeSingle) return { data: hit[0] || null, error: null };
        if (st.single) return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: "Results contain 0 rows" } };
        return { data: null, error: null };
      }
      if (st.mode === "delete") { ops.push({ table, op: "delete" }); return { data: null, error: null }; }
      ops.push({ table, op: "select" });
      let out = rows.filter((r) => matches(r, st.filters));
      if (st.limitN) out = out.slice(0, st.limitN);
      if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: "Results contain 0 rows" } };
      if (st.maybeSingle) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    return b;
  }
  return { from: (t) => builder(t), __tables: tables, __ops: ops };
}

/* ---------------- fixtures ---------------- */
const USER = "user-fixture-1";
function romePayload(tripId) {
  return {
    tripType: "single_destination",
    origin: "Saint John",
    destination: "Rome, Italy",
    destinationCity: "Rome",
    destinationCountry: "Italy",
    startDate: "2027-03-10",
    endDate: "2027-03-14",
    daysCount: 5,
    travelersCount: 1,
    travelers: { adults: 1, children: 0, infants: 0 },
    rooms: 1,
    bedPreference: "No preference",
    budgetAmount: 2500,
    budgetCurrency: "CAD",
    budgetIncludesFlights: true,
    budgetIncludesHotel: true,
    budgetIncludesActivities: true,
    travelStyle: "Balanced",
    interests: ["history"],
    pace: "Balanced",
    walkingTolerance: "Medium",
    accommodationPreference: "Not sure",
    transportationPreference: "Mixed",
    accessibilityNeeds: "",
    dietaryPreference: "",
    specialNotes: "",
    language: "en",
    ...(tripId ? {} : {})
  };
}
function baseTables(tripId) {
  return {
    roamly_trips: [{ id: tripId, user_id: USER, latest_price_discovery_id: null, metadata: {}, status: "draft", updated_at: "2027-03-01T00:00:00.000Z" }],
    roamly_bookings: [],
    roamly_price_discoveries: []
  };
}

/* ---------------- engine prep: save + link + thread ---------------- */
await check("engine prep saves + links a discovery and threads it into the initial state", async () => {
  const tripId = "trip-engine-ok";
  const tables = baseTables(tripId);
  const ops = [];
  const fake = createFakeSupabase({ tables, ops });
  const payload = romePayload(tripId);
  const ctx = await engineLib.prepareEngineGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.equal(ctx.priceDiscoverySaveFailure, null);
  assert.ok(ctx.priceDiscoveryId, "context carries the saved discovery id");
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, ctx.priceDiscoveryId, "trip linked to the discovery");
  assert.equal(tables.roamly_price_discoveries.length, 1, "exactly one discovery row saved");
  const insert = ops.find((o) => o.table === "roamly_price_discoveries" && o.op === "insert");
  assert.ok(insert, "the prep attempted the discovery insert");
  const expectedRow = discoveryToDatabaseRow(ctx.priceDiscovery, { userId: USER, tripId, ...payload });
  assert.deepEqual(Object.keys(insert.payload).sort(), Object.keys(expectedRow).sort(), "insert payload carries the discoveryToDatabaseRow column shape");
  assert.equal(insert.payload.user_id, USER);
  assert.equal(insert.payload.trip_id, tripId);
  assert.ok(Array.isArray(insert.payload.metadata.transportOptions) && insert.payload.metadata.transportOptions.length > 0, "stored transport options exist for the selection routes to read");
  const state = engineLib.buildEngineInitialState({ tripId, payload, unlockSource: "free", requestId: "req-engine-ok", context: ctx });
  assert.equal(state.priceDiscoveryId, ctx.priceDiscoveryId, "state carries the discovery id");
  assert.ok(state.priceDiscovery && typeof state.priceDiscovery === "object", "state carries the discovery");
  assert.ok(typeof state.budgetConstraint === "string" && state.budgetConstraint.length > 0, "state carries the discovery-derived budget constraint");
  assert.ok(!("priceDiscoverySaveError" in state), "no save-error key on a successful state");
});

/* ---------------- incumbent prep: same segment, own shape ---------------- */
await check("incumbent prep saves + links via the shared helper, context shape unchanged", async () => {
  const tripId = "trip-staged-ok";
  const tables = baseTables(tripId);
  const ops = [];
  const fake = createFakeSupabase({ tables, ops });
  const payload = romePayload(tripId);
  const ctx = await stagedLib.prepareStagedGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.equal(ctx.priceDiscoverySaveFailure, null);
  assert.ok(ctx.priceDiscoveryId, "context carries the saved discovery id");
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, ctx.priceDiscoveryId, "trip linked");
  assert.equal(tables.roamly_price_discoveries.length, 1, "one discovery row saved");
  assert.ok(typeof ctx.budgetConstraint === "string" && ctx.budgetConstraint.length > 0, "budget constraint built");
  assert.ok(ctx.priceDiscovery && typeof ctx.priceDiscovery === "object", "discovery object returned");
  assert.ok(Array.isArray(ctx.confirmedBookings), "confirmed bookings flow as before");
  assert.ok(ctx.personalization && typeof ctx.personalization === "object", "personalization flows as before");
});

/* ---------------- carry-forward across a re-generation prep ---------------- */
await check("a stored transport pick survives a re-generation prep (carry-forward)", async () => {
  const tripId = "trip-carry";
  const tables = baseTables(tripId);
  const fake = createFakeSupabase({ tables, ops: [] });
  const payload = romePayload(tripId);
  const first = await engineLib.prepareEngineGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.ok(first.priceDiscoveryId);
  const row = tables.roamly_price_discoveries[0];
  const recommended = row.metadata.recommendedTransportOption;
  assert.ok(recommended && recommended.mode && recommended.title, "fixture discovery has a recommended transport option");
  const stamp = { mode: recommended.mode, title: recommended.title, selectedBy: "traveler" };
  row.metadata.transportSelection = stamp;
  if (row.source_summary && typeof row.source_summary === "object") row.source_summary.transportSelection = stamp;
  const second = await engineLib.prepareEngineGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.ok(second.priceDiscoveryId && second.priceDiscoveryId !== first.priceDiscoveryId, "re-generation saved a fresh discovery");
  assert.equal(tables.roamly_price_discoveries.length, 2, "two discovery rows after re-generation");
  const fresh = tables.roamly_price_discoveries.find((r) => r.id === second.priceDiscoveryId);
  assert.deepEqual(fresh.metadata.transportSelection, stamp, "the traveller's transport pick was carried onto the fresh discovery");
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, second.priceDiscoveryId, "trip re-pointed at the fresh discovery");
});

/* ---------------- loud failure: engine prep ---------------- */
await check("engine prep: a failed save surfaces (return + diagnostic + state), never a silent null", async () => {
  const tripId = "trip-engine-fail";
  const tables = baseTables(tripId);
  const fake = createFakeSupabase({ tables, failInserts: new Set(["roamly_price_discoveries"]), ops: [] });
  const payload = romePayload(tripId);
  diagnostics.length = 0;
  const ctx = await engineLib.prepareEngineGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.equal(ctx.priceDiscoveryId, null, "no id when the save failed (payload carried none)");
  assert.ok(ctx.priceDiscoverySaveFailure, "the failure is returned, not swallowed");
  assert.equal(ctx.priceDiscoverySaveFailure.tripId, tripId);
  assert.match(ctx.priceDiscoverySaveFailure.message, /forced insert failure/);
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, null, "trip not linked");
  const logged = diagnostics.find((d) => d && d.event === "price_discovery_save_failed" && d.tripId === tripId);
  assert.ok(logged, "a price_discovery_save_failed diagnostic was logged with the trip id");
  const state = engineLib.buildEngineInitialState({ tripId, payload, unlockSource: "free", requestId: "req-engine-fail", context: ctx });
  assert.ok(state.priceDiscoverySaveError, "the failure is recorded on the generation state");
  assert.equal(state.priceDiscoverySaveError.tripId, tripId);
  assert.match(state.priceDiscoverySaveError.message, /forced insert failure/);
  assert.ok(typeof state.priceDiscoverySaveError.at === "string" && state.priceDiscoverySaveError.at.length > 0, "state record is timestamped");
});

/* ---------------- loud failure: incumbent prep + staged state ---------------- */
await check("incumbent prep: a failed save surfaces and lands on the staged generation state", async () => {
  const tripId = "trip-staged-fail";
  const tables = baseTables(tripId);
  const fake = createFakeSupabase({ tables, failInserts: new Set(["roamly_price_discoveries"]), ops: [] });
  const payload = romePayload(tripId);
  diagnostics.length = 0;
  const ctx = await stagedLib.prepareStagedGenerationContext({ supabase: fake, userId: USER, tripId, payload });
  assert.equal(ctx.priceDiscoveryId, null);
  assert.ok(ctx.priceDiscoverySaveFailure, "failure returned on the context");
  assert.equal(ctx.priceDiscoverySaveFailure.tripId, tripId);
  assert.ok(diagnostics.some((d) => d && d.event === "price_discovery_save_failed" && d.tripId === tripId), "diagnostic logged");
  const state = await stagedLib.startStagedItineraryGeneration({
    supabase: fake, tripId, userId: USER, payload, requestId: "req-staged-fail", unlockSource: "free", context: ctx
  });
  assert.ok(state.priceDiscoverySaveError, "staged state records the save error");
  assert.equal(state.priceDiscoverySaveError.tripId, tripId);
  assert.match(state.priceDiscoverySaveError.message, /forced insert failure/);
});

/* ---------------- refresh: success path unchanged ---------------- */
function refreshTripFixture(tripId) {
  return {
    id: tripId,
    user_id: USER,
    origin: "Saint John",
    destination: "Rome, Italy",
    destination_city: "Rome",
    destination_country: "Italy",
    start_date: "2027-03-10",
    end_date: "2027-03-14",
    days_count: 5,
    travelers_count: 1,
    travel_style: "Balanced",
    interests: ["history"],
    accommodation_preference: "Not sure",
    transportation_preference: "Mixed",
    special_notes: "",
    budget_amount: 2500,
    budget_currency: "CAD",
    budget_includes_flights: true,
    budget_includes_hotel: true,
    latest_price_discovery_id: null,
    status: "generated",
    metadata: {}
  };
}
// The smallest full_json the refresh + itinerary sync accept: the
// sync reads packing_checklist / pre_trip_essentials /
// destination_summary unconditionally, as every real generated
// itinerary carries them.
const minimalItinerary = {
  full_json: {
    daily_itinerary: [],
    booking_suggestions: [],
    estimated_budget_breakdown: {},
    packing_checklist: [],
    pre_trip_essentials: [],
    destination_summary: ""
  }
};

await check("refresh: success still saves, links, applies and syncs", async () => {
  const tripId = "trip-refresh-ok";
  const tables = { ...baseTables(tripId), roamly_itineraries: [] };
  const ops = [];
  const fake = createFakeSupabase({ tables, ops });
  const trip = refreshTripFixture(tripId);
  tables.roamly_trips[0] = { ...trip };
  const refreshed = await refreshLib.refreshTripMarketPricesForTrip({ supabase: fake, userId: USER, tripId, trip, itinerary: minimalItinerary });
  assert.ok(refreshed.savedDiscovery.id, "refresh returns the saved discovery id");
  assert.equal(refreshed.savedDiscovery.error, null);
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, refreshed.savedDiscovery.id, "trip linked by the refresh");
  assert.ok(refreshed.updatedItinerary, "itinerary re-applied from the saved discovery");
  assert.ok(ops.some((o) => o.table === "roamly_itineraries" && o.op !== "select"), "itinerary sync wrote");
});

/* ---------------- refresh: loud failure ---------------- */
await check("refresh: a failed save throws PriceDiscoverySaveError and nothing is applied or synced", async () => {
  const tripId = "trip-refresh-fail";
  const tables = { ...baseTables(tripId), roamly_itineraries: [] };
  const ops = [];
  const fake = createFakeSupabase({ tables, failInserts: new Set(["roamly_price_discoveries"]), ops });
  const trip = refreshTripFixture(tripId);
  tables.roamly_trips[0] = { ...trip };
  let thrown = null;
  try {
    await refreshLib.refreshTripMarketPricesForTrip({ supabase: fake, userId: USER, tripId, trip, itinerary: minimalItinerary });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof refreshLib.PriceDiscoverySaveError, "the refresh throws PriceDiscoverySaveError");
  assert.equal(thrown.code, "PRICE_DISCOVERY_SAVE_FAILED");
  assert.match(thrown.message, /forced insert failure/);
  assert.ok(!ops.some((o) => o.table === "roamly_itineraries" && o.op !== "select"), "no itinerary write from an unsaved discovery");
  assert.ok(!ops.some((o) => o.table === "roamly_trips" && o.op === "update"), "trip not re-pointed or stamped");
  assert.equal(tables.roamly_trips[0].latest_price_discovery_id, null, "trip stays unlinked");
});

/* ---------------- static wiring ---------------- */
await check("static wiring: route 502 shape, staged state mapping, shared helper call sites", async () => {
  const route = readFileSync(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("instanceof PriceDiscoverySaveError"), "market-search route catches the save error by type");
  assert.ok(route.includes('"PRICE_DISCOVERY_SAVE_FAILED"') || route.includes("error: \"PRICE_DISCOVERY_SAVE_FAILED\""), "route names the failure plainly");
  assert.ok(route.includes("status: 502"), "route answers 502, the selection routes' shape");
  const staged = readFileSync(new URL("../lib/roamly/stagedItineraryGeneration.ts", import.meta.url), "utf8");
  assert.ok(staged.includes("prepareGenerationDiscovery"), "incumbent prep calls the shared helper");
  assert.ok(staged.includes("priceDiscoverySaveError"), "staged start maps the failure onto the state");
  const engine = readFileSync(new URL("../lib/roamly/engine/generate.ts", import.meta.url), "utf8");
  assert.ok(engine.includes("prepareGenerationDiscovery"), "engine prep calls the shared helper");
  const helper = readFileSync(new URL("../lib/roamly/generationDiscovery.ts", import.meta.url), "utf8");
  assert.ok(helper.includes("price_discovery_save_failed"), "helper logs the failure diagnostic");
  assert.ok(helper.includes("savePriceDiscovery"), "helper is the segment's save site");
});

console.info = originalInfo;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
