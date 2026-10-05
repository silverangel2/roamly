// Roamly October 4 customer-journey repair — deterministic regression checks.
// Run from the repo root:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-october4-journey-checks.mjs
// Covers the planner, payment, generation, readiness-gate, grounded-content,
// companion, and trips-navigation repairs with PASS/FAIL assertions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// ---------------------------------------------------------------------------
// Phase 1: planner / draft state
// ---------------------------------------------------------------------------
const planForm = readFileSync("components/plan/TripPlanForm.tsx", "utf8");
check("stored draft restore always surfaces the resume notice", () => {
  assert.match(planForm, /setRestoreNotice\(true\)/, "restore notice must not be gated on ?resumePlan=1");
  assert.doesNotMatch(planForm, /setRestoreNotice\(shouldShowResumeNotice\)/, "old gated notice must be gone");
});
check("trip brief shows Transport before payment", () => {
  assert.match(planForm, /\["Transport", payload\.transportationPreference/, "Transport row in summaryRows");
});

const tripPlanner = await import("../lib/trip-planner.ts");
check("Drive is an explicit transportation option", () => {
  assert.ok(tripPlanner.transportationOptions.includes("Drive"), "transportationOptions must include Drive");
});

// ---------------------------------------------------------------------------
// Phase 4/5 shared: effective transport mode
// ---------------------------------------------------------------------------
const itineraryLib = await import("../lib/itinerary.ts");
const drivePayload = {
  origin: "Saint John",
  destination: "Montreal",
  transportationPreference: "Drive",
  startDate: "2026-10-30",
  endDate: "2026-11-02",
  daysCount: 4,
  budgetAmount: 800,
  budgetCurrency: "CAD"
};
check("explicit Drive preference resolves to drive mode", () => {
  assert.equal(itineraryLib.effectiveTransportMode(drivePayload), "drive");
});
check("Rental car preference resolves to drive mode", () => {
  assert.equal(itineraryLib.effectiveTransportMode({ ...drivePayload, transportationPreference: "Rental car" }), "drive");
});
check("Mixed preference does not force a mode", () => {
  assert.equal(itineraryLib.effectiveTransportMode({ ...drivePayload, transportationPreference: "Mixed" }), "mixed transport");
});

// ---------------------------------------------------------------------------
// Phase 2: payment entitlement synchronization
// ---------------------------------------------------------------------------
const payments = readFileSync("lib/payments.ts", "utf8");
check("return path applies the purchase immediately", () => {
  assert.match(payments, /await applyPaidCheckoutSession\(session\)/, "confirmCheckoutSessionForTrip must apply, not just verify");
  assert.match(payments, /awaitingWebhook: !applied\.ok/, "webhook wait only when the immediate apply failed");
});
const tripPage = readFileSync("app/trip/[id]/page.tsx", "utf8");
check("trip page waits on webhook only when the apply failed", () => {
  assert.match(tripPage, /checkoutAwaitingWebhook = confirmation\.awaitingWebhook === true/, "no unconditional payment-required-until-refresh");
});
const envFile = readFileSync("lib/env.ts", "utf8");
check("prices unchanged: 4.99 / 3.99 / 7.99", () => {
  assert.match(envFile, /itineraryUnlockPriceCents: 499/);
  assert.match(envFile, /trackingAddonPriceCents: 399/);
  assert.match(envFile, /tripBundlePriceCents: 799/);
});

// ---------------------------------------------------------------------------
// Phase 3: generation client/job reconciliation
// ---------------------------------------------------------------------------
const progress = readFileSync("components/trip/StagedGenerationProgress.tsx", "utf8");
check("polling re-arms after a thrown network error", () => {
  assert.match(progress, /pollRetryNonce/, "retry nonce forces the polling loop to re-arm");
  assert.match(progress, /setPollRetryNonce\(\(nonce\) => nonce \+ 1\)/, "thrown fetch bumps the nonce");
});
const billing = readFileSync("lib/roamly/billing.ts", "utf8");
check("duplicate guard consults the durable queue job", () => {
  assert.match(billing, /latestActiveGenerationJob\(supabase, tripId, userId\)/, "active job lookup before trusting staleness");
  assert.match(billing, /ACTIVE_GENERATION_JOB_STATUSES/, "queued/running/waiting are active");
  assert.match(billing, /if \(activeJob \|\| !isStaleGeneratingTrip\(trip\)\)/, "active job blocks even when the row looks stale");
});

// ---------------------------------------------------------------------------
// Phase 4: traveler-ready completion gate
// ---------------------------------------------------------------------------
function dayPlan(dayNumber, items) {
  return {
    day_number: dayNumber,
    date: `2026-10-${29 + dayNumber}`,
    live_timeline: items.map((item, index) => ({
      time_label: ["Morning", "Midday", "Afternoon", "Evening"][index % 4],
      title: item.title,
      description: item.description || "",
      location_name: item.location_name || "Montreal",
      estimated_cost: null,
      category: item.category || "Activity",
      map_query: item.title,
      item_type: item.item_type || "activity",
      travel_mode: item.travel_mode,
      candidateId: item.candidateId,
      factualStatus: item.factualStatus,
      cost_status: item.cost_status
    })),
    estimated_cost: 0
  };
}
function gateFixture(itemsByDay, payload) {
  return {
    trip_title: "Montreal trip",
    generation_note: "Generated through Roamly staged AI generation.",
    daily_itinerary: itemsByDay.map(([n, items]) => dayPlan(n, items)),
    booking_suggestions: [],
    estimated_budget_breakdown: { total_estimate_amount: 750, currency: "CAD" }
  };
}
const validDriveItems = [
  [1, [
    { title: "Leave Saint John", item_type: "travel", travel_mode: "drive" },
    { title: "Drive to Montreal", item_type: "travel", travel_mode: "drive" },
    { title: "Hotel Bonaventure Montreal", item_type: "hotel", candidateId: "hotel-cand-1", factualStatus: "estimated" }
  ]],
  [2, [
    { title: "Notre-Dame Basilica visit", description: "Timed admission in Old Montreal." },
    { title: "Lunch at Schwartz's Deli", item_type: "meal" }
  ]],
  [3, [
    { title: "Mount Royal lookout walk", description: "Free skyline walk." },
    { title: "Old Montreal walking tour" }
  ]],
  [4, [
    { title: "Jean-Talon Market breakfast", item_type: "meal" },
    { title: "Drive back to Saint John", item_type: "travel", travel_mode: "drive" }
  ]]
];
check("gate passes a valid drive itinerary", () => {
  const result = itineraryLib.validateItineraryForProduction(gateFixture(validDriveItems, drivePayload), drivePayload);
  assert.deepEqual(result.errors, [], `expected no errors, got: ${result.errors.join(" | ")}`);
  assert.equal(result.ok, true);
});
check("gate rejects a search placeholder as a plan item", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[0][1].unshift({ title: "Search flights", item_type: "travel" });
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /search is not a plan/i.test(e)), result.errors.join(" | "));
});
check("gate rejects flight content on a drive trip", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[0][1][1] = { title: "Flight to Montreal", item_type: "travel", travel_mode: "flight" };
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /flight content on a drive trip/i.test(e)), result.errors.join(" | "));
});
check("gate rejects duplicate activities across days", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[2][1].push({ title: "Notre-Dame Basilica visit", description: "Evening return." });
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /must not repeat across days/i.test(e)), result.errors.join(" | "));
});
check("gate rejects raw links in titles", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[1][1].push({ title: "Cool tour https://www.klook.com/activity/123" });
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /raw link/i.test(e)), result.errors.join(" | "));
});
check("gate rejects generic placeholders", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[1][1].push({ title: "Lunch at a local restaurant", item_type: "meal" });
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /generic placeholder/i.test(e)), result.errors.join(" | "));
});
check("gate rejects TBD items", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[1][1].push({ title: "Evening plans TBD" });
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Phase 5: authoritative grounding / transport / budget
// ---------------------------------------------------------------------------
const transportOptionsLib = await import("../lib/roamly/transportOptions.ts");
check("transportModeFromPreference maps Drive and Rental car", () => {
  assert.equal(transportOptionsLib.transportModeFromPreference("Drive"), "drive");
  assert.equal(transportOptionsLib.transportModeFromPreference("Rental car"), "drive");
  assert.equal(transportOptionsLib.transportModeFromPreference("Mixed"), null);
  assert.equal(transportOptionsLib.transportModeFromPreference("Flying"), "flight");
});
check("explicit drive choice outranks a cheaper flight", () => {
  const options = [
    { mode: "flight", realistic: true, availability: "verified", estimated_cost_min: 120, estimated_cost_max: 180, title: "Flight", origin: "Saint John", destination: "Montreal" },
    { mode: "drive", realistic: true, availability: "search_ready", estimated_cost_min: 140, estimated_cost_max: 200, title: "Drive", origin: "Saint John", destination: "Montreal" }
  ];
  const picked = transportOptionsLib.pickRecommendedTransportOption(options, { budgetAmount: 800, transportationPreference: "Drive" });
  assert.equal(picked.mode, "drive", `expected drive, got ${picked.mode}`);
});
check("no preference keeps cost-based recommendation", () => {
  const options = [
    { mode: "flight", realistic: true, availability: "verified", estimated_cost_min: 120, estimated_cost_max: 180, title: "Flight", origin: "Saint John", destination: "Montreal" },
    { mode: "drive", realistic: true, availability: "search_ready", estimated_cost_min: 140, estimated_cost_max: 200, title: "Drive", origin: "Saint John", destination: "Montreal" }
  ];
  const picked = transportOptionsLib.pickRecommendedTransportOption(options, { budgetAmount: 800 });
  assert.ok(picked, "a recommendation is still produced without a preference");
});
check("budget total comes from the grounded ledger first", () => {
  const itinerary = {
    estimated_budget_breakdown: { total_estimate_amount: 1677, currency: "CAD" },
    daily_itinerary: []
  };
  assert.equal(itineraryLib.getItineraryTotalEstimateAmount(itinerary, { totalEstimateCents: 87700 }), 877);
});
check("budget total falls back without grounded data", () => {
  const itinerary = {
    estimated_budget_breakdown: { total_estimate_amount: 1677, currency: "CAD" },
    daily_itinerary: []
  };
  assert.equal(itineraryLib.getItineraryTotalEstimateAmount(itinerary, null), 1677);
  assert.equal(itineraryLib.getItineraryTotalEstimateAmount(itinerary), 1677);
});
const itinerarySource = readFileSync("lib/itinerary.ts", "utf8");
check("drive trips get a driving-route suggestion, not an airport transfer", () => {
  assert.match(itinerarySource, /Driving route: \$\{origin\} to \$\{city\.label\}/, "drive-aware transport suggestion");
  assert.match(itinerarySource, /Matches the drive transport choice instead of suggesting an airport transfer/);
});
check("domestic packing lists photo ID, not a passport", () => {
  assert.match(itinerarySource, /Photo ID \(driver's licence or equivalent\)/, "domestic packing");
  assert.doesNotMatch(itinerarySource, /\["Passport\/ID"\]/, "bare Passport/ID fallback removed");
});

const travelRequirements = await import("../lib/roamly/travelRequirements.ts");
check("domestic travel marks entry requirements not applicable", () => {
  const requirements = travelRequirements.deriveTravelRequirements({
    destinationCountry: "CA",
    originCountry: "CA",
    passportIssuingCountry: "CA"
  });
  const entry = requirements.find((r) => r.category === "VISA_OR_AUTHORIZATION");
  assert.equal(entry.status, "NOT_APPLICABLE");
});
check("international travel still requires review", () => {
  const requirements = travelRequirements.deriveTravelRequirements({
    destinationCountry: "FR",
    originCountry: "CA",
    passportIssuingCountry: "CA"
  });
  const entry = requirements.find((r) => r.category === "VISA_OR_AUTHORIZATION");
  assert.equal(entry.status, "REVIEW_REQUIRED");
});

// ---------------------------------------------------------------------------
// Phase 6: companion
// ---------------------------------------------------------------------------
check("companion excludes search placeholders from NEXT", () => {
  assert.equal(itineraryLib.isCompanionEligibleActivity({ title: "Search flights" }), false);
  assert.equal(itineraryLib.isCompanionEligibleActivity({ title: "Lunch at a local restaurant" }), false);
  assert.equal(itineraryLib.isCompanionEligibleActivity({ title: "Notre-Dame Basilica visit" }), true);
  assert.equal(itineraryLib.isCompanionEligibleActivity({ title: "" }), false);
});
const livePage = readFileSync("app/trip/[id]/live/page.tsx", "utf8");
check("live page NEXT uses the eligibility filter", () => {
  assert.match(livePage, /isCompanionEligibleActivity\(activity\)/, "NEXT selection filters placeholders");
});
const liveClient = readFileSync("components/trip/LiveTripClient.tsx", "utf8");
check("location-off produces a clear prompt with an action", () => {
  assert.match(liveClient, /Location is off — Live Companion can't track where you are/, "location-off banner");
  assert.match(liveClient, /Turn on location/, "location action button");
});

// ---------------------------------------------------------------------------
// Trips surface: /dashboard is the canonical trip list
// ---------------------------------------------------------------------------
check("trips nav labels /dashboard as Trips (canonical surface)", () => {
  const shell = readFileSync(new URL("../components/AppShellClient.tsx", import.meta.url), "utf8");
  assert.ok(/href:\s*"\/dashboard",\s*label:\s*t\("ui\.nav\.trips",\s*"Trips"\)/.test(shell),
    "nav must label /dashboard as Trips");
});
check("dashboard lists the traveler's trips with links to open them", () => {
  const page = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('from("roamly_trips")'), "dashboard must query the trips table");
  assert.ok(page.includes("typedTrips.map((trip)"), "dashboard must render a card per trip");
  assert.ok(page.includes("presentation.href"), "trip cards must link to the trip");
});
check("paid trip card links to /trip/[id] (discoverable and openable)", () => {
  const src = readFileSync(new URL("../lib/roamly/dashboardTripPresentation.ts", import.meta.url), "utf8");
  // Every trip card href resolves to the trip page (or live page when active).
  assert.ok(src.includes("href: liveNow ? `/trip/${trip.id}/live` : `/trip/${trip.id}`"),
    "trip card href must open /trip/[id]");
});

// ---------------------------------------------------------------------------
// Hotel readiness: negative tests (a hotel you would book)
// ---------------------------------------------------------------------------
function hotelFixture(timelineHotel) {
  const items = [
    [1, [
      { title: "Drive from Saint John to Montreal", item_type: "travel", travel_mode: "drive" },
      timelineHotel,
      { title: "Evening walk through Old Montreal" }
    ]],
    [2, [{ title: "Notre-Dame Basilica visit" }]],
    [3, [{ title: "Mount Royal lookout walk" }]],
    [4, [{ title: "Drive back to Saint John", item_type: "travel", travel_mode: "drive" }]]
  ];
  return gateFixture(items, drivePayload);
}
check("A: multi-day trip with NO hotel fails readiness", () => {
  const items = [
    [1, [
      { title: "Drive from Saint John to Montreal", item_type: "travel", travel_mode: "drive" },
      { title: "Evening walk through Old Montreal" }
    ]],
    [2, [{ title: "Notre-Dame Basilica visit" }]],
    [3, [{ title: "Mount Royal lookout walk" }]],
    [4, [{ title: "Drive back to Saint John", item_type: "travel", travel_mode: "drive" }]]
  ];
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /names no hotel/i.test(e)), result.errors.join(" | "));
});
check("B: hotel as \"Search hotels\" fails readiness", () => {
  const result = itineraryLib.validateItineraryForProduction(
    hotelFixture({ title: "Search hotels", item_type: "hotel" }), drivePayload);
  assert.equal(result.ok, false);
});
check("C: generic \"Hotel\" / \"Accommodation TBD\" fails readiness", () => {
  for (const bad of ["Hotel", "Accommodation TBD"]) {
    const result = itineraryLib.validateItineraryForProduction(
      hotelFixture({ title: bad, item_type: "hotel" }), drivePayload);
    assert.equal(result.ok, false, `expected FAIL for "${bad}"`);
  }
});
check("D: named hotel without grounding/provenance fails readiness", () => {
  const result = itineraryLib.validateItineraryForProduction(
    hotelFixture({ title: "Hotel Bonaventure Montreal", item_type: "hotel" }), drivePayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /no grounding\/provenance/i.test(e)), result.errors.join(" | "));
});
check("E: grounded named hotel (price UNKNOWN) passes hotel readiness", () => {
  const result = itineraryLib.validateItineraryForProduction(
    hotelFixture({ title: "Hotel Bonaventure Montreal", item_type: "hotel", candidateId: "hotel-cand-1", factualStatus: "estimated", cost_status: "UNKNOWN" }),
    drivePayload);
  assert.ok(!result.errors.some((e) => /hotel/i.test(e)), `hotel errors: ${result.errors.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Extra edge cases
// ---------------------------------------------------------------------------
check("gate rejects a hotel search placeholder", () => {
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[0][1][2] = { title: "Search hotel near downtown", item_type: "hotel" };
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, drivePayload), drivePayload);
  assert.equal(result.ok, false);
});
check("gate rejects drive content on a flight trip", () => {
  const flightPayload = { ...drivePayload, transportationPreference: "Flight" };
  const items = JSON.parse(JSON.stringify(validDriveItems));
  items[0][1][1] = { title: "Drive to Montreal", item_type: "travel", travel_mode: "drive" };
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, flightPayload), flightPayload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /drive content on a flight trip/i.test(e)), result.errors.join(" | "));
});
check("gate passes a valid flight itinerary without false positives", () => {
  const flightPayload = { ...drivePayload, transportationPreference: "Flight" };
  const items = [
    [1, [
      { title: "Flight to Montreal", item_type: "travel", travel_mode: "flight" },
      { title: "Transfer to hotel area", item_type: "transfer" },
      { title: "Hotel Bonaventure Montreal", item_type: "hotel", candidateId: "hotel-cand-1", factualStatus: "estimated" }
    ]],
    [2, [{ title: "Notre-Dame Basilica visit" }]],
    [3, [{ title: "Mount Royal lookout walk" }]],
    [4, [{ title: "Return flight home", item_type: "travel", travel_mode: "flight" }]]
  ];
  const result = itineraryLib.validateItineraryForProduction(gateFixture(items, flightPayload), flightPayload);
  assert.deepEqual(result.errors, [], `expected no errors, got: ${result.errors.join(" | ")}`);
});
check("transportModeFromPreference: transit and mixed are not hard modes", () => {
  assert.equal(transportOptionsLib.transportModeFromPreference("Public transit"), null);
  assert.equal(transportOptionsLib.transportModeFromPreference("Walking"), null);
  assert.equal(transportOptionsLib.transportModeFromPreference(""), null);
});
check("explicit flight choice picks the flight option", () => {
  const options = [
    { mode: "flight", realistic: true, availability: "verified", estimated_cost_min: 300, estimated_cost_max: 400, title: "Flight", origin: "Saint John", destination: "Montreal" },
    { mode: "drive", realistic: true, availability: "search_ready", estimated_cost_min: 140, estimated_cost_max: 200, title: "Drive", origin: "Saint John", destination: "Montreal" }
  ];
  const picked = transportOptionsLib.pickRecommendedTransportOption(options, { budgetAmount: 800, transportationPreference: "Flight" });
  assert.equal(picked.mode, "flight");
});
check("companion excludes TBD placeholders", () => {
  assert.equal(itineraryLib.isCompanionEligibleActivity({ title: "Evening plans TBD" }), false);
});
check("budget falls back to daily sums when nothing else exists", () => {
  const itinerary = {
    estimated_budget_breakdown: { total_estimate_amount: null, currency: "CAD" },
    daily_itinerary: [{ estimated_cost: 200 }, { estimated_cost: 150 }]
  };
  assert.equal(itineraryLib.getItineraryTotalEstimateAmount(itinerary, null), 350);
});
check("requirements still need review when origin is unknown", () => {
  const requirements = travelRequirements.deriveTravelRequirements({
    destinationCountry: "CA",
    originCountry: null,
    passportIssuingCountry: "CA"
  });
  const entry = requirements.find((r) => r.category === "VISA_OR_AUTHORIZATION");
  assert.equal(entry.status, "REVIEW_REQUIRED");
});
check("payments no longer returns a bare awaitingWebhook", () => {
  assert.doesNotMatch(payments, /return \{ ok: true, awaitingWebhook: true \}/, "every success path must attempt the immediate apply");
});

// ---------------------------------------------------------------------------
// Phase 7: trips navigation
// ---------------------------------------------------------------------------
const nextConfig = readFileSync("next.config.ts", "utf8");
check("/trips redirects to /dashboard", () => {
  assert.match(nextConfig, /source: "\/trips"/);
  assert.match(nextConfig, /destination: "\/dashboard"/);
});

console.log(`\nPASS: all ${passed} October 4 journey checks passed`);
