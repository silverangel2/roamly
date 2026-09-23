import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isConfirmedItineraryBookingAnchor } from "../lib/roamly/confirmedItineraryAnchor.ts";

const evidence = [{ title: "LX Factory Food Tour", booking_status: "confirmed" }];
assert.equal(isConfirmedItineraryBookingAnchor("lx-factory food tour", evidence), true, "punctuation and case differences still match a real confirmed booking");
assert.equal(isConfirmedItineraryBookingAnchor("Oceanarium tickets", evidence), false, "AI suggestions cannot become confirmed from item_type alone");
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", booking_status: "recommended" }]), false);
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", booking_status: "confirmed", superseded_by_booking_id: "new-booking" }]), false);
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", traveler_confirmed: true }]), true);
assert.equal(isConfirmedItineraryBookingAnchor("", evidence), false);

const page = await readFile(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8");
assert.match(page, /const authority = isConfirmedItineraryBookingAnchor\(title, confirmedBookings\)/, "timeline confirmation must use actual booking evidence");
assert.doesNotMatch(page, /role === "protected_anchor" \|\| type === "booking"/, "AI-generated role/type labels must not independently confer confirmed status");
assert.match(page, /confirmedBookings=\{confirmedBookingSnapshot as Array<Record<string, unknown>>\}/, "screen timeline receives confirmed snapshots");
assert.match(page, /confirmedBookings=\{confirmedBookings\}/, "print timeline receives confirmed snapshots");
console.log("Roamly confirmed itinerary anchor checks passed.");
