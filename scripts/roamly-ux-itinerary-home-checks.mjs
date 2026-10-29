// roamly-ux-itinerary-home-checks.mjs — Panel 5 (ITINERARY HOME) proof.
// Imports the real lib (lib/roamly/itineraryHome.ts) and asserts its
// behavior on fixtures built from GENERIC place names — never the mock's
// sample values. Plus STATIC checks on the panel component and the trip
// page wiring: structure present, unavailable states honest, no mock
// sample value copied into the tree, no fabricated photo/map/booking.
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-ux-itinerary-home-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC; every date assertion
// must hold in both (local-date parsing must never shift a weekday).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHomeDayView,
  classifyHomeRow,
  formatHomeDateRange,
  formatHomeDayHeading,
  formatHomeMinutes,
  homeDayPickerLabel,
  homeRowIsPlannedTime,
  homeRowTime,
  parseHomeDurationToMinutes,
  selectHomeDay,
  toHomeRow
} from "../lib/roamly/itineraryHome.ts";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// ---- Day labels (mock forms, real dates only) ----
ok("day heading: Day 1 · Mon, Oct 26 for 2026-10-26", () => {
  assert.equal(formatHomeDayHeading(1, "2026-10-26"), "Day 1 · Mon, Oct 26");
});
ok("day heading: Day 5 · Fri, Oct 30 for 2026-10-30", () => {
  assert.equal(formatHomeDayHeading(5, "2026-10-30"), "Day 5 · Fri, Oct 30");
});
ok("day heading without a date falls back to Day N, never invents one", () => {
  assert.equal(formatHomeDayHeading(3, null), "Day 3");
  assert.equal(formatHomeDayHeading(3, "not-a-date"), "Day 3");
});
ok("day picker labels split weekday and month-day", () => {
  assert.deepEqual(homeDayPickerLabel("2026-10-27"), { weekday: "Tue", monthDay: "Oct 27" });
});
ok("photo-header range: Oct 26 – Oct 30, 2026 · 5 days", () => {
  assert.equal(formatHomeDateRange("2026-10-26", "2026-10-30"), "Oct 26 – Oct 30, 2026 · 5 days");
});
ok("photo-header range: single day and missing dates", () => {
  assert.equal(formatHomeDateRange("2026-10-26", "2026-10-26"), "Oct 26, 2026 · 1 day");
  assert.equal(formatHomeDateRange(null, null), "Dates flexible");
});

// ---- Row times ----
ok("row time: Planned prefix stripped, range reduced to its start", () => {
  assert.equal(homeRowTime("Planned · 8:00 AM–10:00 AM"), "8:00 AM");
  assert.equal(homeRowTime("1:00 p.m.–3:00 p.m."), "1:00 PM");
  assert.equal(homeRowTime("Flexible"), "Flexible");
  assert.equal(homeRowIsPlannedTime("Planned · 8:00 AM–10:00 AM"), true);
  assert.equal(homeRowIsPlannedTime("8:00 AM–10:00 AM"), false);
});

// ---- Durations ----
ok("duration minutes: 105 → 1h 45m, 120 → 2h, 45 → 45m", () => {
  assert.equal(formatHomeMinutes(105), "1h 45m");
  assert.equal(formatHomeMinutes(120), "2h");
  assert.equal(formatHomeMinutes(45), "45m");
  assert.equal(formatHomeMinutes(0), null);
});
ok("duration parsing: stored strings become minutes, junk stays null", () => {
  assert.equal(parseHomeDurationToMinutes("105 min"), 105);
  assert.equal(parseHomeDurationToMinutes("1h 45m"), 105);
  assert.equal(parseHomeDurationToMinutes("2 hours"), 120);
  assert.equal(parseHomeDurationToMinutes(""), null);
});

