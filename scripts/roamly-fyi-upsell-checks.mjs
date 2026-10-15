/**
 * roamly-fyi-upsell-checks.mjs — deterministic unit tests for the Roamly
 * customer FYI digest + trip-gap upsell watcher (lanes A + B).
 *
 * Runs with: node --experimental-strip-types scripts/roamly-fyi-upsell-checks.mjs
 * (package.json: test:fyi-upsell)
 *
 * The two core modules under test are pure and dependency-free, so the checks
 * are fully deterministic — no network, no Supabase, no clock mocking beyond
 * fixed timestamps.
 */
import assert from "node:assert/strict";

const core = await import("../lib/roamly/fyiDigestCore.ts");
const gaps = await import("../lib/roamly/tripGapCore.ts");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// A. FYI digest core
// ---------------------------------------------------------------------------

check("fyi moments registered; review_ask exists but is NOT digest-sendable", () => {
  assert.ok(core.FYI_MOMENTS.includes("review_ask"), "review_ask must be registered");
  assert.ok(!core.DIGEST_SENDABLE_MOMENTS.includes("review_ask"), "review_ask must stay digest-unsendable");
  for (const moment of ["check_in_t24", "flight_change", "itinerary_ready", "trip_starting_soon", "upsell_gap"]) {
    assert.ok(core.isDigestSendableMoment(moment), `${moment} must be sendable`);
  }
});

check("dedupe + daily-cap keys are stable and scoped", () => {
  const key = core.fyiDedupeKey("check_in_t24", "trip-1", "seg-1");
  assert.equal(key, core.fyiDedupeKey("check_in_t24", "trip-1", "seg-1"));
  assert.notEqual(key, core.fyiDedupeKey("check_in_t24", "trip-1", "seg-2"));
  assert.notEqual(key, core.fyiDedupeKey("flight_change", "trip-1", "seg-1"));
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(core.fyiDailyEmailCapKey("trip-1", now), "fyi-email-daily:trip-1:2026-10-15");
  assert.notEqual(core.fyiDailyEmailCapKey("trip-1", now), core.fyiDailyEmailCapKey("trip-2", now));
});

check("T-24h check-in window catches the 22-26h band only", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const at = (hours) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  assert.equal(core.isCheckInT24Window(at(24), now), true);
  assert.equal(core.isCheckInT24Window(at(22), now), true);
  assert.equal(core.isCheckInT24Window(at(26), now), true);
  assert.equal(core.isCheckInT24Window(at(21.9), now), false);
  assert.equal(core.isCheckInT24Window(at(26.1), now), false);
  assert.equal(core.isCheckInT24Window(at(2), now), false);
  assert.equal(core.isCheckInT24Window(null, now), false);
  assert.equal(core.isCheckInT24Window("not-a-date", now), false);
});

check("flightChangeKind never invents a change on first observation", () => {
  const current = { bookingStatus: "booked", startAt: "2026-10-16T10:00:00Z", endAt: null, gate: "A1", terminal: "2" };
  assert.equal(core.flightChangeKind(null, current), null);
});

check("flightChangeKind detects cancellation, delay, reschedule, gate", () => {
  const base = { bookingStatus: "booked", startAt: "2026-10-16T10:00:00Z", endAt: "2026-10-16T14:00:00Z", gate: "A1", terminal: "2" };
  assert.equal(core.flightChangeKind(base, { ...base, bookingStatus: "cancelled" }), "cancelled");
  assert.equal(core.flightChangeKind(base, { ...base, startAt: "2026-10-16T10:20:00Z" }), "delayed");
  assert.equal(core.flightChangeKind(base, { ...base, startAt: "2026-10-16T09:50:00Z" }), "rescheduled");
  assert.equal(core.flightChangeKind(base, { ...base, gate: "B7" }), "gate_terminal");
  assert.equal(core.flightChangeKind(base, base), null);
  // A cleared gate is not "news" — only newly-known gates are reported.
  assert.equal(core.flightChangeKind(base, { ...base, gate: null }), null);
});

