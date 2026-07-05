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
  "lib/roamly/navigationLinks.ts",
  "lib/roamly/pushClient.ts",
  "lib/roamly/pushServer.ts",
  "app/api/roamly/price-discovery/route.ts",
  "app/api/roamly/bookings/extract/route.ts",
  "app/api/roamly/bookings/confirm/route.ts",
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

console.log("Roamly production checks passed.");
