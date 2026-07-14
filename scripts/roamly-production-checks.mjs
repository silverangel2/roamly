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
  "lib/roamly/stagedGenerationBackground.ts",
  "lib/roamly/itineraryGenerationEmail.ts",
  "lib/roamly/generationWorker.ts",
  "lib/roamly/generationQueue.ts",
  "lib/roamly/generationScalability.ts",
  "lib/roamly/providers/adapters.ts",
  "lib/roamly/providers/index.ts",
  "lib/roamly/brain/stages.ts",
  "lib/roamly/brain/orchestrator.ts",
  "lib/roamly/brain/index.ts",
  "lib/roamly/brain/transportStages.ts",
  "lib/roamly/brain/accommodationStages.ts",
  "lib/roamly/brain/dailyItineraryStage.ts",
  "lib/roamly/brain/validationStages.ts",
  "lib/roamly/brain/finalAssembly.ts",
  "lib/roamly/travelerMemory.ts",
  "lib/roamly/transportationIntelligence.ts",
  "lib/roamly/accommodationIntelligence.ts",
  "lib/roamly/affiliateNeutrality.ts",
  "lib/roamly/itineraryValidation.ts",
  "lib/roamly/tripFeedback.ts",
  "app/api/account/traveler-memory/route.ts",
  "app/api/trips/[id]/feedback/route.ts",
  "app/api/admin/roamly/generation-queue/route.ts",
  "app/trip/[id]/feedback/page.tsx",
  "app/trip/[id]/bookings/page.tsx",
  "app/trip/[id]/bookings/add/page.tsx",
  "components/account/TravelerMemorySettings.tsx",
  "components/account/EmailConnectionSettings.tsx",
  "components/companion/BookingWalletTimeline.tsx",
  "components/companion/ManualBookingForm.tsx",
  "components/trip/TripFeedbackForm.tsx",
  "supabase/migrations/20260715_roamly_generation_queue.sql",
  "supabase/migrations/20260715_roamly_generation_worker.sql",
  "supabase/migrations/20260715_roamly_traveler_memory.sql",
  "supabase/migrations/20260715_roamly_trip_feedback.sql",
  "supabase/migrations/20260715_roamly_generation_scalability.sql",
  "supabase/migrations/20260716_roamly_booking_wallet.sql",
  "lib/roamly/bookingWallet.ts",
  "lib/roamly/affiliateTracking.ts",
  "lib/roamly/emailConnections.ts",
  "lib/roamly/emailProviderAdapters.ts",
  "app/api/account/email-connections/route.ts",
  "app/api/integrations/gmail/connect/route.ts",
  "app/api/integrations/gmail/callback/route.ts",
  "app/api/integrations/gmail/disconnect/route.ts",
  "app/api/integrations/gmail/sync/route.ts",
  "app/api/integrations/outlook/connect/route.ts",
  "app/api/integrations/outlook/callback/route.ts",
  "app/api/integrations/outlook/disconnect/route.ts",
  "app/api/integrations/outlook/sync/route.ts",
  "app/api/trips/[id]/bookings/route.ts",
  "app/api/trips/[id]/bookings/extract/route.ts",
  "app/api/roamly/affiliate/click/route.ts",
  "app/api/webhooks/affiliate/route.ts",
  "supabase/migrations/20260716_roamly_affiliate_tracking.sql",
  "supabase/migrations/20260716_roamly_email_connections.sql",
  "supabase/migrations/20260716_roamly_travel_email_filtering.sql",
  "supabase/migrations/20260716_roamly_booking_extraction_matching.sql",
  "app/api/webhooks/gmail/route.ts",
  "app/api/webhooks/outlook/route.ts",
  "lib/roamly/travelEmailFiltering.ts",
  "lib/roamly/bookingExtraction.ts",
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

const bookingWalletMigration = read("supabase/migrations/20260716_roamly_booking_wallet.sql");
[
  "trip_bookings",
  "booking_segments",
  "recommended",
  "clicked",
  "detected",
  "needs_confirmation",
  "confirmed",
  "affiliate_click_id",
  "affiliate_conversion_id",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(bookingWalletMigration.toLowerCase().includes(needle.toLowerCase()), `booking wallet migration missing ${needle}`)
);

const bookingWallet = read("lib/roamly/bookingWallet.ts");
["isBookingClickOnly", "isConfirmedBooking", "confirmedBookingsForItinerary", "stableBookingKey", "createTripBooking"].forEach((needle) =>
  assert.ok(bookingWallet.includes(needle), `booking wallet helper missing ${needle}`)
);

