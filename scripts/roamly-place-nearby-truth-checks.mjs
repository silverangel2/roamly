// roamly-place-nearby-truth-checks.mjs — ROUND 3 LANE F: Nearby
// sibling cards must derive a booking-linked sibling's display title
// from the booking's CURRENT truth (the placeDetail mirror of
// bookingTruth.titleForTruth), never the stored title verbatim — a
// since-cancelled booking whose stored itinerary title still carries
// a baked "Confirmed: " stamp must not appear as Confirmed on OTHER
// places' pages. Non-booking / unresolvable siblings keep their
// stored titles byte-unchanged.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-place-nearby-truth-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlaceDetail,
  fallbackPlaceId
} from "@/lib/roamly/placeDetail.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const TRIP = { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-11-16", end_date: "2026-11-20" };
const DAY = { day_number: 1, date: "2026-11-16", live_timeline: [] };
const MAIN = {
  item_id: "item-main",
  title: "Fixture Old Port Walk",
  description: "Plain planned sightseeing stop with no booking.",
  category: "activity",
  startTime: "12:00",
  endTime: "13:00",
  timing_status: "PLANNED",
  coordinates: { latitude: 45.5048, longitude: -73.5525 }
};

const EMAIL_EVIDENCE = {
  confirmation_number: "HTL48219",
  provider_booking_id: "HTL48219",
  provider_name: "Booking.com",
  source_type: "gmail",
  source_reference: "email:fixture-lane-f-msg-001",
  metadata: { email_import: true },
  traveler_confirmed: true
};

const BOOKING_CANCELLED = {
  ...EMAIL_EVIDENCE,
  confirmation_number: "HTL73021",
  provider_booking_id: "HTL73021",
  title: "Fixture Cancelled Suites",
  booking_status: "cancelled"
};
const BOOKING_EMAIL_ACTIVE = {
  ...EMAIL_EVIDENCE,
  title: "Fixture Riverside Hotel",
  booking_status: "booked"
};
const BOOKING_TRAVELER_ONLY = {
  title: "Fixture Legacy Inn",
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: null,
  provider_booking_id: null,
  provider_name: null,
  source_type: null,
  source_reference: null,
  metadata: {}
};
const BOOKING_REFUNDED = {
  ...EMAIL_EVIDENCE,
  title: "Fixture Refunded Rooms",
  booking_status: "refunded"
};

function nearbyFor(siblingItems, bookings) {
  const siblings = [MAIN, ...siblingItems];
  const detail = buildPlaceDetail({
    item: MAIN,
    day: { ...DAY, live_timeline: siblings },
    siblings: siblings.map((sibling, i) => ({ item: sibling, id: sibling.item_id || fallbackPlaceId(1, i) })),
    trip: TRIP,
    tripTips: [],
    confirmedBookings: bookings,
    photo: null,
    siblingPhotos: {}
  });
  return detail?.nearby || [];
}

// ---- Cancelled booking: stale "Confirmed:" stamp must not leak ----
{
  const sibling = { item_id: "sib-cancelled", title: "Confirmed: Fixture Cancelled Suites", category: "hotel", description: "Fixture hotel stop." };
  const nearby = nearbyFor([sibling], [BOOKING_CANCELLED]);
  check("cancelled sibling renders Cancelled stamp, not stored Confirmed stamp", nearby[0]?.title === "Cancelled: Fixture Cancelled Suites", nearby[0]?.title || "none");
  check("no stale Confirmed stamp anywhere in the nearby output", !JSON.stringify(nearby).includes("Confirmed: Fixture Cancelled Suites") && !JSON.stringify(nearby).includes("Confirmed ·"));
}

// ---- Provider-evidenced active booking: provenance stamp kept ----
{
  const plainStamped = { item_id: "sib-email-1", title: "Confirmed: Fixture Riverside Hotel", category: "hotel", description: "Fixture hotel stop." };
  const nearby1 = nearbyFor([plainStamped], [BOOKING_EMAIL_ACTIVE]);
  check("provider-evidenced sibling re-stamps plain Confirmed to its provenance stamp", nearby1[0]?.title === "Confirmed · from your Booking.com email: Fixture Riverside Hotel", nearby1[0]?.title || "none");
  const provenanceStamped = { item_id: "sib-email-2", title: "Confirmed · from your Booking.com email: Fixture Riverside Hotel", category: "hotel", description: "Fixture hotel stop." };
  const nearby2 = nearbyFor([provenanceStamped], [BOOKING_EMAIL_ACTIVE]);
  check("provider-evidenced sibling keeps its provenance stamp byte-identically", nearby2[0]?.title === provenanceStamped.title, nearby2[0]?.title || "none");
}

