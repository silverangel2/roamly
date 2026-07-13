import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

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
  "lib/roamly/session-token.ts",
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
  "app/api/trips/[id]/generation/status/route.ts",
  "app/api/trips/[id]/generation/advance/route.ts",
  "app/api/cron/roamly-itinerary-generation/route.ts",
  "components/trip/StagedGenerationProgress.tsx",
  "lib/roamly/stagedItineraryGeneration.ts",
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
assert.ok(generateRoute.includes("startStagedItineraryGeneration"), "generation route must create a staged generation job");
assert.ok(generateRoute.includes("prepareStagedGenerationContext"), "generation route must prepare staged price/booking context");
assert.ok(generateRoute.includes("status: \"queued\""), "generation route must return a queued staged job");
assert.ok(generateRoute.includes("buildTripPlanningMetadata"), "generation must persist planner details in metadata");
assert.ok(!generateRoute.includes("is_activated: false"), "generation insert must not require legacy is_activated column");

const stagedGenerator = read("lib/roamly/stagedItineraryGeneration.ts");
assert.ok(stagedGenerator.includes("markFreeItineraryUsed"), "free itinerary must be consumed only after staged generation completes");
assert.ok(stagedGenerator.includes("getConfirmedBookingCostCents"), "staged generation must include committed booking costs");
assert.ok(stagedGenerator.includes("lockGeneratedItinerary"), "staged generation must lock itinerary after final validation");
assert.ok(stagedGenerator.includes("MAX_AI_COST_USD"), "staged generation must enforce a per-itinerary cost ceiling");
assert.ok(stagedGenerator.includes("plannedDayBatches"), "staged generation must batch days instead of generating one item per request");
assert.ok(stagedGenerator.includes("BATCH_ATTEMPT_LIMIT"), "staged generation must cap failed-stage retries");
assert.ok(stagedGenerator.includes("generatedDays"), "staged generation must preserve completed days across failures");
assert.ok(!stagedGenerator.includes("buildFallbackItinerary"), "staged generation must not silently save template fallback itineraries");

const generationAdvanceRoute = read("app/api/trips/[id]/generation/advance/route.ts");
assert.ok(generationAdvanceRoute.includes("advanceStagedItineraryGeneration"), "generation advance route must execute the next persisted stage");

const generationStatusRoute = read("app/api/trips/[id]/generation/status/route.ts");
assert.ok(generationStatusRoute.includes("publicStagedGenerationProgress"), "generation status route must expose resumable progress");

const generationCron = read("app/api/cron/roamly-itinerary-generation/route.ts");
assert.ok(generationCron.includes("ROAMLY_GENERATION_CRON_SECRET") && generationCron.includes("CRON_SECRET"), "generation cron must require a bearer secret");
assert.ok(generationCron.includes("advanceStagedItineraryGeneration"), "generation cron must resume jobs when the browser is closed");

const tripPage = read("app/trip/[id]/page.tsx");
assert.ok(tripPage.includes("checkoutSyncError"), "trip page must surface checkout sync failures");
assert.ok(tripPage.includes("checkout_sync_failed"), "checkout sync failures must be observable");
assert.ok(tripPage.includes("CheckoutUrlCleanup") && tripPage.includes("checkoutNeedsAttention"), "checkout success URL must be retained while sync needs attention");

const activateTripButton = read("components/trip/ActivateTripButton.tsx");
assert.ok(activateTripButton.includes("fetchWithSupabaseAuth"), "trip checkout buttons must forward Supabase auth");

const planForm = read("components/plan/TripPlanForm.tsx");
assert.ok(planForm.includes("checkout=failed"), "planner checkout failures after draft save must land on a retryable trip page");
assert.ok(!planForm.includes("ensureActiveSessionBeforeGeneration"), "planner must not block generation on stale browser session state before server auth runs");
assert.ok(planForm.includes("x-roamly-session-token"), "planner API calls must include the server-issued Roamly auth token");

const sessionToken = read("lib/roamly/session-token.ts");
assert.ok(sessionToken.includes("createRoamlySessionToken"), "server-issued Roamly auth token helper missing");
assert.ok(sessionToken.includes("verifyRoamlySessionToken"), "server-issued Roamly auth token verifier missing");

const auth = read("lib/roamly/auth.ts");
assert.ok(auth.includes("getUserFromRoamlySessionToken"), "requireUser must fall back to the server-issued Roamly auth token");

const middleware = read("middleware.ts");
assert.ok(middleware.includes("createServerClient"), "middleware must refresh Supabase sessions");
assert.ok(middleware.includes("supabase.auth.getUser()"), "middleware must validate/refresh auth before protected routes");
assert.ok(middleware.includes("\"/api/trips/:path*\""), "middleware must refresh auth for trip API requests");

const pushServer = read("lib/roamly/pushServer.ts");
assert.ok(pushServer.includes("createInAppNotification"), "in-app notifications helper missing");
assert.ok(pushServer.includes("tracking_unlocked"), "cron must check companion unlock");
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

const dateUtilsSource = read("lib/roamly/dateUtils.ts");
const compiledDateUtils = ts.transpileModule(dateUtilsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const dateUtilsExports = {};
vm.runInNewContext(compiledDateUtils, { exports: dateUtilsExports, module: { exports: dateUtilsExports } });

assert.equal(
  dateUtilsExports.calculateInclusiveTripDays("2026-08-05", "2026-08-12"),
  8,
  "Roamly date counting failed: Aug 5 to Aug 12 must be 8 days."
);
assert.equal(
  dateUtilsExports.calculateInclusiveTripDays("2026-08-05", "2026-08-05"),
  1,
  "Roamly date counting failed: same-day trips must be 1 day."
);
const invalidDateRange = dateUtilsExports.calculateTripDateRange("2026-08-13", "2026-07-20");
assert.equal(invalidDateRange.ok, false, "Roamly date validation failed: backwards dates must be invalid.");
assert.equal(invalidDateRange.days, null, "Roamly date validation failed: backwards dates must not return days.");
assert.equal(invalidDateRange.errorCode, "END_BEFORE_START", "Roamly date validation failed: backwards dates must return END_BEFORE_START.");
assert.notEqual(
  dateUtilsExports.calculateInclusiveTripDays("2026-08-13", "2026-07-20"),
  3,
  "Roamly date counting failed: backwards dates must not fall back to 3 days."
);

console.log("Roamly production checks passed.");