const tripBookingsRoute = read("app/api/trips/[id]/bookings/route.ts");
assert.ok(tripBookingsRoute.includes("requireUser"), "trip booking wallet route must require authenticated users");
assert.ok(tripBookingsRoute.includes("createTripBooking") && tripBookingsRoute.includes("listTripBookings"), "trip booking wallet route must use centralized wallet helpers");

const tripBookingsPage = read("app/trip/[id]/bookings/page.tsx");
assert.ok(tripBookingsPage.includes("BookingWalletTimeline"), "trip booking wallet page must render the premium wallet timeline");
assert.ok(tripBookingsPage.includes("legacyRoamlyBookingToWallet"), "trip booking wallet page must preserve existing imported booking compatibility");

const bookingWalletTimeline = read("components/companion/BookingWalletTimeline.tsx");
["Add booking", "View details", "Today", "Trip", "Bookings", "Companion"].forEach((needle) =>
  assert.ok(bookingWalletTimeline.includes(needle), `booking wallet timeline missing ${needle}`)
);
assert.ok(!bookingWalletTimeline.includes("Track flight"), "Booking Wallet must not claim live flight tracking before live providers are configured");
assert.ok(bookingWalletTimeline.includes("/bookings/add"), "Booking Wallet must link to the add-booking flow");

const manualBookingForm = read("components/companion/ManualBookingForm.tsx");
["Upload confirmation", "Enter manually", "Review booking", "Airline", "Flight number", "Hotel name", "Save booking"].forEach((needle) =>
  assert.ok(manualBookingForm.includes(needle), `manual booking form missing ${needle}`)
);

const addBookingPage = read("app/trip/[id]/bookings/add/page.tsx");
assert.ok(addBookingPage.includes("ManualBookingForm") && addBookingPage.includes("getTripBundle"), "add booking page must be trip-owned");

const bookingExtractRoute = read("app/api/trips/[id]/bookings/extract/route.ts");
assert.ok(bookingExtractRoute.includes("extractBookingFromScreenshot") && bookingExtractRoute.includes("application/pdf"), "booking extraction route must support screenshot and PDF review flows");

const affiliateTrackingMigration = read("supabase/migrations/20260716_roamly_affiliate_tracking.sql");
["affiliate_clicks", "affiliate_conversions", "sub_id", "enable row level security", "trip_bookings_affiliate_click_id_fkey"].forEach((needle) =>
  assert.ok(affiliateTrackingMigration.toLowerCase().includes(needle.toLowerCase()), `affiliate tracking migration missing ${needle}`)
);

const affiliateTracking = read("lib/roamly/affiliateTracking.ts");
["createAffiliateClick", "recordAffiliateConversion", "appendAffiliateSubId", "verifyAffiliateWebhookSignature"].forEach((needle) =>
  assert.ok(affiliateTracking.includes(needle), `affiliate tracking helper missing ${needle}`)
);

const bookingRecommendationButton = read("components/trip/BookingRecommendationButton.tsx");
assert.ok(bookingRecommendationButton.includes("/api/roamly/affiliate/click"), "affiliate CTAs must go through server-side click tracking");

const affiliateClickRoute = read("app/api/roamly/affiliate/click/route.ts");
assert.ok(affiliateClickRoute.includes("requireUser") && affiliateClickRoute.includes("createAffiliateClick"), "affiliate click route must authenticate and create click records");

const affiliateWebhookRoute = read("app/api/webhooks/affiliate/route.ts");
assert.ok(affiliateWebhookRoute.includes("ROAMLY_AFFILIATE_WEBHOOK_SECRET"), "affiliate conversion webhook must require a server-side secret");
assert.ok(affiliateWebhookRoute.includes("verifyAffiliateWebhookSignature"), "affiliate conversion webhook must verify signatures");

const emailConnectionsMigration = read("supabase/migrations/20260716_roamly_email_connections.sql");
["email_connections", "email_watch_subscriptions", "email_sync_cursors", "encrypted_access_token", "enable row level security"].forEach((needle) =>
  assert.ok(emailConnectionsMigration.toLowerCase().includes(needle.toLowerCase()), `email connections migration missing ${needle}`)
);

const travelEmailFilteringMigration = read("supabase/migrations/20260716_roamly_travel_email_filtering.sql");
["travel_email_messages", "provider_message_id", "extracted_booking_facts", "parser_confidence", "raw_body_retained", "enable row level security"].forEach((needle) =>
  assert.ok(travelEmailFilteringMigration.toLowerCase().includes(needle.toLowerCase()), `travel email filtering migration missing ${needle}`)
);
assert.ok(travelEmailFilteringMigration.includes("travel_email_messages_no_raw_body_check"), "travel email filtering must enforce no retained raw body");

