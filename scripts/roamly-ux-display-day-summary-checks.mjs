// roamly-ux-display-day-summary-checks.mjs — DISPLAY-ONLY day-summary
// correction (final local round, 2026-10-27; natural shape + one
// stop-count rule, consistency repairs 2026-10-28).
//
// The stored day summary on an already-saved trip is NEVER rewritten:
// the render layer derives a factual sentence from the day's own
// displayed items (counts from the items, arrival from the arrival
// leg, times from item times) and shows THAT, while the stored text
// stays intact on the view object for audit. This suite proves:
//   (1) exact derived sentences for the normal, arrival-only,
//       rest-day, no-timed-activity, and empty shapes, in the
//       natural shape (destination + hotel clause + stop count +
//       first-activity + wrap-up; rest-block time NEVER in the
//       headline; no "planned stops" label anywhere);
//   (2) the stored text is unchanged alongside the displayed
//       correction (stored-vs-displayed comparison, incl. the live
//       Montreal Day 1 stored sentence shape);
//   (3) the derivation is pure: input items, their order, and the
//       day object are deep-identical before and after;
//   (4) no file in this round writes the stored summary back
//       (no primary_plan assignment in the derivation, the home
//       view builder, or either render surface);
//   (5) both render surfaces use the derived value (panel renders
//       displaySummary; day card derives from its FULL timeline
//       items, not its capped rendered rows);
//   (6) ONE STOP-COUNT RULE: the capped card view and the full
//       panel view print the identical count for the same day
//       (live Montreal Day 1 = 6, unplanned row counted, never
//       labelled planned);
//   (7) display-only activity-description shortening (generic
//       arrival filler cut; walk/drive times, dietary facts,
//       opening-hour notes, and genuine directions retained);
//   (8) a plan stay row (check-in / check-out / return) is never
//       promoted to confirmed by a booking title match.
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-ux-display-day-summary-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveDaySummary, daySummaryStartClock, countDayStops } from "../lib/roamly/daySummary.ts";
import { buildHomeDayView } from "../lib/roamly/itineraryHome.ts";
import { displayActivityDescription, displayRestTitle } from "../lib/roamly/activityDescription.ts";
import { isPlanStayRow } from "../lib/roamly/planStayRow.ts";
import { provenanceForHomeRow } from "../lib/roamly/timeProvenance.ts";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// ---- Clock extraction: start only, Planned stripped, p.m. normalised ----
ok("clock: Planned prefix stripped, range reduced to start, p.m. normalised", () => {
  assert.equal(daySummaryStartClock("Planned · 8:00 AM–9:45 AM"), "8:00 AM");
  assert.equal(daySummaryStartClock("1:00 p.m.–3:00 p.m."), "1:00 PM");
  assert.equal(daySummaryStartClock("Flexible"), null);
  assert.equal(daySummaryStartClock("Check-in"), null);
  assert.equal(daySummaryStartClock(""), null);
});

// ---- Normal day: travel + arrival + 3 stops + rest + return ----
const montrealLike = [
  { time: "Planned · 8:00 AM–9:45 AM", title: "Travel from Origin City to Destination City", kind: "travel" },
  { time: "10:30 AM", title: "Arrive in Destination City", kind: "arrival" },
  { time: "1:00 PM–3:00 PM", title: "Central Market Hall", kind: "venue" },
  { time: "3:30 PM", title: "Rest at the hotel", kind: "rest" },
  { time: "4:30 PM", title: "Harbor Gallery", kind: "venue" },
  { time: "6:30 PM", title: "Riverside Theatre", kind: "venue" },
  { time: "8:30 PM", title: "Return to Harbor Hotel", kind: "return-to-stay" }
];
ok("normal day: natural shape — destination + hotel + count + first + wrap, rest time NOT in headline", () => {
  assert.equal(
    deriveDaySummary(montrealLike),
    "Arrive in Destination City, settle into your hotel, and explore three stops. Your first activity begins at 1:00 PM, with your day wrapping up around 8:30 PM."
  );
  assert.equal(deriveDaySummary(montrealLike).includes("3:30 PM"), false);
  assert.equal(deriveDaySummary(montrealLike).includes("planned stops"), false);
});

