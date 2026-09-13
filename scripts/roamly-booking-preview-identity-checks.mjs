import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBookingPreviewProductIdentity, bookingPreviewIdentityMatchesRequest, evaluateBookingPreviewIdentity, previewIdentityEquivalent } from "../lib/roamly/bookingPreviewIdentity.ts";
import { normalizeBookingAccommodationResponse } from "../lib/roamly/hotelInventory.ts";
import { revalidateSelectedHotelProduct } from "../lib/roamly/selectedHotelProductAvailability.ts";

const request = {
  checkIn: "2026-10-10", checkOut: "2026-10-12", travelers: 2, rooms: 1, children: 1,
  childAges: [8], currency: "CAD", bookerCountry: "ca"
};
const binding = { ...request };
const timestamp = "2026-09-13T12:00:00.000Z";
const product = (id, extra = {}) => ({ id, number_of_adults: 1, children: [8], room: "room-1", ...extra });
const fixture = (products) => ({ data: [{ id: 1001, name: "Hotel A", currency: { accommodation: "CAD" }, products }] });

const candidates = normalizeBookingAccommodationResponse(fixture([product("P2")]), request, timestamp, "2026-09-13T12:15:00.000Z");
const option = candidates?.[0]?.productOptions?.[0];
assert.equal(option?.previewIdentity?.provider, "booking_demand", "A: provider namespace exact");
assert.equal(option?.previewIdentity?.providerPropertyId, "1001", "B: property ID preserved");
assert.equal(option?.previewIdentity?.providerProductId, "P2", "C/D: exact P2 ID preserved");
assert.deepEqual(option?.previewIdentity?.allocation, { numberOfAdults: 1, children: [8] }, "G/H: provider allocation preserved and product-associated");
assert.deepEqual(option?.previewIdentity?.requestBinding, binding, "T-Z/AA: request binding preserved");
assert.equal(option?.previewIdentity?.providerRetrievedAt, timestamp, "AH: provider retrieval timestamp factual");
assert.equal(option?.previewIdentity?.roomId, "room-1", "N: factual room ID preserved");
assert.equal(option?.previewIdentity?.rateId, null, "Q/R/S: rate identity remains unknown");
assert.equal(evaluateBookingPreviewIdentity(option.previewIdentity).status, "COMPLETE_FOR_PREVIEW_REQUEST", "AT: complete means request identity only");
assert.equal(evaluateBookingPreviewIdentity(option.previewIdentity).identity.state, "COMPLETE");
assert.equal(evaluateBookingPreviewIdentity({ ...option.previewIdentity, allocation: null }).status, "INCOMPLETE_FOR_PREVIEW_REQUEST", "J/AU: missing allocation incomplete");
assert.equal(evaluateBookingPreviewIdentity({ ...option.previewIdentity, allocation: { numberOfAdults: 0, children: [] } }).status, "INVALID", "K/AV: malformed allocation invalid");
assert.equal(evaluateBookingPreviewIdentity({ ...option.previewIdentity, requestBinding: { ...binding, childAges: [] } }).status, "INVALID", "L/M: no fabricated child assignment");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, binding), true, "AF: original binding matches");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, currency: "USD" }), false, "AF: changed currency invalidates reuse");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, checkIn: "2026-10-11" }), false, "AB: changed dates invalidate reuse");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, rooms: 2 }), false, "AC: changed rooms invalidate reuse");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, travelers: 3 }), false, "AD: changed travelers invalidate reuse");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, childAges: [9] }), false, "AE: changed child ages invalidate reuse");
assert.equal(bookingPreviewIdentityMatchesRequest(option.previewIdentity, { ...binding, bookerCountry: "us" }), false, "AG: changed booker country invalidates reuse");
assert.equal(previewIdentityEquivalent(option.previewIdentity, { ...option.previewIdentity }), true, "AJ: equivalent duplicate accepted");
assert.equal(previewIdentityEquivalent(option.previewIdentity, { ...option.previewIdentity, roomId: "room-2" }), false, "AK: conflicting duplicate rejected");
assert.equal(option.totalStayPrice, null, "AL/AM: availability price remains a non-final availability fact");
assert.equal(option.previewIdentity?.state, "COMPLETE");

