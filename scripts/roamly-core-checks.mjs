import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const billing = read("lib/roamly/billing.ts");
assert.ok(billing.includes("validateStripePriceForPurchase"), "checkout must validate Stripe Prices server-side");
assert.ok(billing.includes("STRIPE_PRICE_MISSING"), "missing Stripe Price IDs must return a specific safe error");
assert.ok(billing.includes("STRIPE_PRICE_AMOUNT_MISMATCH"), "Stripe Price amount mismatch must be detected");
assert.ok(billing.includes("STRIPE_PRICE_CURRENCY_MISMATCH"), "Stripe Price currency mismatch must be detected");
assert.ok(billing.includes("getOrCreateStripeCustomer"), "checkout must create or reuse one Stripe customer per user");
assert.ok(billing.includes("findReusablePendingCheckoutSession"), "checkout must reuse open pending sessions to reduce duplicate checkout attempts");
assert.ok(!billing.includes("price_data"), "production checkout must not silently fall back to inline Stripe price_data");
assert.ok(billing.includes("handleStripeWebhookEvent"), "Stripe webhooks must use centralized processing");
assert.ok(billing.includes("stripe_webhook_event_processed"), "Stripe webhook events must be idempotent");
assert.ok(billing.includes("invoice.payment_succeeded") && billing.includes("invoice.payment_failed"), "invoice webhooks must be handled");
assert.ok(billing.includes("customer.subscription.updated") && billing.includes("customer.subscription.deleted"), "subscription lifecycle webhooks must be handled");

const payments = read("lib/payments.ts");
assert.ok(payments.includes("awaitingWebhook"), "success redirect must not grant paid access by itself");
assert.ok(!payments.includes("return applyPaidCheckoutSession(session);"), "success redirect must not call paid sync directly");

const checkoutRoute = read("app/api/stripe/create-trip-checkout/route.ts");
assert.ok(checkoutRoute.includes("code: checkout.error"), "checkout API must return stable safe error codes");
assert.ok(checkoutRoute.includes("INVALID_CHECKOUT_KIND"), "checkout API must reject invalid internal plan keys");
assert.ok(!checkoutRoute.includes("priceId"), "checkout API must not accept browser Price IDs");

const webhookRoute = read("app/api/stripe/webhook/route.ts");
assert.ok(webhookRoute.includes("request.text()"), "Stripe webhook must verify the raw request body");
assert.ok(webhookRoute.includes("constructEvent"), "Stripe webhook must verify signatures");
assert.ok(webhookRoute.includes("handleStripeWebhookEvent"), "Stripe webhook route must use centralized handler");

const affiliateResolver = read("lib/roamly/affiliateResolver.ts");
[
  "travelpayouts",
  "stay22",
  "klook",
  "amazon",
  "esim",
  "ROAMLY_TRAVELPAYOUTS_MARKER",
  "ROAMLY_STAY22_PARTNER_ID",
  "ROAMLY_KLOOK_PARTNER_ID",
  "ROAMLY_AMAZON_ASSOCIATE_TAG",
  "ROAMLY_ESIM_REFERRAL_URL"
].forEach((needle) => assert.ok(affiliateResolver.includes(needle), `affiliate resolver missing ${needle}`));
["booking\\.com", "google\\.com\\/travel\\/flights", "viator", "getyourguide"].forEach((needle) =>
  assert.ok(affiliateResolver.toLowerCase().includes(needle), `legacy provider guard missing ${needle}`)
);
assert.ok(!affiliateResolver.includes("source\", \"affiliate_fallback\""), "affiliate resolver must not send booking CTAs back to /plan");
assert.ok(affiliateResolver.includes('fallbackBehavior: isAffiliate ? "affiliate" : "hidden"'), "missing affiliate providers must hide CTAs, not create internal fallbacks");

const affiliateLinks = read("lib/roamly/affiliateLinks.ts");
assert.ok(affiliateLinks.includes("enrichTimelineItems"), "timeline booking CTAs must be resolved server-side");
assert.ok(affiliateLinks.includes("resolveAffiliateLink"), "affiliate links must use the centralized resolver");
assert.ok(affiliateLinks.includes("booking: {"), "timeline items must receive structured booking objects");
assert.ok(affiliateLinks.includes('if (raw.startsWith("/")) return "";'), "generated booking links must reject internal /plan fallbacks");

