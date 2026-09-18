import assert from "node:assert/strict";
import fs from "node:fs";
import { isOperationalCurrentBooking, sameBookingScope, supersessionWouldCreateCycle } from "../lib/roamly/bookingSupersession.ts";

const booking = (id, next = null, status = "booked") => ({ id, superseded_by_booking_id: next, booking_status: status });
assert.equal(isOperationalCurrentBooking(booking("A")), true, "normal booking remains current");
assert.equal(isOperationalCurrentBooking(booking("A", "B")), false, "A is historical after A -> B");
assert.equal(isOperationalCurrentBooking(booking("B")), true, "B is current after A -> B");
assert.equal(isOperationalCurrentBooking(booking("A", "B")) && isOperationalCurrentBooking(booking("B", "C")), false, "A/B historical in A -> B -> C");
assert.equal(isOperationalCurrentBooking(booking("C", null, "cancelled")), true, "cancelled leaf remains the only current candidate");
assert.equal(supersessionWouldCreateCycle([booking("A", "B"), booking("B")], "B", "A"), true, "two-node cycle rejected");
assert.equal(supersessionWouldCreateCycle([booking("A", "B"), booking("B", "C"), booking("C")], "C", "A"), true, "longer cycle rejected");
assert.equal(supersessionWouldCreateCycle([booking("A"), booking("B")], "A", "B"), false, "normal link allowed");
assert.equal(supersessionWouldCreateCycle([booking("A")], "A", "A"), true, "self-link rejected");
assert.equal(sameBookingScope({ user_id: "u", trip_id: "t" }, { user_id: "u", trip_id: "t" }), true, "same owner/trip allowed");
assert.equal(sameBookingScope({ user_id: "u1", trip_id: "t" }, { user_id: "u2", trip_id: "t" }), false, "cross-user rejected");
assert.equal(sameBookingScope({ user_id: "u", trip_id: "t1" }, { user_id: "u", trip_id: "t2" }), false, "cross-trip rejected");
assert.equal(sameBookingScope({ user_id: "u", trip_id: null }, { user_id: "u", trip_id: null }), false, "tripless rejected");

const wallet = fs.readFileSync("lib/roamly/bookingWallet.ts", "utf8");
const rpc = fs.readFileSync("supabase/migrations/20260917_roamly_booking_supersession_rpc.sql", "utf8");
const consumers = [
  "lib/roamly/preTripReminders.ts",
  "lib/roamly/preTrip7DayBriefing.ts",
  "lib/roamly/preTrip1DayBriefing.ts",
  "lib/roamly/travelDayBriefing.ts",
  "lib/roamly/dailyTripBriefing.ts",
  "lib/roamly/companionBriefings.ts",
  "lib/roamly/tripCompanion.ts",
  "lib/roamly/bookingMonitor.ts",
  "app/trip/[id]/live/page.tsx"
];
assert.match(wallet, /isOperationalCurrentBooking\(booking\)/, "wallet uses centralized current rule");
for (const file of consumers) assert.match(fs.readFileSync(file, "utf8"), /superseded_by_booking_id/, `${file} filters superseded bookings`);
assert.match(rpc, /for update/i, "trusted mutation locks rows");
assert.match(rpc, /auth\.role\(\) <> 'service_role'/, "trusted mutation requires service role");
assert.match(rpc, /supersession would create a lineage cycle/i, "trusted mutation protects cycles");
assert.doesNotMatch(fs.readFileSync("lib/roamly/bookingWallet.ts", "utf8"), /provider.*cancel|cancel.*provider/i, "no external provider mutation");
console.log("Booking supersession checks: PASS (current truth, lineage, cycle safety, downstream filters, no provider mutation)");