check("check-in copy states only what the segment data says", () => {
  const segment = {
    bookingId: "b1", tripId: "t1", userId: "u1",
    flightNumber: "AC123", provider: "Air Canada",
    origin: "YYZ", destination: "LIS",
    departureTime: "2026-10-16T10:00:00Z", arrivalTime: null,
    terminal: null, gate: null, status: null
  };
  const copy = core.buildCheckInCopy(segment, "t1");
  assert.ok(copy.subject.includes("AC123"), "subject names the flight");
  assert.ok(copy.body.includes("YYZ") && copy.body.includes("LIS"), "body states the route");
  assert.ok(!/delay|cancel/i.test(copy.body), "check-in copy invents no disruption");
});

check("flight-change copy for cancellation is factual, no invented rebooking", () => {
  const segment = {
    bookingId: "b1", tripId: "t1", userId: "u1",
    flightNumber: "AC123", provider: null, origin: null, destination: null,
    departureTime: null, arrivalTime: null, terminal: null, gate: null, status: null
  };
  const copy = core.buildFlightChangeCopy(segment, "t1", "cancelled", {
    bookingStatus: "cancelled", startAt: null, endAt: null, gate: null, terminal: null
  });
  assert.ok(/cancel/i.test(copy.title), "title states cancellation");
  assert.ok(!/rebooked|new flight/i.test(copy.body), "copy invents no rebooking");
});

check("unsubscribe URL builder is deterministic", () => {
  assert.equal(core.unsubscribeUrl("tok-1"), "/api/roamly/email/unsubscribe?token=tok-1");
});

// ---------------------------------------------------------------------------
// B. Trip-gap watcher core
// ---------------------------------------------------------------------------

const NO_PREFS = { accepted: {}, inferred: {}, enabled: false };
const tripBase = {
  tripId: "t1",
  destinationCountry: "Portugal",
  originCountry: "Canada",
  destinationLabel: "Lisbon"
};
const booking = (bookingType, bookingStatus = "booked") => ({
  bookingType, bookingStatus, origin: null, destination: null, provider: null
});

check("flight with no hotel -> hotel gap; hotel with no transfer -> transfer gap", () => {
  const flightOnly = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("flight")], preferences: NO_PREFS });
  const types = flightOnly.map((g) => g.type);
  assert.ok(types.includes("hotel"), "hotel gap detected");
  const hotelOnly = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("hotel")], preferences: NO_PREFS });
  assert.ok(hotelOnly.map((g) => g.type).includes("transfer"), "transfer gap detected");
});

check("international trip with no connectivity -> esim gap; domestic -> none", () => {
  const intl = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("hotel")], preferences: NO_PREFS });
  assert.ok(intl.map((g) => g.type).includes("esim"), "esim gap detected for international trip");
  const domestic = gaps.detectTripGaps({
    trip: { ...tripBase, originCountry: "Canada", destinationCountry: "Canada" },
    bookings: [booking("hotel")],
    preferences: NO_PREFS
  });
  assert.ok(!domestic.map((g) => g.type).includes("esim"), "no esim gap for domestic trip");
});

check("cancelled bookings do not close gaps", () => {
  const found = gaps.detectTripGaps({
    trip: tripBase,
    bookings: [booking("flight"), booking("hotel", "cancelled")],
    preferences: NO_PREFS
  });
  assert.ok(found.map((g) => g.type).includes("hotel"), "cancelled hotel does not close the hotel gap");
});

check("fully covered trip leaves only the generic gear offer", () => {
  const found = gaps.detectTripGaps({
    trip: tripBase,
    bookings: [booking("flight"), booking("hotel"), booking("transport"), booking("tour"), booking("car_rental"), { ...booking("other"), provider: "Airalo eSIM" }],
    preferences: NO_PREFS
  });
  assert.deepEqual(found.map((g) => g.type), ["gear"]);
});