const affiliateNeutrality = read("lib/roamly/affiliateNeutrality.ts");
[
  "ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE",
  "TRANSPORT_SCORE_WEIGHTS",
  "ACCOMMODATION_SCORE_WEIGHTS",
  "affiliate_value: 0",
  "rankAffiliateNeutralOptions",
  "NEAR_TIE_POINTS"
].forEach((needle) => assert.ok(affiliateNeutrality.includes(needle), `affiliate neutrality helper missing ${needle}`));
const compiledAffiliateNeutrality = ts.transpileModule(affiliateNeutrality, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const affiliateNeutralityExports = {};
vm.runInNewContext(compiledAffiliateNeutrality, { exports: affiliateNeutralityExports, module: { exports: affiliateNeutralityExports } });
const neutralRanked = affiliateNeutralityExports.rankAffiliateNeutralOptions([
  { id: "better-customer-option", customerScore: 90, affiliateAvailable: false, affiliateValue: 0 },
  { id: "high-commission-inferior-option", customerScore: 82, affiliateAvailable: true, affiliateValue: 1000 }
]);
assert.equal(neutralRanked[0].id, "better-customer-option", "high-commission inferior option must not outrank a better customer option");

const itinerary = read("lib/itinerary.ts");
[
  "arrivalTravelItems",
  "departureTravelItems",
  "withTransfersBetweenMajorItems",
  "withChronologicalTimes",
  "timelineChronologyErrors",
  "Day 1 is missing travel/arrival before local activities.",
  "Final day is missing checkout/departure/return travel.",
  "CTA"
].forEach((needle) => assert.ok(itinerary.includes(needle), `itinerary validation missing ${needle}`));
assert.ok(itinerary.includes("startTime") && itinerary.includes("endTime") && itinerary.includes("durationMinutes"), "structured timeline fields must be normalized");
assert.ok(itinerary.includes('if (raw.startsWith("/")) return false;'), "itinerary production validation must reject internal booking CTA URLs");
assert.ok(itinerary.includes("Roamly recommends this option for your trip."), "itinerary must confidently label the recommended transport option");

const tripPage = read("app/trip/[id]/page.tsx");
assert.ok(tripPage.includes("BookingRecommendationButton") && tripPage.includes("item.booking"), "timeline CTAs must render as real booking buttons");
assert.ok(tripPage.includes("isLegacyBookingUrl(raw)"), "trip rendering must reject legacy booking links");
assert.ok(tripPage.includes("enrichItineraryBookingSuggestions"), "saved trips must reconstruct missing affiliate links on load");

const planPage = read("app/plan/page.tsx");
assert.ok(planPage.includes("hidden gap-2 lg:grid"), "mobile plan page must not render the desktop info rail");
assert.ok(!planPage.includes("min-h-screen"), "/plan must not force full-screen height");

const planForm = read("components/plan/TripPlanForm.tsx");
assert.ok(!planForm.includes("setConfirming") && !planForm.includes("confirming"), "planner must not use the old extra confirmation modal");
assert.ok(!planForm.includes("min-h-[24rem]"), "planner form must not reserve excessive blank height");
assert.ok(planForm.includes("submitPlan(generationPayload)"), "final planner action must generate immediately after budget check");
assert.ok(!planForm.includes("controller.abort()"), "planner generation must not abort paid AI requests on a client timer");

const generateLockedButton = read("components/trip/GenerateLockedItineraryButton.tsx");
assert.ok(!generateLockedButton.includes("controller.abort()"), "locked itinerary generation must not abort paid AI requests on a client timer");

const stagedGenerator = read("lib/roamly/stagedItineraryGeneration.ts");
[
  "outlinePrompt",
  "dayBatchPrompt",
  "plannedDayBatches",
  "MAX_AI_COST_USD",
  "BATCH_ATTEMPT_LIMIT",
  "assertCostBudget",
  "estimatedStageCost",
  "aiCallCount",
  "estimatedAiCostUsd",
  "generatedDays",
  "repairItineraryForTravelRequirements",
  "enrichItineraryBookingSuggestions",
  "persistItinerary",
  "resetFailedStagedBatch",
  "finalizeStagedGenerationNotification",
  "generationEmail",
  "maxRetries: 0",
  "staged_ai_call_start",
  "staged_ai_call_result",
  "staged_ai_call_failed"
].forEach((needle) => assert.ok(stagedGenerator.includes(needle), `staged generation missing ${needle}`));
assert.ok(!stagedGenerator.includes("buildFallbackItinerary"), "staged generation must not use template fallback itineraries");
assert.ok(!stagedGenerator.includes("local-starter-itinerary"), "staged generation must not return a local starter itinerary");
assert.ok(!stagedGenerator.includes("ROAMLY_SECONDARY_AI"), "secondary-provider fallback is paused until primary production acceptance passes");

const trips = read("lib/trips.ts");
["startTime", "endTime", "durationMinutes", "travelTimeMinutes", "booking", "affiliate_category"].forEach((needle) =>
  assert.ok(trips.includes(needle), `itinerary persistence metadata missing ${needle}`)
);
assert.ok(trips.includes("itinerary_storage_write_completed"), "itinerary storage diagnostics must prove structure was persisted");

const generationDiagnostics = read("lib/roamly/generationDiagnostics.ts");
[
  "logGenerationDiagnostic",
  "summarizeItineraryShape",
  "SENSITIVE_KEY_PATTERN",
  "structuredTimelineComplete",
  "firstDayHasTravel",
  "finalDayHasReturnTravel"
].forEach((needle) => assert.ok(generationDiagnostics.includes(needle), `generation diagnostics missing ${needle}`));

const aiGenerator = read("lib/ai/roamly-itinerary.ts");
[
  "ai_generation_call_start",
  "ai_generation_call_result",
  "ai_generation_response_parsed",
  "ai_generation_failed_no_fallback",
  "fallbackDisabled",
  "openAiKeyPresent",
  "responseContentPresent",
  "generationModelCandidates",
  "model_failover",
  "AI_PROVIDER_FAILED"
].forEach((needle) => assert.ok(aiGenerator.includes(needle), `AI generation trace missing ${needle}`));
assert.ok(!aiGenerator.includes("buildFallbackItinerary"), "paid itinerary generation must not silently build a template fallback");
assert.ok(!aiGenerator.includes("local-starter-itinerary"), "paid itinerary generation must not return the local starter itinerary");

const generateRouteDiagnostics = read("app/api/trips/generate/route.ts");
[
  "generation_route_request_received",
  "generation_route_auth_failed",
  "prepareStagedGenerationContext",
  "startStagedItineraryGeneration",
  "createOrResumeGenerationJob",
  "ROAMLY_GENERATION_QUEUE_MISSING",
  "generationPriorityForEntitlement",
  "duplicateGenerationRequestKey",
  "paidPriority",
  "generation_staged_job_started",
  "generation_route_response"
].forEach((needle) => assert.ok(generateRouteDiagnostics.includes(needle), `generation route trace missing ${needle}`));
assert.ok(!generateRouteDiagnostics.includes("generateRoamlyItinerary"), "generate route must not call the old all-in-one AI generator");
assert.ok(generateRouteDiagnostics.includes("status: \"queued\""), "generate route must return a queued staged job");

assert.ok(tripPage.includes("itinerary_render_full_loaded"), "trip page must log safe structure diagnostics when rendering saved itineraries");

const advanceRoute = read("app/api/trips/[id]/generation/advance/route.ts");
assert.ok(advanceRoute.includes("processGenerationQueue"), "client generation worker route must advance through the durable queue worker");
assert.ok(!advanceRoute.includes("advanceStagedItineraryGeneration"), "client generation worker route must not bypass queue locking");
assert.ok(advanceRoute.includes("resetFailedStagedBatch"), "client generation worker route must retry only failed batches");
assert.ok(advanceRoute.includes("queueSnapshot") && advanceRoute.includes("queue: await queueSnapshot"), "client generation worker route must return durable queue progress");

const statusRoute = read("app/api/trips/[id]/generation/status/route.ts");
assert.ok(statusRoute.includes("publicStagedGenerationProgress"), "generation status route must expose safe progress");
assert.ok(statusRoute.includes("getGenerationQueueForTrip"), "generation status route must expose durable queue progress");
assert.ok(statusRoute.includes("queue: queueProgress"), "generation status route must return saved queue progress");

const generationQueue = read("lib/roamly/generationQueue.ts");
[
  "generationIdempotencyKey",
  "createOrResumeGenerationJob",
  "ensureGenerationLayers",
  "markQueueFromLegacyState",
  "queueTableMissing",
  "invalidateGenerationLayers",
  "requeueInvalidatedGenerationLayers",
  "paid_priority",
  "duplicate_request_key",
  "dead_lettered_at",
  "estimated_cost_json"
].forEach((needle) => assert.ok(generationQueue.includes(needle), `generation queue helper missing ${needle}`));

const generationScalability = read("lib/roamly/generationScalability.ts");
[
  "getGenerationScalabilityConfig",
  "ROAMLY_PAID_QUEUE_PRIORITY",
  "ROAMLY_FREE_QUEUE_PRIORITY",
  "ROAMLY_FREE_GENERATION_DAILY_LIMIT",
  "ROAMLY_PAID_GENERATION_DAILY_LIMIT",
  "ROAMLY_OPENAI_DAILY_TOKEN_LIMIT",
  "ROAMLY_PROVIDER_RATE_LIMITS_JSON",
  "ROAMLY_GENERATION_RETRY_BUDGET",
  "ROAMLY_GENERATION_COST_BUDGET_USD",
  "generationPriorityForEntitlement",
  "duplicateGenerationRequestKey",
  "recordGenerationCostEvent",
  "estimateGenerationCostFromUsage",
  "checkUserGenerationRateLimit",
  "getGenerationQueueHealth",
  "listAdminGenerationQueue",
  "adminRetryGenerationJob",
  "adminCancelGenerationJob"
].forEach((needle) => assert.ok(generationScalability.includes(needle), `generation scalability helper missing ${needle}`));

const brainStages = read("lib/roamly/brain/stages.ts");
[
  "ROAMLY_BRAIN_VERSION",
  "ROAMLY_BRAIN_STAGES",
  "traveler_profile",
  "trip_requirements",
  "destination_research",
  "transport_search",
  "transport_decision",
  "destination_structure",
  "accommodation_area_selection",
  "accommodation_search",
  "accommodation_decision",
  "daily_itinerary_generation",
  "itinerary_logistics_validation",
  "budget_validation",
  "schedule_validation",
  "backup_plan_generation",
  "final_assembly",
  "completion_notification",
  "dependencies",
  "retryClass",
  "providerRequirements",
  "evidenceRequirements",
  "invalidatedBy",
  "inputSchema",
  "outputSchema",
  "dependentStagesForRegeneration",
  "stagesInvalidatedBy"
].forEach((needle) => assert.ok(brainStages.includes(needle), `Brain stage framework missing ${needle}`));

const brainOrchestrator = read("lib/roamly/brain/orchestrator.ts");
[
  "buildBrainStageInput",
  "validateBrainStageInput",
  "validateBrainStageOutput",
  "dependencyVersionSnapshot",
  "invalidateBrainLayersForChange",
  "invalidateGenerationLayers",
  "requeueInvalidatedGenerationLayers"
].forEach((needle) => assert.ok(brainOrchestrator.includes(needle), `Brain orchestrator missing ${needle}`));

const travelerMemory = read("lib/roamly/travelerMemory.ts");
[
  "TRAVELER_PREFERENCE_KEYS",
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "transportation_preferences",
  "accommodation_types",
  "hotel_priorities",
  "confirmed_preferences",
  "inferred_preferences",
  "personalization_enabled",
  "getTravelerMemory",
  "upsertTravelerProfile",
  "deleteTravelerPreference",
  "deleteTravelerMemory",
  "updatePreferenceEventStatus",
  "preferenceInfluenceSummary"
].forEach((needle) => assert.ok(travelerMemory.includes(needle), `traveler memory helper missing ${needle}`));
assert.ok(generationQueue.includes("travelerMemory"), "generation layers must receive traveler memory input");

const travelerMemoryMigration = read("supabase/migrations/20260715_roamly_traveler_memory.sql");
[
  "traveler_profiles",
  "traveler_preference_events",
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "confirmed_preferences",
  "inferred_preferences",
  "personalization_enabled",
  "enable row level security",
  "user_id = auth.uid()",
  "source_trip_id",
  "source_feedback_id"
].forEach((needle) => assert.ok(travelerMemoryMigration.toLowerCase().includes(needle.toLowerCase()), `traveler memory migration missing ${needle}`));

const travelerMemoryRoute = read("app/api/account/traveler-memory/route.ts");
["requireUser", "getTravelerMemory", "upsertTravelerProfile", "deleteTravelerPreference", "updatePreferenceEventStatus", "deleteTravelerMemory"].forEach((needle) =>
  assert.ok(travelerMemoryRoute.includes(needle), `traveler memory route missing ${needle}`)
);

const travelerMemoryComponent = read("components/account/TravelerMemorySettings.tsx");
[
  "/api/account/traveler-memory",
  "Here is what Roamly remembers",
  "Here is what Roamly learned from your trip.",
  "Delete all travel memory",
  "personalization"
].forEach((needle) => assert.ok(travelerMemoryComponent.includes(needle), `traveler memory UI missing ${needle}`));

const tripFeedback = read("lib/roamly/tripFeedback.ts");
[
  "submitTripFeedback",
  "getTripFeedback",
  "proposePreferenceUpdatesFromFeedback",
  "overallSatisfaction",
  "itineraryPace",
  "transportationSatisfaction",
  "hotelLocationSatisfaction",
  "hotelQualitySatisfaction",
  "budgetAccuracy",
  "scheduleRealism",
  "favouriteActivities",
  "disappointingActivities",
  "skippedActivities",
  "reasonsForSkipping",
  "wouldUseRoamlyAgain",
  "freeTextFeedback",
  "transportationDifficult",
  "adjustTomorrow",
  "recommendationUsefulness",
  "traveler_preference_events",
  "status: \"proposed\"",
  "Here is what Roamly learned from your trip."
].forEach((needle) => assert.ok(tripFeedback.includes(needle), `trip feedback helper missing ${needle}`));

const tripFeedbackRoute = read("app/api/trips/[id]/feedback/route.ts");
["requireUser", "getTripFeedback", "submitTripFeedback", "feedbackType", "proposedPreferences"].forEach((needle) =>
  assert.ok(tripFeedbackRoute.includes(needle), `trip feedback route missing ${needle}`)
);

const tripFeedbackComponent = read("components/trip/TripFeedbackForm.tsx");
[
  "fetchWithSupabaseAuth",
  "Trip feedback",
  "Today",
  "Transportation was difficult",
  "Adjust tomorrow",
  "Would use Roamly again",
  "Here is what Roamly learned from your trip."
].forEach((needle) => assert.ok(tripFeedbackComponent.includes(needle), `trip feedback UI missing ${needle}`));

const tripFeedbackMigration = read("supabase/migrations/20260715_roamly_trip_feedback.sql");
[
  "trip_feedback",
  "overall_satisfaction",
  "itinerary_pace",
  "transportation_satisfaction",
  "hotel_location_satisfaction",
  "hotel_quality_satisfaction",
  "budget_accuracy",
  "schedule_realism",
  "favourite_activities",
  "disappointing_activities",
  "skipped_activities",
  "reasons_for_skipping",
  "would_use_roamly_again",
  "free_text_feedback",
  "transportation_difficult",
  "adjust_tomorrow",
  "recommendation_usefulness",
  "learned_preferences_json",
  "traveler_preference_events_source_feedback_id_fkey",
  "enable row level security",
  "user_id = auth.uid()",
  "to service_role"
].forEach((needle) => assert.ok(tripFeedbackMigration.toLowerCase().includes(needle.toLowerCase()), `trip feedback migration missing ${needle}`));

const transportationIntelligence = read("lib/roamly/transportationIntelligence.ts");
[
  "buildTransportationIntelligence",
  "drivingDaysRequired",
  "drivingOvernightStops",
  "door_to_door_minutes",
  "overnight_stops",
  "estimated_additional_costs",
  "score_components",
  "affiliate_value: 0",
  "rental_car",
  "ferry",
  "No ferry provider is configured",
  "Roamly recommends this option for your trip.",
  "user_override_supported",
  "maximumComfortableDrivingHours",
  "transportationPreferences"
].forEach((needle) => assert.ok(transportationIntelligence.includes(needle), `transportation intelligence missing ${needle}`));

const transportStages = read("lib/roamly/brain/transportStages.ts");
["buildTransportSearchLayer", "buildTransportDecisionLayer", "buildTransportationIntelligence"].forEach((needle) =>
  assert.ok(transportStages.includes(needle), `transport Brain stage helper missing ${needle}`)
);

const accommodationIntelligence = read("lib/roamly/accommodationIntelligence.ts");
[
  "buildAccommodationIntelligence",
  "selectAccommodationArea",
  "activity_access",
  "arrival_access",
  "transit_access",
  "walking_fit",
  "review_evidence",
  "booking_conditions",
  "affiliate_value: 0",
  "requires_route_revalidation",
  "Search-ready accommodation option only",
  "Recommendations are ranked according to your trip needs, not commission."
].forEach((needle) => assert.ok(accommodationIntelligence.includes(needle), `accommodation intelligence missing ${needle}`));

const accommodationStages = read("lib/roamly/brain/accommodationStages.ts");
[
  "buildAccommodationAreaSelectionLayer",
  "buildAccommodationSearchLayer",
  "buildAccommodationDecisionLayer",
  "buildAccommodationIntelligence"
].forEach((needle) => assert.ok(accommodationStages.includes(needle), `accommodation Brain stage helper missing ${needle}`));

const dailyItineraryStage = read("lib/roamly/brain/dailyItineraryStage.ts");
[
  "generateDailyItineraryBatch",
  "buildDailyItineraryBatches",
  "validateDailyItineraryBatch",
  "normalizeDailyItineraryDay",
  "response_format",
  "OPENAI_API_KEY_MISSING",
  "verified_live",
  "recently_retrieved",
  "estimated",
  "unknown",
  "reservation_requirements",
  "opening_hour_considerations",
  "weather_considerations",
  "accessibility_considerations",
  "backup_plan",
  "optional_flexible_activity",
  "Use only supplied evidence"
].forEach((needle) => assert.ok(dailyItineraryStage.includes(needle), `daily itinerary stage missing ${needle}`));

const brainIndex = read("lib/roamly/brain/index.ts");
assert.ok(brainIndex.includes("dailyItineraryStage"), "Brain index must export the daily itinerary stage");

const itineraryValidation = read("lib/roamly/itineraryValidation.ts");
[
  "validateItineraryDeterministically",
  "repairLowRiskItineraryIssues",
  "validateAndRepairItinerary",
  "buildItineraryLogisticsValidationLayer",
  "buildBudgetValidationLayer",
  "buildScheduleValidationLayer",
  "overlapping_activities",
  "impossible_travel_time",
  "closed_attraction",
  "insufficient_transfer_time",
  "missed_check_in_window",
  "departure_conflict",
  "budget_overrun",
  "duplicate_activity",
  "excessive_walking",
  "excessive_driving",
  "missing_meal_time",
  "missing_rest",
  "timezone_error",
  "date_error",
  "stale_market_data",
  "missing_reservation_warning",
  "mixed_currencies",
  "dependency_mismatch",
  "hotel_route_inconsistency",
  "transport_itinerary_inconsistency",
  "repairItineraryForTravelRequirements",
  "validationFindingsToInvalidatedStages"
].forEach((needle) => assert.ok(itineraryValidation.includes(needle), `itinerary validation missing ${needle}`));

const validationStages = read("lib/roamly/brain/validationStages.ts");
[
  "buildBrainValidationLayer",
  "itinerary_logistics_validation",
  "budget_validation",
  "schedule_validation",
  "validationRequiresTargetedRegeneration",
  "invalidate and rerun only the relevant Brain layer"
].forEach((needle) => assert.ok(validationStages.includes(needle), `validation Brain stage helper missing ${needle}`));
assert.ok(brainIndex.includes("validationStages"), "Brain index must export validation stages");

const finalAssembly = read("lib/roamly/brain/finalAssembly.ts");
[
  "ROAMLY_FINAL_ASSEMBLY_VERSION",
  "assembleFinalItinerary",
  "buildFinalAssemblyLayer",
  "targetedItineraryChangePlan",
  "trip_overview",
  "traveler_fit_summary",
  "recommended_transportation",
  "transportation_alternatives",
  "recommended_accommodation",
  "accommodation_alternatives",
  "area_rationale",
  "daily_itinerary",
  "travel_times",
  "estimated_total_cost",
  "cost_breakdown",
  "reservations",
  "warnings",
  "backup_options",
  "booking_links",
  "affiliate_disclosure",
  "source_timestamps",
  "why_trip_fits_traveler",
  "legacy_itinerary",
  "structured_layers",
  "replace_activity",
  "regenerate_day",
  "change_transport",
  "change_hotel",
  "change_budget",
  "change_pace",
  "change_dates",
  "Only dependent layers are invalidated"
].forEach((needle) => assert.ok(finalAssembly.includes(needle), `final assembly missing ${needle}`));
assert.ok(brainIndex.includes("finalAssembly"), "Brain index must export final assembly helpers");

const generationQueueMigration = read("supabase/migrations/20260715_roamly_generation_queue.sql");
[
  "roamly_trip_generation_jobs",
  "roamly_trip_generation_layers",
  "idempotency_key",
  "lease_expires_at",
  "roamly_claim_generation_jobs",
  "roamly_claim_generation_layer",
  "roamly_renew_generation_lease",
  "roamly_release_generation_job",
  "roamly_complete_generation_layer",
  "roamly_schedule_generation_layer_retry",
  "roamly_schedule_generation_job_retry",
  "roamly_cancel_generation_job",
  "roamly_invalidate_generation_layers",
  "for update skip locked",
  "enable row level security",
  "to service_role",
  "user_id = auth.uid()",
  "shared anonymous market cache"
].forEach((needle) => assert.ok(generationQueueMigration.toLowerCase().includes(needle.toLowerCase()), `generation queue migration missing ${needle}`));
assert.ok(generationQueueMigration.includes("status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')"), "generation job statuses must be constrained");
assert.ok(generationQueueMigration.includes("status in ('pending', 'running', 'completed', 'failed', 'skipped', 'invalidated')"), "generation layer statuses must be constrained");

const generationCron = read("app/api/cron/roamly-itinerary-generation/route.ts");
assert.ok(generationCron.includes("processGenerationQueue"), "generation cron must wake the shared queue worker");
assert.ok(generationCron.includes("getGenerationWorkerSecrets"), "generation cron must be protected by accepted bearer secrets");
assert.ok(generationCron.includes("export async function POST"), "generation worker must support protected background POST triggers");

const generationWorker = read("lib/roamly/generationWorker.ts");
[
  "processGenerationQueue",
  "getGenerationWorkerConfig",
  "ROAMLY_GENERATION_BATCH_SIZE",
  "ROAMLY_GENERATION_CONCURRENCY",
  "ROAMLY_GENERATION_MAX_RETRIES",
  "ROAMLY_GENERATION_LEASE_SECONDS",
  "ROAMLY_GENERATION_MAX_LAYERS_PER_RUN",
  "ROAMLY_GENERATION_RETRY_BASE_SECONDS",
  "ROAMLY_GENERATION_RETRY_MAX_SECONDS",
  "claimGenerationJobs",
  "claimGenerationJobByTrip",
  "claimGenerationLayer",
  "advanceStagedItineraryGeneration",
  "sendPendingStagedGenerationEmail",
  "recordGenerationCostEvent",
  "worker_execution",
  "model_tokens",
  "terminalStatus(state.status)",
  "releaseGenerationJob",
  "scheduleGenerationLayerRetry",
  "scheduleGenerationJobRetry"
].forEach((needle) => assert.ok(generationWorker.includes(needle), `generation worker missing ${needle}`));

const generationScalabilityMigration = read("supabase/migrations/20260715_roamly_generation_scalability.sql");
[
  "roamly_generation_cost_events",
  "roamly_generation_rate_limits",
  "roamly_generation_provider_limits",
  "paid_priority",
  "duplicate_request_key",
  "dead_lettered_at",
  "estimated_cost_json",
  "provider_usage_json",
  "roamly_record_generation_cost",
  "roamly_retry_generation_job_admin",
  "roamly_cancel_generation_job_admin",
  "roamly_mark_generation_job_dead_letter",
  "roamly_generation_queue_health",
  "roamly_generation_queue_admin",
  "model_tokens",
  "transport_search",
  "accommodation_search",
  "worker_execution",
  "enable row level security",
  "to service_role"
].forEach((needle) => assert.ok(generationScalabilityMigration.toLowerCase().includes(needle.toLowerCase()), `generation scalability migration missing ${needle}`));

const generationQueueAdminRoute = read("app/api/admin/roamly/generation-queue/route.ts");
["requireRoamlyAdmin", "getGenerationQueueHealth", "listAdminGenerationQueue", "adminRetryGenerationJob", "adminCancelGenerationJob"].forEach((needle) =>
  assert.ok(generationQueueAdminRoute.includes(needle), `generation queue admin route missing ${needle}`)
);

const providerAdapters = read("lib/roamly/providers/adapters.ts");
[
  "RoamlyProviderResponse",
  "provider_identifier",
  "retrieved_at",
  "availability_at",
  "raw_result",
  "normalized_result",
  "confidence",
  "stale_status",
  "rate_limit",
  "PROVIDER_CREDENTIALS_MISSING",
  "Roamly will not fabricate live availability, schedules, ratings, reviews, prices, or distances.",
  "providerDiagnostics",
  "validateProviderEnvironment",
  "flightProviderAdapter",
  "railProviderAdapter",
  "busProviderAdapter",
  "ferryProviderAdapter",
  "drivingDistanceProviderAdapter",
  "mapsProviderAdapter",
  "hotelProviderAdapter",
  "activitiesProviderAdapter",
  "reviewsProviderAdapter",
  "weatherProviderAdapter",
  "currencyConversionProviderAdapter",
  "affiliateProviderAdapter",
  "TRAVELPAYOUTS_API_TOKEN",
  "ROAMLY_RAIL_PROVIDER_API_KEY",
  "ROAMLY_BUS_PROVIDER_API_KEY",
  "ROAMLY_FERRY_PROVIDER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "ROAMLY_STAY22_PARTNER_ID or ROAMLY_STAY22_REFERRAL_URL",
  "KLOOK_API_KEY",
  "ROAMLY_REVIEWS_PROVIDER_API_KEY",
  "ROAMLY_WEATHER_API_KEY",
  "ROAMLY_CURRENCY_API_KEY",
  "ROAMLY_PROVIDER_ADAPTERS"
].forEach((needle) => assert.ok(providerAdapters.includes(needle), `provider adapter missing ${needle}`));

const liveProviderMigration = read("supabase/migrations/20260716_roamly_live_provider_status.sql");
[
  "live_provider_status_snapshots",
  "live_flight_status",
  "airport_gate",
  "train_status",
  "local_transit_disruption",
  "attraction_closure",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(liveProviderMigration.toLowerCase().includes(needle.toLowerCase()), `live provider migration missing ${needle}`));

const liveProviderAdapters = read("lib/roamly/liveProviderAdapters.ts");
[
  "LiveProviderResult",
  "liveProviderDiagnostics",
  "liveFlightStatusAdapter",
  "airportGateAdapter",
  "trainStatusAdapter",
  "localTransitDisruptionAdapter",
  "weatherStatusAdapter",
  "trafficDrivingConditionsAdapter",
  "attractionClosureAdapter",
  "recordLiveProviderSnapshot",
  "ROAMLY_FLIGHT_STATUS_API_KEY",
  "ROAMLY_TRAIN_STATUS_API_KEY",
  "ROAMLY_TRANSIT_STATUS_API_KEY",
  "ROAMLY_ATTRACTION_STATUS_API_KEY",
  "Roamly will not fabricate live delays, gates, cancellations, weather, traffic, or closures."
].forEach((needle) => assert.ok(liveProviderAdapters.includes(needle), `live provider adapter missing ${needle}`));

const providerIndex = read("lib/roamly/providers/index.ts");
assert.ok(providerIndex.includes("liveProviderAdapters"), "live provider adapters must be exported through provider index");

const companionEventsMigration = read("supabase/migrations/20260716_roamly_companion_events.sql");
[
  "booking_change_events",
  "companion_events",
  "event_fingerprint",
  "affected_layers",
  "requires_user_approval",
  "booking_change_events_fingerprint_uidx",
  "companion_events_fingerprint_uidx",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(companionEventsMigration.toLowerCase().includes(needle.toLowerCase()), `companion event migration missing ${needle}`));

const companionEventEngine = read("lib/roamly/companionEventEngine.ts");
[
  "companionEventFingerprint",
  "recordBookingChangeEvent",
  "recordCompanionEvent",
  "processBookingChangeEvent",
  "eventFromLiveProviderResult",
  "affectedLayersForCompanionEvent",
  "approvalRequiredForEvent",
  "flight_delayed",
  "flight_cancelled",
  "gate_changed",
  "hotel_cancelled",
  "missed_connection_risk",
  "analyzeCompanionImpact",
  "onConflict: \"user_id,event_fingerprint\""
].forEach((needle) => assert.ok(companionEventEngine.includes(needle), `companion event engine missing ${needle}`));

const companionImpactMigration = read("supabase/migrations/20260716_roamly_companion_impact_analysis.sql");
[
  "companion_impact_results",
  "affected_items_json",
  "timing_impact_json",
  "cost_impact_json",
  "traveler_action_required",
  "safe_automatic_actions",
  "approval_required_actions",
  "fallback_options",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(companionImpactMigration.toLowerCase().includes(needle.toLowerCase()), `companion impact migration missing ${needle}`));

const companionImpactAnalysis = read("lib/roamly/companionImpactAnalysis.ts");
[
  "COMPANION_IMPACT_SCHEMA",
  "analyzeCompanionImpact",
  "deterministicImpact",
  "aiImpactReview",
  "json_schema",
  "strict: true",
  "paid_commitment_allowed: false",
  "Do not book, cancel, purchase",
  "safeAutomaticActions",
  "approvalRequiredActions"
].forEach((needle) => assert.ok(companionImpactAnalysis.includes(needle), `companion impact analysis missing ${needle}`));

const generationWorkerMigration = read("supabase/migrations/20260715_roamly_generation_worker.sql");
[
  "roamly_claim_generation_job_by_trip",
  "roamly_release_generation_layer",
  "roamly_skip_remaining_generation_layers",
  "for update skip locked",
  "grant execute"
].forEach((needle) => assert.ok(generationWorkerMigration.toLowerCase().includes(needle.toLowerCase()), `generation worker migration missing ${needle}`));

const generationBackground = read("lib/roamly/stagedGenerationBackground.ts");
assert.ok(generationBackground.includes("after("), "generation background trigger must continue after the response");
assert.ok(generationBackground.includes("/api/cron/roamly-itinerary-generation"), "background trigger must call the protected worker route");
assert.ok(generationBackground.includes("ROAMLY_GENERATION_CRON_SECRET") && generationBackground.includes("CRON_SECRET"), "background trigger must use the existing cron secret");

const progressComponent = read("components/trip/StagedGenerationProgress.tsx");
assert.ok(progressComponent.includes("fetchWithSupabaseAuth"), "generation progress UI must send authenticated cookies/tokens");
assert.ok(progressComponent.includes("retryLimit"), "generation progress UI must respect the retry ceiling");
assert.ok(progressComponent.includes("estimatedAiCostUsd"), "generation progress UI must show estimated AI cost");
assert.ok(progressComponent.includes("Email me when ready"), "generation progress UI must show transactional email status");
[
  "QueueProgress",
  "SAVED_QUEUE_MESSAGE",
  "Your trip is safely saved. Roamly will continue building it even if you close this page.",
  "Saved stages",
  "Queued",
  "Understanding your trip",
  "Learning your preferences",
  "Researching your destination",
  "Comparing transportation",
  "Choosing the best way to travel",
  "Finding the best area to stay",
  "Comparing accommodations",
  "Building your itinerary",
  "Checking travel times",
  "Checking your budget",
  "Creating backup plans",
  "Finalizing your trip",
  "Completed",
  "trackPollMovement(data?.progress, data?.queue)",
  "advanceProgress"
].forEach((needle) => assert.ok(progressComponent.includes(needle), `generation progress UI missing ${needle}`));

const generationEmail = read("lib/roamly/itineraryGenerationEmail.ts");
[
  "finalizeStagedGenerationNotification",
  "sendStagedGenerationEmail",
  "sendPendingStagedGenerationEmail",
  "completion_email_status",
  "completion_email_sent_at",
  "completion_email_attempt_count",
  "completion_email_next_retry_at",
  "failure_email_sent_at",
  "email_provider_message_id",
  "delivery_status",
  "last_email_error",
  "sendRoamlyEmail",
  "transactional: true",
  "idempotencyKey"
].forEach((needle) => assert.ok(generationEmail.includes(needle), `generation email helper missing ${needle}`));
assert.ok(generationEmail.includes("toRoamlyAbsoluteUrl(`/trip/${tripId}?from=generation-email`"), "itinerary completion email CTA must use a production-safe absolute trip URL");
assert.ok(!generationEmail.includes("if (process.env.VERCEL_URL) return"), "itinerary completion email must not point at Vercel preview domains");
assert.ok(generationEmail.includes("View your itinerary"), "itinerary completion email CTA copy must match the production template");
assert.ok(generationEmail.includes("same Roamly account"), "itinerary completion email must tell users to sign into the correct account");

const emailAdapter = read("lib/roamly/email.ts");
[
  "nodemailer",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EXPECTED_SMTP_USER = \"support@roamlyhq.com\"",
  "verifyRoamlyEmailProvider",
  "dns.lookup",
  "createSmtpTransporter",
  "messageId",
  "provider_message_id",
  "template",
  "attempt_count",
  "last_error",
  "EMAIL_PROVIDER_NOT_CONFIGURED",
  "preference === \"resend\"",
  "fetch(\"https://api.resend.com/emails\""
].forEach((needle) => assert.ok(emailAdapter.includes(needle), `email adapter missing ${needle}`));
assert.ok(emailAdapter.includes('readEnv("ROAMLY_EMAIL_PROVIDER").toLowerCase() || "smtp"'), "SMTP must be the default provider preference, not Resend");
assert.ok(!emailAdapter.includes('|| "resend"'), "Resend must not be the default Roamly email provider");
assert.ok(emailAdapter.includes('config.provider === "smtp"') && emailAdapter.includes("sendSmtpEmail"), "SMTP sends must use the SMTP sender path");
assert.ok(emailAdapter.includes('config.provider === "smtp"') && emailAdapter.includes("sendResendEmail"), "Resend must remain optional and provider-gated");

const emailTemplates = read("lib/roamly/emailTemplates.ts");
[
  "ROAMLY_LOGO_URL",
  "roamly-wordmark@2x.png",
  "renderRoamlyEmailHeader",
  "renderEmailHeading",
  "renderEmailBodyCopy",
  "renderEmailCta",
  "renderEmailSummary",
  "renderRoamlyEmailFooter",
  "renderPlainText",
  "role=\"presentation\"",
  "alt=\"Roamly\"",
  "View your itinerary"
].forEach((needle) => assert.ok(emailTemplates.includes(needle), `shared email layout missing ${needle}`));
assert.ok(!emailTemplates.includes("display:inline-flex"), "email layout must avoid flex-only logo/header markup");

const adminEmailPage = read("app/admin/email/page.tsx");
["Active provider", "activeProviderLabel", "Last successful send", "Retry queue", "completion_email_status"].forEach((needle) =>
  assert.ok(adminEmailPage.includes(needle), `admin email page missing ${needle}`)
);

const adminEmailConsole = read("components/admin/AdminEmailConsole.tsx");
[
  "Verify SMTP connection",
  "Send test email to admin",
  "Preview itinerary-ready email",
  "Preview welcome email",
  "Preview support email",
  "Desktop preview",
  "Mobile preview",
  "HTML preview",
  "Plain-text preview",
  "Retry failed email",
  "provider_message_id"
].forEach((needle) => assert.ok(adminEmailConsole.includes(needle), `admin email console missing ${needle}`));

const emailPreviewRoute = read("app/api/admin/roamly/email/preview/route.ts");
assert.ok(emailPreviewRoute.includes("renderSampleItineraryGenerationEmail") && emailPreviewRoute.includes("renderEmailTemplate"), "admin previews must use production renderers");

const emailTestRoute = read("app/api/admin/roamly/email/test/route.ts");
assert.ok(emailTestRoute.includes("getRoamlySupportEmail"), "admin test email must send to configured support/admin email");

const vercelConfig = read("vercel.json");
assert.ok(vercelConfig.includes("/api/cron/roamly-itinerary-generation"), "Vercel cron must resume staged itinerary generation");
assert.ok(vercelConfig.includes("\"schedule\": \"*/5 * * * *\""), "Vercel itinerary generation cron must run every five minutes");

const travelMarketSearch = read("lib/roamly/travelMarketSearch.ts");
assert.ok(travelMarketSearch.includes('return value !== "false" && value !== "0" && value !== "disabled";'), "market and affiliate gates should default on unless explicitly disabled");

const bookingWalletMigration = read("supabase/migrations/20260716_roamly_booking_wallet.sql");
[
  "trip_bookings",
  "booking_segments",
  "recommended",
  "clicked",
  "detected",
  "needs_confirmation",
  "confirmed",
  "modified",
  "cancelled",
  "refunded",
  "completed",
  "enable row level security",
  "user_id = auth.uid()",
  "trip_bookings_provider_booking_uidx",
  "booking_segments_booking_sequence_uidx"
].forEach((needle) =>
  assert.ok(bookingWalletMigration.toLowerCase().includes(needle.toLowerCase()), `booking wallet migration missing ${needle}`)
);

const bookingWallet = read("lib/roamly/bookingWallet.ts");
[
  "TRIP_BOOKING_TYPES",
  "TRIP_BOOKING_STATUSES",
  "TRIP_BOOKING_SOURCE_TYPES",
  "normalizeTripBookingInput",
  "normalizeBookingSegments",
  "isConfirmedBooking",
  "isBookingClickOnly",
  "stableBookingKey",
  "confirmedBookingsForItinerary",
  "bookingWalletSummary"
].forEach((needle) => assert.ok(bookingWallet.includes(needle), `booking wallet helper missing ${needle}`));

const bookingReconciliationMigration = read("supabase/migrations/20260716_roamly_booking_reconciliation.sql");
["booking_reconciliation_runs", "source_booking_id", "affected_layers", "enable row level security", "user_id = auth.uid()"].forEach((needle) =>
  assert.ok(bookingReconciliationMigration.toLowerCase().includes(needle.toLowerCase()), `booking reconciliation migration missing ${needle}`)
);

const bookingReconciliationStage = read("lib/roamly/brain/bookingReconciliation.ts");
[
  "BOOKING_RECONCILIATION_STAGE",
  "booking_reconciliation",
  "reconcileTripBookings",
  "reconcileBookingRecords",
  "stableBookingKey",
  "affectedLayersForBooking",
  "transport_decision",
  "accommodation_decision",
  "recommendationHistoryPreserved"
].forEach((needle) => assert.ok(bookingReconciliationStage.includes(needle), `booking reconciliation stage missing ${needle}`));

const brainIndexWithReconciliation = read("lib/roamly/brain/index.ts");
assert.ok(brainIndexWithReconciliation.includes("bookingReconciliation"), "booking reconciliation stage must be exported from the Brain package");

const compiledBookingWallet = ts.transpileModule(bookingWallet, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const bookingWalletSandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/roamly/events") {
      return {
        recordTripEvent: async () => ({ ok: true })
      };
    }

    if (id === "@/lib/roamly/companionOrchestrator") {
      return {
        processCompanionBookingChange: async () => ({
          ok: true,
          test: true
        })
      };
    }

    return require(id);
  }
};
bookingWalletSandbox.exports = bookingWalletSandbox.module.exports;
vm.runInNewContext(compiledBookingWallet, bookingWalletSandbox);
const wallet = bookingWalletSandbox.module.exports;
const clickedBooking = {
  booking_status: "clicked",
  source_type: "affiliate_click",
  traveler_confirmed: false
};
assert.equal(wallet.isBookingClickOnly(clickedBooking), true, "affiliate clicks must remain click-only wallet records");
assert.equal(wallet.isConfirmedBooking(clickedBooking), false, "affiliate clicks must not become confirmed bookings");
const confirmedBooking = {
  booking_status: "confirmed",
  traveler_confirmed: true
};
assert.equal(wallet.isConfirmedBooking(confirmedBooking), true, "traveler-confirmed bookings must count as confirmed");
const normalizedFlight = wallet.normalizeTripBookingInput({
  bookingType: "flight",
  bookingStatus: "confirmed",
  travelerConfirmed: true,
  provider: "Air Canada",
  title: "AC 870",
  startTime: "2026-08-01T20:30:00-04:00",
  totalPrice: 1200.126,
  currency: "cad"
});
assert.equal(normalizedFlight.booking_type, "flight", "flight bookings must normalize");
assert.equal(normalizedFlight.currency, "CAD", "booking currencies must normalize to ISO uppercase");
assert.equal(normalizedFlight.total_price, 1200.13, "booking prices must be rounded, not converted from cents");
assert.ok(
  wallet.stableBookingKey({
    userId: "user-1",
    provider: "Air Canada",
    providerBookingId: "ABC123",
    bookingType: "flight"
  }).startsWith("provider:user-1:air canada:abc123"),
  "stable booking keys must dedupe provider confirmations"
);

