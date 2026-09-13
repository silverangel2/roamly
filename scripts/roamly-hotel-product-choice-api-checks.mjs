import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const route = await readFile("app/api/trips/[id]/hotel-product-choice/route.ts", "utf8");
const storage = await import("../lib/roamly/hotelProductChoiceStorage.ts");
const choiceDomain = await import("../lib/roamly/selectedHotelProductChoice.ts");

assert.match(route, /export const POST/);
assert.match(route, /export const GET/);
assert.match(route, /export const DELETE/);
assert.match(route, /requireUser\(\)/);
assert.match(route, /getTripBundle\(auth\.supabase, auth\.user\.id, id\)/);
assert.match(route, /loadSelectedHotelActionContext/);
assert.match(route, /revalidateSelectedHotelProduct/);
assert.match(route, /createHotelProductChoice/);
assert.match(route, /replacePendingHotelProductChoice/);
assert.match(await readFile("lib/roamly/hotelProductChoiceStorage.ts", "utf8"), /upsert\(row, \{ onConflict: "trip_id" \}/); // The storage helper owns the atomic upsert.
for (const forbidden of ["orders/preview", "orders/create", "orderToken", "paymentToken"]) assert.doesNotMatch(route, new RegExp(forbidden, "i"));
assert.doesNotMatch(route, /fetch\(/i);
assert.match(route, /PENDING_CUSTOMER_PRODUCT_CHOICE/);
assert.match(route, /bookingContinuity: "UNVERIFIED"/);
assert.match(route, /actionability: "INFORMATIONAL_ONLY"/);
for (const authority of ["tripId", "userId", "providerPropertyId", "selectedHotelCandidateId", "price", "currency", "checkIn", "checkOut", "travelers", "rooms", "revalidatedAt", "chosenAt", "providerUrl", "bookingUrl"]) {
  assert.match(route, new RegExp(`ACCEPTED_POST_FIELDS|${authority}`));
}

let executable = route.replace(/^import[\s\S]*?;\n/gm, "");
executable = executable.replace(/export const (POST|GET|DELETE)\s*=/g, "const $1 =");
executable = stripTypeScriptTypes(executable, { mode: "transform" });
executable += "\nglobalThis.__createHandler = createHotelProductChoiceHandler;";

const responseFactory = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };
const context = {
  NextResponse: responseFactory,
  isMissingTableError: () => false,
  storageInputFromActiveChoiceResult: storage.storageInputFromActiveChoiceResult,
  requireUser: async () => ({ ok: false, response: responseFactory.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 }) }),
  getTripBundle: async () => ({ data: null, error: null }),
  getConfirmedBookingsForItinerary: async () => ({ bookings: [], error: null }),
  loadSelectedHotelActionContext: async () => null,
  payloadFromTrip: () => ({}),
  hotelInventoryInputFromPayload: () => null,
  createBookingDemandProvider: () => ({}),
  revalidateSelectedHotelProduct: async () => null,
  getPendingHotelProductChoice: async () => ({ choice: null, error: null }),
  replacePendingHotelProductChoice: async () => ({ choice: null, error: null }),
  clearPendingHotelProductChoice: async () => ({ ok: true, error: null }),
  createHotelProductChoice: () => ({ status: "INVALID_CHOICE", choice: null, reasonCodes: [], materialChanges: [], bookingContinuity: "UNVERIFIED" }),
  console
};
vm.createContext(context);
new vm.Script(executable).runInContext(context);

const routeId = "route-trip";
const auth = { ok: true, user: { id: "user-a" }, supabase: { marker: "owned" } };
const trip = { id: routeId, user_id: "user-a" };
const trustedContext = {
  selectedId: "booking:1001",
  selected: { providerPropertyId: "1001" },
  market: { metadata: { providerPayload: { property_id: "1001", product_options: [{ providerProductId: "P2", totalStayPrice: 640 }] } } }
};
const trustedRequest = { checkIn: "2026-10-10", checkOut: "2026-10-12", travelers: 2, rooms: 1, children: 0, childAges: [], currency: "CAD", bookerCountry: "CA" };
const currentEvidence = (id = "P2", changes = []) => ({
  status: "CURRENT", selectedHotelCandidateId: "booking:1001", providerPropertyId: "1001", intendedProviderProductId: id,
  refreshedProduct: { providerProductId: id }, previousProduct: null, searchedAt: "2026-10-01T12:00:00.000Z",
  factualChanges: changes, previousProductPresent: true, comparisonStatus: "COMPARED", bookingContinuity: "UNVERIFIED"
});

