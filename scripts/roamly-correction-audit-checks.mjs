// Roamly correction-audit checks — regression proof for the 2026-10-28
// browser acceptance audit (build LYHQMfCYLRoUOqePTccHd), defects
// D1–D9 plus the sponsored-content and entry-prompt fixes.
//
// Pure-function assertions where the code allows it; file-content
// assertions where the fix lives in a server component or JSX that
// node cannot import (Live page, LiveTripClient, trip page, plan
// shell). Every check names the defect it guards so a future revert
// fails loudly with the audit reference, not a mystery.
//
// Run: node --experimental-strip-types
//        --import ./scripts/roamly-test-register.mjs
//        scripts/roamly-correction-audit-checks.mjs
// (also as `npm run test:correction-audit`)
// No network, no database, no production data: all fixtures are
// invented here, except the read-only seed-file distinctness check,
// which reads the local preview seed (never executes it).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const treeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(treeRoot, p), "utf8");
// The preview seed lives in the sibling preview tree (the audit
// baseline's own seed file, corrected in place for future seeds).
const seedPath = path.join(path.dirname(path.dirname(treeRoot)), "roamly-preview-local", "seed-preview.mjs");

let passed = 0;
function check(label, ok) {
  assert.ok(ok, label);
  passed++;
}

const { formatRoamlyDate } = await import("../lib/i18n.ts");
const {
  daySummaryStartClock, deriveDaySummary, dayRestAndWrap,
  dayUncertaintyNotes, isGenericStopText
} = await import("../lib/roamly/daySummary.ts");
const { findIdenticalDayPlans } = await import("../lib/roamly/dayPlanIdentity.ts");
const { travelerReadinessErrors } = await import("../lib/itinerary.ts");
const { itineraryDaysFromDailyItinerary } = await import("../lib/roamly/liveItineraryFallback.ts");
const { buildNavigationLinks } = await import("../lib/roamly/navigationLinks.ts");
const { houseAdCandidates, pickHouseAd } = await import("../lib/houseAds.ts");
const { deriveTravelRequirements } = await import("../lib/roamly/travelRequirements.ts");
const { buildTripTravelerRequirements } = await import("../lib/roamly/tripTravelers.ts");

// ---------- D1: dashboard dates must match the trip page ----------
// The dashboard calls formatRoamlyDate with these exact options
// (app/dashboard/page.tsx formatDate); the audit's "Oct 25" came from
// the old UTC-midnight parse under ADT. The options below are the
// dashboard's own call, not a test invention.
const dashboardDateOptions = { month: "short", day: "numeric", year: "numeric" };
check("D1 date-only Oct 26 renders Oct 26 (not Oct 25)", formatRoamlyDate("2026-10-26", "en", dashboardDateOptions) === "Oct 26, 2026");
check("D1 date-only Nov 10 renders Nov 10 (not Nov 9)", formatRoamlyDate("2026-11-10", "en", dashboardDateOptions) === "Nov 10, 2026");
check("D1 date-only Jan 1 renders Jan 1", formatRoamlyDate("2026-01-01", "en", dashboardDateOptions) === "Jan 1, 2026");
check("D1 full datetime still formats (no throw, non-empty)", typeof formatRoamlyDate("2026-10-26T12:00:00", "en") === "string" && formatRoamlyDate("2026-10-26T12:00:00", "en").length > 0);