const bookingWalletRoute = read("app/api/trips/[id]/bookings/route.ts");
["requireUser", "listTripBookings", "createTripBooking", "bookingInput", "segmentInput"].forEach((needle) =>
  assert.ok(bookingWalletRoute.includes(needle), `trip booking wallet route missing ${needle}`)
);
assert.ok(bookingWalletRoute.includes("reconcileTripBookings"), "manual booking saves must trigger booking reconciliation");

const bookingReconcileRoute = read("app/api/trips/[id]/bookings/reconcile/route.ts");
assert.ok(bookingReconcileRoute.includes("requireUser") && bookingReconcileRoute.includes("reconcileTripBookings"), "booking reconciliation route must be authenticated");

const bookingWalletPage = read("app/trip/[id]/bookings/page.tsx");
[
  "BookingWalletTimeline",
  "legacyRoamlyBookingToWallet",
  "listTripBookings",
  "mergeBookings",
  "tripHasTrackingUnlock",
  "login?next"
].forEach((needle) => assert.ok(bookingWalletPage.includes(needle), `booking wallet page missing ${needle}`));

const bookingWalletTimeline = read("components/companion/BookingWalletTimeline.tsx");
[
  "Add booking",
  "View details",
  "Trip status",
  "Next",
  "Today",
  "Trip",
  "Bookings",
  "Companion",
  "No bookings yet",
  "statusCopy",
  "BookingIcon"
].forEach((needle) => assert.ok(bookingWalletTimeline.includes(needle), `booking wallet timeline UI missing ${needle}`));
assert.ok(!bookingWalletTimeline.includes("Track flight"), "Booking Wallet must not claim live flight tracking before live providers are wired");
assert.ok(bookingWalletTimeline.includes("/bookings/add"), "Booking Wallet Add booking action must open the manual booking flow");