const bookingExtractionMigration = read("supabase/migrations/20260716_roamly_booking_extraction_matching.sql");
["booking_extraction_results", "email_message_id", "extracted_booking_json", "field_confidence_json", "matched_booking_id", "needs_confirmation", "enable row level security"].forEach((needle) =>
  assert.ok(bookingExtractionMigration.toLowerCase().includes(needle.toLowerCase()), `booking extraction migration missing ${needle}`)
);

const emailConnections = read("lib/roamly/emailConnections.ts");
["ROAMLY_TOKEN_ENCRYPTION_KEY", "GMAIL_READONLY_SCOPE", "OUTLOOK_READONLY_SCOPES", "encryptToken", "decryptToken", "syncGmailConnection", "syncOutlookConnection", "recordTravelEmailFilterResult", "extractAndMatchTravelEmailBooking", "metadataHeaders"].forEach((needle) =>
  assert.ok(emailConnections.includes(needle), `email connections helper missing ${needle}`)
);
assert.ok(!emailConnections.includes("gmail.modify"), "Gmail integration must not request write mailbox scopes");
assert.ok(!emailConnections.includes("Mail.ReadWrite"), "Outlook integration must not request write mailbox scopes");
assert.ok(!emailConnections.includes("format\", \"full"), "Gmail sync must not fetch full message bodies during filtering");

const travelEmailFiltering = read("lib/roamly/travelEmailFiltering.ts");
["KNOWN_TRAVEL_DOMAINS", "booking confirmation", "BOOKING_REFERENCE_PATTERN", "filterTravelEmail", "bodyStored: false", "raw_body_retained: false"].forEach((needle) =>
  assert.ok(travelEmailFiltering.includes(needle), `travel email filtering helper missing ${needle}`)
);

const bookingExtraction = read("lib/roamly/bookingExtraction.ts");
["BOOKING_EXTRACTION_JSON_SCHEMA", "deterministicBookingExtraction", "extractBookingWithAiStructuredOutput", "json_schema", "strict: true", "stableBookingKey", "createTripBooking", "high_confidence_match"].forEach((needle) =>
  assert.ok(bookingExtraction.includes(needle), `booking extraction helper missing ${needle}`)
);

const emailProviderAdapters = read("lib/roamly/emailProviderAdapters.ts");
["EMAIL_PROVIDER_ADAPTERS", "Gmail", "Outlook", "supportsWatchNotifications", "MICROSOFT_OUTLOOK_CLIENT_ID"].forEach((needle) =>
  assert.ok(emailProviderAdapters.includes(needle), `email provider adapter registry missing ${needle}`)
);

const gmailConnectRoute = read("app/api/integrations/gmail/connect/route.ts");
assert.ok(gmailConnectRoute.includes("requireUser") && gmailConnectRoute.includes("gmailAuthorizationUrl"), "Gmail connect route must be authenticated and use the Gmail OAuth helper");

const gmailCallbackRoute = read("app/api/integrations/gmail/callback/route.ts");
assert.ok(gmailCallbackRoute.includes("GMAIL_OAUTH_STATE_COOKIE") && gmailCallbackRoute.includes("upsertGmailConnection"), "Gmail callback must validate state and store encrypted tokens");

const gmailWebhookRoute = read("app/api/webhooks/gmail/route.ts");
assert.ok(gmailWebhookRoute.includes("ROAMLY_GMAIL_WEBHOOK_SECRET") && gmailWebhookRoute.includes("syncGmailConnection"), "Gmail webhook route must verify and trigger cursor sync");

const outlookCallbackRoute = read("app/api/integrations/outlook/callback/route.ts");
assert.ok(outlookCallbackRoute.includes("OUTLOOK_OAUTH_STATE_COOKIE") && outlookCallbackRoute.includes("upsertOutlookConnection"), "Outlook callback must validate state and store encrypted tokens");

const outlookWebhookRoute = read("app/api/webhooks/outlook/route.ts");
assert.ok(outlookWebhookRoute.includes("ROAMLY_OUTLOOK_WEBHOOK_SECRET") && outlookWebhookRoute.includes("syncOutlookConnection"), "Outlook webhook route must verify and trigger delta sync");

const emailConnectionSettings = read("components/account/EmailConnectionSettings.tsx");
assert.ok(emailConnectionSettings.includes("Connect Gmail") && emailConnectionSettings.includes("Connect Outlook") && emailConnectionSettings.includes("Personal emails are not saved"), "account page must expose clear email privacy controls");

