import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("lib/roamly/selectedHotelProductChoice.ts", "utf8");
assert.doesNotMatch(source, /fetch\(|supabase|orders\/(preview|create|details|cancel|modify)/i);
assert.match(source, /evidence\.status !== "CURRENT"/);
assert.match(source, /evidence\.selectedHotelCandidateId !== selected\.selectedHotelCandidateId/);
assert.match(source, /evidence\.providerPropertyId !== selected\.providerPropertyId/);
assert.match(source, /refreshedProduct\.providerProductId !== productId/);
assert.match(source, /bookingContinuity: "UNVERIFIED"/);
const choiceBlock = source.match(/const choice: HotelProductChoice = \{[\s\S]*?\n  \};/)?.[0] || "";
for (const forbidden of ["totalStayPrice", "cancellationPolicy", "taxesFees", "deepLink", "bookingUrl", "redirectUrl", "actionUrl", "orderToken", "rawProviderPayload"]) {
  assert.doesNotMatch(choiceBlock, new RegExp(forbidden));
}

const { createHotelProductChoice, validateHotelProductChoice, replaceHotelProductChoice } = await import("../lib/roamly/selectedHotelProductChoice.ts");

const hotelA = { selectedHotelCandidateId: "booking:1001", providerPropertyId: "1001", provider: "booking_demand" };
const hotelB = { selectedHotelCandidateId: "booking:2002", providerPropertyId: "2002", provider: "booking_demand" };
const current = (id = "P2", changes = []) => ({ status: "CURRENT", selectedHotelCandidateId: "booking:1001", providerPropertyId: "1001", intendedProviderProductId: id, refreshedProduct: { providerProductId: id }, previousProduct: null, searchedAt: "2026-10-01T12:00:00.000Z", factualChanges: changes, previousProductPresent: true, comparisonStatus: "COMPARED", bookingContinuity: "UNVERIFIED" });
const input = (overrides = {}) => ({ selectedHotel: hotelA, revalidation: current(), confirmedBooking: false, chosenAt: "2026-10-01T12:01:00.000Z", ...overrides });

const active = createHotelProductChoice(input());
assert.equal(active.status, "ACTIVE_CHOICE");
assert.deepEqual(active.choice, { selectedHotelCandidateId: "booking:1001", provider: "booking_demand", providerPropertyId: "1001", providerProductId: "P2", chosenAt: "2026-10-01T12:01:00.000Z", choiceSource: "CUSTOMER_EXPLICIT", revalidatedAt: "2026-10-01T12:00:00.000Z", bookingContinuity: "UNVERIFIED", actionability: "INFORMATIONAL_ONLY" });
assert.equal(active.choice.providerProductId, "P2");
assert.equal(active.choice.selectedHotelCandidateId, hotelA.selectedHotelCandidateId);
assert.equal(active.choice.providerPropertyId, hotelA.providerPropertyId);

const representative = "P1";
const recommended = "P3";
assert.equal(representative, "P1");
assert.equal(recommended, "P3");
assert.equal(active.choice.providerProductId, "P2");
assert.notEqual(active.choice.providerProductId, representative);
assert.notEqual(active.choice.providerProductId, recommended);

assert.equal(createHotelProductChoice(input({ selectedHotel: hotelB })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), selectedHotelCandidateId: hotelB.selectedHotelCandidateId, providerPropertyId: hotelB.providerPropertyId } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), status: "DISAPPEARED", refreshedProduct: null } })).status, "INVALID_CHOICE");
for (const status of ["PROVIDER_ERROR", "MALFORMED_PROVIDER_RESPONSE", "REQUEST_CONTEXT_MISSING"]) assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), status } })).status, "INVALID_CHOICE");
for (const id of ["", " P2 ", 2, null]) assert.equal(createHotelProductChoice(input({ revalidation: current(id) })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: current("P3") })).status, "ACTIVE_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: current("P2"), confirmedBooking: true })).status, "SUPPRESSED_BY_CONFIRMED_BOOKING");

