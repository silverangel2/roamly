import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const route = await readFile("app/api/trips/[id]/hotel-product-revalidate/route.ts", "utf8");
const availability = await readFile("lib/roamly/selectedHotelProductAvailability.ts", "utf8");

assert.match(route, /export const POST/);
assert.match(route, /requireUser\(\)/);
assert.match(route, /getTripBundle\(auth\.supabase, auth\.user\.id, id\)/);
assert.match(route, /getConfirmedBookingsForItinerary\(auth\.supabase, auth\.user\.id, id\)/);
assert.match(route, /loadSelectedHotelActionContext\(auth\.supabase, bundle\.data\.trip/);
assert.match(route, /hotelInventoryInputFromPayload\(payload\)/);
assert.match(route, /revalidateSelectedHotelProduct\(/);
assert.match(route, /createBookingDemandProvider\(\)/);
assert.match(route, /providerProductId: result\.refreshedProduct/);
assert.doesNotMatch(route, /orders\/(preview|create|details|cancel|modify)/i);
assert.doesNotMatch(route, /\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
assert.doesNotMatch(route, /NextResponse\.redirect/);
for (const forbidden of ["providerPropertyId", "price", "currency", "checkIn", "checkOut", "travelers", "rooms", "deepLink", "bookingUrl", "orderToken", "rawProviderPayload"]) {
  assert.doesNotMatch(route, new RegExp(`body\\.${forbidden}`), `body must not supply ${forbidden}`);
}

const safeResultFields = ["status", "providerProductId", "product", "previousProduct", "searchedAt", "factualChanges", "comparisonStatus", "bookingContinuity"];
assert.match(route, /function safeResult/);
for (const field of ["deepLink", "url", "bookingUrl", "redirectUrl", "actionUrl", "orderToken", "providerPropertyId", "selectedHotelCandidateId", "providerPayload"]) {
  assert.doesNotMatch(route.match(/function safeResult[\s\S]*?\n}\n\nfunction statusFor/)?.[0] || "", new RegExp(`\\b${field}\\b`), `safe response must omit ${field}`);
}
assert.ok(safeResultFields.every((field) => route.includes(field)));
assert.match(route, /CONFIRMED_BOOKING_AUTHORITATIVE/);
assert.match(route, /TRIP_NOT_FOUND/);
assert.match(route, /SELECTED_HOTEL_UNAVAILABLE/);
assert.match(route, /INVALID_PRODUCT_ID/);
assert.match(route, /REQUEST_CONTEXT_MISSING|statusFor/);
assert.match(availability, /option\.providerProductId === id/);
assert.match(availability, /bookingContinuity: "UNVERIFIED"/);

// Behavioral ordering proof for the injected route seam: authorization and
// ownership/context gates precede the only provider helper invocation.
const order = route.indexOf("const auth = await dependencies.requireUser()") < route.indexOf("const bundle = await dependencies.getTripBundle") &&
  route.indexOf("const bundle = await dependencies.getTripBundle") < route.indexOf("const context = await dependencies.loadSelectedHotelActionContext") &&
  route.indexOf("const context = await dependencies.loadSelectedHotelActionContext") < route.indexOf("dependencies.revalidateSelectedHotelProduct(");
assert.equal(order, true, "provider revalidation is ordered after auth, ownership, and selected-property context");
assert.match(route, /selectedHotelFromContext\(context\)/);
assert.match(route, /candidateId: context\.selectedId/);
assert.match(route, /productOptions: Array\.isArray\(providerPayload\.product_options\)/);
assert.match(route, /bookingContinuity/);

// Execute the route handler through its internal dependency seam. This keeps
// Next's route export surface unchanged while behaviorally testing auth,
// ownership, trusted context, provider ordering, and response filtering.
let executable = route.replace(/^import .*;\n/gm, "").replace("export const POST", "const POST");
executable = stripTypeScriptTypes(executable, { mode: "transform" }) + "\nglobalThis.__createHandler = createHotelProductRevalidationHandler;";
const responseFactory = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };
const context = {
  NextResponse: responseFactory,
  isMissingTableError: () => false,
  requireUser: async () => ({ ok: false, response: responseFactory.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 }) }),
  getTripBundle: async () => ({ data: null, error: "stub" }),
  getConfirmedBookingsForItinerary: async () => ({ bookings: [], error: null }),
  loadSelectedHotelActionContext: async () => null,
  payloadFromTrip: () => ({}),
  hotelInventoryInputFromPayload: () => ({}),
  createBookingDemandProvider: () => ({}),
  revalidateSelectedHotelProduct: async () => ({ status: "PROVIDER_ERROR", refreshedProduct: null, previousProduct: null, searchedAt: null, factualChanges: [], comparisonStatus: "NO_PRIOR_COMPARISON", bookingContinuity: "UNVERIFIED" }),
  console
};
vm.createContext(context);
new vm.Script(executable).runInContext(context);