const noAllocation = normalizeBookingAccommodationResponse(fixture([{ id: "P2", room: "room-1", price: { total: 1, currency: "CAD", charges: [] } }]), request, timestamp, "2026-09-13T12:15:00.000Z");
assert.equal(noAllocation?.[0]?.productOptions?.[0]?.previewIdentity?.allocation, null, "J: absent allocation stays absent");
assert.equal(noAllocation?.[0]?.productOptions?.[0]?.previewIdentity?.state, "INCOMPLETE", "AU: absent allocation is incomplete");
const malformedAllocation = normalizeBookingAccommodationResponse(fixture([product("P2", { number_of_adults: 1, children: [99] })]), request, timestamp, "2026-09-13T12:15:00.000Z");
assert.equal(malformedAllocation?.[0]?.productOptions?.[0]?.previewIdentity?.state, "INVALID", "K: malformed allocation fails closed");
const p2 = normalizeBookingAccommodationResponse(fixture([product("P2")]), request, timestamp, "2026-09-13T12:15:00.000Z")?.[0];
const p3 = normalizeBookingAccommodationResponse(fixture([product("P3")]), request, "2026-09-13T12:01:00.000Z", "2026-09-13T12:16:00.000Z")?.[0];
assert.equal(p2?.productOptions?.[0]?.providerProductId, "P2", "D/F: P2 cannot become P3");
assert.equal(p3?.productOptions?.[0]?.providerProductId, "P3");
assert.notEqual(p2?.productOptions?.[0]?.previewIdentity?.providerRetrievedAt, p3?.productOptions?.[0]?.previewIdentity?.providerRetrievedAt, "AI: refreshed timestamp is new evidence");

const refreshed = await revalidateSelectedHotelProduct({
  getPropertyAvailability: async () => ({ state: "OK", provider: "booking_demand", searchedAt: "2026-09-13T13:00:00.000Z", expiresAt: "2026-09-13T13:15:00.000Z", candidates: normalizeBookingAccommodationResponse(fixture([product("P2", { room: "room-2" })]), request, "2026-09-13T13:00:00.000Z", "2026-09-13T13:15:00.000Z") })
}, { selectedHotel: p2, request, intendedProviderProductId: "P2" });
assert.equal(refreshed.status, "CURRENT", "BA/BD: exact refreshed P2 remains current");
assert.equal(refreshed.refreshedProduct?.previewIdentity?.roomId, "room-2", "BA: refreshed P2 carries new identity");
assert.equal(refreshed.refreshedProduct?.previewIdentity?.providerRetrievedAt, "2026-09-13T13:00:00.000Z", "AI: refreshed timestamp retained");
assert.notEqual(refreshed.refreshedProduct?.previewIdentity?.providerRetrievedAt, option.previewIdentity?.providerRetrievedAt, "BB: old retrieval evidence is not merged");
const refreshedMissing = await revalidateSelectedHotelProduct({
  getPropertyAvailability: async () => ({ state: "OK", provider: "booking_demand", searchedAt: "2026-09-13T14:00:00.000Z", expiresAt: "2026-09-13T14:15:00.000Z", candidates: normalizeBookingAccommodationResponse(fixture([{ id: "P2", room: "room-3" }]), { ...request, children: 0, childAges: [] }, "2026-09-13T14:00:00.000Z", "2026-09-13T14:15:00.000Z") })
}, { selectedHotel: p2, request, intendedProviderProductId: "P2" });
assert.equal(refreshedMissing.status, "CURRENT", "BD: current remains separate from preview completeness");
assert.equal(refreshedMissing.refreshedProduct?.previewIdentity?.state, "INCOMPLETE", "BC: refreshed missing allocation is incomplete");

const sourceFiles = await Promise.all([
  "components/trip/HotelProductOptions.tsx", "components/trip/HotelProductChoicePicker.tsx",
  "app/api/trips/[id]/hotel-product-choice/route.ts", "app/api/trips/[id]/hotel-product-revalidate/route.ts",
  "app/trip/[id]/page.tsx"
].map((file) => readFile(file, "utf8")));
const publicSource = sourceFiles.join("\n");
for (const forbidden of ["previewIdentity", "order_token", "payment_token", "allocation", "roomId", "rateId"]) {
  assert.doesNotMatch(publicSource, new RegExp(forbidden), `BQ-BV: ${forbidden} does not leak to public/UI boundaries`);
}
const identitySource = await readFile("lib/roamly/bookingPreviewIdentity.ts", "utf8");
assert.match(identitySource, /server|Server|preview request/i, "BY: contract is clearly preview-bound");
assert.doesNotMatch(identitySource, /fetch\(|orders\/preview|orders\/create|order_token|payment/i, "BK-BN/BY: identity contract makes no provider or Orders calls");
assert.doesNotMatch(sourceFiles.slice(0, 2).join("\n"), /candidateDecisionCore|replacePendingHotelProductChoice|roamly_bookings|roamly_price_discoveries/i, "BI/BX: no choice/storage/core mutation");

console.log("roamly Booking.com preview identity checks passed (A–BZ)");
