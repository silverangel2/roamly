import assert from "node:assert/strict";
import {
  bookingLinkedDeliveryState,
  isOperationalBookingReference,
  shouldSuppressScheduledBookingEvent
} from "../lib/roamly/operationalScheduledEvents.ts";

const user = "user-a";
const trip = "trip-a";
const booking = (id, overrides = {}) => ({ id, user_id: user, trip_id: trip, booking_status: "booked", superseded_by_booking_id: null, ...overrides });
const future = new Date("2026-09-20T12:00:00Z");

assert.equal(isOperationalBookingReference(booking("a"), user, trip, new Set(["a"])), true);
assert.equal(isOperationalBookingReference(booking("a", { superseded_by_booking_id: "b" }), user, trip, new Set()), false);
assert.equal(isOperationalBookingReference(booking("a", { booking_status: "cancelled" }), user, trip, new Set(["a"])), false);
assert.equal(isOperationalBookingReference(booking("a", { user_id: "user-b" }), user, trip, new Set(["a"])), false);
assert.equal(isOperationalBookingReference(booking("a", { trip_id: "trip-b" }), user, trip, new Set(["a"])), false);

assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "a", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["a"]), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "a", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["b"]), now: future }), true);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "b", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["b"]), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "c", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["c"]), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "c", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(), now: future }), true);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "shown", booking_id: "a", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["b"]), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "cancelled", booking_id: "a", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(["a"]), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", booking_id: "a", scheduled_for: "2026-09-19T12:00:00Z" }, currentBookingIds: new Set(), now: future }), false);
assert.equal(shouldSuppressScheduledBookingEvent({ event: { status: "scheduled", scheduled_for: "2026-09-21T12:00:00Z" }, currentBookingIds: new Set(), now: future }), false);

assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, booking_id: "a" }, bookings: [booking("a")], currentBookingIds: new Set(["a"]) }), "valid");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, booking_id: "a" }, bookings: [booking("a")], currentBookingIds: new Set() }), "stale");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, booking_id: "a" }, bookings: [booking("a", { user_id: "user-b" })], currentBookingIds: new Set(["a"]) }), "stale");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, metadata_json: { confirmed_booking_ids: ["a", "b"] } }, bookings: [booking("a"), booking("b")], currentBookingIds: new Set(["a", "b"]) }), "valid");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, metadata_json: { confirmed_booking_ids: ["a", "b"] } }, bookings: [booking("a"), booking("b")], currentBookingIds: new Set(["a"]) }), "stale");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, metadata_json: { title: "Hotel at destination" } }, bookings: [], currentBookingIds: new Set() }), "unlinked");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: null, booking_id: "a" }, bookings: [booking("a")], currentBookingIds: new Set(["a"]) }), "stale");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, booking_id: "a" }, bookings: [booking("a", { trip_id: "trip-b" })], currentBookingIds: new Set(["a"]) }), "stale");
assert.equal(bookingLinkedDeliveryState({ delivery: { user_id: user, trip_id: trip, booking_id: "a" }, bookings: [booking("a", { user_id: "user-b" })], currentBookingIds: new Set(["a"]) }), "stale");

console.log("Operational scheduled event reconciliation checks passed.");