const billing = read("lib/roamly/billing.ts");
assert.ok(billing.includes("ROAMLY_STRIPE_FEATURES_PRICE_ID") || read("lib/env.ts").includes("ROAMLY_STRIPE_FEATURES_PRICE_ID"));
assert.ok(billing.includes("Live Trip Companion"), "billing copy should use Live Trip Companion");

const generateRoute = read("app/api/trips/generate/route.ts");
assert.ok(generateRoute.includes("startStagedItineraryGeneration"), "generation route must create a staged generation job");
assert.ok(generateRoute.includes("prepareStagedGenerationContext"), "generation route must prepare staged price/booking context");
assert.ok(generateRoute.includes("createOrResumeGenerationJob"), "generation route must create or resume a durable queue job");
assert.ok(generateRoute.includes("generationPriorityForEntitlement"), "generation route must apply paid/free queue priority");
assert.ok(generateRoute.includes("duplicateGenerationRequestKey"), "generation route must prevent duplicate generation requests");
assert.ok(generateRoute.includes("queue: queueState"), "generation route must return durable queue state");
assert.ok(generateRoute.includes("status: \"queued\""), "generation route must return a queued staged job");
assert.ok(generateRoute.includes("buildTripPlanningMetadata"), "generation must persist planner details in metadata");
assert.ok(!generateRoute.includes("is_activated: false"), "generation insert must not require legacy is_activated column");

const generationQueue = read("lib/roamly/generationQueue.ts");
assert.ok(generationQueue.includes("ROAMLY_BRAIN_STAGES"), "generation queue must know the persisted Brain layer list");
assert.ok(generationQueue.includes("generationIdempotencyKey"), "generation queue must use stable idempotency keys");
assert.ok(generationQueue.includes("createSupabaseAdminClient() || client"), "generation queue writes must prefer the service-role server client");
assert.ok(generationQueue.includes("publicQueueProgress"), "generation queue must expose safe public progress");
assert.ok(generationQueue.includes("paid_priority") && generationQueue.includes("duplicate_request_key"), "generation queue must support paid priority and duplicate prevention");

const generationScalability = read("lib/roamly/generationScalability.ts");
[
  "getGenerationScalabilityConfig",
  "generationPriorityForEntitlement",
  "duplicateGenerationRequestKey",
  "recordGenerationCostEvent",
  "checkUserGenerationRateLimit",
  "getGenerationQueueHealth",
  "adminRetryGenerationJob",
  "adminCancelGenerationJob"
].forEach((needle) => assert.ok(generationScalability.includes(needle), `generation scalability helper missing ${needle}`));

const brainStages = read("lib/roamly/brain/stages.ts");
[
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
  "providerRequirements",
  "evidenceRequirements",
  "invalidatedBy"
].forEach((needle) => assert.ok(brainStages.includes(needle), `Brain stage definitions missing ${needle}`));

const brainOrchestrator = read("lib/roamly/brain/orchestrator.ts");
["buildBrainStageInput", "dependencyVersionSnapshot", "validateBrainStageOutput", "invalidateBrainLayersForChange"].forEach((needle) =>
  assert.ok(brainOrchestrator.includes(needle), `Brain orchestrator missing ${needle}`)
);

const travelerMemory = read("lib/roamly/travelerMemory.ts");
["TRAVELER_PREFERENCE_KEYS", "confirmed_preferences", "inferred_preferences", "personalization_enabled", "preferenceInfluenceSummary"].forEach((needle) =>
  assert.ok(travelerMemory.includes(needle), `traveler memory helper missing ${needle}`)
);
assert.ok(generationQueue.includes("travelerMemory"), "generation queue layers must load traveler memory");

const travelerMemoryMigration = read("supabase/migrations/20260715_roamly_traveler_memory.sql");
["traveler_profiles", "traveler_preference_events", "enable row level security", "user_id = auth.uid()", "personalization_enabled"].forEach((needle) =>
  assert.ok(travelerMemoryMigration.toLowerCase().includes(needle.toLowerCase()), `traveler memory migration missing ${needle}`)
);

const travelerMemoryRoute = read("app/api/account/traveler-memory/route.ts");
["getTravelerMemory", "upsertTravelerProfile", "deleteTravelerMemory", "updatePreferenceEventStatus"].forEach((needle) =>
  assert.ok(travelerMemoryRoute.includes(needle), `traveler memory route missing ${needle}`)
);