const trustedTrip = { id: "trip-a", user_id: "user-a" };
const trustedInput = { checkIn: "2026-10-10", checkOut: "2026-10-12", travelers: 2, rooms: 1, children: 0, childAges: [], currency: "CAD", bookerCountry: "ca" };
const trustedContext = {
  selectedId: "booking:1001",
  selected: { providerPropertyId: "1001" },
  market: { metadata: { providerPayload: { property_id: "1001", product_options: [{ providerProductId: "P2", totalStayPrice: 640 }] } } }
};
const makeRequest = (body) => ({ json: async () => body });
const authResponse = responseFactory.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
const calls = { bundle: 0, context: 0, provider: 0, revalidate: 0, request: null };
const baseDeps = {
  requireUser: async () => ({ ok: true, user: { id: "user-a" }, supabase: { marker: "owned" } }),
  getTripBundle: async (supabase, userId, tripId) => { calls.bundle++; assert.equal(supabase.marker, "owned"); assert.equal(userId, "user-a"); assert.equal(tripId, "route-trip"); return { data: { trip: trustedTrip, itinerary: null } }; },
  getConfirmedBookingsForItinerary: async (_supabase, userId, tripId) => { assert.equal(userId, "user-a"); assert.equal(tripId, "route-trip"); return { bookings: [], error: null }; },
  loadSelectedHotelActionContext: async (_supabase, trip, _itinerary, _bookings) => { calls.context++; assert.equal(trip, trustedTrip); return trustedContext; },
  payloadFromTrip: (trip) => { assert.equal(trip, trustedTrip); return { trusted: true }; },
  hotelInventoryInputFromPayload: (payload) => { assert.deepEqual(payload, { trusted: true }); return trustedInput; },
  createBookingDemandProvider: () => { calls.provider++; return { marker: "booking-provider" }; },
  revalidateSelectedHotelProduct: async (provider, input) => { calls.revalidate++; assert.equal(provider.marker, "booking-provider"); calls.request = input.request; assert.equal(input.selectedHotel.providerPropertyId, "1001"); return { status: "CURRENT", intendedProviderProductId: input.intendedProviderProductId, refreshedProduct: { providerProductId: "P2", totalStayPrice: 640, currency: "CAD", roomDescription: "Room", taxesFees: 10, taxInclusionStatus: "included", feeInclusionStatus: "unknown", availabilityStatus: "available", cancellationPolicy: "conditional", deepLink: "https://provider.invalid/p2" }, previousProduct: null, searchedAt: "2026-10-01T12:00:00.000Z", factualChanges: [], comparisonStatus: "COMPARED", bookingContinuity: "UNVERIFIED" }; }
};
const handler = context.__createHandler(baseDeps);
const unauth = context.__createHandler({ ...baseDeps, requireUser: async () => ({ ok: false, response: authResponse }) });
const beforeAuth = { ...calls };
assert.equal((await unauth(makeRequest({ providerProductId: "P2" }), { params: Promise.resolve({ id: "route-trip" }) })).status, 401, "A: unauthenticated request is rejected");
assert.equal(calls.bundle, beforeAuth.bundle, "A: ownership lookup is not reached before auth");
assert.equal(calls.provider, beforeAuth.provider, "A: provider is not called before auth");

const missingTrip = context.__createHandler({ ...baseDeps, getTripBundle: async () => ({ data: null, error: "Trip not found." }) });
assert.equal((await missingTrip(makeRequest({ providerProductId: "P2" }), { params: Promise.resolve({ id: "route-trip" }) })).status, 404, "B: inaccessible trip is not revealed");
assert.equal(calls.provider, beforeAuth.provider, "B: provider is not called for inaccessible trip");

