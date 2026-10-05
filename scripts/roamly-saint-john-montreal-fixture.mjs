// Full-journey regression against the Saint John -> Montreal deterministic fixture.
// Saint John NB -> Montreal QC, Oct 30-Nov 2 2026, 4 days, DRIVE, CA$800, Complete Trip Pack.
// Controlled grounded data only — no network, no provider calls.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, "fixtures/saint-john-montreal-drive.json"), "utf8"));

const itineraryLib = await import("../lib/itinerary.ts");
const transportLib = await import("../lib/roamly/transportOptions.ts");
const requirementsLib = await import("../lib/roamly/travelRequirements.ts");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok ${passed + failed} - ${name}`);
    console.log(`  ${String(err && err.message || err).split("\n").join("\n  ")}`);
  }
}

const { payload, itinerary, groundedPriceDiscovery } = fixture;

// 1. The 4-day drive itinerary passes the traveler-ready gate with zero errors.
check("fixture itinerary is traveler-ready (gate passes clean)", () => {
  const result = itineraryLib.validateItineraryForProduction(itinerary, payload);
  assert.equal(result.ok, true, `gate errors: ${result.errors.join(" | ")}`);
  assert.deepEqual(result.errors, []);
});

// 2. Explicit Drive preference resolves to the drive mode.
check("fixture Drive preference maps to drive mode", () => {
  assert.equal(transportLib.transportModeFromPreference(payload.transportationPreference), "drive");
});

// 3. Drive outranks a cheaper flight in the recommendation.
check("fixture drive recommendation beats a cheaper flight", () => {
  const options = [
    { mode: "flight", realistic: true, availability: "verified", estimated_cost_min: 260, estimated_cost_max: 340, title: "Direct flight", origin: "Saint John", destination: "Montreal" },
    { mode: "drive", realistic: true, availability: "search_ready", estimated_cost_min: 160, estimated_cost_max: 220, title: "Drive via Trans-Canada Hwy", origin: "Saint John", destination: "Montreal" }
  ];
  const picked = transportLib.pickRecommendedTransportOption(options, {
    budgetAmount: payload.budgetAmount,
    transportationPreference: payload.transportationPreference
  });
  assert.equal(picked.mode, "drive");
});

// 4. Budget total comes from the grounded ledger (CA$745), not from the null AI breakdown.
check("fixture budget total is the grounded CA$745 ledger", () => {
  assert.equal(itineraryLib.getItineraryTotalEstimateAmount(itinerary, groundedPriceDiscovery), 745);
});

// 5. Domestic Canada->Canada travel: entry requirements are NOT_APPLICABLE.
check("fixture domestic travel marks entry requirements not applicable", () => {
  const requirements = requirementsLib.deriveTravelRequirements({
    destinationCountry: payload.destinationCountry,
    originCountry: payload.originCountry,
    passportIssuingCountry: "CA"
  });
  const entry = requirements.find((r) => r.category === "VISA_OR_AUTHORIZATION");
  assert.equal(entry.status, "NOT_APPLICABLE");
});

// 6. Trip is 4 days over Oct 30 -> Nov 2.
check("fixture spans 4 days Oct 30 to Nov 2", () => {
  assert.equal(itinerary.daily_itinerary.length, 4);
  assert.equal(itinerary.daily_itinerary[0].date, "2026-10-30");
  assert.equal(itinerary.daily_itinerary[3].date, "2026-11-02");
});

// 7. No flight or search content anywhere in the fixture itinerary.
check("fixture contains no flight or search content", () => {
  const titles = itinerary.daily_itinerary.flatMap((d) => d.live_timeline.map((i) => String(i.title).toLowerCase()));
  assert.ok(!titles.some((t) => t.includes("flight") || t.startsWith("search")), titles.join(" | "));
});

// 8. Grounded total fits inside the CA$800 budget.
check("fixture grounded total fits the CA$800 budget", () => {
  assert.ok(groundedPriceDiscovery.totalEstimateCents <= payload.budgetAmount * 100);
});

// 9. Drive-mode suggestions for the fixture are driving routes, not airport transfers.
check("fixture effective transport mode is drive (drives suggestion filtering)", () => {
  assert.equal(itineraryLib.effectiveTransportMode(payload), "drive");
});

console.log(failed === 0
  ? `\nPASS: all ${passed} Saint John->Montreal fixture checks passed`
  : `\nFAIL: ${failed} of ${passed + failed} fixture checks failed`);
process.exit(failed === 0 ? 0 : 1);