// ---------- D2: summaries agree with listed times ----------
// Seed-shaped Montreal Day 1: four venues, 24-hour times.
const montrealDay1 = [
  { time: "09:30", title: "Old Port Promenade" },
  { time: "11:00", title: "Pointe-à-Callière Museum" },
  { time: "14:00", title: "Notre-Dame Basilica" },
  { time: "16:30", title: "Place Jacques-Cartier" }
];
const day1Summary = deriveDaySummary(montrealDay1);
check("D2 summary counts four stops", day1Summary.includes("four stops"));
check("D2 summary names the 9:30 AM start", day1Summary.includes("9:30 AM"));
check("D2 summary never says 'no fixed times' above listed times", !day1Summary.includes("no fixed times"));
check("D2 24h clock 09:30 -> 9:30 AM", daySummaryStartClock("09:30") === "9:30 AM");
check("D2 24h clock 14:00 -> 2:00 PM", daySummaryStartClock("14:00") === "2:00 PM");
check("D2 24h clock 00:30 -> 12:30 AM", daySummaryStartClock("00:30") === "12:30 AM");
check("D2 24h clock 12:00 -> 12:00 PM", daySummaryStartClock("12:00") === "12:00 PM");
check("D2 12h clock 8:00 AM unchanged", daySummaryStartClock("8:00 AM") === "8:00 AM");
check("D2 'Flexible' is not a clock", daySummaryStartClock("Flexible") === null);
check("D2 'Check-in' is not a clock", daySummaryStartClock("Check-in") === null);
const untimedSummary = deriveDaySummary([{ time: "Flexible", title: "Old Port Promenade" }]);
check("D2 genuinely untimed day still says 'no fixed times set' (honest)", untimedSummary.includes("no fixed times set"));
const restWrap = dayRestAndWrap([
  { time: "09:30", title: "Old Port Promenade" },
  { time: "13:00", title: "Rest at hotel", kind: "rest" },
  { time: "21:00", title: "Return to hotel", kind: "return" }
]);
check("D2 rest clock sourced (1:00 PM)", restWrap.restClock === "1:00 PM");
check("D2 wrap clock sourced (9:00 PM)", restWrap.wrapClock === "9:00 PM");
const seededRestWrap = dayRestAndWrap(montrealDay1);
check("D2 seeded day honestly reports no rest/wrap clocks", seededRestWrap.restClock === null && seededRestWrap.wrapClock === null);
check("D2 uncertainty notes keep specifics", dayUncertaintyNotes({ headingKind: "uncertain", planStatus: null, uncertainty: ["Hotel check-in time unconfirmed"], statusTexts: [] }).includes("Hotel check-in time unconfirmed"));
check("D2 uncertainty notes dedupe", dayUncertaintyNotes({ uncertainty: ["Same note", "Same note"], statusTexts: [] }).length === 1);
check("D2 uncertainty notes empty when nothing specific", dayUncertaintyNotes({}).length === 0);
check("D2 'Place Jacques-Cartier' is a real venue, not generic", isGenericStopText("Place Jacques-Cartier") === false);
check("D2 bare 'Place' is generic", isGenericStopText("Place") === true);
check("D2 bare 'Free time' is generic", isGenericStopText("Free time") === true);
check("D2 'CN Tower' is not generic", isGenericStopText("CN Tower") === false);
check("D2 'place to visit' placeholder is generic", isGenericStopText("place to visit") === true);

// ---------- D3: identical days are the seed's fault, not the generator's ----------
check("D3 identical pair flagged as days 1+2", JSON.stringify(findIdenticalDayPlans([["CN Tower", "Market"], ["CN Tower", "Market"]])) === JSON.stringify([{ days: [1, 2] }]));
check("D3 distinct days not flagged", findIdenticalDayPlans([["CN Tower"], ["Casa Loma"]]).length === 0);
check("D3 case/whitespace-insensitive match", findIdenticalDayPlans([["CN Tower"], ["cn  tower"]]).length === 1);
check("D3 empty days never match", findIdenticalDayPlans([[], []]).length === 0);
check("D3 order matters (reversed sequence is a different day)", findIdenticalDayPlans([["A", "B"], ["B", "A"]]).length === 0);
const validationPayload = { daysCount: 5, destination: "Toronto", origin: "Saint John", transportationPreference: "" };
const identicalDoc = {
  daily_itinerary: [1, 2].map((n) => ({
    day_number: n,
    live_timeline: [
      { item_type: "activity", title: "CN Tower", description: "" },
      { item_type: "activity", title: "St. Lawrence Market", description: "" },
      { item_type: "activity", title: "Royal Ontario Museum", description: "" }
    ]
  }))
};
const distinctDoc = {
  daily_itinerary: [
    { day_number: 1, live_timeline: [{ item_type: "activity", title: "CN Tower", description: "" }] },
    { day_number: 2, live_timeline: [{ item_type: "activity", title: "Casa Loma", description: "" }] }
  ]
};
const repeatOf = (doc) => travelerReadinessErrors(doc, validationPayload).filter((e) => /must not repeat across days/.test(e));
check("D3 validation flags identical days (activity-repeat rule)", repeatOf(identicalDoc).length >= 1);
check("D3 validation passes distinct days on repeats", repeatOf(distinctDoc).length === 0);
const seedSource = readFileSync(seedPath, "utf8");
const torontoBlock = seedSource.slice(seedSource.indexOf("const TORONTO_DAYS"), seedSource.indexOf("];", seedSource.indexOf("const TORONTO_DAYS")) + 2);
check("D3 seed no longer maps one stop list over all days", !torontoBlock.includes("[1, 2, 3, 4, 5].map"));
const torontoDayTitles = torontoBlock.split(/day\(\d+,/).slice(1).map((segment) => [...segment.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]));
check("D3 seed has 5 explicit Toronto days", torontoDayTitles.length === 5);
check("D3 seed Toronto days are all distinct", findIdenticalDayPlans(torontoDayTitles).length === 0);

