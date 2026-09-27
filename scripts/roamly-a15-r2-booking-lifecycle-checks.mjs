import assert from "node:assert/strict";
import fs from "node:fs";
import { customerTripLifecycleState, isCustomerTripTerminalState } from "../lib/roamly/liveCompanion.ts";

const entitled = {
  status: "planned",
  itineraryStatus: "generated",
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  metadata: { planning: { timezone: "America/Toronto" } }
};

assert.equal(customerTripLifecycleState(entitled, "2026-09-26T12:00:00Z"), "upcoming");
assert.equal(customerTripLifecycleState(entitled, "2026-10-11T12:00:00Z"), "active");

const completedByWindow = { ...entitled, startDate: "2026-08-05", endDate: "2026-08-08" };
const archived = { ...completedByWindow, status: "archived" };
for (const trip of [completedByWindow, archived]) {
  const lifecycle = customerTripLifecycleState(trip, "2026-09-26T12:00:00Z");
  assert.equal(isCustomerTripTerminalState(lifecycle), true);
}

const bookingsPage = fs.readFileSync("app/trip/[id]/bookings/page.tsx", "utf8");
assert.match(bookingsPage, /customerTripLifecycleState/);
assert.match(bookingsPage, /isCustomerTripTerminalState/);
assert.match(bookingsPage, /const companionOperational = !isCustomerTripTerminalState\(tripLifecycle\) && tripHasTrackingUnlock\(trip\)/);
assert.match(bookingsPage, /companionUnlocked=\{companionOperational\}/);
assert.match(bookingsPage, /listTripBookings/);
assert.match(bookingsPage, /legacyRoamlyBookingToWallet/);
assert.doesNotMatch(bookingsPage, /companionUnlocked=\{tripHasTrackingUnlock\(trip\)\}/);

const timeline = fs.readFileSync("components/companion/BookingWalletTimeline.tsx", "utf8");
assert.match(timeline, /Live Companion available/);
assert.match(timeline, /Live Companion not active/);
assert.match(timeline, /bookings\/add/);

console.log("A15-R2 booking lifecycle checks passed.");