// ---- Traveler-confirmed-only booking: honest "Confirmed by you" ----
{
  const sibling = { item_id: "sib-legacy", title: "Confirmed: Fixture Legacy Inn", category: "hotel", description: "Fixture hotel stop." };
  const nearby = nearbyFor([sibling], [BOOKING_TRAVELER_ONLY]);
  check("traveler-only sibling shows Confirmed by you", nearby[0]?.title === "Confirmed by you: Fixture Legacy Inn", nearby[0]?.title || "none");
}

// ---- Refunded booking: honest re-stamp ----
{
  const sibling = { item_id: "sib-refunded", title: "Confirmed: Fixture Refunded Rooms", category: "hotel", description: "Fixture hotel stop." };
  const nearby = nearbyFor([sibling], [BOOKING_REFUNDED]);
  check("refunded sibling renders Refunded stamp", nearby[0]?.title === "Refunded: Fixture Refunded Rooms", nearby[0]?.title || "none");
}

// ---- Non-booking / unresolvable siblings: stored title untouched ----
{
  const plain = { item_id: "sib-walk", title: "Fixture Old Port Walk", category: "activity", description: "No booking." };
  // A second item with MAIN's title would be skipped as self; use a distinct main here via a walk sibling only.
  const nearbyPlain = nearbyFor([plain], [BOOKING_CANCELLED, BOOKING_EMAIL_ACTIVE, BOOKING_TRAVELER_ONLY]);
  check("non-booking sibling is byte-unchanged", nearbyPlain[0]?.title === "Fixture Old Port Walk", nearbyPlain[0]?.title || "none");
  const staleUnresolvable = { item_id: "sib-stale", title: "Confirmed: Fixture Mystery Walk", category: "activity", description: "Stamped in the plan, but no booking row resolves it." };
  const nearbyStale = nearbyFor([staleUnresolvable], [BOOKING_CANCELLED, BOOKING_EMAIL_ACTIVE]);
  check("unresolvable sibling keeps its stored title untouched (scope: booking-linked only)", nearbyStale[0]?.title === "Confirmed: Fixture Mystery Walk", nearbyStale[0]?.title || "none");
}

// ---- Main place regression: its own cancelled page stays bare + Cancelled badge ----
{
  const cancelledItem = { item_id: "main-cancelled", title: "Confirmed: Fixture Cancelled Suites", category: "hotel", description: "Fixture hotel stop.", startTime: "14:00", endTime: "16:00", timing_status: "PLANNED" };
  const detail = buildPlaceDetail({
    item: cancelledItem,
    day: { ...DAY, live_timeline: [cancelledItem, MAIN] },
    siblings: [cancelledItem, MAIN].map((sibling, i) => ({ item: sibling, id: sibling.item_id || fallbackPlaceId(1, i) })),
    trip: TRIP,
    tripTips: [],
    confirmedBookings: [BOOKING_CANCELLED],
    photo: null,
    siblingPhotos: {}
  });
  check("main cancelled place still renders bare title + Cancelled badge", detail?.title === "Fixture Cancelled Suites" && detail?.badge === "Cancelled", `${detail?.title} / ${detail?.badge}`);
  check("main place's Nearby shows the non-booking sibling byte-unchanged", detail?.nearby[0]?.title === "Fixture Old Port Walk", detail?.nearby[0]?.title || "none");
}

// ---- Static: the builder derives, the panel consumes the view-model ----
{
  const source = read("lib/roamly/placeDetail.ts");
  check("placeDetail derives sibling titles via the truth mirror", source.includes("placeTitleForTruth") && source.includes("findLinkedBookingForPlace(confirmedBookings, siblingTitle)") && source.includes("title: siblingDisplayTitle"));
  check("placeDetail does not push the stored sibling title verbatim", !source.includes("title: siblingTitle,"));
  const panel = read("components/roamly/PlaceDetailPanel.tsx");
  check("panel renders the view-model nearby title (no separate derivation needed)", panel.includes("place.title"));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES: ${failed.map((f) => f.name).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
