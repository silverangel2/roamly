import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
}

[
  "supabase/migrations/20260706_roamly_budget_booking_companion_notifications.sql",
  "lib/roamly/priceDiscovery.ts",
  "lib/roamly/bookings.ts",
  "lib/roamly/tripCompanion.ts",
  "lib/roamly/activityActions.ts",
  "lib/roamly/liveCompanionTest.ts",
  "lib/roamly/affiliateLinks.ts",
  "lib/roamly/navigationLinks.ts",
  "lib/roamly/pushClient.ts",
  "lib/roamly/pushServer.ts",
  "supabase/migrations/20260707_roamly_live_test_affiliates.sql",
  "app/api/roamly/price-discovery/route.ts",
  "app/api/roamly/bookings/extract/route.ts",
  "app/api/roamly/bookings/confirm/route.ts",
  "app/api/roamly/activities/check-in/route.ts",
  "app/api/roamly/activities/skip/route.ts",
  "app/api/roamly/activities/complete/route.ts",
  "app/api/admin/roamly/live-test/route.ts",
  "app/admin/live-test/page.tsx",
  "app/api/stripe/checkout/features/route.ts",
  "app/api/stripe/checkout/complete-trip/route.ts",
  "app/api/cron/roamly-notifications/route.ts",
  "public/sw.js",
  "public/icon.svg",
  "vercel.json"
].forEach(exists);

const migration = read("supabase/migrations/20260706_roamly_budget_booking_companion_notifications.sql");
[
  "roamly_price_discoveries",
  "roamly_bookings",
  "roamly_trip_companion_events",
  "roamly_push_subscriptions",
  "roamly_notifications",
  "live_companion_unlocked",
  "estimated_total_min_cents",
  "source_summary"
].forEach((needle) => assert.ok(migration.includes(needle), `migration missing ${needle}`));

const liveMigration = read("supabase/migrations/20260707_roamly_live_test_affiliates.sql");
[
  "activity_checked_in",
  "activity_skipped",
  "activity_completed",
  "push_status",
  "roamly_trip_activities_status_live_check"
].forEach((needle) => assert.ok(liveMigration.includes(needle), `live migration missing ${needle}`));

const billing = read("lib/roamly/billing.ts");
assert.ok(billing.includes("ROAMLY_STRIPE_FEATURES_PRICE_ID") || read("lib/env.ts").includes("ROAMLY_STRIPE_FEATURES_PRICE_ID"));
assert.ok(billing.includes("Live Trip Companion"), "billing copy should use Live Trip Companion");

const generateRoute = read("app/api/trips/generate/route.ts");
assert.ok(generateRoute.includes("markFreeItineraryUsed"), "free itinerary must be consumed after generation");
assert.ok(generateRoute.includes("getConfirmedBookingCostCents"), "generation must include committed booking costs");
assert.ok(generateRoute.includes("lockGeneratedItinerary"), "generation must lock itinerary");

const pushServer = read("lib/roamly/pushServer.ts");
assert.ok(pushServer.includes("createInAppNotification"), "in-app notifications helper missing");
assert.ok(pushServer.includes("live_companion_unlocked"), "cron must check companion unlock");
assert.ok(pushServer.includes("push_status"), "push status diagnostics missing");

const activityActions = read("lib/roamly/activityActions.ts");
["activity_checked_in", "activity_skipped", "activity_completed"].forEach((needle) =>
  assert.ok(activityActions.includes(needle), `activity actions missing ${needle}`)
);

const liveTest = read("lib/roamly/liveCompanionTest.ts");
["simulateTripLocation", "sendTestPushNotification", "buildLiveCompanionDebugReport"].forEach((needle) =>
  assert.ok(liveTest.includes(needle), `live test helper missing ${needle}`)
);

const affiliateLinks = read("lib/roamly/affiliateLinks.ts");
["buildHotelAffiliateUrl", "buildFlightAffiliateUrl", "buildAttractionAffiliateUrl", "attachAffiliateMetadata"].forEach((needle) =>
  assert.ok(affiliateLinks.includes(needle), `affiliate helper missing ${needle}`)
);

console.log("Roamly production checks passed.");