const rows = new Map();
const calls = { provider: 0, revalidate: 0, upsert: 0, get: 0, delete: 0 };
const storedChoice = (id = "P2", acknowledged = []) => ({
  tripId: routeId,
  acknowledgedMaterialChanges: acknowledged,
  choice: {
    selectedHotelCandidateId: "booking:1001", provider: "booking_demand", providerPropertyId: "1001", providerProductId: id,
    revalidatedAt: "2026-10-01T12:00:00.000Z", chosenAt: "2026-10-01T12:01:00.000Z", choiceSource: "CUSTOMER_EXPLICIT",
    bookingContinuity: "UNVERIFIED", actionability: "INFORMATIONAL_ONLY"
  }
});

const baseDeps = {
  requireUser: async () => auth,
  getTripBundle: async (supabase, userId, id) => { assert.equal(supabase.marker, "owned"); assert.equal(userId, "user-a"); return { data: id === routeId ? { trip, itinerary: null } : null, error: null }; },
  getConfirmedBookingsForItinerary: async () => ({ bookings: [], error: null }),
  loadSelectedHotelActionContext: async () => trustedContext,
  payloadFromTrip: (value) => { assert.equal(value, trip); return { trusted: true }; },
  hotelInventoryInputFromPayload: (value) => { assert.deepEqual(value, { trusted: true }); return trustedRequest; },
  createBookingDemandProvider: () => { calls.provider += 1; return { provider: true }; },
  revalidateSelectedHotelProduct: async (_provider, input) => { calls.revalidate += 1; return currentEvidence(input.intendedProviderProductId); },
  createHotelProductChoice: choiceDomain.createHotelProductChoice,
  replacePendingHotelProductChoice: async (_supabase, id, input) => { calls.upsert += 1; const value = { ...input, tripId: id }; rows.set(id, value); return { choice: value, error: null }; },
  getPendingHotelProductChoice: async (_supabase, id) => { calls.get += 1; return { choice: rows.get(id) || null, error: null }; },
  clearPendingHotelProductChoice: async (_supabase, id) => { calls.delete += 1; rows.delete(id); return { ok: true, error: null }; }
};

const makeRequest = (body = {}) => ({ json: async () => body });
const params = { params: Promise.resolve({ id: routeId }) };
const handler = context.__createHandler(baseDeps);
const unauth = context.__createHandler({ ...baseDeps, requireUser: async () => ({ ok: false, response: responseFactory.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 }) }) });
for (const method of ["POST", "GET", "DELETE"]) assert.equal((await unauth[method](makeRequest(), params)).status, 401, `A-C: unauthenticated ${method} rejected`);

const wrongOwner = context.__createHandler({ ...baseDeps, getTripBundle: async () => ({ data: null, error: null }) });
for (const method of ["POST", "GET", "DELETE"]) assert.equal((await wrongOwner[method](makeRequest({ providerProductId: "P2" }), params)).status, 404, `D-F: inaccessible trip rejected for ${method}`);

for (const body of [
  { tripId: "other" }, { userId: "other" }, { provider: "booking_demand" }, { providerPropertyId: "1001" }, { selectedHotelCandidateId: "booking:1001" },
  { price: 1 }, { currency: "USD" }, { checkIn: "2020-01-01" }, { checkOut: "2020-01-02" }, { travelers: 9 }, { rooms: 9 },
  { revalidatedAt: "2026-10-01T00:00:00.000Z" }, { chosenAt: "2026-10-01T00:00:00.000Z" }, { providerUrl: "https://invalid" }, { bookingUrl: "https://invalid" }
]) assert.equal((await handler.POST(makeRequest(body), params)).status, 400, "G-S: authority-bearing browser fields rejected");

