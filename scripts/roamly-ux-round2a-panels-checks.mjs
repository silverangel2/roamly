// roamly-ux-round2a-panels-checks.mjs — ROUND 2 panel build proof:
// composite structure EXACT, data REAL. Run under both
// TZ=America/Moncton and TZ=UTC; clock assertions use explicit `now`
// values, so the result is timezone-free.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2a-panels-checks.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tripClockState, formatTripDateRange, tripDayDateLabel, formatDurationHM } from "../lib/roamly/tripClock.ts";
import { buildDayTimelineRows, coerceDayTimelineItem, isTravelTimelineItem } from "../lib/roamly/liveDayTimeline.ts";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- Clock honesty: one clock for badge + Today tab ----------
// Composite state: trip Oct 26–30, 2026, badge "Trip in 3 days" means
// the real clock reads Oct 23 in the trip timezone (America/Toronto).
const oct23 = new Date("2026-10-23T15:00:00Z"); // 11:00 a.m. EDT
const clock = tripClockState({ startDate: "2026-10-26", endDate: "2026-10-30", timezone: "America/Toronto", now: oct23 });
assert.equal(clock.window, "future_trip");
assert.equal(clock.daysUntilStart, 3);
assert.equal(clock.badge, "Trip in 3 days");
assert.equal(clock.dayCount, 5);
assert.equal(formatTripDateRange("2026-10-26", "2026-10-30"), "Oct 26 – Oct 30, 2026");
assert.equal(tripDayDateLabel("2026-10-26", 1), "Mon, Oct 26");
// Same instant in UTC terms is still Oct 23 in the trip timezone — the
// badge does not flip when the viewer's device timezone changes.
assert.equal(
  tripClockState({ startDate: "2026-10-26", endDate: "2026-10-30", timezone: "America/Toronto", now: new Date("2026-10-23T02:00:00Z") }).daysUntilStart,
  4,
  "02:00Z Oct 23 is still Oct 22 in Toronto, so the trip is 4 days out — the trip timezone governs, not UTC"
);
// Active / completed / missing windows.
assert.equal(tripClockState({ startDate: "2026-10-26", endDate: "2026-10-30", timezone: "America/Toronto", now: new Date("2026-10-27T15:00:00Z") }).badge, "Trip in progress");
assert.equal(tripClockState({ startDate: "2026-10-26", endDate: "2026-10-30", timezone: "America/Toronto", now: new Date("2026-11-02T15:00:00Z") }).badge, "Trip complete");
assert.equal(tripClockState({ startDate: null, endDate: null, timezone: "America/Toronto", now: oct23 }).badge, "Dates to confirm");
assert.equal(tripClockState({ startDate: "2026-10-26", endDate: "2026-10-30", timezone: "America/Toronto", now: new Date("2026-10-25T15:00:00Z") }).badge, "Trip tomorrow");
// Duration formatting in the composite's h/m style.
assert.equal(formatDurationHM(45), "45m");
assert.equal(formatDurationHM(120), "2h");
assert.equal(formatDurationHM(75), "1h 15m");
assert.equal(formatDurationHM(null), null);
assert.equal(formatDurationHM(0), null, "zero is not a duration");

// ---------- Day timeline: structure exact, data real ----------
// Fixture seeds in STORED-plan shape (times/durations deliberately
// different from the composite's samples — the builder must echo the
// input, never the mock).
const seeds = [
  { time_label: "9:30 AM", title: "Travel from Saint John to Montreal", item_type: "travel", transportMode: "Flight", travelTimeMinutes: 95, origin: "Saint John", destination: "Montreal", timing_status: "PLANNED" },
  { time_label: "11:10 AM", title: "Walk to Galerie Blanche", item_type: "transfer", travelTimeMinutes: 12, timing_status: "PLANNED" },
  { time_label: "11:10 AM", title: "Galerie Blanche", description: "Contemporary art", category: "attraction", durationMinutes: 50, timing_status: "PLANNED" },
  { time_label: "12:37 PM", title: "Resto Végo", description: "Vegetarian restaurant", category: "restaurant", startTime: "12:37", endTime: "13:52", timing_status: "FACTUAL" },
  { time_label: "2:54 PM", title: "Théâtre Jean-Duceppe", description: "Evening show", category: "show", timing_status: "PLANNED" }
].map((seed) => coerceDayTimelineItem(seed));
assert.ok(seeds.every(Boolean));
assert.equal(isTravelTimelineItem(seeds[0]), true);
assert.equal(isTravelTimelineItem(seeds[2]), false);
const rows = buildDayTimelineRows(seeds, "Saint John", "Montreal");
// The walk-to-Galerie row is dropped (it approaches the next stop);
// the leg, the venue, the verified span, and the duration-less stop remain.
assert.equal(rows.length, 4);
assert.equal(rows[0].kind, "travel");
assert.equal(rows[0].title, "Travel from Saint John to Montreal");
assert.equal(rows[0].time, "9:30 AM", "stored time echoes verbatim — never the composite's 8:00");
assert.equal(rows[0].durationLabel, "1h 35m (est.)", "planned leg duration is estimated-labeled");
assert.equal(rows[0].planned, true);
assert.equal(rows[1].title, "Galerie Blanche");
assert.equal(rows[1].durationLabel, "50m (est.)");
assert.equal(rows[2].title, "Resto Végo");
assert.equal(rows[2].durationLabel, "1h 15m", "FACTUAL span renders bare — no (est.)");
assert.equal(rows[2].planned, false);
assert.equal(rows[3].title, "Théâtre Jean-Duceppe");
assert.equal(rows[3].durationLabel, null, "no duration data means no duration shown — never a default");
// Consecutive travel items stay SEPARATE legs — merging them would
// invent a combined movement the plan does not state.
const separate = buildDayTimelineRows([
  coerceDayTimelineItem({ time_label: "8:00 AM", title: "Walk to station", item_type: "transfer", travelTimeMinutes: 10, timing_status: "PLANNED" }),
  coerceDayTimelineItem({ time_label: "8:10 AM", title: "Train to city", item_type: "travel", travelTimeMinutes: 40, origin: "Saint John", destination: "Montreal", timing_status: "PLANNED" }),
  coerceDayTimelineItem({ time_label: "9:00 AM", title: "City Museum", durationMinutes: 60, timing_status: "PLANNED" })
], "Saint John", "Montreal");
assert.equal(separate.length, 3, "two legs + one stop, none merged");
assert.equal(separate[0].kind, "travel");
assert.equal(separate[0].durationLabel, "10m (est.)");
assert.equal(separate[1].kind, "travel");
assert.equal(separate[1].title, "Travel from Saint John to Montreal");
assert.equal(separate[1].durationLabel, "40m (est.)");
// A start time with no end time is NOT a duration (no 90-minute default).
const noSpan = buildDayTimelineRows([
  coerceDayTimelineItem({ time_label: "10:00 AM", title: "Lone stop", startTime: "10:00", timing_status: "PLANNED" })
], null, null);
assert.equal(noSpan[0].durationLabel, null);

