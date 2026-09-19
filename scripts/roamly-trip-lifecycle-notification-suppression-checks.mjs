import assert from "node:assert/strict";

const source = await import("../lib/roamly/companionDeliveryLifecycle.ts");
const { companionTripLifecycleState } = source;

assert.equal(companionTripLifecycleState({ found: true, status: "active" }), "active");
assert.equal(companionTripLifecycleState({ found: true, status: "draft" }), "active");
assert.equal(companionTripLifecycleState({ found: true, status: "archived" }), "inactive");
assert.equal(companionTripLifecycleState({ found: true, status: "cancelled" }), "inactive");
assert.equal(companionTripLifecycleState({ found: true, status: "completed" }), "inactive");
assert.equal(companionTripLifecycleState({ found: true, status: "active", itineraryStatus: "cancelled" }), "inactive");
assert.equal(companionTripLifecycleState({ found: false }), "inactive");
assert.equal(companionTripLifecycleState({ found: true, status: "active", error: new Error("lookup failed") }), "unavailable");
assert.equal(companionTripLifecycleState({ found: true }), "unavailable");

console.log("ROAMLY TRIP LIFECYCLE NOTIFICATION SUPPRESSION CHECKS PASS");