const manualBookingForm = read("components/companion/ManualBookingForm.tsx");
[
  "Upload confirmation",
  "Enter manually",
  "Review booking",
  "Check this field",
  "Airline",
  "Flight number",
  "Hotel name",
  "Check-in",
  "Check-out",
  "Save booking",
  `/api/trips/${"${tripId}"}/bookings/extract`,
  `/api/trips/${"${tripId}"}/bookings`
].forEach((needle) => assert.ok(manualBookingForm.includes(needle), `manual booking form missing ${needle}`));
assert.ok(!manualBookingForm.includes("Proceed") && !manualBookingForm.includes("Execute"), "manual booking UI must use plain action labels");

const addBookingPage = read("app/trip/[id]/bookings/add/page.tsx");
["ManualBookingForm", "login?next", "getTripBundle"].forEach((needle) =>
  assert.ok(addBookingPage.includes(needle), `add booking page missing ${needle}`)
);

const bookingExtractRoute = read("app/api/trips/[id]/bookings/extract/route.ts");
["extractBookingFromScreenshot", "application/pdf", "Review the fields before saving.", "Trip access denied"].forEach((needle) =>
  assert.ok(bookingExtractRoute.includes(needle), `booking extraction route missing ${needle}`)
);

const affiliateTrackingMigration = read("supabase/migrations/20260716_roamly_affiliate_tracking.sql");
[
  "affiliate_clicks",
  "affiliate_conversions",
  "sub_id",
  "affiliate_clicks_sub_id_uidx",
  "affiliate_conversions_partner_order_uidx",
  "affiliate_conversions_raw_event_uidx",
  "trip_bookings_affiliate_click_id_fkey",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(affiliateTrackingMigration.toLowerCase().includes(needle.toLowerCase()), `affiliate tracking migration missing ${needle}`)
);