// ---- Fixture day: travel + arrival + venue + return, generic names ----
const fixtureRows = [
  {
    time: "Planned · 8:00 AM–9:45 AM", title: "Travel from Origin City to Destination City",
    description: "Flight", location: "", category: "flight", itemType: "travel",
    durationLabel: "", travelLabel: "105 min travel", mapQuery: "Origin City Airport",
    authority: "supporting", timeFromBooking: false
  },
  {
    time: "10:30 AM", title: "Arrive in Destination City",
    description: "Get to hotel and drop luggage", location: "", category: "transfer", itemType: "transfer",
    durationLabel: "", travelLabel: "", mapQuery: "Destination City",
    authority: "supporting", timeFromBooking: false
  },
  {
    time: "1:00 PM–3:00 PM", title: "Central Market Hall",
    description: "Historic market and local shops", location: "Old Town", category: "attraction", itemType: "activity",
    durationLabel: "120 min", travelLabel: "", mapQuery: "Central Market Hall",
    authority: "must_do", timeFromBooking: false
  },
  {
    time: "8:30 PM", title: "Return to Harbor Hotel",
    description: "Check-in and rest", location: "Harbor Hotel", category: "hotel", itemType: "stay",
    durationLabel: "", travelLabel: "", mapQuery: "Harbor Hotel",
    authority: "supporting", timeFromBooking: false
  }
];

ok("row kinds: travel / arrival / venue / return-to-stay in order", () => {
  const kinds = fixtureRows.map((row, i) => classifyHomeRow(row, i, fixtureRows.length));
  assert.deepEqual(kinds, ["travel", "arrival", "venue", "return-to-stay"]);
});
ok("mid-day check-in is NOT misread as the return-to-stay row", () => {
  const midday = {
    time: "10:30 AM", title: "Check in, store bags, and recover",
    description: "", location: "", category: "hotel", itemType: "stay",
    durationLabel: "", travelLabel: "", mapQuery: "",
    authority: "supporting", timeFromBooking: false
  };
  assert.equal(classifyHomeRow(midday, 1, 4), "venue");
});
ok("travel leg: Planned chip + (est.) duration, detail first", () => {
  const row = toHomeRow(fixtureRows[0], 0, 4);
  assert.equal(row.planned, true);
  assert.equal(row.booked, false);
  assert.equal(row.time, "8:00 AM");
  assert.equal(row.durationText, "1h 45m");
  assert.equal(row.durationEstimated, true);
  assert.equal(row.subtitle, "Flight · 1h 45m (est.)");
});
ok("venue row: duration first with (est.), never a bare plan fact", () => {
  const row = toHomeRow(fixtureRows[2], 2, 4);
  assert.equal(row.subtitle, "2h (est.) · Historic market and local shops");
  assert.equal(row.planned, false);
});
ok("confirmed row: Booked, no (est.), no Planned chip", () => {
  const booked = {
    time: "1:00 PM–3:00 PM", title: "Central Market Hall",
    description: "Ticketed entry", location: "", category: "attraction", itemType: "activity",
    durationLabel: "120 min", travelLabel: "", mapQuery: "Central Market Hall",
    authority: "confirmed", timeFromBooking: true
  };
  const row = toHomeRow(booked, 0, 1);
  assert.equal(row.booked, true);
  assert.equal(row.planned, false);
  assert.equal(row.durationEstimated, false);
  assert.equal(row.subtitle, "2h · Ticketed entry");
});
ok("row without a duration renders no duration, never a made-up one", () => {
  const row = toHomeRow(fixtureRows[1], 1, 4);
  assert.equal(row.durationText, null);
  assert.equal(row.subtitle, "Get to hotel and drop luggage");
});

// ---- Day view + selection + per-trip isolation ----
ok("day view: heading, subtitle from stored plan, deduped map stops", () => {
  const view = buildHomeDayView({
    day_number: 1, date: "2026-10-26", primary_plan: "Arrival and first exploration",
    morning: "", afternoon: "", evening: "", rows: fixtureRows
  });
  assert.equal(view.heading, "Day 1 · Mon, Oct 26");
  assert.equal(view.subtitle, "Arrival and first exploration");
  assert.equal(view.rows.length, 4);
  assert.deepEqual(view.mapStops, [
    "Origin City Airport", "Destination City", "Central Market Hall", "Harbor Hotel"
  ]);
});
ok("day view with no subtitle renders empty subtitle, never invented text", () => {
  const view = buildHomeDayView({
    day_number: 2, date: "2026-10-27",
    primary_plan: "", morning: "", afternoon: "", evening: "", rows: []
  });
  assert.equal(view.subtitle, "");
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.mapStops, []);
});
ok("day selection: requested day, fallback to first, never another trip", () => {
  const tripA = [1, 2, 3].map((n) =>
    buildHomeDayView({ day_number: n, date: `2026-10-${25 + n}`, rows: [] }));
  assert.equal(selectHomeDay(tripA, 2)?.dayNumber, 2);
  assert.equal(selectHomeDay(tripA, 99)?.dayNumber, 1);
  assert.equal(selectHomeDay(tripA, null)?.dayNumber, 1);
  assert.equal(selectHomeDay([], 1), null);
  // Isolation: selection only ever returns an element of the array it
  // was given — a view built from trip A days can contain no trip B day.
  const tripBDay = buildHomeDayView({ day_number: 1, date: "2027-03-01", rows: [] });
  assert.ok(!tripA.includes(tripBDay));
  assert.notEqual(selectHomeDay(tripA, 1)?.date, tripBDay.date);
});