const travelerMemoryComponent = read("components/account/TravelerMemorySettings.tsx");
["Here is what Roamly remembers", "Delete all travel memory", "/api/account/traveler-memory"].forEach((needle) =>
  assert.ok(travelerMemoryComponent.includes(needle), `traveler memory UI missing ${needle}`)
);

const tripFeedback = read("lib/roamly/tripFeedback.ts");
[
  "submitTripFeedback",
  "proposePreferenceUpdatesFromFeedback",
  "traveler_preference_events",
  "status: \"proposed\"",
  "Here is what Roamly learned from your trip."
].forEach((needle) => assert.ok(tripFeedback.includes(needle), `trip feedback helper missing ${needle}`));

const tripFeedbackRoute = read("app/api/trips/[id]/feedback/route.ts");
["requireUser", "getTripFeedback", "submitTripFeedback", "proposedPreferences"].forEach((needle) =>
  assert.ok(tripFeedbackRoute.includes(needle), `trip feedback route missing ${needle}`)
);

const tripFeedbackComponent = read("components/trip/TripFeedbackForm.tsx");
["fetchWithSupabaseAuth", "Trip feedback", "Today", "Here is what Roamly learned from your trip."].forEach((needle) =>
  assert.ok(tripFeedbackComponent.includes(needle), `trip feedback UI missing ${needle}`)
);

const tripFeedbackMigration = read("supabase/migrations/20260715_roamly_trip_feedback.sql");
["trip_feedback", "enable row level security", "user_id = auth.uid()", "traveler_preference_events_source_feedback_id_fkey"].forEach((needle) =>
  assert.ok(tripFeedbackMigration.toLowerCase().includes(needle.toLowerCase()), `trip feedback migration missing ${needle}`)
);

const transportationIntelligence = read("lib/roamly/transportationIntelligence.ts");
[
  "buildTransportationIntelligence",
  "door_to_door_minutes",
  "drivingDaysRequired",
  "overnight_stops",
  "rental_car",
  "ferry",
  "affiliate_value: 0",
  "user_override_supported",
  "Roamly recommends this option for your trip."
].forEach((needle) => assert.ok(transportationIntelligence.includes(needle), `transportation intelligence missing ${needle}`));

const transportStages = read("lib/roamly/brain/transportStages.ts");
assert.ok(transportStages.includes("buildTransportDecisionLayer"), "Brain must expose a transport decision layer helper");

const affiliateNeutrality = read("lib/roamly/affiliateNeutrality.ts");
["TRANSPORT_SCORE_WEIGHTS", "ACCOMMODATION_SCORE_WEIGHTS", "affiliate_value: 0", "rankAffiliateNeutralOptions"].forEach((needle) =>
  assert.ok(affiliateNeutrality.includes(needle), `affiliate neutrality helper missing ${needle}`)
);

const emailTemplatesSource = read("lib/roamly/emailTemplates.ts");
assert.ok(
  emailTemplatesSource.includes("Recommendations are ranked according to your trip needs, not commission."),
  "affiliate disclosure must state recommendations are not commission-ranked"
);

const accommodationIntelligence = read("lib/roamly/accommodationIntelligence.ts");
[
  "buildAccommodationIntelligence",
  "selectAccommodationArea",
  "review_evidence",
  "booking_conditions",
  "affiliate_value: 0",
  "requires_route_revalidation",
  "Search-ready accommodation option only"
].forEach((needle) => assert.ok(accommodationIntelligence.includes(needle), `accommodation intelligence missing ${needle}`));

const accommodationStages = read("lib/roamly/brain/accommodationStages.ts");
assert.ok(accommodationStages.includes("buildAccommodationDecisionLayer"), "Brain must expose an accommodation decision layer helper");

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

const itineraryValidation = read("lib/roamly/itineraryValidation.ts");
[
  "validateItineraryDeterministically",
  "repairLowRiskItineraryIssues",
  "buildItineraryLogisticsValidationLayer",
  "buildBudgetValidationLayer",
  "buildScheduleValidationLayer",
  "overlapping_activities",
  "impossible_travel_time",
  "closed_attraction",
  "budget_overrun",
  "stale_market_data",
  "missing_reservation_warning",
  "mixed_currencies",
  "dependency_mismatch",
  "hotel_route_inconsistency",
  "transport_itinerary_inconsistency",
  "repairItineraryForTravelRequirements"
].forEach((needle) => assert.ok(itineraryValidation.includes(needle), `itinerary validation missing ${needle}`));