// ---- Arrival-only day ----
ok("arrival-only day: short shape, no stops, no invented activity", () => {
  assert.equal(
    deriveDaySummary([
      { time: "8:00 AM", title: "Travel to Destination City", kind: "travel" },
      { time: "10:30 AM", title: "Arrive in Destination City", kind: "arrival" }
    ]),
    "Arrive in Destination City."
  );
  assert.equal(
    deriveDaySummary([
      { time: "8:00 AM", title: "Travel from Origin City to Destination City", kind: "travel" },
      { time: "Check-in", title: "Harbor Hotel", kind: "arrival", itemType: "hotel", category: "hotel" }
    ]),
    "Arrive in Destination City and settle into your hotel."
  );
});

// ---- Rest day ----
ok("rest day: rest-day sentence, no stop count invented", () => {
  assert.equal(
    deriveDaySummary([
      { time: "10:00 AM", title: "Rest", kind: "rest" },
      { time: "8:30 PM", title: "Return to Harbor Hotel", kind: "return-to-stay" }
    ]),
    "A rest day, wrapping up around 8:30 PM."
  );
});

// ---- No timed activities: names only, no times invented ----
ok("no timed activities: count + names, explicitly no fixed times", () => {
  assert.equal(
    deriveDaySummary([
      { time: "Flexible", title: "Central Market Hall", kind: "venue" },
      { time: "Flexible", title: "Harbor Gallery", kind: "venue" }
    ]),
    "Explore two stops — Central Market Hall and Harbor Gallery, with no fixed times set."
  );
});

// ---- Empty day: nothing to derive ----
ok("empty day: derivation is empty, caller fallback owns the copy", () => {
  assert.equal(deriveDaySummary([]), "");
});

// ---- Unverified stops count but are never named by junk title ----
ok("unverified stop: counted, never named; times without names", () => {
  assert.equal(
    deriveDaySummary([
      { time: "1:00 PM", title: "Some junk place name", kind: "venue", unverified: true, planTitle: "Some junk place name" },
      { time: "3:30 PM", title: "Harbor Gallery", kind: "venue" }
    ]),
    "Explore two stops. Your first activity begins at 1:00 PM."
  );
  assert.equal(
    deriveDaySummary([
      { time: "1:00 PM", title: "Some junk place name", kind: "venue", unverified: true, planTitle: "Some junk place name" },
      { time: "3:30 PM", title: "Harbor Gallery", kind: "venue" }
    ]).includes("Some junk place name"),
    false
  );
});

// ---- Hotel check-in time label is an arrival, never a stop ----
ok("check-in label: hotel row with time Check-in classifies as arrival, never a stop", () => {
  assert.equal(
    deriveDaySummary([
      { time: "9:37 AM", title: "Central Market Hall", itemType: "activity", category: "attraction" },
      { time: "Check-in", title: "Harbor Hotel", itemType: "hotel", category: "hotel", description: "Check in at Harbor Hotel — your base for this trip." }
    ]),
    "Settle into your hotel and explore one stop. Your first activity begins at 9:37 AM."
  );
  assert.equal(
    countDayStops([
      { time: "9:37 AM", title: "Central Market Hall", itemType: "activity", category: "attraction" },
      { time: "Check-in", title: "Harbor Hotel", itemType: "hotel", category: "hotel", description: "Check in at Harbor Hotel — your base for this trip." }
    ]),
    1
  );
});

// ---- Inference without an explicit kind (day-card items) ----
ok("inference: day-card itemType/category/title classify without kind", () => {
  assert.equal(
    deriveDaySummary([
      { time: "8:00 AM", title: "Flight to Destination City", itemType: "travel", category: "flight" },
      { time: "1:00 PM", title: "Central Market Hall", itemType: "activity", category: "attraction" },
      { time: "8:30 PM", title: "Return to Harbor Hotel", itemType: "hotel", category: "hotel", description: "Return to Harbor Hotel for the night" }
    ]),
    "Settle into your hotel and explore one stop. Your first activity begins at 1:00 PM, with your day wrapping up around 8:30 PM."
  );
});