const affiliateTracking = read("lib/roamly/affiliateTracking.ts");
[
  "createAffiliateSubId",
  "appendAffiliateSubId",
  "createAffiliateClick",
  "recordAffiliateConversion",
  "verifyAffiliateWebhookSignature",
  "normalizeAffiliateConversionEvent",
  "reconcileTripBookings",
  "We found your booking. Add the confirmation details to activate live tracking."
].forEach((needle) => assert.ok(affiliateTracking.includes(needle), `affiliate tracking helper missing ${needle}`));
const compiledAffiliateTracking = ts.transpileModule(affiliateTracking, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const affiliateTrackingSandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/roamly/bookingLinks") return { safeExternalUrl: (value) => new URL(value).toString() };
    if (id === "@/lib/roamly/bookingWallet") return { createTripBooking: async () => ({ booking: null, error: null }) };
    if (id === "@/lib/roamly/brain/bookingReconciliation") return { reconcileTripBookings: async () => ({ ok: true, output: {} }) };
    return require(id);
  },
  URL,
  Buffer
};
affiliateTrackingSandbox.exports = affiliateTrackingSandbox.module.exports;
vm.runInNewContext(compiledAffiliateTracking, affiliateTrackingSandbox);
const affiliateTrackingExports = affiliateTrackingSandbox.module.exports;
assert.ok(/^rc_/.test(affiliateTrackingExports.createAffiliateSubId()), "affiliate sub IDs must be opaque Roamly click IDs");
assert.ok(
  affiliateTrackingExports.appendAffiliateSubId("https://www.stay22.com/search?aid=partner", "stay22", "rc_safeopaque1234567890").includes("sid=rc_safeopaque"),
  "Stay22 affiliate redirects must use opaque sid values"
);
assert.ok(
  !affiliateTrackingExports.appendAffiliateSubId("https://www.aviasales.com/search", "travelpayouts", "rc_safeopaque1234567890").includes("user"),
  "affiliate redirect params must not expose raw user identifiers"
);