const validationStages = read("lib/roamly/brain/validationStages.ts");
["buildBrainValidationLayer", "validationRequiresTargetedRegeneration", "invalidate and rerun only the relevant Brain layer"].forEach((needle) =>
  assert.ok(validationStages.includes(needle), `validation Brain stage helper missing ${needle}`)
);

const finalAssembly = read("lib/roamly/brain/finalAssembly.ts");
[
  "assembleFinalItinerary",
  "buildFinalAssemblyLayer",
  "targetedItineraryChangePlan",
  "recommended_transportation",
  "recommended_accommodation",
  "affiliate_disclosure",
  "source_timestamps",
  "structured_layers",
  "legacy_itinerary",
  "replace_activity",
  "regenerate_day",
  "change_transport",
  "change_hotel",
  "change_budget",
  "change_pace",
  "change_dates",
  "Only dependent layers are invalidated"
].forEach((needle) => assert.ok(finalAssembly.includes(needle), `final assembly missing ${needle}`));

const generationQueueMigration = read("supabase/migrations/20260715_roamly_generation_queue.sql");
[
  "roamly_trip_generation_jobs",
  "roamly_trip_generation_layers",
  "roamly_claim_generation_jobs",
  "roamly_claim_generation_layer",
  "for update skip locked",
  "lease_expires_at",
  "idempotency_key",
  "enable row level security",
  "user_id = auth.uid()",
  "grant execute on function public.roamly_claim_generation_jobs",
  "shared anonymous market cache"
].forEach((needle) => assert.ok(generationQueueMigration.toLowerCase().includes(needle.toLowerCase()), `queue migration missing ${needle}`));

const stagedGenerator = read("lib/roamly/stagedItineraryGeneration.ts");
assert.ok(stagedGenerator.includes("markFreeItineraryUsed"), "free itinerary must be consumed only after staged generation completes");
assert.ok(stagedGenerator.includes("getConfirmedBookingCostCents"), "staged generation must include committed booking costs");
assert.ok(stagedGenerator.includes("lockGeneratedItinerary"), "staged generation must lock itinerary after final validation");
assert.ok(stagedGenerator.includes("MAX_AI_COST_USD"), "staged generation must enforce a per-itinerary cost ceiling");
assert.ok(stagedGenerator.includes("plannedDayBatches"), "staged generation must batch days instead of generating one item per request");
assert.ok(stagedGenerator.includes("BATCH_ATTEMPT_LIMIT"), "staged generation must cap failed-stage retries");
assert.ok(stagedGenerator.includes("generatedDays"), "staged generation must preserve completed days across failures");
assert.ok(stagedGenerator.includes("finalizeStagedGenerationNotification"), "staged generation must finalize terminal transactional emails");
assert.ok(stagedGenerator.includes("generationEmail"), "staged generation must persist email notification state");
assert.ok(!stagedGenerator.includes("buildFallbackItinerary"), "staged generation must not silently save template fallback itineraries");

const itinerarySource = read("lib/itinerary.ts");
assert.ok(itinerarySource.includes("Roamly recommends this option for your trip."), "final itinerary must confidently state the transport recommendation");

const generationAdvanceRoute = read("app/api/trips/[id]/generation/advance/route.ts");
assert.ok(generationAdvanceRoute.includes("processGenerationQueue"), "generation advance route must execute through the durable queue worker");
assert.ok(!generationAdvanceRoute.includes("advanceStagedItineraryGeneration"), "generation advance route must not bypass queue locking");
assert.ok(generationAdvanceRoute.includes("queueSnapshot") && generationAdvanceRoute.includes("queue: await queueSnapshot"), "generation advance route must return queue state");

const generationStatusRoute = read("app/api/trips/[id]/generation/status/route.ts");
assert.ok(generationStatusRoute.includes("publicStagedGenerationProgress"), "generation status route must expose resumable progress");
assert.ok(generationStatusRoute.includes("getGenerationQueueForTrip"), "generation status route must expose saved queue progress");
assert.ok(generationStatusRoute.includes("queue: queueProgress"), "generation status route must return queue progress");

const progressComponent = read("components/trip/StagedGenerationProgress.tsx");
[
  "QueueProgress",
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
  "trackPollMovement(data?.progress, data?.queue)"
].forEach((needle) => assert.ok(progressComponent.includes(needle), `generation progress UI missing ${needle}`));

const generationCron = read("app/api/cron/roamly-itinerary-generation/route.ts");
assert.ok(generationCron.includes("getGenerationWorkerSecrets"), "generation cron must require an accepted bearer secret");
assert.ok(generationCron.includes("processGenerationQueue"), "generation cron must wake the shared queue worker");
assert.ok(generationCron.includes("export async function POST"), "generation cron route must support immediate background worker triggers");