// ---------- Panel structure (static: the wiring itself) ----------
const notifPage = await read("app/notifications/page.tsx");
const livePage = await read("app/trip/[id]/live/page.tsx");
const liveClient = await read("components/trip/LiveTripClient.tsx");
const hero = await read("components/roamly/TripHeroCard.tsx");
const sectionCard = await read("components/roamly/AlertsSectionCard.tsx");
// ALERTS: hero + three counted sections + See all + tab bar (shell) + weather honesty.
assert.match(notifPage, /TripHeroCard/, "Alerts renders the photo hero card");
assert.match(notifPage, /tripClockState\(/, "Alerts badge is computed from the real trip dates");
assert.match(notifPage, /getDestinationPhoto\(/, "Alerts photo comes from the destination-photo pipeline");
assert.match(notifPage, /AlertsSectionCard/, "Alerts renders mock-style sections");
assert.match(notifPage, /title="Action required"/, "Action required section exists");
assert.match(notifPage, /title="Upcoming"/, "Upcoming section exists");
assert.match(notifPage, /title="Travel updates"/, "Travel updates section exists");
assert.match(notifPage, /weatherUnavailableRow/, "weather block exists in its mock position");
assert.match(notifPage, /Weather is not available for this trip yet/, "weather block is honestly unavailable, never invented");
assert.match(sectionCard, /See all/, "sections offer See all");
assert.match(sectionCard, /rows\.length/, "section counts are the real row counts");
// LIVE: header + hero + four tabs + pre-trip honesty + Day timeline + actions.
assert.match(liveClient, /Live Companion/, "Live header title exists");
assert.match(liveClient, /TripHeroCard/, "Live renders the photo hero card");
assert.match(liveClient, /Full Itinerary/, "Full Itinerary tab exists");
assert.match(liveClient, /role="tablist"/, "tab bar exists");
assert.match(liveClient, /Trip hasn&apos;t started yet/, "pre-trip honesty banner exists");
assert.match(liveClient, /planned activities for Day/, "banner names the planned Day content");
assert.match(liveClient, /dayTimelineRows\.map/, "Day timeline renders server-built stored rows");
assert.match(liveClient, /Open in Maps/, "Open in Maps action exists");
assert.match(livePage, /dayTimelineRows=\{dayTimelineRows\}/, "Live page passes stored timeline rows");
assert.match(livePage, /itineraryDays=\{itineraryDays\}/, "Live page passes full-itinerary days");
assert.match(livePage, /heroPhoto=\{destinationPhoto/, "Live page passes the pipeline photo");
// Per-trip isolation: sections and bookings stay scoped to the selected trip.
assert.ok((notifPage.match(/\.eq\("trip_id", trip\.id\)/g) || []).length >= 2, "Alerts queries stay scoped to the selected trip");
// ---------- Data-real: no composite sample values in panel code ----------
const MOCK_SAMPLES = ["Place d'Armes", "Light rain", "Musée du marché", "Galerie Blanche", "Resto Végo", "Jean-Duceppe", "1h 45m"];
for (const token of MOCK_SAMPLES) {
  for (const [name, source] of [["notifications page", notifPage], ["live page", livePage], ["live client", liveClient]]) {
    assert.equal(source.includes(token), false, `${name} must not hardcode composite sample ${JSON.stringify(token)}`);
  }
}
assert.equal(hero.includes("unsplash") || hero.includes("picsum"), false, "hero never uses a stock-photo shortcut");
assert.doesNotMatch(notifPage, /openweathermap|weatherapi/i, "no weather provider invented for the UI");

console.log("Roamly UX Round 2A panel checks passed (structure exact, data real, clock honest).");
