import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  const hasKnownExtension = (file) => /\.(?:json|ts|mjs)$/.test(file);
  function load(file) {
    const absolute = path.join(root, file);
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

const { getConfirmedBookingCostCents } = loadTsModule("lib/roamly/bookings.ts");
const { buildGroundedDecisionCore } = loadTsModule("lib/roamly/candidateDecisionCore.ts");
const { buildBudgetPresentation } = loadTsModule("lib/roamly/budgetPresentation.ts");
const { deriveTripReadiness } = loadTsModule("lib/roamly/tripReadiness.ts");
const { discoverTripPrices, discoveryToDatabaseRow } = loadTsModule("lib/roamly/priceDiscovery.ts");

function query(rows, error = null) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    is() { return chain; },
    neq() { return chain; },
    then(resolve) {
      const filtered = Array.isArray(rows)
        ? rows.filter((row) => {
            const conditions = chain.conditions || [];
            return conditions.every((condition) => condition(row));
          })
        : rows;
      return Promise.resolve(resolve({ data: filtered, error }));
    },
    conditions: []
  };
  chain.eq = (_column, value) => { chain.conditions.push((row) => row[_column] === undefined || row[_column] === value); return chain; };
  chain.is = (_column, value) => { chain.conditions.push((row) => row[_column] === undefined || (value === null ? row[_column] == null : row[_column] === value)); return chain; };
  chain.neq = (_column, value) => { chain.conditions.push((row) => row[_column] === undefined || row[_column] !== value); return chain; };
  return { from() { return chain; } };
}

const baseInput = {
  userId: "u",
  tripId: "t",
  destination: "Montreal",
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  daysCount: 4,
  travelersCount: 1,
  budgetAmount: 10000,
  budgetCurrency: "CAD",
  budgetIncludesFlights: true,
  budgetIncludesHotel: true,
  budgetIncludesActivities: true,
  marketResults: []
};

const known = await getConfirmedBookingCostCents(query([{ amount_cents: 80000, currency: "CAD" }]), "u", "t", "CAD");
assert.equal(known.status, "known_compatible");
assert.equal(known.amountCents, 80000);

const mismatch = await getConfirmedBookingCostCents(query([{ amount_cents: 150000, currency: "USD" }]), "u", "t", "CAD");
assert.equal(mismatch.status, "currency_mismatch");
assert.equal(mismatch.amountCents, null);
assert.equal(mismatch.knownAmountCents, 0);

const multiCurrency = await getConfirmedBookingCostCents(query([
  { amount_cents: 50000, currency: "CAD" },
  { amount_cents: 70000, currency: "USD" },
  { amount_cents: 10000, currency: "CAD" }
]), "u", "t", "CAD");
assert.equal(multiCurrency.status, "currency_mismatch");
assert.equal(multiCurrency.amountCents, null);
assert.equal(multiCurrency.knownAmountCents, 60000, "only known CAD evidence is retained as the CAD subtotal");
assert.equal(JSON.stringify(multiCurrency.currencies), JSON.stringify(["CAD", "USD"]));

const unknownAmount = await getConfirmedBookingCostCents(query([{ amount_cents: null, currency: "CAD" }]), "u", "t", "CAD");
assert.equal(unknownAmount.status, "unknown_amount");
assert.equal(unknownAmount.amountCents, null);

const unknownCurrency = await getConfirmedBookingCostCents(query([{ amount_cents: 80000, currency: null }]), "u", "t", "CAD");
assert.equal(unknownCurrency.status, "unknown_currency");
assert.equal(unknownCurrency.amountCents, null);

const zero = await getConfirmedBookingCostCents(query([{ amount_cents: 0, currency: "CAD" }]), "u", "t", "CAD");
assert.equal(zero.status, "known_compatible");
assert.equal(zero.amountCents, 0);

const filtered = await getConfirmedBookingCostCents(query([
  { amount_cents: 80000, currency: "CAD", booking_status: "cancelled" },
  { amount_cents: 70000, currency: "CAD", superseded_by_booking_id: "successor" },
  { amount_cents: 50000, currency: "CAD", booking_status: "paid", superseded_by_booking_id: null }
]), "u", "t", "CAD");
assert.equal(filtered.amountCents, 50000, "cancelled and superseded bookings are excluded from monetary truth");

const queryError = await getConfirmedBookingCostCents(query(null, new Error("temporary database failure")), "u", "t", "CAD");
assert.equal(queryError.status, "query_error");
assert.equal(queryError.amountCents, null);