const bookingRecommendationButton = read("components/trip/BookingRecommendationButton.tsx");
assert.ok(bookingRecommendationButton.includes("/api/roamly/affiliate/click"), "affiliate booking CTAs must use tracked server redirects");
assert.ok(bookingRecommendationButton.includes("destinationUrl") && bookingRecommendationButton.includes("affiliateUrl"), "tracked affiliate CTAs must pass only internal redirect metadata");

const affiliateClickRoute = read("app/api/roamly/affiliate/click/route.ts");
["requireUser", "createAffiliateClick", "NextResponse.redirect"].forEach((needle) =>
  assert.ok(affiliateClickRoute.includes(needle), `affiliate click route missing ${needle}`)
);

const affiliateWebhookRoute = read("app/api/webhooks/affiliate/route.ts");
["request.text()", "verifyAffiliateWebhookSignature", "ROAMLY_AFFILIATE_WEBHOOK_SECRET", "recordAffiliateConversion"].forEach((needle) =>
  assert.ok(affiliateWebhookRoute.includes(needle), `affiliate webhook route missing ${needle}`)
);

const emailConnectionsMigration = read("supabase/migrations/20260716_roamly_email_connections.sql");
[
  "email_connections",
  "email_watch_subscriptions",
  "email_sync_cursors",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "gmail",
  "outlook",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(emailConnectionsMigration.toLowerCase().includes(needle.toLowerCase()), `email connections migration missing ${needle}`)
);

