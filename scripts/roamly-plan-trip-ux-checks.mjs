import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planDateFieldErrors,
  planEntitlementCopy,
  positiveDayCount,
  preferenceStyleSummary,
  syncPlanDates,
  travelerCountPhrase,
  tripLengthCopy
} from "../lib/roamly/planTripUx.ts";

assert.equal(positiveDayCount(""), null);
assert.equal(positiveDayCount("0"), null);
assert.equal(positiveDayCount("3"), 3);
assert.match(planDateFieldErrors("2026-11-10", "2026-11-12", "0").days, /at least 1 day/i);
assert.match(planDateFieldErrors("", "", "0").days, /at least 1 day/i);
assert.equal(planDateFieldErrors("2026-11-10", "2026-11-12", "").days, "");
assert.equal(tripLengthCopy(1), "1 day, no overnight");
assert.equal(tripLengthCopy(5), "5 days, 4 nights");
assert.equal(travelerCountPhrase(1, 0, 0), "1 adult");
assert.equal(travelerCountPhrase(2, 1, 0), "2 adults, 1 child");

const fromLength = syncPlanDates("2026-11-10", "", "5");
assert.equal(fromLength.endDate, "2026-11-14");
assert.equal(fromLength.days, 5);
assert.deepEqual(planDateFieldErrors(fromLength.startDate, fromLength.endDate, "5"), { start: "", end: "", days: "" });

const daysOnly = syncPlanDates("", "", "3");
assert.equal(daysOnly.endDate, "");
assert.match(planDateFieldErrors("", "", "3").start, /Add a start date/);
assert.match(planDateFieldErrors("", "", "3").start, /3 days, 2 nights/);

const ordered = syncPlanDates("2026-11-14", "2026-11-10", "3");
assert.equal(ordered.endDate, "2026-11-10");
assert.match(planDateFieldErrors("2026-11-14", "2026-11-10", "3").end, /on or after/);

const guest = planEntitlementCopy({ signedIn: false, freeItineraryUsed: true });
assert.match(guest.cta, /Generate my free itinerary/);
assert.doesNotMatch(`${guest.stepNote} ${guest.reviewLead} ${guest.nextStep} ${guest.cta}`, /used on this account/i);
assert.match(guest.nextStep, /\$4\.99 CAD/);
assert.match(guest.reviewLead, /has not been used/);

const available = planEntitlementCopy({ signedIn: true, freeItineraryUsed: false });
assert.match(available.reviewLead, /still has its free itinerary/);
assert.match(available.cta, /Generate my free itinerary/);

const used = planEntitlementCopy({ signedIn: true, freeItineraryUsed: true });
assert.match(used.reviewLead, /already used its free itinerary/);
assert.match(used.cta, /Unlock itinerary — \$4\.99 CAD/);
assert.match(used.nextStep, /\$4\.99 CAD/);

assert.match(
  preferenceStyleSummary({ travelStyle: "Balanced", pace: "Balanced", walkingTolerance: "Medium" }),
  /Balanced style \(default\).*Balanced pace \(default\).*Medium walking \(default\)/
);

const planForm = readFileSync("components/plan/TripPlanForm.tsx", "utf8");
const hero = readFileSync("components/roamly/DynamicDestinationHero.tsx", "utf8");
const shell = readFileSync("components/AppShellClient.tsx", "utf8");
const places = readFileSync("components/roamly/PlaceSelector.tsx", "utf8");

assert.match(planForm, /Resume previous trip/);
assert.match(planForm, /setRestoreNotice\(true\)/);
assert.match(planForm, /role="switch"/);
assert.match(planForm, /Number of days/);
assert.doesNotMatch(planForm, /Or number of days/);
assert.doesNotMatch(planForm, /used on this account/);
assert.doesNotMatch(planForm, /Starting with \$\{placeLabel\}/);
assert.match(planForm, /holdDraftSave/);
assert.match(planForm, /will not be regenerated in place/);
assert.doesNotMatch(hero, /Travel, with room to be you/);
assert.doesNotMatch(hero, /One full itinerary per account/);
assert.match(hero, /PLAN_START_NOTE/);
assert.match(hero, /role="tablist"/);
assert.match(hero, /roamly-hero-dots/);
assert.match(planForm, /plan-budget-error/);
assert.match(planForm, /plan-interest-error/);
assert.match(planForm, /invalidTypedDayCount/);
assert.match(planForm, /entitlement\.stepNote/);
assert.doesNotMatch(planForm, /step === 0 \? \([\s\S]{0,180}entitlement\.stepNote/);
assert.match(shell, /pathname === "\/"/);
assert.match(shell, /routeHidesBottomNav/);
assert.doesNotMatch(places, /absolute left-0 right-0 z-30/);

console.log("PASS: lean traveler plan and hero UX");