// ---- Purity: inputs and order identical before and after ----
ok("purity: derivation mutates nothing — items, order, day object identical", () => {
  const before = JSON.parse(JSON.stringify(montrealLike));
  deriveDaySummary(montrealLike);
  assert.deepEqual(montrealLike, before);
  const dayInput = {
    day_number: 1, date: "2026-10-26",
    primary_plan: "Monday, October 26 begins at a humane hour — the first stop is Central Market Hall at 1:00 PM.",
    rows: [
      { time: "Planned · 8:00 AM–9:45 AM", title: "Travel from Origin City to Destination City", description: "Flight", location: "", category: "flight", itemType: "travel", durationLabel: "", travelLabel: "105 min travel", mapQuery: "", authority: "supporting", timeFromBooking: false },
      { time: "10:30 AM", title: "Arrive in Destination City", description: "Get to hotel and drop luggage", location: "", category: "transfer", itemType: "transfer", durationLabel: "", travelLabel: "", mapQuery: "", authority: "supporting", timeFromBooking: false },
      { time: "1:00 PM–3:00 PM", title: "Central Market Hall", description: "Historic market and local shops", location: "Old Town", category: "attraction", itemType: "activity", durationLabel: "120 min", travelLabel: "", mapQuery: "Central Market Hall", authority: "must_do", timeFromBooking: false },
      { time: "8:30 PM", title: "Return to Harbor Hotel", description: "Check-in and rest", location: "Harbor Hotel", category: "hotel", itemType: "stay", durationLabel: "", travelLabel: "", mapQuery: "Harbor Hotel", authority: "supporting", timeFromBooking: false }
    ]
  };
  const dayBefore = JSON.parse(JSON.stringify(dayInput));
  const view = buildHomeDayView(dayInput);
  assert.deepEqual(dayInput, dayBefore);
  // Stored text preserved verbatim on the view; displayed text differs.
  assert.equal(view.subtitle, dayInput.primary_plan);
  assert.equal(
    view.displaySummary,
    "Arrive in Destination City, settle into your hotel, and explore one stop. Your first activity begins at 1:00 PM, with your day wrapping up around 8:30 PM."
  );
  assert.notEqual(view.displaySummary, view.subtitle);
  assert.equal(view.displaySummary.includes("humane hour"), false);
  // Rows identical and in the same order as the input rows.
  assert.deepEqual(view.rows.map((row) => row.title), [
    "Travel from Origin City to Destination City",
    "Arrive in Destination City",
    "Central Market Hall",
    "Return to Harbor Hotel"
  ]);
});

// ---- Empty-rows fallback: stored text shown only when nothing to derive from ----
ok("empty rows: displaySummary falls back to stored text, never invents", () => {
  const view = buildHomeDayView({ day_number: 2, date: "2026-10-27", primary_plan: "A quiet day", rows: [] });
  assert.equal(view.displaySummary, "A quiet day");
  assert.equal(view.subtitle, "A quiet day");
});

// ---- No stored-summary writes anywhere in this round's render path ----
ok("no stored writes: no primary_plan assignment in derivation, builder, or surfaces", () => {
  for (const file of [
    "lib/roamly/daySummary.ts",
    "lib/roamly/itineraryHome.ts",
    "components/trip/ItineraryHomePanel.tsx",
    "components/trip/ItineraryDayPlan.tsx"
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/primary_plan\s*=/.test(src), false, `${file} must never assign primary_plan`);
    assert.equal(/\.primary_plan\s*=\s*[^=]/.test(src), false, `${file} must never assign primary_plan`);
  }
});