const generationWorker = read("lib/roamly/generationWorker.ts");
[
  "ROAMLY_GENERATION_BATCH_SIZE",
  "ROAMLY_GENERATION_CONCURRENCY",
  "ROAMLY_GENERATION_MAX_RETRIES",
  "ROAMLY_GENERATION_LEASE_SECONDS",
  "ROAMLY_GENERATION_MAX_LAYERS_PER_RUN",
  "claimGenerationJobs",
  "claimGenerationJobByTrip",
  "advanceStagedItineraryGeneration",
  "sendPendingStagedGenerationEmail",
  "scheduleGenerationLayerRetry",
  "recordGenerationCostEvent"
].forEach((needle) => assert.ok(generationWorker.includes(needle), `generation worker missing ${needle}`));

const generationScalabilityMigration = read("supabase/migrations/20260715_roamly_generation_scalability.sql");
[
  "roamly_generation_cost_events",
  "roamly_generation_rate_limits",
  "roamly_generation_provider_limits",
  "paid_priority",
  "dead_lettered_at",
  "roamly_generation_queue_health",
  "roamly_generation_queue_admin",
  "roamly_retry_generation_job_admin",
  "roamly_cancel_generation_job_admin",
  "enable row level security"
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
  "ROAMLY_PROVIDER_ADAPTERS"
].forEach((needle) => assert.ok(providerAdapters.includes(needle), `provider adapter missing ${needle}`));

const generationWorkerMigration = read("supabase/migrations/20260715_roamly_generation_worker.sql");
["roamly_claim_generation_job_by_trip", "roamly_release_generation_layer", "roamly_skip_remaining_generation_layers", "for update skip locked"].forEach((needle) =>
  assert.ok(generationWorkerMigration.toLowerCase().includes(needle.toLowerCase()), `worker migration missing ${needle}`)
);

const generationBackground = read("lib/roamly/stagedGenerationBackground.ts");
assert.ok(generationBackground.includes("after("), "generation background trigger must run after the response");
assert.ok(generationBackground.includes("/api/cron/roamly-itinerary-generation"), "generation background trigger must call the protected worker");

const vercelConfig = read("vercel.json");
assert.ok(vercelConfig.includes("\"schedule\": \"*/5 * * * *\""), "Vercel itinerary generation cron must run every five minutes");

const generationEmail = read("lib/roamly/itineraryGenerationEmail.ts");
["completion_email_status", "completion_email_sent_at", "completion_email_attempt_count", "completion_email_next_retry_at", "failure_email_sent_at", "email_provider_message_id", "delivery_status", "last_email_error", "sendRoamlyEmail"].forEach((needle) =>
  assert.ok(generationEmail.includes(needle), `generation email helper missing ${needle}`)
);
assert.ok(generationEmail.includes("toRoamlyAbsoluteUrl(`/trip/${tripId}?from=generation-email`"), "completion email CTA must be a production-safe absolute trip URL");
assert.ok(generationEmail.includes("alreadySent(current, params.kind)"), "completion email duplicate prevention must remain in place");
assert.ok(generationEmail.includes("retryDue(current, params.kind)") && generationEmail.includes("MAX_COMPLETION_EMAIL_ATTEMPTS"), "completion email retry limits must remain in place");

const emailAdapter = read("lib/roamly/email.ts");
["nodemailer", "verifyRoamlyEmailProvider", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "messageId", "provider_message_id"].forEach((needle) =>
  assert.ok(emailAdapter.includes(needle), `SMTP email adapter missing ${needle}`)
);
assert.ok(emailAdapter.includes('readEnv("ROAMLY_EMAIL_PROVIDER").toLowerCase() || "smtp"'), "Roamly email provider must default to SMTP preference");
assert.ok(!emailAdapter.includes('|| "resend"'), "Resend must not be the default Roamly email provider");
assert.ok(emailAdapter.includes('currentProvider === "resend"') && emailAdapter.includes("RESEND_API_KEY is missing for optional Resend provider"), "Resend must remain optional and explicitly provider-gated");

const emailTemplates = read("lib/roamly/emailTemplates.ts");
["ROAMLY_LOGO_URL", "roamly-wordmark@2x.png", "renderPlainText", "role=\"presentation\"", "alt=\"Roamly\""].forEach((needle) =>
  assert.ok(emailTemplates.includes(needle), `production email template missing ${needle}`)
);