// ---- STATIC: panel component + page wiring ----
const panel = readFileSync(new URL("../components/trip/ItineraryHomePanel.tsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("../lib/roamly/itineraryHome.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8");

ok("STATIC panel: mock structure present (header, tabs, picker, timeline, map button)", () => {
  for (const needle of [
    "Roamly", "Edit trip", "Itinerary", "Essentials", "Documents",
    "See day", "View day on map", "Pick a day"
  ]) assert.ok(panel.includes(needle), `missing ${needle}`);
});
ok("STATIC panel: bottom tab bar NOT re-implemented (AppShell owns it)", () => {
  assert.ok(!panel.includes("AppTabBar"));
  assert.ok(panel.includes("The bottom tab bar (Itinerary / Live /"));
});
ok("STATIC panel: embedded-map gap named honestly, Open-in-Maps links used", () => {
  assert.ok(panel.includes("does not have an embedded map yet"));
  assert.ok(panel.includes("buildNavigationLinks"));
  assert.ok(!/leaflet|mapbox|google\.maps\.Map/i.test(panel));
});
ok("STATIC panel: honest unavailable states for map/essentials/documents", () => {
  assert.ok(panel.includes("no mappable stops yet"));
  assert.ok(panel.includes("No essentials saved for this trip yet"));
  assert.ok(panel.includes("No document checklist saved for this trip yet"));
  assert.ok(panel.includes("no saved day-by-day plan yet"));
});
ok("STATIC panel: photo only from props, fails to the bare header (no photo) or the branded fallback (failed photo), never generated", () => {
  // Final local round (2026-10-27, Task 1): the failed-photo branch
  // is the Roamly-branded fallback panel; the no-photo branch keeps
  // the approved bare header. Both are photo-free, never generated.
  assert.ok(panel.includes('photoState !== "failed"'));
  assert.ok(panel.includes('onError={() => setPhotoState("failed")}'));
  assert.ok(!/unsplash|picsum|via\.placeholder|placehold\.co/i.test(panel));
  assert.ok(panel.includes("never a generated/broken image"));
  assert.ok(panel.includes('photo && photoState === "failed"'));
  assert.ok(panel.includes('data-testid="roamly-photo-fallback"'));
});
ok("STATIC panel+lib: no mock sample value copied in as data", () => {
  const mockSamples = [
    "Place d'Armes", "Galerie Blanche", "Resto Végo", "Jean-Duceppe",
    "Sainte-Anne", "Saint John to Montreal"
  ];
  for (const sample of mockSamples) {
    assert.ok(!panel.includes(sample), `panel contains mock sample: ${sample}`);
    assert.ok(!lib.includes(sample), `lib contains mock sample: ${sample}`);
  }
});
ok("STATIC page wiring: panel mounted with this trip's data only", () => {
  assert.ok(page.includes('import { ItineraryHomePanel } from "@/components/trip/ItineraryHomePanel"'));
  assert.ok(page.includes("itineraryHomeDays = canonicalDays.map"));
  assert.ok(page.includes("buildDisplayTimelineItems(day, confirmedBookingSnapshot"));
  assert.ok(page.includes("<ItineraryHomePanel"));
  assert.ok(page.includes('editHref={itineraryHomeEditHref}'));
});
ok("STATIC panel+lib: no billing, entitlement, or gate-law code touched", () => {
  for (const needle of ["billing", "entitlement", "free itinerary", "hasUsedFreeItinerary"]) {
    assert.ok(!panel.includes(needle), `panel touches ${needle}`);
    assert.ok(!lib.includes(needle), `lib touches ${needle}`);
  }
});

// ---- Picture 5 (2026-10-26): the home screen IS the panel, top to
// bottom; legacy blocks live only in detail destinations. ----
const tripNav = readFileSync(new URL("../components/roamly/TripContextNav.tsx", import.meta.url), "utf8");

ok("PICTURE5 panel: no From-origin line in hero or bare header (picture has none)", () => {
  assert.ok(!panel.includes("originLabel"), "panel still references originLabel");
  assert.ok(!/>\s*From \{/.test(panel), "panel still renders a From line");
  assert.ok(!panel.includes("text-white/80\">From") && !panel.includes("text-cgray\">From"),
    "panel still renders a From paragraph");
});
ok("PICTURE5 panel: View day on map is the picture's pale-blue full-width button", () => {
  assert.ok(panel.includes("View day on map"));
  assert.ok(panel.includes("bg-cblue/10"), "map button lost its pale-blue ground");
});
ok("PICTURE5 page: legacy header, house ad, and footer are detail-only (hidden on home)", () => {
  assert.ok(page.includes('roamly-detail-only bg-transparent'), "legacy header section not marked detail-only");
  assert.ok(page.includes('roamly-detail-only mt-6'), "house ad not marked detail-only");
  assert.ok(page.includes('roamly-detail-only mt-10'), "footer not marked detail-only");
  assert.ok(page.includes(".roamly-detail-only{display:none}"), "detail-only default-hide rule missing");
  assert.ok(page.includes(".roamly-screen-document:has(.roamly-tab-input:checked) .roamly-detail-only{display:block}"),
    "detail-only reveal rule (checked detail tab) missing");
});
ok("PICTURE5 page: home section holds ONLY the panel — no stays, notes, or transport line", () => {
  const start = page.indexOf('roamly-home-panel');
  assert.ok(start >= 0);
  const segment = page.slice(start, page.indexOf("</section>", start));
  assert.ok(segment.includes("<ItineraryHomePanel"), "home section lost the panel");
  assert.ok(!segment.includes("PackageStays"), "stays still inside the home section");
  assert.ok(!segment.includes("Your notes"), "notes still inside the home section");
  assert.ok(!segment.includes("How you’ll get there"), "transport line still inside the home section");
});
ok("PICTURE5 page: detail destinations still mounted (day cards, budget, bookings, notes, overview)", () => {
  assert.ok(page.includes("DayTimelineCard"), "day-card destination gone");
  assert.ok(page.includes("roamly-panel-budget"), "budget destination gone");
  assert.ok(page.includes("BookingPlan"), "bookings destination gone");
  assert.ok(page.includes("ChecklistGroup"), "travel-notes destination gone");
  assert.ok(page.includes("Trip at a glance"), "overview destination gone");
});
ok("PICTURE5 page: Edit trip destination hidden by default, shown only as :target", () => {
  assert.ok(page.includes("<CustomizeYourTrip"), "editing section removed instead of moved behind Edit trip");
  assert.ok(page.includes("#customize{display:none}"), "customize default-hide rule missing");
  assert.ok(page.includes("#customize:target{display:block}"), "customize :target reveal rule missing");
  assert.ok(panel.includes("/customize") || page.includes("#customize"), "no Edit trip target wiring");
});
ok("PICTURE5 page: limited-features banner kept ABOVE the home panel (gate law, skipped trips only)", () => {
  // Final local round (2026-10-27, Task 2): the banner text moved
  // from an inline <p> in this page into the compact expandable
  // LimitedFeaturesNotice component (same position, same wording,
  // same gate condition). The pin therefore checks the mount, not
  // the literal string in this file.
  const notice = readFileSync(new URL("../components/roamly/LimitedFeaturesNotice.tsx", import.meta.url), "utf8");
  const mount = page.indexOf("<LimitedFeaturesNotice");
  assert.ok(mount >= 0, "limited-features banner gone");
  assert.ok(mount < page.indexOf("roamly-home-panel"), "banner must sit above the home panel, not inside a detail panel");
  assert.ok(notice.includes("Showing with limited features"), "banner wording gone from the notice component");
  assert.ok(!page.slice(Math.max(0, mount - 200), mount).includes("roamly-detail-only"), "banner must not be detail-only — skipped trips need it on home");
});
ok("PICTURE5 page: transient checkout notices stay visible above home (not detail-only)", () => {
  const notice = page.indexOf("Stripe returned successfully, but Roamly could not confirm");
  const header = page.indexOf("roamly-detail-only bg-transparent");
  assert.ok(notice >= 0 && header >= 0 && notice < header,
    "checkout attention notice must sit before the detail-only header");
});
ok("PICTURE5 nav: See day (#day-N) activates the day-by-day panel, not a hidden card", () => {
  assert.ok(tripNav.includes('/^#day-\\d+$/.test(suffix) ? "roamly-tab-day-by-day"'),
    "day-N hash does not map to the day-by-day tab");
  assert.ok(panel.includes("#day-"), "panel rows/See day lost their #day-N target");
});
ok("PICTURE5 page: print still shows everything (detail blocks + customize in print)", () => {
  assert.ok(page.includes(".roamly-detail-only{display:block!important}"), "print rule for detail blocks missing");
  assert.ok(page.includes("#customize{display:block!important}"), "print rule for customize missing");
});

// ---- Tiny follow-up (2026-10-28): an "Unplanned stop" row must
// never wear a Planned pill/label. The trigger shape is an
// unverified junk-title row that still carries a clock time —
// exactly the live Montreal Day 1 WIP row (1:45 PM) that shipped
// the mislabel. Both stored-plan render sites gate on it. ----
ok("unplanned row: WIP fixture is unverified AND clock-timed (the mislabel trigger shape)", () => {
  const wip = {
    time: "1:45 PM", title: "WIP",
    description: "", location: "", category: "activity", itemType: "activity",
    durationLabel: "", travelLabel: "", mapQuery: "",
    authority: "supporting", timeFromBooking: false
  };
  const row = toHomeRow(wip, 3, 4);
  assert.equal(row.unverified, true);
  assert.equal(row.time, "1:45 PM");
});
ok("STATIC panel: provenance pill gated on !row.unverified (unplanned rows carry no pill)", () => {
  assert.ok(panel.includes("isClockTime(row.time) && !row.unverified"),
    "panel pill render lost its unverified gate");
});
ok("STATIC day card: Planned line gated on !item.unverified (unplanned rows carry no Planned line)", () => {
  const dayCard = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  const plannedAt = dayCard.indexOf(">Planned</p>");
  assert.ok(plannedAt >= 0, "day-card Planned line gone");
  assert.ok(dayCard.slice(Math.max(0, plannedAt - 220), plannedAt).includes("!item.unverified"),
    "day-card Planned line lost its unverified gate");
});
ok("planned rows keep their pill path: travel leg is planned with a clock time", () => {
  const row = toHomeRow(fixtureRows[0], 0, 4);
  assert.equal(row.planned, true);
  assert.equal(row.unverified, false);
  assert.equal(row.time, "8:00 AM");
});

// ---- Owner review (2026-10-28): unverified rows read "Unverified
// stop", not "Unplanned stop", on every display surface. Display-only:
// the stored title stays "WIP", the row still counts as a stop, and
// the no-pill / no-Planned-line gates above are unchanged. ----
ok("STATIC unverified label: home panel + day card render \"Unverified stop\"", () => {
  const dayCard = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes('row.unverified ? "Unverified stop" : row.title'));
  assert.ok(dayCard.includes('item.unverified ? "Unverified stop" : item.title'));
});
ok("STATIC unverified label: live client + place panel render \"Unverified stop\"; old wording gone from display components", () => {
  const live = readFileSync(new URL("../components/trip/LiveTripClient.tsx", import.meta.url), "utf8");
  const place = readFileSync(new URL("../components/roamly/PlaceDetailPanel.tsx", import.meta.url), "utf8");
  assert.ok(live.includes("Unverified stop") && place.includes("Unverified stop"));
  for (const [name, src] of [["home panel", panel], ["day card", readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8")], ["live", live], ["place", place]]) {
    assert.ok(!src.includes("Unplanned stop"), `old wording survives in ${name}`);
  }
});

console.log(`\n${passed} itinerary-home checks passed.`);
