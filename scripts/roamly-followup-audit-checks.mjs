// Roamly follow-up audit checks — regression proof for the 2026-10-29
// browser retest of the corrected build (dL2ErYMBWTpC9zxdhGhnT),
// which REOPENED two defects the correction phase got wrong, plus the
// Entry section the retest could not locate.
//
// D4 (reopened): the overview Transport card rendered "between the or
//   station" — NOT a template error (affiliateLinks.ts is correct) and
//   NOT a text-extraction artifact. The ground-transport rewrite
//   (presentGroundTransportText) ate "airport" after "the" via its
//   named-airport rule. Fixed by mapping the "airport or station" pair
//   before that rule. The template file is deliberately untouched.
// D8 (reopened): making routeHidesBottomNav always return false did
//   NOT render the bar on /plan, because the bar never renders there
//   (/plan is not an app surface; the marketing nav renders instead
//   and is lg:hidden). Fixed by rendering AppTabBar on /plan for
//   signed-in travelers without flipping appFrame (header kept).
// Entry (NOT RUN on screen in the retest): the section genuinely
//   cannot render for the domestic tunnel trips — see the checks at
//   the end. These checks prove the code path, NOT an on-screen PASS.
//
// Run: node --experimental-strip-types
//        --import ./scripts/roamly-test-register.mjs
//        scripts/roamly-followup-audit-checks.mjs
// (also as `npm run test:followup-audit`)
// No network, no database, no production data: all fixtures are
// invented here, except the tunnel-trip values, which are the seed's
// own stored values (origin "Saint John, Canada", destination
// "Canada", travelers_count 1) read from the local backend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const treeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(treeRoot, p), "utf8");

let passed = 0;
function check(label, ok) {
  assert.ok(ok, label);
  passed++;
}

const { presentGroundTransportText } = await import("../lib/roamly/itineraryPresentation.ts");
const { deriveTravelRequirements, countMaterialTravelRequirements } = await import("../lib/roamly/travelRequirements.ts");
const { buildTripTravelerRequirements } = await import("../lib/roamly/tripTravelers.ts");