const travelEmailFilteringMigration = read("supabase/migrations/20260716_roamly_travel_email_filtering.sql");
[
  "travel_email_messages",
  "provider_message_id",
  "extracted_booking_facts",
  "parser_confidence",
  "processing_result",
  "raw_body_retained boolean not null default false",
  "travel_email_messages_no_raw_body_check",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(travelEmailFilteringMigration.toLowerCase().includes(needle.toLowerCase()), `travel email filtering migration missing ${needle}`)
);

const bookingExtractionMigration = read("supabase/migrations/20260716_roamly_booking_extraction_matching.sql");
[
  "booking_extraction_results",
  "email_message_id",
  "extracted_booking_json",
  "field_confidence_json",
  "overall_confidence",
  "match_status",
  "matched_booking_id",
  "needs_confirmation",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(bookingExtractionMigration.toLowerCase().includes(needle.toLowerCase()), `booking extraction migration missing ${needle}`)
);

const emailConnections = read("lib/roamly/emailConnections.ts");
[
  "GMAIL_READONLY_SCOPE",
  "OUTLOOK_READONLY_SCOPES",
  "ROAMLY_TOKEN_ENCRYPTION_KEY",
  "encryptToken",
  "decryptToken",
  "gmailAuthorizationUrl",
  "outlookAuthorizationUrl",
  "exchangeGmailCodeForTokens",
  "exchangeOutlookCodeForTokens",
  "renewGmailWatch",
  "renewOutlookSubscription",
  "syncGmailConnection",
  "syncOutlookConnection",
  "recordTravelEmailFilterResult",
  "extractAndMatchTravelEmailBooking",
  "format\", \"metadata",
  "metadataHeaders",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta",
  "q\", \"newer_than:30d"
].forEach((needle) => assert.ok(emailConnections.includes(needle), `email connections helper missing ${needle}`));
assert.ok(!emailConnections.includes("gmail.modify"), "Gmail integration must not request write mailbox scopes");
assert.ok(!emailConnections.includes("Mail.ReadWrite"), "Outlook integration must not request write mailbox scopes");
assert.ok(!emailConnections.includes("format\", \"full"), "Gmail sync must not fetch full message bodies during filtering");