// ---------- D4: transport templates correct; vague note replaced ----------
check("D4 transport template says 'between the airport or station'", read("lib/roamly/affiliateLinks.ts").includes("between the airport or station"));
const tripPage = read("app/trip/[id]/page.tsx");
check("D4 booking details line keeps its spaces", tripPage.includes("Start with your") && tripPage.includes("details below"));
const dayPlan = read("components/trip/ItineraryDayPlan.tsx");
check("D4 vague line 'Some details still need confirmation.' is gone", !dayPlan.includes("Some details still need confirmation."));
check("D4 replacement names specifics ('Still to confirm:')", dayPlan.includes("Still to confirm:"));

// ---------- D5: Live falls back to the itinerary JSON ----------
const fallbackDays = itineraryDaysFromDailyItinerary([
  {
    day_number: 1,
    live_timeline: [
      { time: "09:30", title: "Old Port Promenade", map_query: "Old Port of Montreal" },
      { time: "11:00", title: "Pointe-à-Callière Museum", timing_status: "FACTUAL" },
      { title: "" },
      { time: "16:30", title: "Place Jacques-Cartier" }
    ]
  },
  { day_number: 2, live_timeline: [{ time: "09:00", title: "Mount Royal" }] }
], (n) => `Day ${n}`);
check("D5 fallback keeps both days", fallbackDays.length === 2);
check("D5 fallback Day 1 has 3 titled stops (title-less dropped)", fallbackDays[0].activities.length === 3);
check("D5 fallback keeps seed times (09:30)", fallbackDays[0].activities[0].timeLabel === "09:30");
check("D5 fallback labels seed rows Planned", fallbackDays[0].activities[0].status === "Planned");
check("D5 fallback honors FACTUAL timing_status", fallbackDays[0].activities[1].status === "FACTUAL");
check("D5 fallback keeps map_query", fallbackDays[0].activities[0].mapQuery === "Old Port of Montreal");
check("D5 fallback invents no time for a timeless row", itineraryDaysFromDailyItinerary([{ day_number: 1, live_timeline: [{ title: "Open day" }] }], (n) => `Day ${n}`)[0].activities[0].timeLabel === null);
const livePage = read("app/trip/[id]/live/page.tsx");
check("D5 Live page uses the fallback helper", livePage.includes("itineraryDaysFromDailyItinerary") && livePage.includes("itineraryFallbackDays"));
const liveClient = read("components/trip/LiveTripClient.tsx");
check("D5 Live client renders the itinerary fallback for Today", liveClient.includes("from your itinerary"));
check("D5 Live client keeps the empty state for the both-empty case", liveClient.includes("not available yet"));

// ---------- D6: Live Map agrees with Itinerary Map ----------
check("D6 Live client computes a fallback map stop", liveClient.includes("fallbackMapStop"));
check("D6 Live client Map tab names the fallback honestly", liveClient.includes("Open today's first stop"));

// ---------- D7: locked-Live gate has a preview and a skip path ----------
check("D7 gate offers 'Skip for now'", livePage.includes("Skip for now"));
check("D7 gate shows a Day 1 preview", livePage.includes("gatePreviewStops") && livePage.includes("Preview"));
check("D7 gate states Live stays locked until unlocked", livePage.includes("Live Companion stays locked until you unlock it"));

// ---------- D8: /plan keeps the bottom tab bar ----------
const shell = read("components/AppShellClient.tsx");
const hideFn = shell.slice(shell.indexOf("function routeHidesBottomNav"));
check("D8 routeHidesBottomNav returns false (no route hides the bar)", hideFn.slice(0, hideFn.indexOf("\n}")).includes("return false"));
check("D8 routeHidesBottomNav no longer hides /plan", !hideFn.slice(0, hideFn.indexOf("\n}")).includes('pathname === "/plan"'));