check("traveler prefs suppress offers stated against (Junel's hard rule)", () => {
  const antiHotel = {
    accepted: { dislikes: ["hotels", "I hate hotels, staying with family"] },
    inferred: {},
    enabled: true
  };
  const hotelGaps = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("flight")], preferences: antiHotel });
  assert.ok(!hotelGaps.map((g) => g.type).includes("hotel"), "hotel offer suppressed by stated dislike");

  const transitFan = {
    accepted: { transportation_preferences: ["public transit only, no taxi"] },
    inferred: {},
    enabled: true
  };
  const transferGaps = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("hotel")], preferences: transitFan });
  assert.ok(!transferGaps.map((g) => g.type).includes("transfer"), "transfer offer suppressed by transit preference");

  const antiDrive = {
    accepted: { transportation_preferences: ["I don't drive"] },
    inferred: {},
    enabled: true
  };
  const carGaps = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("hotel")], preferences: antiDrive });
  assert.ok(!carGaps.map((g) => g.type).includes("car"), "car offer suppressed by no-driving preference");

  const antiTour = { accepted: { dislikes: ["guided tours"] }, inferred: {}, enabled: true };
  const tourGaps = gaps.detectTripGaps({ trip: tripBase, bookings: [booking("hotel")], preferences: antiTour });
  assert.ok(!tourGaps.map((g) => g.type).includes("tours"), "tours offer suppressed by stated dislike");
});

check("gap offers reuse the /finds affiliate endpoints — nothing new invented", () => {
  const amazon = (query) => `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=roamly02e-20`;
  const hotel = gaps.buildGapOffer("hotel", tripBase, amazon);
  assert.equal(hotel.href, "https://booking.stay22.com/roamly/YhpfMFjm2n");
  assert.equal(hotel.providerLabel, "Stay22");
  const transfer = gaps.buildGapOffer("transfer", tripBase, amazon);
  assert.equal(transfer.href, "https://intui.tpo.lu/6GQiV5Ai");
  assert.equal(transfer.providerLabel, "Intui");
  const tours = gaps.buildGapOffer("tours", tripBase, amazon);
  assert.equal(tours.href, "https://kkday.tpo.lu/DrPvqlSH");
  assert.ok(/browse/i.test(tours.ctaLabel + tours.description), "tours offer is labeled as browsing, not an exact product");
  const esim = gaps.buildGapOffer("esim", tripBase, amazon);
  assert.ok(esim.widget, "esim offer carries the widget embed");
  assert.ok(esim.widget.src.includes("trs=549715") && esim.widget.src.includes("shmarker=750294"), "esim widget keeps the approved identifiers");
  const car = gaps.buildGapOffer("car", tripBase, amazon);
  assert.ok(car.widget && car.widget.src.includes("trs=549715"), "car widget keeps the approved identifiers");
  const gear = gaps.buildGapOffer("gear", tripBase, amazon);
  assert.ok(gear.href.includes("tag=roamly02e-20"), "gear offer carries the configured Amazon tag");
  for (const offer of [hotel, transfer, tours, esim, car, gear]) {
    assert.ok(offer.disclosure.length > 0, `${offer.type} offer carries the affiliate disclosure`);
  }
});

check("upsell email copy keeps the disclosure and never invents prices", () => {
  const copy = core.buildUpsellCopy({
    gapTitle: "Find a stay for Lisbon",
    gapDescription: "Your flight is booked but no stay is on file yet.",
    destination: "Lisbon",
    tripId: "t1",
    ctaUrl: "https://booking.stay22.com/roamly/YhpfMFjm2n",
    ctaLabel: "Search stays",
    disclosure: "Roamly may earn a commission from some booking links."
  });
  assert.ok(copy.body.includes("Roamly may earn a commission"), "disclosure present in upsell email");
  assert.ok(!/\$\d/.test(copy.body), "no invented prices in upsell copy");
});

console.log(`fyi-upsell checks: ${passed} passed`);