const travelEmailFiltering = read("lib/roamly/travelEmailFiltering.ts");
[
  "KNOWN_TRAVEL_DOMAINS",
  "TRAVEL_SUBJECT_PATTERNS",
  "BOOKING_REFERENCE_PATTERN",
  "FLIGHT_NUMBER_PATTERN",
  "filterTravelEmail",
  "recordTravelEmailFilterResult",
  "bodyStored: false",
  "raw_body_retained: false"
].forEach((needle) => assert.ok(travelEmailFiltering.includes(needle), `travel email filtering helper missing ${needle}`));
["full_body", "body_html", "raw_email_body"].forEach((needle) =>
  assert.ok(!travelEmailFilteringMigration.includes(needle), `travel email filtering must not store ${needle}`)
);

const bookingExtraction = read("lib/roamly/bookingExtraction.ts");
[
  "BOOKING_EXTRACTION_JSON_SCHEMA",
  "deterministicBookingExtraction",
  "extractBookingWithAiStructuredOutput",
  "json_schema",
  "strict: true",
  "createTripBooking",
  "bestTripMatch",
  "needs_confirmation",
  "high_confidence_match",
  "reconcileTripBookings",
  "Do not infer missing booking facts"
].forEach((needle) => assert.ok(bookingExtraction.includes(needle), `booking extraction helper missing ${needle}`));
assert.ok(
  bookingWallet.includes("processCompanionBookingChange"),
  "booking wallet must trigger Companion for meaningful booking changes"
);

const emailProviderAdapters = read("lib/roamly/emailProviderAdapters.ts");
["EMAIL_PROVIDER_ADAPTERS", "Gmail", "Outlook", "supportsIncrementalSync", "MICROSOFT_OUTLOOK_CLIENT_ID"].forEach((needle) =>
  assert.ok(emailProviderAdapters.includes(needle), `email provider adapter registry missing ${needle}`)
);

[
  "app/api/integrations/gmail/connect/route.ts",
  "app/api/integrations/gmail/callback/route.ts",
  "app/api/integrations/gmail/disconnect/route.ts",
  "app/api/integrations/gmail/sync/route.ts",
  "app/api/webhooks/gmail/route.ts",
  "app/api/integrations/outlook/connect/route.ts",
  "app/api/integrations/outlook/callback/route.ts",
  "app/api/integrations/outlook/disconnect/route.ts",
  "app/api/integrations/outlook/sync/route.ts",
  "app/api/webhooks/outlook/route.ts",
  "lib/roamly/emailProviderAdapters.ts",
  "app/api/account/email-connections/route.ts"
].forEach((file) => assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`));

const gmailConnectRoute = read("app/api/integrations/gmail/connect/route.ts");
["GMAIL_OAUTH_STATE_COOKIE", "gmailAuthorizationUrl", "requireUser"].forEach((needle) =>
  assert.ok(gmailConnectRoute.includes(needle), `Gmail connect route missing ${needle}`)
);

const gmailCallbackRoute = read("app/api/integrations/gmail/callback/route.ts");
["exchangeGmailCodeForTokens", "getGmailProfile", "upsertGmailConnection", "renewGmailWatch"].forEach((needle) =>
  assert.ok(gmailCallbackRoute.includes(needle), `Gmail callback route missing ${needle}`)
);

const gmailWebhookRoute = read("app/api/webhooks/gmail/route.ts");
["ROAMLY_GMAIL_WEBHOOK_SECRET", "Buffer.from", "syncGmailConnection"].forEach((needle) =>
  assert.ok(gmailWebhookRoute.includes(needle), `Gmail webhook route missing ${needle}`)
);

const outlookConnectRoute = read("app/api/integrations/outlook/connect/route.ts");
["OUTLOOK_OAUTH_STATE_COOKIE", "outlookAuthorizationUrl", "requireUser"].forEach((needle) =>
  assert.ok(outlookConnectRoute.includes(needle), `Outlook connect route missing ${needle}`)
);

const outlookCallbackRoute = read("app/api/integrations/outlook/callback/route.ts");
["exchangeOutlookCodeForTokens", "getOutlookProfile", "upsertOutlookConnection", "renewOutlookSubscription"].forEach((needle) =>
  assert.ok(outlookCallbackRoute.includes(needle), `Outlook callback route missing ${needle}`)
);

const outlookWebhookRoute = read("app/api/webhooks/outlook/route.ts");
["ROAMLY_OUTLOOK_WEBHOOK_SECRET", "validationToken", "syncOutlookConnection"].forEach((needle) =>
  assert.ok(outlookWebhookRoute.includes(needle), `Outlook webhook route missing ${needle}`)
);

const emailConnectionSettings = read("components/account/EmailConnectionSettings.tsx");
["Connect Gmail", "Disconnect Gmail", "Sync Gmail", "Connect Outlook", "Disconnect Outlook", "Sync Outlook", "Personal emails are not saved or used for advertising."].forEach((needle) =>
  assert.ok(emailConnectionSettings.includes(needle), `email connection settings missing ${needle}`)
);

const accountPageWithEmailImport = read("app/account/page.tsx");
assert.ok(accountPageWithEmailImport.includes("EmailConnectionSettings"), "account page must expose mailbox controls separately from Google login");

console.log("Roamly core checks passed.");