const accepted = await handler.POST(makeRequest({ providerProductId: "P2" }), params);
assert.equal(accepted.status, 200, "X: exact product intent accepted");
assert.equal(accepted.body.pendingChoice.providerProductId, "P2");
assert.equal(accepted.body.pendingChoice.state, "PENDING_CUSTOMER_PRODUCT_CHOICE");
assert.equal(accepted.body.pendingChoice.bookingContinuity, "UNVERIFIED");
assert.equal(calls.upsert, 1, "AW: atomic storage invoked once");
assert.equal(calls.provider, 1, "BZ: provider orchestration runs for POST");
assert.notEqual(accepted.body.pendingChoice.chosenAt, accepted.body.pendingChoice.revalidatedAt, "AN-AP: timestamps remain distinct");

for (const result of [
  { status: "DISAPPEARED" }, { status: "PROVIDER_ERROR" }, { status: "MALFORMED_PROVIDER_RESPONSE" },
  { status: "CURRENT", refreshedProduct: { providerProductId: "P1" } }
]) {
  const blocked = context.__createHandler({ ...baseDeps, revalidateSelectedHotelProduct: async () => ({ ...currentEvidence("P2"), ...result }) });
  const before = calls.upsert;
  assert.notEqual((await blocked.POST(makeRequest({ providerProductId: "P2" }), params)).status, 200, "Y-AA/AC-AD: invalid exact revalidation blocks write");
  assert.equal(calls.upsert, before, "Y-AA/AC-AD: blocked revalidation does not persist");
}

const confirmed = context.__createHandler({ ...baseDeps, getConfirmedBookingsForItinerary: async () => ({ bookings: [{ booking_type: "hotel", booking_status: "confirmed" }], error: null }) });
assert.equal((await confirmed.POST(makeRequest({ providerProductId: "P2" }), params)).status, 409, "AV: confirmed hotel suppresses choice");

const changed = context.__createHandler({
  ...baseDeps,
  revalidateSelectedHotelProduct: async () => ({ ...currentEvidence("P2", ["PRICE_CHANGED", "CURRENCY_CHANGED"]), refreshedProduct: { providerProductId: "P2" } }),
  createHotelProductChoice: (input) => input.acknowledgedMaterialChanges?.length === 2
    ? baseDeps.createHotelProductChoice(input)
    : { status: "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT", choice: null, reasonCodes: ["MATERIAL_FACTUAL_CHANGE"], materialChanges: ["PRICE_CHANGED", "CURRENCY_CHANGED"], bookingContinuity: "UNVERIFIED" }
});
assert.equal((await changed.POST(makeRequest({ providerProductId: "P2", acknowledgedMaterialChanges: ["PRICE_CHANGED"] }), params)).status, 409, "AE-AJ: partial/stale acknowledgment rejected");
assert.equal((await changed.POST(makeRequest({ providerProductId: "P2", acknowledgedMaterialChanges: ["PRICE_CHANGED", "CURRENCY_CHANGED"] }), params)).status, 200, "AF/AK-AL: exact canonical acknowledgment accepted");
assert.equal((await handler.POST(makeRequest({ providerProductId: "P2", acknowledgedMaterialChanges: "PRICE_CHANGED" }), params)).status, 400, "AM: arbitrary acknowledgment shape rejected");

const get = await handler.GET(makeRequest(), params);
assert.equal(get.status, 200, "BA: GET succeeds");
assert.equal(get.body.pendingChoice.state, "PENDING_CUSTOMER_PRODUCT_CHOICE", "BB: GET labels pending only");
for (const forbidden of ["CURRENT", "bookable", "confirmed", "checkout", "deepLink", "providerPayload", "rawError"]) assert.doesNotMatch(JSON.stringify(get.body), new RegExp(forbidden, "i"), "BC/BP-BR: GET is allowlisted");
assert.equal(calls.provider, 7, "BE: GET does not call provider");

const deletesBefore = calls.delete;
assert.equal((await handler.DELETE(makeRequest(), params)).status, 200, "BF-BG: DELETE succeeds idempotently");
assert.equal(calls.delete, deletesBefore + 1, "BF: DELETE targets the route trip only");
assert.equal((await handler.DELETE(makeRequest(), params)).status, 200, "BG: repeated DELETE remains safe");
assert.equal(calls.provider, 7, "BH: DELETE does not call provider");

console.log("roamly authenticated hotel product choice API checks passed (A–BZ)");