const adminEmailPreviewRoute = read("app/api/admin/roamly/email/preview/route.ts");
assert.ok(adminEmailPreviewRoute.includes("renderSampleItineraryGenerationEmail"), "admin preview must use the itinerary production renderer");

const tripPage = read("app/trip/[id]/page.tsx");
assert.ok(tripPage.includes("checkoutSyncError"), "trip page must surface checkout sync failures");
assert.ok(tripPage.includes("checkout_sync_failed"), "checkout sync failures must be observable");
assert.ok(tripPage.includes("CheckoutUrlCleanup") && tripPage.includes("checkoutNeedsAttention"), "checkout success URL must be retained while sync needs attention");

const accountPage = read("app/account/page.tsx");
assert.ok(accountPage.includes("TravelerMemorySettings"), "account page must expose traveler memory controls");

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
assert.ok(middleware.includes("attachRefreshedCookies"), "middleware redirects must preserve refreshed Supabase cookies");
assert.ok(middleware.includes("applyCookieHeaders"), "middleware must preserve Supabase no-store headers when cookies refresh");
assert.ok(middleware.includes("normalizeSupabaseCookieOptions"), "middleware must normalize Supabase auth cookie options");
assert.ok(middleware.includes("\"/plan/:path*\""), "middleware must refresh sessions while users plan trips");
assert.ok(middleware.includes("\"/pricing/:path*\""), "middleware must refresh sessions while users view pricing");
assert.ok(middleware.includes("middleware_auth_redirect"), "middleware protected-route redirects must log safe diagnostics");

const callbackRoute = read("app/auth/callback/route.ts");
assert.ok(callbackRoute.includes("exchangeCodeForSession(code)"), "OAuth callback must exchange the Supabase auth code");
assert.ok(callbackRoute.includes("redirectWithAuthCookies"), "OAuth callback must return session cookies on the redirect response");
assert.ok(callbackRoute.includes("normalizeSupabaseCookieOptions"), "OAuth callback must normalize production auth cookie options");
assert.ok(callbackRoute.includes("applyCookieHeaders"), "OAuth callback must preserve Supabase no-store headers");
assert.ok(callbackRoute.includes("selectAuthNextPath"), "OAuth callback must preserve requested return paths");
assert.ok(callbackRoute.includes("authCookiesWritten"), "OAuth callback must safely diagnose whether cookies were written");

const sessionRoute = read("app/api/auth/session/route.ts");
assert.ok(sessionRoute.includes("supabase.auth.setSession"), "session sync route must write Supabase SSR cookies from browser session tokens");
assert.ok(sessionRoute.includes("normalizeSupabaseCookieOptions"), "session sync route must normalize production auth cookie options");
assert.ok(sessionRoute.includes("applyCookieHeaders"), "session sync route must preserve Supabase no-store headers");
assert.ok(sessionRoute.includes("session_sync_succeeded"), "session sync route must log safe diagnostics");

const authenticatedFetch = read("lib/roamly/authenticatedFetch.ts");
assert.ok(authenticatedFetch.includes('credentials: init.credentials ?? "include"'), "authenticated fetches must include same-origin cookies");
assert.ok(authenticatedFetch.includes('credentials: "include"'), "session sync must include same-origin cookies");
assert.ok(authenticatedFetch.includes("user: session.user ?? null"), "failed session sync must still report a browser user to avoid forced login loops");

const tripAuthSessionCheck = read("components/auth/TripAuthSessionCheck.tsx");
assert.ok(tripAuthSessionCheck.includes("first.user"), "trip auth recovery must not force login while a browser session exists");
assert.ok(tripAuthSessionCheck.includes("retry.user"), "trip auth recovery must retry after a refresh returns a browser session");
assert.ok(tripAuthSessionCheck.includes("clearAttemptCount(attemptKey);") && tripAuthSessionCheck.includes("window.location.replace(targetPath)"), "successful trip auth recovery must clear loop state and return to the requested trip");

const supabaseBrowser = read("lib/supabase/browser.ts");
const supabaseServer = read("lib/supabase/server.ts");
assert.ok(supabaseBrowser.includes("getSupabaseUrl()") && supabaseServer.includes("getSupabaseUrl()"), "browser and server Supabase clients must use the shared configured project URL");
assert.ok(supabaseBrowser.includes("getSupabaseAnonKey()") && supabaseServer.includes("getSupabaseAnonKey()"), "browser and server Supabase clients must use the shared configured anon key");
assert.ok(![middleware, callbackRoute, sessionRoute, supabaseBrowser, supabaseServer].join("\n").includes("localhost:54321"), "production auth flow must not reference a local Supabase URL");

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