const shell = read("components/AppShellClient.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const planForm = read("components/plan/TripPlanForm.tsx");
const planPage = read("app/plan/page.tsx");
const affiliateLinks = read("lib/roamly/affiliateLinks.ts");
const requirementsComponent = read("components/trip/TripTravelerRequirements.tsx");

// ---------- D4: overview Transport card must not drop "airport" ----------
const retestInput = "Door-to-door taxi or private van between the airport or station and your stay in Montreal, Canada. Availability and fixed pricing vary by date — check live options before you travel.";
const retestOutput = presentGroundTransportText(retestInput);
check("D4 retest string renders 'between the arrival point or station'", retestOutput.includes("between the arrival point or station"));
check("D4 retest string has no 'between the or station' (the defect)", !retestOutput.includes("between the or station"));
check("D4 retest string has no empty interpolation / double space", !/between the\s+or\b/.test(retestOutput) && !/  +/.test(retestOutput));
check("D4 source template untouched (still 'between the airport or station')", affiliateLinks.includes("between the airport or station and your stay in ${destination}"));
check("D4 'airport / station' still maps to 'arrival point'", presentGroundTransportText("between the airport / station and your stay") === "between the arrival point and your stay");
check("D4 'airport station' still maps to 'arrival point'", presentGroundTransportText("between the airport station and your stay") === "between the arrival point and your stay");
check("D4 named airport still kept ('Montréal–Trudeau airport and downtown')", presentGroundTransportText("Montréal–Trudeau airport and downtown") === "Montréal–Trudeau downtown");
check("D4 'YUL airport transfer' still maps to 'local transfer'", presentGroundTransportText("YUL airport transfer on arrival") === "YUL local transfer on arrival");
check("D4 'at the airport, collect bags' still maps to 'on arrival, settle in'", presentGroundTransportText("at the airport, collect bags") === "on arrival, settle in");
check("D4 overview card path uses the ground rewrite under suppressFlightFraming", tripPage.includes("presentGroundTransportText(bookingDescription(suggestion))"));

// ---------- D8: tab bar must RENDER on /plan ----------
// The correction-phase fix (routeHidesBottomNav always false) was
// necessary but not sufficient: the bar never rendered on /plan.
check("D8 shell renders AppTabBar on /plan for signed-in travelers", shell.includes('authenticated && pathname === "/plan"'));
check("D8 routeHidesBottomNav still always returns false (no regression)", /function routeHidesBottomNav[\s\S]{0,600}?return false;/.test(shell));
check("D8 AppTabBar keeps all four tabs", shell.includes('label: t("ui.nav.itinerary", "Itinerary")') && shell.includes('label: t("ui.nav.live", "Live")') && shell.includes('label: t("ui.nav.alerts", "Alerts")') && shell.includes('label: t("ui.nav.account", "Account")'));
check("D8 AppTabBar falls back to /dashboard with no active trip", shell.includes('tripId ? `/trip/${tripId}` : "/dashboard"'));
check("D8 marketing nav still rendered for other non-app surfaces", shell.includes('aria-label="Mobile navigation"'));
check("D8 wizard Back/Continue are in-flow (no sticky/fixed footer to collide)", planForm.includes('className="mt-7 grid grid-cols-2 gap-3 border-t border-cloud/80 pt-5"'));
check("D8 plan page keeps .safe-bottom clearance", planPage.includes("safe-bottom"));

// ---------- Entry: domestic tunnel trips (CODE-VERIFIED, not screen) ----------
// Exact stored values of the tunnel Montreal trip (local backend):
// origin "Saint John, Canada", destination_country "Canada",
// travelers_count 1, no composition, no passport country saved.
const tunnelTrip = { destination_country: "Canada", origin: "Saint John, Canada", origin_country: null, travelers_count: 1, start_date: "2026-10-26", end_date: "2026-10-30", metadata: { planning: { timezone: "America/Toronto" } } };
const built = buildTripTravelerRequirements({ trip: tunnelTrip, travelers: [], accountHolderPassportCountry: null });
const domesticReqs = deriveTravelRequirements({ destinationCountry: "Canada", originCountry: "Saint John, Canada", passportIssuingCountry: null, startDate: "2026-10-26", endDate: "2026-10-30", travelerCount: 1 });
check("Entry domestic resolution is exactly one requirement", domesticReqs.length === 1);
check("Entry domestic requirement is VISA_OR_AUTHORIZATION / NOT_APPLICABLE", domesticReqs[0].category === "VISA_OR_AUTHORIZATION" && domesticReqs[0].status === "NOT_APPLICABLE");
check("Entry domestic summary is the photo-ID sentence", domesticReqs[0].summary === "This is domestic travel within the same country, so no passport or visa entry requirement applies. Carry a photo ID for check-in.");
check("Entry domestic result never asks for a passport country", !domesticReqs[0].summary.includes("Add your passport"));
check("Entry material count is 0, so the section is gated off for these trips", countMaterialTravelRequirements(domesticReqs) === 0);
check("Entry tunnel trip builds one account-holder evaluation, still gated off", built.evaluations.length === 1 && countMaterialTravelRequirements(built.evaluations.flatMap((e) => e.requirements)) === 0);
check("Entry passport button hides for NOT_APPLICABLE (component guard)", requirementsComponent.includes('requirement.status !== "NOT_APPLICABLE"'));
check("Entry section renders only when hasRequirements (trip page gate)", tripPage.includes('hasRequirements ? <section id="requirements"'));
check("Entry tab appears only when hasRequirements (tab list gate)", tripPage.includes('...(hasRequirements ? [["roamly-tab-requirements", "Entry requirements"]]'));

console.log(`followup-audit checks: ${passed} passed`);