// ---- Both render surfaces use the derived value ----
ok("surfaces: panel renders displaySummary; day card derives from FULL timeline items, not capped rows", () => {
  const panel = readFileSync(new URL("../components/trip/ItineraryHomePanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /selectedDay\.displaySummary/);
  assert.equal(panel.includes("{selectedDay.subtitle}"), false);
  const card = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  assert.match(card, /deriveDaySummary\(/);
  assert.match(card, /derivedDaySummary \|\| presentTravelerArea/);
  // The one-count rule at the call site: the card builds an
  // uncapped list for the summary while rendering the capped one,
  // with the SAME options as the home panel (travel leg kept, so
  // the destination clause survives; stored order kept).
  assert.match(card, /fullTimelineItems = buildDisplayTimelineItems\(day, confirmedBookings, \{ suppressFlightFraming, maxRows: null, keepTravelRows: true, keepStoredOrder: true \}\)/);
  // Correction phase (D2, 2026-10-28): the card now maps the full
  // items ONCE into `summaryItems` and derives the summary AND the
  // rest/wrap clocks from that same list. The old inline
  // deriveDaySummary(fullTimelineItems.map(...)) call shape is gone,
  // but the behavior — summary from the FULL items, never the capped
  // rendered list — is unchanged: summaryItems is a 1:1 map of
  // fullTimelineItems with no filtering. The assertion follows the
  // new call shape instead of the old one.
  assert.match(card, /summaryItems = fullTimelineItems\.map/);
  assert.match(card, /deriveDaySummary\(summaryItems\)/);
  assert.match(card, /dayRestAndWrap\(summaryItems\)/);
});

// ---- Length bound ----
ok("length: derived summary never exceeds 160 characters", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    time: `${1 + i}:00 PM`, title: `A Very Long Named Attraction Number ${i + 1} With Extra Words`, kind: "venue"
  }));
  const summary = deriveDaySummary(many);
  assert.ok(summary.length <= 160, `length ${summary.length}: ${summary}`);
});

// ---- ONE STOP-COUNT RULE: live Montreal Day 1 shape ----
// Full day (10 rows, home-panel shape): travel leg, check-in
// arrival, 6 stops (Musée, Galerie Blanche, Resto Végo, the WIP
// unplanned stop, Théâtre Jean-Duceppe, Le Centre d'art), a rest
// block, and the return. The capped card view shows only the
// first 6 rows of the same day — the count must still be 6.
const montrealDay1Full = [
  { time: "Arrival", title: "Travel from Saint John to Montreal", kind: "travel" },
  { time: "Check-in", title: "Hôtel Place d'Armes", kind: "arrival", itemType: "hotel", category: "hotel", description: "Check in at Hôtel Place d'Armes — your base for this trip." },
  { time: "9:37 AM", title: "Musée du marché Sainte-Anne et du parlement de la province du Canada", kind: "venue" },
  { time: "11:10 AM", title: "Galerie Blanche", kind: "venue" },
  { time: "12:37 PM", title: "Resto Végo", kind: "venue" },
  { time: "1:45 PM", title: "WIP", kind: "venue", unverified: true, planTitle: "WIP" },
  { time: "2:54 PM", title: "Théâtre Jean-Duceppe", kind: "venue" },
  { time: "3:54 PM", title: "A short pause", kind: "rest" },
  { time: "4:13 PM", title: "Le Centre d'art et musée de Montréal", kind: "venue" },
  { time: "5:17 PM", title: "Return to your stay", kind: "return-to-stay" }
];
const montrealDay1Expected =
  "Arrive in Montreal, settle into your hotel, and explore six stops. Your first activity begins at 9:37 AM, with your day wrapping up around 5:17 PM.";