const changed = createHotelProductChoice(input({ revalidation: current("P2", ["PRICE_CHANGED", "CURRENCY_CHANGED", "CANCELLATION_CHANGED", "CHARGES_CHANGED", "ROOM_DESCRIPTION_CHANGED"]) }));
assert.equal(changed.status, "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT");
assert.deepEqual(changed.materialChanges, ["PRICE_CHANGED", "CURRENCY_CHANGED", "ROOM_DESCRIPTION_CHANGED", "CANCELLATION_CHANGED", "CHARGES_CHANGED"]);
const acknowledged = createHotelProductChoice(input({ acknowledgedMaterialChanges: ["CURRENCY_CHANGED", "PRICE_CHANGED"], revalidation: current("P2", ["PRICE_CHANGED", "PRICE_CHANGED", "CURRENCY_CHANGED"]) }));
assert.equal(acknowledged.status, "ACTIVE_CHOICE");
assert.deepEqual(acknowledged.materialChanges, ["PRICE_CHANGED", "CURRENCY_CHANGED"]);
assert.equal(acknowledged.choice.revalidatedAt, "2026-10-01T12:00:00.000Z");
assert.equal(Object.hasOwn(acknowledged.choice, "totalStayPrice"), false);

assert.equal(createHotelProductChoice(input({ revalidation: null })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ selectedHotel: null })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ selectedHotel: { ...hotelA, providerPropertyId: "" } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), intendedProviderProductId: "P2", refreshedProduct: { providerProductId: "P3" } } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), searchedAt: null } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), factualChanges: ["FUTURE_UNKNOWN_CHANGE"] } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["PRICE_CHANGED"], revalidation: current("P2", ["PRICE_CHANGED", "FUTURE_UNKNOWN_CHANGE"]) })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["CURRENCY_CHANGED"], revalidation: current("P2", ["PRICE_CHANGED"]) })).status, "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["PRICE_CHANGED"], revalidation: current("P2", ["PRICE_CHANGED", "CURRENCY_CHANGED"]) })).status, "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["PRICE_CHANGED", "PRICE_CHANGED"], revalidation: current("P2", ["PRICE_CHANGED"]) })).status, "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["PRICE_CHANGED"], revalidation: current("P2", ["CURRENCY_CHANGED"]) })).status, "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT");
assert.equal(createHotelProductChoice(input({ acknowledgedMaterialChanges: ["AVAILABILITY_CHANGED"], revalidation: current("P2", ["AVAILABILITY_CHANGED"]) })).status, "ACTIVE_CHOICE");

const replaced = replaceHotelProductChoice(active.choice, createHotelProductChoice(input({ revalidation: current("P3") })));
assert.equal(replaced.providerProductId, "P3");
assert.equal(Array.isArray(replaced), false);
assert.equal(replaceHotelProductChoice(active.choice, createHotelProductChoice(input({ revalidation: { ...current(), status: "DISAPPEARED", refreshedProduct: null } }))), null);
assert.equal(validateHotelProductChoice({ choice: replaced, selectedHotel: hotelA, confirmedBooking: false }).status, "VALID");
assert.equal(validateHotelProductChoice({ choice: replaced, selectedHotel: hotelB, confirmedBooking: false }).status, "INVALID");
assert.equal(validateHotelProductChoice({ choice: replaced, selectedHotel: hotelA, confirmedBooking: true }).status, "SUPPRESSED_BY_CONFIRMED_BOOKING");
assert.equal(createHotelProductChoice(input({ selectedHotel: { ...hotelA, provider: "other_provider" }, revalidation: current() })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), providerPropertyId: "2002" } })).status, "INVALID_CHOICE");
assert.equal(createHotelProductChoice(input({ revalidation: { ...current(), intendedProviderProductId: "P3" } })).status, "INVALID_CHOICE");

const original = structuredClone(input());
const before = JSON.stringify(original);
const first = createHotelProductChoice(original);
const second = createHotelProductChoice(original);
assert.equal(JSON.stringify(original), before);
assert.deepEqual(first, second);
assert.equal(first.choice.bookingContinuity, "UNVERIFIED");
assert.equal(first.choice.actionability, "INFORMATIONAL_ONLY");
assert.notEqual(first.choice.chosenAt, first.choice.revalidatedAt);
assert.equal(createHotelProductChoice(input({ chosenAt: "2030-01-01T00:00:00.000Z" })).choice.revalidatedAt, "2026-10-01T12:00:00.000Z");
assert.equal(Object.hasOwn(first.choice, "providerUrl"), false);
assert.equal(Object.hasOwn(first.choice, "rawProviderPayload"), false);
assert.equal(Object.hasOwn(first.choice, "orderToken"), false);

console.log("roamly hotel product choice checks passed (A–AZ)");