const currentResponse = await handler(makeRequest({ providerProductId: "P2", tripId: "other", userId: "other", selectedHotelCandidateId: "booking:2002", providerPropertyId: "2002", price: 1, currency: "USD", checkIn: "2000-01-01", rooms: 99, children: 8 }), { params: Promise.resolve({ id: "route-trip" }) });
assert.equal(currentResponse.status, 200, "C: owned trip returns current result");
assert.equal(currentResponse.body.status, "CURRENT");
assert.equal(currentResponse.body.providerProductId, "P2");
assert.equal(calls.context > beforeAuth.context, true, "C: trusted context loader receives the owned trip");
assert.deepEqual(calls.request, trustedInput, "AS: body request overrides do not affect trusted provider request");
assert.equal(calls.provider > beforeAuth.provider, true, "E: provider is called only after auth and ownership");
assert.equal(currentResponse.body.product.providerProductId, "P2");
assert.equal(Object.hasOwn(currentResponse.body, "providerPropertyId"), false, "AK: property ID is not exposed");
assert.equal(Object.hasOwn(currentResponse.body.product, "deepLink"), false, "V: provider URL is not exposed");
assert.equal(Object.hasOwn(currentResponse.body, "orderToken"), false, "W: order token is not exposed");
assert.equal(Object.hasOwn(currentResponse.body, "selectedHotelCandidateId"), false, "AK: candidate ID is not exposed");
assert.equal(currentResponse.body.bookingContinuity, "UNVERIFIED", "AZ: current does not authorize booking");

const invalidBodies = [null, {}, { providerProductId: "" }, { providerProductId: " P2 " }, { providerProductId: 2 }];
for (const body of invalidBodies) {
  const response = await handler(makeRequest(body), { params: Promise.resolve({ id: "route-trip" }) });
  assert.equal(response.status, 400, "D/AO/AP: invalid product identity is rejected before provider work");
}
assert.equal(calls.provider, beforeAuth.provider + 1, "D/AO/AP: invalid product IDs do not create provider calls");

const loaderFailure = context.__createHandler({ ...baseDeps, loadSelectedHotelActionContext: async () => null });
const providerBeforeLoaderFailure = calls.provider;
assert.equal((await loaderFailure(makeRequest({ providerProductId: "P2" }), { params: Promise.resolve({ id: "route-trip" }) })).status, 409, "AW: context failure is safe");
assert.equal(calls.provider, providerBeforeLoaderFailure, "AW: provider is not called after context failure");

const disappeared = context.__createHandler({ ...baseDeps, revalidateSelectedHotelProduct: async (_provider, input) => ({ status: "DISAPPEARED", intendedProviderProductId: input.intendedProviderProductId, refreshedProduct: null, previousProduct: null, searchedAt: "2026-10-01T12:00:00.000Z", factualChanges: [], comparisonStatus: "COMPARED", bookingContinuity: "UNVERIFIED" }) });
const disappearedResponse = await disappeared(makeRequest({ providerProductId: "P2" }), { params: Promise.resolve({ id: "route-trip" }) });
assert.equal(disappearedResponse.status, 200, "Q: disappearance is an explicit successful read result");
assert.equal(disappearedResponse.body.product, null, "BA: disappearance has no replacement product");

const providerFailed = context.__createHandler({ ...baseDeps, revalidateSelectedHotelProduct: async () => ({ status: "PROVIDER_ERROR", intendedProviderProductId: "P2", refreshedProduct: null, previousProduct: null, searchedAt: null, factualChanges: [], comparisonStatus: "NO_PRIOR_COMPARISON", bookingContinuity: "UNVERIFIED", warning: "secret" }) });
const failedResponse = await providerFailed(makeRequest({ providerProductId: "P2" }), { params: Promise.resolve({ id: "route-trip" }) });
assert.equal(failedResponse.status, 502, "S: provider failure maps to gateway failure");
assert.equal(Object.hasOwn(failedResponse.body, "warning"), false, "AX: provider error text is not exposed");
assert.equal(calls.revalidate > beforeAuth.revalidate, true, "BB: repeated reads remain provider-read only");
assert.equal(Object.hasOwn(failedResponse.body, "providerPayload"), false, "AY: failure response is allowlisted");
console.log("roamly hotel product revalidation API checks passed");