// ---------- Sponsored: destination-match rule ----------
const montrealAds = houseAdCandidates("trip", "Montreal");
check("Sponsored Montreal never yields hotel-lisbon", !montrealAds.some((c) => c.id === "hotel-lisbon"));
check("Sponsored Montreal never yields hotel-kyoto", !montrealAds.some((c) => c.id === "hotel-kyoto"));
check("Sponsored Montreal still yields destination-agnostic cards", montrealAds.length >= 1 && montrealAds.every((c) => !c.destinationCity));
check("Sponsored Lisbon may yield hotel-lisbon (first rotation)", pickHouseAd("trip", 0, "Lisbon")?.id === "hotel-lisbon");
check("Sponsored Montreal rotation never yields a hotel card", pickHouseAd("trip", 0, "Montreal")?.category !== "hotel");
check("Sponsored no-destination rotation unchanged (hotel-lisbon eligible)", houseAdCandidates("trip").some((c) => c.id === "hotel-lisbon"));
check("Sponsored trip slot passes the destination city", tripPage.includes('destinationCity={trip.destination_city'));

// ---------- Entry: domestic trips must not prompt for a passport country ----------
const domesticReqs = deriveTravelRequirements({ destinationCountry: "Canada", originCountry: "Saint John, Canada" });
check("Entry 'Saint John, Canada' resolves to CA (domestic)", domesticReqs[0].status === "NOT_APPLICABLE");
check("Entry domestic summary says domestic", domesticReqs[0].summary.includes("domestic"));
check("Entry domestic requirement is the entry category", domesticReqs[0].category === "VISA_OR_AUTHORIZATION");
const crossBorderReqs = deriveTravelRequirements({ destinationCountry: "Canada", originCountry: "Manila, Philippines" });
check("Entry cross-border trip is NOT marked domestic", crossBorderReqs[0].status !== "NOT_APPLICABLE");
const codeReqs = deriveTravelRequirements({ destinationCountry: "CA", originCountry: "CA" });
check("Entry code path CA/CA still domestic", codeReqs[0].status === "NOT_APPLICABLE");
const tripReqs = buildTripTravelerRequirements({
  trip: { id: "test-trip", destination_country: "Canada", origin: "Saint John, Canada", travelers_count: 1 },
  travelers: [],
  accountHolderPassportCountry: null
});
check("Entry trip-level domestic evaluation is NOT_APPLICABLE", tripReqs.evaluations[0].requirements[0].status === "NOT_APPLICABLE");
const reqComponent = read("components/trip/TripTravelerRequirements.tsx");
check("Entry component guards the passport button on the entry requirement", reqComponent.includes('category === "VISA_OR_AUTHORIZATION"') && reqComponent.includes('!== "NOT_APPLICABLE"'));

// ---------- D9: coordinates for verified stops, name-only for WIP stops ----------
const verifiedLinks = buildNavigationLinks({ label: "Notre-Dame Basilica", latitude: 45.5048, longitude: -73.6112 });
check("D9 verified stop Google link carries coordinates", verifiedLinks.find((l) => l.provider === "google_maps").href === "https://www.google.com/maps/dir/?api=1&destination=45.5048%2C-73.6112");
check("D9 verified stop Apple link carries coordinates", verifiedLinks.find((l) => l.provider === "apple_maps").href === "https://maps.apple.com/?daddr=45.5048%2C-73.6112");
check("D9 verified stop Citymapper link carries endcoord", verifiedLinks.find((l) => l.provider === "citymapper").href.includes("endcoord=45.5048%2C-73.6112"));
const wipLinks = buildNavigationLinks({ label: "WIP" });
check("D9 WIP stop Google link is name-only (no coordinates)", wipLinks.find((l) => l.provider === "google_maps").href === "https://www.google.com/maps/dir/?api=1&destination=WIP");
check("D9 WIP stop Citymapper falls back to a name search", wipLinks.find((l) => l.provider === "citymapper").href === "https://citymapper.com/search?query=WIP");
check("D9 DirectionsPanel labels unverified stops", read("components/trip/DirectionsPanel.tsx").includes('props.unverified ? "Unverified stop"'));

// ---------- Preservation: Gmail paging behavior untouched ----------
const paging = read("lib/roamly/emailConnections.ts");
check("Paging preserved: pageToken present", paging.includes("pageToken"));
check("Paging preserved: MAX_SCANNED=1000 present", paging.includes("MAX_SCANNED") && paging.includes("1000"));

console.log(`correction-audit checks: ${passed} passed`);