const partial = await getConfirmedBookingCostCents(query([
  { amount_cents: 80000, currency: "CAD" },
  { amount_cents: null, currency: "CAD" }
]), "u", "t", "CAD");
assert.equal(partial.status, "unknown_amount");
assert.equal(partial.amountCents, null);
assert.equal(partial.knownAmountCents, 80000);

const knownDiscovery = await discoverTripPrices({ ...baseInput, committedBookingCost: known });
assert.equal(knownDiscovery.committedBudgetCents, 80000);
assert.equal(knownDiscovery.budgetStatus, "within_budget");

const uncertainDiscovery = await discoverTripPrices({ ...baseInput, committedBookingCost: partial });
assert.equal(uncertainDiscovery.committedBudgetCents, null);
assert.equal(uncertainDiscovery.committedBookingKnownCents, 80000);
assert.equal(uncertainDiscovery.budgetStatus, "unknown");
assert.equal(uncertainDiscovery.remainingBudgetCents, null);
const persisted = discoveryToDatabaseRow(uncertainDiscovery, baseInput);
assert.equal(persisted.committed_budget_cents, 80000, "persisted required subtotal preserves known evidence");
assert.equal(persisted.remaining_budget_cents, null);
assert.equal(persisted.metadata.committed_booking_status, "unknown_amount");
assert.equal(JSON.stringify(persisted.metadata.committed_booking_currencies), JSON.stringify(["CAD"]));
const repeatedDiscovery = await discoverTripPrices({ ...baseInput, committedBookingCost: { ...unknownAmount, knownAmountCents: 80000 } });
assert.deepEqual(
  [repeatedDiscovery.committedBudgetCents, repeatedDiscovery.committedBookingCostStatus, repeatedDiscovery.remainingBudgetCents, repeatedDiscovery.budgetStatus],
  [uncertainDiscovery.committedBudgetCents, uncertainDiscovery.committedBookingCostStatus, uncertainDiscovery.remainingBudgetCents, uncertainDiscovery.budgetStatus]
);

const candidate = (currency, amount = 100) => ({
  id: `${currency}-${amount}`,
  category: "hotel",
  title: "Hotel",
  provider: "provider",
  source: "provider",
  currency,
  price_type: "live_partner",
  price_amount: amount,
  booking_url: "https://example.test/hotel",
  searched_at: "2026-09-12T00:00:00.000Z",
  start_date: "2026-10-10",
  end_date: "2026-10-14",
  metadata: { providerPayload: {} }
});
const decision = buildGroundedDecisionCore({
  payload: { ...baseInput, origin: "YFC", travelStyle: "Balanced", interests: [], pace: "Balanced", accommodationPreference: "No preference", transportationPreference: "Mixed", specialNotes: "" },
  marketResults: [candidate("CAD")],
  confirmedBookings: [{ booking_type: "hotel", title: "Booked hotel", amount_cents: 150000, currency: "USD", provider_name: "Gmail" }]
});
assert.equal(decision.budgetLedger.status, "BUDGET_UNCERTAIN");
assert.equal(decision.budgetLedger.remaining, null);
assert.equal(decision.budgetLedger.knownTotal, 0, "incompatible confirmed money is not summed as CAD");

const breakdown = {
  lodging: "CAD 800",
  food: "CAD 300",
  activities: "CAD 200",
  transport: "CAD 400",
  buffer: "CAD 100",
  total_estimate: "CAD 1,800",
  notes: "",
  budget_status: "unknown",
  committed_bookings_amount: null,
  budget_category_confidence: []
};
const presentation = buildBudgetPresentation({
  budgetAmount: 2000,
  currency: "CAD",
  totalEstimateAmount: 1800,
  breakdown,
  priceDiscovery: {
    unknownMarketPriceCount: 1,
    unknownMarketPriceCategories: ["confirmed booking monetary truth"],
    committed_booking_status: "currency_mismatch"
  },
  confirmedBookingCount: 1
});
assert.equal(presentation.status, "BUDGET_UNCERTAIN");
assert.equal(presentation.remainingLabel, null);
assert.ok(presentation.uncertainty.some((item) => item.includes("confirmed booking")));

const readiness = deriveTripReadiness({ tripId: "t", startDate: "2026-10-10", endDate: "2026-10-14", generationStatus: "complete", hasItinerary: true, budgetStatus: "BUDGET_UNCERTAIN" });
assert.equal(readiness.state, "UNCERTAIN");

console.log("Confirmed booking monetary truth checks passed.");