ok("one-count rule: full day counts 6 stops (arrival, check-in, rest, return excluded)", () => {
  assert.equal(countDayStops(montrealDay1Full), 6);
  assert.equal(deriveDaySummary(montrealDay1Full), montrealDay1Expected);
  assert.equal(deriveDaySummary(montrealDay1Full).includes("planned stops"), false);
  assert.equal(deriveDaySummary(montrealDay1Full).includes("3:54 PM"), false);
});
ok("one-count rule: capped first-6 rows count only 4 — so the card must NOT derive from them", () => {
  const capped = montrealDay1Full.slice(0, 6);
  assert.equal(countDayStops(capped), 4);
  assert.notEqual(deriveDaySummary(capped), montrealDay1Expected);
});
ok("one-count rule: home panel over the same full day prints the identical sentence", () => {
  const row = (over) => ({
    time: "", title: "", description: "", location: "", category: "",
    itemType: "", durationLabel: "", travelLabel: "", mapQuery: "",
    authority: "supporting", timeFromBooking: false, ...over
  });
  const view = buildHomeDayView({
    day_number: 1, date: "2026-10-26", primary_plan: "Monday, October 26 begins at a humane hour — stored text, untouched.",
    rows: [
      row({ time: "Arrival", title: "Travel from Saint John to Montreal", itemType: "travel", category: "travel" }),
      row({ time: "Check-in", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Check in at Hôtel Place d'Armes — your base for this trip." }),
      row({ time: "9:37 AM", title: "Musée du marché Sainte-Anne et du parlement de la province du Canada", itemType: "activity", category: "attraction" }),
      row({ time: "11:10 AM", title: "Galerie Blanche", itemType: "activity", category: "attraction" }),
      row({ time: "12:37 PM", title: "Resto Végo", itemType: "activity", category: "restaurant" }),
      row({ time: "1:45 PM", title: "WIP", itemType: "activity", category: "attraction", description: "" }),
      row({ time: "2:54 PM", title: "Théâtre Jean-Duceppe", itemType: "activity", category: "attraction" }),
      row({ time: "3:54 PM", title: "A short pause", itemType: "rest", category: "rest" }),
      row({ time: "4:13 PM", title: "Le Centre d'art et musée de Montréal", itemType: "activity", category: "attraction" }),
      row({ time: "5:17 PM", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Return to Hôtel Place d'Armes for the night." })
    ]
  });
  assert.equal(view.displaySummary, montrealDay1Expected);
  assert.equal(view.subtitle, "Monday, October 26 begins at a humane hour — stored text, untouched.");
});
ok("one-count rule: return row NOT last (clock-sorted card list) still classifies as return, never a 7th stop", () => {
  // The day card's clock sort puts clock-less rows (travel,
  // check-in) AFTER the 5:17 PM return. The return's own
  // description signature must still win over position.
  const sortedLike = [
    { time: "9:37 AM", title: "Musée du marché Sainte-Anne et du parlement de la province du Canada", itemType: "activity", category: "attraction" },
    { time: "11:10 AM", title: "Galerie Blanche", itemType: "activity", category: "attraction" },
    { time: "12:37 PM", title: "Resto Végo", itemType: "activity", category: "restaurant" },
    { time: "1:45 PM", title: "WIP", itemType: "activity", category: "attraction", unverified: true, planTitle: "WIP" },
    { time: "2:54 PM", title: "Théâtre Jean-Duceppe", itemType: "activity", category: "attraction" },
    { time: "3:54 PM", title: "A short pause", itemType: "rest", category: "rest" },
    { time: "4:13 PM", title: "Le Centre d'art et musée de Montréal", itemType: "activity", category: "attraction" },
    { time: "5:17 PM", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Return to Hôtel Place d'Armes for the night." },
    { time: "Arrival", title: "Travel from Saint John to Montreal", itemType: "travel", category: "travel" },
    { time: "Check-in", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Check in at Hôtel Place d'Armes — your base for this trip." }
  ];
  assert.equal(countDayStops(sortedLike), 6);
  assert.equal(deriveDaySummary(sortedLike), montrealDay1Expected);
});
ok("one-count rule: no-hotel day omits the settle clause (no invented stay)", () => {
  assert.equal(
    deriveDaySummary([
      { time: "Arrival", title: "Travel from Saint John to Montreal", kind: "travel" },
      { time: "9:37 AM", title: "Musée du marché Sainte-Anne et du parlement de la province du Canada", kind: "venue" },
      { time: "11:10 AM", title: "Galerie Blanche", kind: "venue" }
    ]),
    "Arrive in Montreal and explore two stops. Your first activity begins at 9:37 AM."
  );
});

// ---- Display-only activity descriptions: selective flattening ----
ok("descriptions: generic arrival filler cut; useful guidance retained verbatim", () => {
  // Live row: title already says the route, so the flattened
  // description drops as a title echo (title carries it).
  assert.equal(
    displayActivityDescription(
      "Travel from Saint John to Montreal",
      "Arrival travel from Saint John to Montreal — make your way in, then settle at your stay."
    ),
    ""
  );
  // Same generic sentence under a different title still flattens
  // to the short route sentence (the shortening itself, pinned).
  assert.equal(
    displayActivityDescription(
      "Arrival",
      "Arrival travel from Saint John to Montreal — make your way in, then settle at your stay."
    ),
    "Travel from Saint John to Montreal."
  );
  // Retained: walk/drive times, dietary facts, opening-hour
  // notes, genuine directions, stay instructions.
  assert.equal(
    displayActivityDescription("Walk to Galerie Blanche", "Walk from Resto Végo to Galerie Blanche — about 8 min."),
    "Walk from Resto Végo to Galerie Blanche — about 8 min."
  );
  assert.equal(
    displayActivityDescription("Resto Végo", "Lunch is at Resto Végo, 12:37–13:37. The choice is backed by the restaurant's own listing, which marks it diet:vegan = yes."),
    "Lunch is at Resto Végo, 12:37–13:37. The choice is backed by the restaurant's own listing, which marks it diet:vegan = yes."
  );
  assert.equal(
    displayActivityDescription("Musée du marché", "Opening hours weren't listed for Musée du marché — worth a glance at the door."),
    "Opening hours weren't listed for Musée du marché — worth a glance at the door."
  );
  assert.equal(
    displayActivityDescription("Hôtel Place d'Armes", "Check in at Hôtel Place d'Armes — your base for this trip."),
    "Check in at Hôtel Place d'Armes — your base for this trip."
  );
  assert.equal(
    displayActivityDescription("Hôtel Place d'Armes", "Return to Hôtel Place d'Armes for the night."),
    "Return to Hôtel Place d'Armes for the night."
  );
  assert.equal(
    displayActivityDescription(
      "Travel from Montreal to Saint John",
      "Departure travel from Montreal back to Saint John — collect your luggage from your stay and head out."
    ),
    "Departure travel from Montreal back to Saint John — collect your luggage from your stay and head out."
  );
  // The shortening lives in the display layer only: the day-card
  // builder and the home-row builder both route through it, and
  // no file assigns the shortened text back to a stored field.
  const card = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  assert.match(card, /displayActivityDescription\(title, strippedDescription\)/);
  const home = readFileSync(new URL("../lib/roamly/itineraryHome.ts", import.meta.url), "utf8");
  assert.match(home, /displayActivityDescription\(/);
});

// ---- Rest-break wording (final refinements, 2026-10-28): display-only ----
ok("rest wording: solver title + narrative line shorten; meaning, time, and count preserved", () => {
  // Title mapping: exact solver phrase (any dash) -> "A short rest".
  assert.equal(displayRestTitle("A short pause — sit down, water, breathe"), "A short rest");
  assert.equal(displayRestTitle("A short pause - sit down, water, breathe"), "A short rest");
  // Everything else passes through: the already-concise short form,
  // meal windows, and real venue titles are never rewritten.
  assert.equal(displayRestTitle("A short pause"), "A short pause");
  assert.equal(displayRestTitle("Lunch window — nothing booked; eat when you find a spot"), "Lunch window — nothing booked; eat when you find a spot");
  assert.equal(displayRestTitle("Galerie Blanche"), "Galerie Blanche");
  // Description mapping: the narrative break line shortens to one
  // sentence; the solver phrase (alone or with the engine's
  // generic "planned for day N" tail) drops as a title echo.
  assert.equal(
    displayActivityDescription("A short pause", "A short pause is built in here — sit down, water, nowhere to be for a few minutes."),
    "A short rest."
  );
  assert.equal(
    displayActivityDescription("A short pause — sit down, water, breathe", "A short pause — sit down, water, breathe — planned for day 1 of this trip."),
    ""
  );
  assert.equal(
    displayActivityDescription("A short pause — sit down, water, breathe", "A short pause — sit down, water, breathe"),
    ""
  );
  // The mapping is applied at render time on all three surfaces
  // that show the row (home panel, day card, Live timeline).
  const home = readFileSync(new URL("../lib/roamly/itineraryHome.ts", import.meta.url), "utf8");
  assert.match(home, /displayRestTitle\(getString\(item\.title\)\)/);
  const card = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  assert.match(card, /displayRestTitle\(title\)/);
  const live = readFileSync(new URL("../lib/roamly/liveDayTimeline.ts", import.meta.url), "utf8");
  assert.match(live, /displayRestTitle\(stopTitle\)/);
  // Meaning preservation, end to end: the same full Montreal Day 1
  // with the REAL solver rest title still counts 6, still shows
  // the rest row at its real clock time, and never turns the rest
  // block into a stop.
  const row = (over) => ({
    time: "", title: "", description: "", location: "", category: "",
    itemType: "", durationLabel: "", travelLabel: "", mapQuery: "",
    authority: "supporting", timeFromBooking: false, ...over
  });
  const view = buildHomeDayView({
    day_number: 1, date: "2026-10-26", primary_plan: "stored text, untouched.",
    rows: [
      row({ time: "Arrival", title: "Travel from Saint John to Montreal", itemType: "travel", category: "travel" }),
      row({ time: "Check-in", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Check in at Hôtel Place d'Armes — your base for this trip." }),
      row({ time: "9:37 AM", title: "Musée du marché Sainte-Anne et du parlement de la province du Canada", itemType: "activity", category: "attraction" }),
      row({ time: "11:10 AM", title: "Galerie Blanche", itemType: "activity", category: "attraction" }),
      row({ time: "12:37 PM", title: "Resto Végo", itemType: "activity", category: "restaurant" }),
      row({ time: "1:45 PM", title: "WIP", itemType: "activity", category: "attraction", description: "" }),
      row({ time: "2:54 PM", title: "Théâtre Jean-Duceppe", itemType: "activity", category: "attraction" }),
      row({ time: "3:54 PM", title: "A short pause — sit down, water, breathe", itemType: "rest", category: "rest", description: "A short pause — sit down, water, breathe — planned for day 1 of this trip." }),
      row({ time: "4:13 PM", title: "Le Centre d'art et musée de Montréal", itemType: "activity", category: "attraction" }),
      row({ time: "5:17 PM", title: "Hôtel Place d'Armes", itemType: "hotel", category: "hotel", description: "Return to Hôtel Place d'Armes for the night." })
    ]
  });
  assert.equal(view.displaySummary, montrealDay1Expected);
  const restRow = view.rows.find((r) => r.time === "3:54 PM");
  assert.equal(restRow.title, "A short rest");
  assert.equal(restRow.time, "3:54 PM");
  assert.equal(view.rows.filter((r) => r.title === "A short rest").length, 1);
});

// ---- Check-in evidence: plan stay rows never read as confirmed ----
ok("check-in guard: plan stay rows identified; venue and booking rows not flagged", () => {
  assert.equal(isPlanStayRow({ itemType: "hotel", category: "hotel", time: "Check-in", title: "Hôtel Place d'Armes", description: "Check in at Hôtel Place d'Armes — your base for this trip." }), true);
  assert.equal(isPlanStayRow({ itemType: "hotel", category: "hotel", time: "5:17 PM", title: "Hôtel Place d'Armes", description: "Return to Hôtel Place d'Armes for the night." }), true);
  assert.equal(isPlanStayRow({ itemType: "hotel", category: "hotel", time: "Check-out", title: "Hôtel Place d'Armes", description: "Check out of Hôtel Place d'Armes and keep luggage handled before departure." }), true);
  assert.equal(isPlanStayRow({ itemType: "hotel", category: "hotel", time: "5:17 PM", title: "Return to your stay", description: "" }), true);
  assert.equal(isPlanStayRow({ itemType: "activity", category: "attraction", time: "9:37 AM", title: "Musée du marché", description: "Historic market." }), false);
  // A confirmed booking row (booking-table shape: clock time,
  // provider description) is NOT a plan stay row — verified
  // booking rows keep their own evidence.
  assert.equal(isPlanStayRow({ itemType: "hotel", category: "Stay", time: "4:00 PM", title: "Hôtel Place d'Armes", description: "Booking.com" }), false);
  // The day-card builder applies the guard before any promotion.
  const card = readFileSync(new URL("../components/trip/ItineraryDayPlan.tsx", import.meta.url), "utf8");
  assert.match(card, /isPlanStayRow\(output\[index\]\)/);
  // And an unpromoted plan row's time provenance is Planned, never
  // Confirmed (the home panel's pill rule for a non-booked row).
  assert.equal(provenanceForHomeRow({ planned: false, booked: false, timeFromBooking: false, retimed: false }), "planned");
  assert.equal(provenanceForHomeRow({ planned: false, booked: true, timeFromBooking: false, retimed: false }), "confirmed");
});

console.log(`display-day-summary checks: ${passed} passed, 0 failed`);
