import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

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
  "responseContentPresent"
].forEach((needle) => assert.ok(aiGenerator.includes(needle), `AI generation trace missing ${needle}`));
assert.ok(!aiGenerator.includes("buildFallbackItinerary"), "paid itinerary generation must not silently build a template fallback");
assert.ok(!aiGenerator.includes("local-starter-itinerary"), "paid itinerary generation must not return the local starter itinerary");

const generateRouteDiagnostics = read("app/api/trips/generate/route.ts");
[
  "generation_route_request_received",
  "generation_route_auth_failed",
  "generation_ai_result",
  "generation_storage_completed",
  "generation_route_response"
].forEach((needle) => assert.ok(generateRouteDiagnostics.includes(needle), `generation route trace missing ${needle}`));

assert.ok(tripPage.includes("itinerary_render_full_loaded"), "trip page must log safe structure diagnostics when rendering saved itineraries");

const travelMarketSearch = read("lib/roamly/travelMarketSearch.ts");
assert.ok(travelMarketSearch.includes('return value !== "false" && value !== "0" && value !== "disabled";'), "market and affiliate gates should default on unless explicitly disabled");

console.log("Roamly core checks passed.");
