import OpenAI from "openai";
import {
  normalizeItinerary,
  repairItineraryForTravelRequirements,
  validateItineraryForProduction,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { normalizeLocale, type RoamlyLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import {
  classifyGenerationValidationErrors,
  getPublicSupabaseHost,
  logGenerationDiagnostic,
  summarizeItineraryShape
} from "@/lib/roamly/generationDiagnostics";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { describeBudgetBalanceCents, formatBudgetMoneyCents } from "@/lib/roamly/budget";
import { describeTravelEssentialsContext } from "@/lib/roamly/amazonAffiliate";

export type GeneratedItineraryResult = {
  itinerary: RoamlyItinerary;
  model: string;
  aiUsed: boolean;
};

export type RoamlyGenerationTrace = {
  requestId?: string;
  tripId?: string;
  route?: string;
};

export const ROAMLY_AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
export const ROAMLY_AI_GENERATION_FAILED_MESSAGE =
  "Roamly could not finish itinerary generation. Please try again in a moment.";
const OPENAI_ITINERARY_TIMEOUT_MS = 70_000;
const OPENAI_ITINERARY_TRANSLATION_TIMEOUT_MS = 45_000;
const languageNames: Record<RoamlyLocale, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  zh: "Simplified Chinese"
};

export class RoamlyItineraryGenerationError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "RoamlyItineraryGenerationError";
    this.code = code;
    this.status = status;
  }
}

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function traceGeneration(trace: RoamlyGenerationTrace | undefined, event: string, details: Record<string, unknown> = {}) {
  logGenerationDiagnostic(event, {
    requestId: trace?.requestId,
    tripId: trace?.tripId,
    route: trace?.route,
    supabaseHost: getPublicSupabaseHost(),
    ...details
  });
}

function safeAiError(error: unknown) {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = typeof record?.status === "number" ? record.status : null;
  const code =
    typeof record?.code === "string"
      ? record.code
      : typeof record?.type === "string"
        ? record.type
        : error instanceof Error
          ? error.name
          : "UNKNOWN_AI_ERROR";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const category =
    status === 401 || status === 403
      ? "auth"
      : status === 404
        ? "model_or_endpoint"
        : status === 429
          ? "rate_limit"
          : status != null && status >= 500
            ? "provider_server_error"
            : /timeout|timed out|abort|aborted/.test(message)
              ? "timeout"
              : /network|connection|fetch|econnreset|enotfound|eai_again/.test(message)
                ? "connection"
                : "unknown";
  return {
    errorCode: code,
    errorName: error instanceof Error ? error.name : "UnknownError",
    httpStatus: status,
    errorCategory: category
  };
}

function expectedGenerationDays(payload: TripPlannerPayload) {
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  return dateRange.ok ? dateRange.days || 1 : payload.daysCount || 1;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function generationModelCandidates(primaryModel: string) {
  return uniqueStrings([
    primaryModel,
    process.env.OPENAI_FALLBACK_MODEL || "",
    "gpt-4o-mini"
  ]);
}

function shouldTryNextAiModel(errorCategory: unknown) {
  return (
    errorCategory === "timeout" ||
    errorCategory === "connection" ||
    errorCategory === "provider_server_error" ||
    errorCategory === "rate_limit" ||
    errorCategory === "unknown"
  );
}

function parsedItineraryStructureErrors(parsed: unknown, payload: TripPlannerPayload) {
  const shape = summarizeItineraryShape(parsed);
  const expectedDays = expectedGenerationDays(payload);
  const errors: string[] = [];
  if (!shape.hasDailyItinerary) errors.push("AI response missing daily_itinerary.");
  if (shape.dayCount < expectedDays) errors.push(`AI response returned ${shape.dayCount} days for a ${expectedDays}-day trip.`);
  if (shape.daysWithTimelineItems < expectedDays) {
    errors.push("AI response missing live_timeline items for one or more days.");
  }
  if (shape.timelineItemCount <= 0) errors.push("AI response has no timeline items.");
  if (shape.timelineItemsWithTimes < shape.timelineItemCount) {
    errors.push("AI response has timeline items without startTime/endTime.");
  }
  return errors;
}

function centsToMoney(value: unknown, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `${currency} ${Math.round(value / 100)}`;
}

function arrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function safeSummaryString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function safeSummaryNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeMarketResult(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    category: safeSummaryString(record.category),
    title: safeSummaryString(record.title),
    provider: safeSummaryString(record.provider),
    source: safeSummaryString(record.source),
    price_type: safeSummaryString(record.price_type),
    confidence: safeSummaryString(record.confidence),
    price_amount: safeSummaryNumber(record.price_amount),
    price_min: safeSummaryNumber(record.price_min),
    price_max: safeSummaryNumber(record.price_max),
    currency: safeSummaryString(record.currency),
    origin: safeSummaryString(record.origin),
    destination: safeSummaryString(record.destination),
    city: safeSummaryString(record.city),
    start_date: safeSummaryString(record.start_date),
    end_date: safeSummaryString(record.end_date),
    booking_url_present: typeof record.booking_url === "string" && record.booking_url.length > 0,
    affiliate_url_present: typeof record.affiliate_url === "string" && record.affiliate_url.length > 0
  };
}

function summarizeTransportOption(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    mode: safeSummaryString(record.mode),
    label: safeSummaryString(record.label || record.title),
    origin: safeSummaryString(record.origin),
    destination: safeSummaryString(record.destination),
    estimated_duration_hours: safeSummaryNumber(record.estimated_duration_hours),
    estimated_total_cents: safeSummaryNumber(record.estimated_total_cents),
    availability: safeSummaryString(record.availability),
    realistic: typeof record.realistic === "boolean" ? record.realistic : null
  };
}

function summarizeConfirmedBooking(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    category: safeSummaryString(record.category || record.booking_category),
    title: safeSummaryString(record.title || record.name),
    status: safeSummaryString(record.status),
    start_date: safeSummaryString(record.start_date || record.startDate),
    end_date: safeSummaryString(record.end_date || record.endDate),
    location: safeSummaryString(record.location || record.address),
    price_amount: safeSummaryNumber(record.price_amount || record.amount)
  };
}

function priceDiscoverySummary(payload: TripPlannerPayload) {
  const discovery = payload.priceDiscovery || {};
  const currency = typeof discovery.budgetCurrency === "string" ? discovery.budgetCurrency : payload.budgetCurrency || "CAD";
  const balance = describeBudgetBalanceCents(
    typeof discovery.remainingBudgetCents === "number" ? discovery.remainingBudgetCents : null,
    currency
  );
  return {
    status: discovery.budgetStatus || "unknown",
    total_estimate: centsToMoney(discovery.totalEstimateCents, currency),
    total_estimate_display: formatBudgetMoneyCents(
      typeof discovery.totalEstimateCents === "number" ? discovery.totalEstimateCents : null,
      currency
    ),
    remaining_budget: centsToMoney(discovery.remainingBudgetCents, currency),
    remaining_or_over_budget: balance?.text || "unknown",
    remaining_budget_amount: balance?.remainingAmount ?? null,
    committed_bookings: centsToMoney(discovery.committedBudgetCents, currency),
    coverage_note: discovery.coverageNote || "Prices are estimates and may change before booking.",
    price_coverage: discovery.priceCoverage || "fallback",
    unknown_market_price_count: discovery.unknownMarketPriceCount || 0,
    unknown_market_price_categories: discovery.unknownMarketPriceCategories || [],
    selected_market_prices: arrayFromUnknown(discovery.selectedMarketPrices).slice(0, 8).map(summarizeMarketResult),
    market_results: arrayFromUnknown(discovery.marketResults).slice(0, 12).map(summarizeMarketResult),
    route_legs: arrayFromUnknown(discovery.routeLegs).slice(0, 8),
    transport_options: arrayFromUnknown(discovery.transportOptions).slice(0, 8).map(summarizeTransportOption),
    recommended_transport_option: discovery.recommendedTransportOption ? summarizeTransportOption(discovery.recommendedTransportOption) : null,
    selected_transport_estimate: centsToMoney(discovery.selectedTransportEstimateCents, currency),
    transport_assumptions: discovery.transportAssumptions || [],
    city_estimates: arrayFromUnknown(discovery.cityEstimates).slice(0, 8),
    budget_category_confidence: arrayFromUnknown(discovery.budgetCategoryConfidence).slice(0, 8),
    hotel_estimate_note: discovery.hotelEstimateNote || "",
    cross_border: discovery.cross_border === true,
    cross_border_warnings: discovery.crossBorderWarnings || [],
    origin_currency: discovery.originCurrency || currency,
    destination_currency: discovery.destinationCurrency || currency,
    currency_change: discovery.currencyChange === true,
    over_budget_recommendations: arrayFromUnknown(discovery.recommendationNotes).slice(0, 8)
  };
}

function routeSummary(payload: TripPlannerPayload) {
  const stops = payload.tripType === "multi_city" ? payload.destinationStops?.map((stop) => stop.value) || [] : [payload.destination];
  const route = [payload.origin || "Origin", ...stops].filter(Boolean);
  if (payload.tripType === "multi_city" && payload.returnToOrigin !== false && payload.origin) route.push(payload.origin);
  return route.join(" \u2192 ");
}

function languageName(value?: string | null) {
  return languageNames[normalizeLocale(value)] || "English";
}

export function buildPrompt(payload: TripPlannerPayload, validationErrors: string[] = []) {
  const outputLanguage = languageName(payload.language);
  const priceSummary = priceDiscoverySummary(payload);
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  const tripDays = dateRange.ok ? dateRange.days || 1 : payload.daysCount || 3;
  const essentialsContext = describeTravelEssentialsContext(payload);
  const confirmedBookingSummary = arrayFromUnknown(payload.confirmedBookings).slice(0, 10).map(summarizeConfirmedBooking);

  return `Create a practical travel itinerary for Roamly.

Traveler input:
- Trip type: ${payload.tripType === "multi_city" ? "multi-city trip" : "single destination"}
- Route: ${routeSummary(payload)}
- Destination: ${payload.destination}
- Destination stops: ${(payload.destinationStops || []).map((stop) => stop.value).join(" | ") || "single destination only"}
- Origin: ${payload.origin || "not set"}
- Return to origin: ${payload.returnToOrigin !== false ? "yes" : "no"}
- Flexible city order: ${payload.flexibleCityOrder ? "yes" : "no"}
- Flexible dates: ${payload.flexibleDates ? "yes" : "no"}
- Start date: ${payload.startDate || "not set"}
- End date: ${payload.endDate || "not set"}
- Days: ${tripDays}
- Travelers: ${payload.travelersCount || 1} total (${travelers.adults || 1} adults, ${travelers.children || 0} children, ${travelers.infants || 0} infants)
- Rooms: ${payload.rooms || 1}
- Bed preference: ${payload.bedPreference || "No preference"}
- Budget: ${payload.budgetCurrency} ${payload.budgetAmount}
- Budget includes flights: ${payload.budgetIncludesFlights !== false ? "yes" : "no"}
- Budget includes hotel: ${payload.budgetIncludesHotel !== false ? "yes" : "no"}
- Budget includes activities: ${payload.budgetIncludesActivities !== false ? "yes" : "no"}
- Travel style: ${payload.travelStyle}
- Pace: ${payload.pace}
- Walking tolerance: ${payload.walkingTolerance || "Medium"}
- Interests: ${payload.interests.join(", ") || "balanced travel"}
- Accommodation: ${payload.accommodationPreference}
- Transportation: ${payload.transportationPreference}
- Accessibility needs: ${payload.accessibilityNeeds || "none"}
- Dietary preference: ${payload.dietaryPreference || "none"}
- Notes: ${payload.specialNotes || "none"}
- Budget instruction: ${payload.budgetConstraint || "Use practical current-price caution. Prices are estimates and may change before booking."}
- Price discovery summary: ${JSON.stringify(priceSummary)}
- Uploaded/saved booking costs: ${priceSummary.committed_bookings}. Treat these as already committed costs from bookings or screenshots when present; do not invent new bookings.
- Fixed bookings and screenshots summary: ${JSON.stringify(confirmedBookingSummary)}
	- Pre-trip essentials context: ${essentialsContext}
	- Output language: ${outputLanguage}
${validationErrors.length ? `\nPrevious itinerary attempt was rejected for: ${validationErrors.join(" | ")}. Correct these issues deterministically in the next JSON.` : ""}

Return ONLY valid JSON with this shape:
{
  "trip_title": "short catchy title",
  "destination_summary": "2 concise sentences",
  "best_for": ["short labels"],
  "route_reasoning": "why the route or recommended order makes sense",
  "budget_fit_summary": "how the plan fits the budget, where costs are tight, and what to change if needed",
  "booking_status_summary": "what is already booked or committed, and what still needs booking",
  "free_or_low_cost_notes": ["free or cheap tactics that fit this trip"],
  "estimated_budget_breakdown": {
    "lodging": "short budget note",
    "food": "short budget note",
    "activities": "short budget note",
    "transport": "short budget note",
    "buffer": "short budget note",
    "total_estimate": "short total estimate",
    "notes": "verify prices note",
    "user_budget_amount": ${payload.budgetAmount ?? "null"},
    "total_estimate_amount": 0,
    "remaining_budget_amount": 0,
    "budget_status": "within_budget | tight | over_budget | unknown",
    "currency": "${payload.budgetCurrency || "CAD"}"
  },
  "hotel_area_suggestions": ["area + why"],
  "transport_overview": "concise transport strategy",
  "daily_itinerary": [
    {
      "day_number": 1,
      "city": "city for this day",
      "title": "short day theme",
      "morning": "clear plan",
      "afternoon": "clear plan",
      "evening": "clear plan",
      "food": ["specific food ideas"],
      "estimated_cost": 120,
      "map_queries": ["search query"],
      "live_timeline": [
        {
          "time_label": "9:30 AM",
          "startTime": "09:30",
          "endTime": "11:00",
          "title": "activity title",
          "description": "one helpful sentence",
          "location_name": "place or area",
          "estimated_cost": 20,
	          "category": "Activity | Travel | Transfer | Hotel | Meal | Rest | Booking | Reminder",
	          "item_type": "travel | transfer | hotel | activity | meal | rest | booking | reminder",
	          "travel_mode": "flight | train | bus | ferry | drive | walk/transit | transfer when relevant",
	          "transportMode": "flight | train | bus | ferry | drive | walk/transit | transfer when relevant",
	          "duration": "estimated duration or buffer",
	          "durationMinutes": 90,
	          "travelTimeMinutes": 30,
	          "origin": "origin when relevant",
	          "destination": "destination when relevant",
	          "booking_label": "Check flights | Find a hotel | Book activity | Book transfer when relevant",
	          "affiliate_category": "flight | hotel | attraction | tour | transport when relevant",
	          "booking": null,
	          "map_query": "maps search query"
	        }
      ]
    }
  ],
  "booking_suggestions": [
    {
      "category": "flight | hotel | attraction | tour | transport | restaurant",
      "booking_category": "same as category",
      "title": "specific search-ready option title",
	      "provider_or_search_source": "Travelpayouts | Stay22 | Klook | Amazon | eSIM partner | Roamly discovery",
      "description": "what this option is and what to verify before booking",
      "location": "airport, neighborhood, attraction, station, or meeting area",
      "city": "city",
      "country": "country if known",
      "date": "YYYY-MM-DD when relevant",
      "time_window": "morning | afternoon | evening | flexible | specific time window",
      "origin": "flight or transport origin city/airport when relevant",
      "destination": "flight or transport destination city/airport when relevant",
      "departure_date": "YYYY-MM-DD for outbound travel when relevant",
      "return_date": "YYYY-MM-DD for return travel when relevant",
      "room_type": "Standard queen room | Budget private room | Family room | Central hotel room when relevant",
      "neighborhood": "stay area when relevant",
      "duration": "tour or transport duration when relevant",
      "estimated_cost_min": 0,
      "estimated_cost_max": 0,
      "estimated_nightly_cost_min": 0,
      "estimated_nightly_cost_max": 0,
      "estimated_total_cost_min": 0,
      "estimated_total_cost_max": 0,
      "currency": "${payload.budgetCurrency || "CAD"}",
      "price_confidence": "estimated | partner | user_uploaded | unknown",
	      "booking_label": "Check flights | Find a hotel | Book activity | Book transfer",
	      "normal_search_url": "",
      "affiliate_url": "",
      "affiliate_provider": "",
	      "provider": "Travelpayouts | Stay22 | Klook | Roamly discovery",
      "booking_status": "suggested | user_uploaded | needs_booking",
      "why_recommended": "why this option fits the route, budget, travelers, area, or day",
      "advance_booking_recommended": true,
      "free_or_paid": "free | paid | mixed"
    }
  ],
  "pre_trip_essentials": [
    {
      "title": "item name",
      "reason": "why this item fits this destination, dates, weather/season, activities, trip length, or travel style",
      "category": "Luggage & packing | Power & tech | Comfort | Weather gear | Documents & safety | Connectivity | Destination-specific items",
      "search_query": "Amazon search query for the item",
      "amazon_url": "",
      "priority": "high | medium | low"
    }
  ],
  "packing_checklist": ["items"],
  "local_tips": ["tips"],
  "safety_notes": ["notes"],
  "emergency_notes": ["notes"],
  "regenerate_suggestions": []
}

Rules:
- Write every user-facing JSON value in ${outputLanguage}. Keep JSON keys exactly as shown in English.
- Act like a responsible personal travel agent. Before finalizing the itinerary, compare flight, driving, train, bus, and mixed route options from Price discovery summary.
- Choose transport in this order: route availability/realism, fit with trip duration, fit with user budget, travel comfort, then time saved.
- Do not recommend transportation that is unrealistic, unavailable, unverified, or too time-consuming for the trip length.
- Do not choose the cheapest option if it makes the trip miserable or consumes too much of the vacation. Include this exact idea when relevant: "Cheaper is not always better if it costs too much travel time."
- Do not invent bus routes, train routes, flights, hotel rooms, ticket availability, or exact prices.
- Never say a room, flight, route, ticket, or tour is available unless provider data in Price discovery summary explicitly says so.
- If route or price cannot be verified, say it cannot be verified and mark it as needing live verification.
- For bus/train, recommend them only when transport_options says availability is "verified" or "search_ready", realistic is true, and estimated_duration_hours is reasonable for the trip. If bus/train is "unverified" or "not_available", call it unverified/not recommended.
- For long international or cross-border routes, prefer flight unless budget cannot support it and driving is realistic. Driving must include fuel, parking, toll, and overnight-stop assumptions when provided.
- If the remaining budget is comfortable, do not force a painful bus route just because it is cheaper.
- Explain transport tradeoffs clearly. Use "Recommended because it keeps the trip closer to your budget" for the selected cheaper option or "Faster but more expensive" for a flight or premium option.
- If transport_options includes driving, train, bus, flight, or mixed options, reflect them in booking_suggestions as search-ready transport recommendations and do not invent exact fares.
	- Make the plan useful without overstuffing the day.
	- Keep each field short enough for mobile cards.
	- Give map queries, not URLs.
	- Do not create booking URLs in live_timeline. Leave booking null; Roamly will attach approved affiliate URLs after validation.
	- Include clean location names and addresses when possible in location_name and map_query so map/navigation link-outs work reliably.
	- Day 1 must begin with the actual journey to the destination unless the traveler is already there. Include departure city, departure point, travel mode, realistic buffer, arrival, baggage/customs/immigration when relevant, transfer to hotel, check-in or luggage storage, and recovery/rest before local activities.
	- The first Day 1 item must not be a local attraction when Origin is set and different from Destination.
	- Final day must include hotel checkout, transfer to airport/station/terminal/departure point, recommended arrival buffer, return travel, and final arrival timing when return_to_origin is yes.
	- Add first-class Travel or Transfer live_timeline items between every major activity, meal, hotel, and booking. Do not hide travel time in notes.
	- Do not schedule two major places back-to-back without a Transfer item and realistic buffer.
	- Use item_type "Travel" for flights, train, bus, ferry, drive, and inter-city movement; "Transfer" for local movement; "Hotel" for check-in/checkout/luggage; "Rest" for arrival recovery.
	- Booking suggestions must be specific and practical: Travelpayouts flight searches, Stay22 stay options, Klook entrance tickets/tours/activities/transfers, and Roamly discovery fallback only when a provider is not configured.
	- Include startTime and endTime in 24-hour HH:mm format for every live_timeline item. Times must be chronological and non-overlapping.
- Pre-trip essentials must recommend travel items based on destination, dates, likely weather/season, planned activities/interests, trip length, travelers, and travel style.
- Include essentials across these categories when relevant: Luggage & packing, Power & tech, Comfort, Weather gear, Documents & safety, Connectivity, Destination-specific items.
- Each pre_trip_essentials item must include title, reason, category, search_query, amazon_url, and priority. Use priority "high", "medium", or "low".
- Do not include exact Amazon prices, discounts, ratings, review counts, ASINs, or claims that a product is currently available. Roamly will attach the Amazon Associates search URL, so leave amazon_url blank and make search_query search-ready.
- Include carry-on luggage, packing cubes, and a travel adapter unless clearly irrelevant.
- For cross-border, international, or roaming-sensitive trips, include a Connectivity pre_trip_essentials item titled "Travel eSIM or roaming plan" with a reason that includes: "Helps keep maps, booking confirmations, and Live Companion available while traveling."
- Do not put Airalo, eSIMs, roaming, or mobile data under flights, hotels, tours, tickets, or activity booking suggestions. They belong only under Pre-trip essentials, Travel notes, Cross-border reminders, Live Companion reminders, or Connectivity.
- Do not claim eSIM coverage, speed, price, refund terms, or device compatibility is guaranteed. Include: "Check coverage, device compatibility, speed limits, and refund rules before buying."
- Never output generic placeholder titles or descriptions such as "Flights to book", "Hotel/stay to book", "Find hotels", "Activities/tours to reserve", "Things to do", or "Book activities". Every booking title must name a route, room type + area, attraction/ticket, tour concept, transport option, or restaurant area.
- Use the required booking recommendation shape. Include provider_or_search_source on every booking suggestion. Keep booking_category equal to category for backward compatibility.
	- Do not output Google Flights, Google Search, Booking.com, Viator, GetYourGuide, or generic hotel/activity booking URLs. Leave affiliate_url and affiliate_provider blank; Roamly will attach Travelpayouts, Stay22, Klook, Amazon, and eSIM links if configured.
- Use selected_market_prices and market_results from the Price discovery summary for exact booking recommendation prices, provider/source labels, timestamps, and booking/search URLs.
- If a selected market result has price_type "live_partner", you may call it a live partner price. If it has "cached_recent", call it recently searched. If it has "search_ready", call it a market estimate that should be refreshed before booking. If it has "estimated_fallback", call it a conservative estimate.
- If live partner APIs are not in the price discovery summary, label options as "Suggested option", "Conservative estimate", or "Search-ready option". Use price_confidence "estimated" unless a real partner/live price source or uploaded user booking is present.
- Do not claim exact live prices unless a real partner/live API returned them. Do not invent confirmation numbers.
- Do not invent exact hotel prices. If live stay provider data is missing, say "Needs live price verification" and call the hotel amount an estimated planning value.
- Hotel/stay budget notes must explain the calculation when fallback pricing is used: nightly estimate x nights + taxes/fees buffer. Include "Hotel estimate uses planning assumptions until live provider pricing is connected."
- Do not say "specific room available" unless selected_market_prices contains a live partner stay result that says so.
- Do not say "booked", "reserved", or "confirmed" unless the user uploaded a booking screenshot or confirmed booking in Fixed bookings and screenshots. Those can use booking_status "user_uploaded" and price_confidence "user_uploaded".
- For non-uploaded recommendations, make clear they are search-ready only and that price and availability must be verified before booking.
- Budget math must use the selected total from Price discovery summary: remaining_budget_amount = user_budget_amount - total_estimate_amount. If the value is negative, budget_fit_summary and estimated_budget_breakdown.notes must say "Over budget by ${payload.budgetCurrency || "CAD"} X"; if positive, say "Remaining budget: ${payload.budgetCurrency || "CAD"} X". Never show a positive remaining budget when the total estimate is higher than the user budget.
- Budget math must use recommended_transport_option and selected_transport_estimate from Price discovery summary, not a flight-only path.
- Budget must reconcile exactly: user budget minus selected transport, selected hotel/stay, tickets/tours, food, local transport, buffer, and uploaded committed bookings equals remaining or over budget.
- When Price discovery summary includes total_estimate_display, use that same total estimate in estimated_budget_breakdown.total_estimate and total_estimate_amount.
- Do not leave the user with a missing-price final state. Always provide the full budget estimate from Price discovery summary.
- estimated_budget_breakdown.notes must include: "Full budget estimate generated using best available price sources. Some items use conservative market estimates and should be refreshed before booking."
- Show confidence/source per category using budget_category_confidence. Use these labels only when supported: Live price, Recently searched, Market estimate, Conservative estimate, User uploaded confirmation.
- For conservative flight estimates, say "Conservative flight estimate — refresh live prices before booking."
- For conservative hotel estimates, say "Conservative hotel estimate — refresh live prices before booking."
- If cross_border is true, include a Travel documents section/reminders in packing_checklist, local_tips, safety_notes, emergency_notes, and booking/status copy: Passport; Visa / ESTA / eTA if applicable; driver's license if driving; vehicle registration / rental car cross-border permission if driving; hotel/booking confirmations; return/onward travel proof if relevant; and "Check official entry requirements before travel."
- For cross-border driving/bus/train, mention "Border wait times can change. Allow extra time." Do not recommend an unverified cross-border bus/train route as best; say "Cross-border route not verified — not recommended as primary option."
- For currency changes, include: destination currency, exchange-rate reminder, foreign transaction fee reminder, cash/card note, and tolls/parking/payment method note. If applicable, use: "Your trip crosses from CAD to USD. Check card foreign transaction fees and carry a backup payment method."
- Add customs reminder: "Review customs rules before crossing. Food, alcohol, tobacco, medication, plants, and large purchases may have restrictions."
- Add phone reminders for cross-border/international trips: confirm roaming or eSIM before departure, check device compatibility before buying, download offline maps, save hotel address offline, and emergency contact/local emergency number note when available.
- Do not give legal immigration, customs, or duty advice; tell the traveler to check official sources.
- Include at least one recommended transport option, one flight alternative when relevant, one hotel/stay option, one paid ticket or attraction, one tour/activity, and one local transport option when relevant.
- For flights, include origin city/airport, destination city/airport, departure date, return date when relevant, estimated price range when present in Price discovery summary, and booking_label "Find this flight". Say "Faster but more expensive" when the flight is not the budget recommendation. Leave URLs blank.
- For driving, include a gas/parking estimate if Price discovery summary provides it and booking_label "Open driving route". Use map queries only for directions. Say the estimate uses fuel assumptions until live maps/gas providers are connected.
- For train and bus, include booking_label "Check train" or "Check bus", and say "Verify live schedule and price." Do not invent exact ticket prices. Leave URLs blank.
- For mixed routes, explain that the option may reduce transport cost but increases travel time.
- For hotel/stay suggestions, include room_type, neighborhood, estimated nightly range, estimated total stay range, and why the room/area fits the traveler.
- For attraction tickets, include the specific attraction name, ticket note, estimated ticket range, free_or_paid, and whether advance booking is recommended.
- For tours/activities, include a specific tour/activity title, estimated range, duration, best day/time, and "Find tour" booking_label.
- For transport, include airport transfer, inter-city legs for multi-city trips, local transport, and map/search links where possible.
- Explain what still needs booking and what is already booked or committed based on the committed cost signal.
- Respect fixed bookings, booked dates, addresses, and check-in/check-out times from the booking summary when present.
- Separate free/cheap activities from paid anchors.
- Respect walking tolerance, accessibility needs, dietary preference, travel pace, and Live Companion timeline needs.
- Account for hotel check-in/check-out timing and inter-city travel time when useful.
- For multi-city trips, group daily_itinerary entries by city in route order, include travel days between cities, and keep city blocks contiguous. Include origin-to-first-city, between-city, and final return transport suggestions if return_to_origin is yes. Include stay, ticket, tour/activity, local transport, and at least one free activity idea per city. If flexible city order is yes, you may recommend a cheaper or smoother order in route_reasoning while still producing a coherent day sequence.
- Mention users must verify opening hours and prices.
- Mention: "Prices are estimates and may change before booking."
- Do not invent reservations or claim bookings are made.
- If the destination is Montreal, suitable specific options include Notre-Dame Basilica admission, Montreal Museum of Fine Arts, Pointe-a-Calliere Museum, Mount Royal as a free attraction, Old Montreal walking tour, Montreal food tasting tour, Plateau street art walk, and an evening jazz/nightlife experience when they fit the user's interests.
- Build exactly ${tripDays} itinerary days.`;
}

function buildCompactPrompt(payload: TripPlannerPayload, validationErrors: string[] = []) {
  const outputLanguage = languageName(payload.language);
  const priceSummary = priceDiscoverySummary(payload);
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  const tripDays = dateRange.ok ? dateRange.days || 1 : payload.daysCount || 3;
  const essentialsContext = describeTravelEssentialsContext(payload);
  const confirmedBookingSummary = arrayFromUnknown(payload.confirmedBookings).slice(0, 8).map(summarizeConfirmedBooking);

  return `Return ONLY valid JSON for a paid Roamly itinerary. Keep all strings concise for mobile cards.

Trip:
- Language: ${outputLanguage}
- Route: ${routeSummary(payload)}
- Origin: ${payload.origin || "not set"}
- Destination: ${payload.destination}
- Stops: ${(payload.destinationStops || []).map((stop) => stop.value).join(" | ") || "single destination"}
- Dates: ${payload.startDate || "not set"} to ${payload.endDate || "not set"} (${tripDays} days)
- Return to origin: ${payload.returnToOrigin !== false ? "yes" : "no"}
- Travelers: ${payload.travelersCount || 1} total (${travelers.adults || 1} adults, ${travelers.children || 0} children, ${travelers.infants || 0} infants)
- Rooms: ${payload.rooms || 1}
- Budget: ${payload.budgetCurrency || "CAD"} ${payload.budgetAmount ?? "not set"}
- Style/interests: ${payload.travelStyle || "Balanced"}; ${payload.interests.join(", ") || "balanced travel"}
- Pace/walking: ${payload.pace || "Balanced"}; ${payload.walkingTolerance || "Medium"}
- Accommodation/transport: ${payload.accommodationPreference || "Not sure"}; ${payload.transportationPreference || "Mixed"}
- Accessibility/diet: ${payload.accessibilityNeeds || "none"}; ${payload.dietaryPreference || "none"}
- Notes: ${payload.specialNotes || "none"}
- Fixed bookings summary: ${JSON.stringify(confirmedBookingSummary)}
- Price summary: ${JSON.stringify(priceSummary)}
- Essentials context: ${essentialsContext}
${validationErrors.length ? `\nPrevious attempt failed validation: ${validationErrors.slice(0, 8).join(" | ")}. Fix these issues in the JSON.` : ""}

Required JSON shape:
{
  "trip_title": "short title",
  "destination_summary": "two concise sentences",
  "best_for": ["label"],
  "route_reasoning": "short route logic",
  "budget_fit_summary": "short budget fit using Price summary",
  "booking_status_summary": "what needs booking; do not claim booked unless fixed booking says so",
  "free_or_low_cost_notes": ["short notes"],
  "estimated_budget_breakdown": {
    "lodging": "short",
    "food": "short",
    "activities": "short",
    "transport": "short",
    "buffer": "short",
    "total_estimate": "${priceSummary.total_estimate_display || priceSummary.total_estimate}",
    "notes": "Prices are estimates and may change before booking.",
    "user_budget_amount": ${payload.budgetAmount ?? "null"},
    "total_estimate_amount": ${typeof payload.priceDiscovery?.totalEstimateCents === "number" ? Math.round(payload.priceDiscovery.totalEstimateCents / 100) : 0},
    "remaining_budget_amount": ${priceSummary.remaining_budget_amount ?? "null"},
    "budget_status": "${priceSummary.status || "unknown"}",
    "currency": "${payload.budgetCurrency || "CAD"}"
  },
  "hotel_area_suggestions": ["area + why"],
  "transport_overview": "short transport strategy",
  "daily_itinerary": [
    {
      "day_number": 1,
      "date": "${payload.startDate || ""}",
      "city": "city/area",
      "title": "short day theme",
      "morning": "short summary",
      "afternoon": "short summary",
      "evening": "short summary",
      "food": ["short food idea"],
      "estimated_cost": 0,
      "map_queries": ["place or area map search"],
      "live_timeline": [
        {
          "time_label": "06:30",
          "startTime": "06:30",
          "endTime": "07:30",
          "title": "short item title",
          "description": "one short sentence",
          "location_name": "place or area",
          "estimated_cost": 0,
          "category": "Travel",
          "item_type": "travel",
          "travel_mode": "flight",
          "transportMode": "flight",
          "duration": "60 min",
          "durationMinutes": 60,
          "travelTimeMinutes": 60,
          "origin": "origin when relevant",
          "destination": "destination when relevant",
          "booking_label": "Check flights only when bookable",
          "affiliate_category": "flight",
          "booking": null,
          "map_query": "map search"
        }
      ]
    }
  ],
  "booking_suggestions": [
    {
      "category": "flight",
      "booking_category": "flight",
      "title": "route-specific search title",
      "provider_or_search_source": "Travelpayouts",
      "description": "what to verify",
      "location": "",
      "city": "",
      "country": "",
      "date": "${payload.startDate || ""}",
      "time_window": "flexible",
      "origin": "${payload.origin || ""}",
      "destination": "${payload.destination || ""}",
      "departure_date": "${payload.startDate || ""}",
      "return_date": "${payload.returnToOrigin !== false ? payload.endDate || "" : ""}",
      "room_type": "",
      "neighborhood": "",
      "duration": "",
      "estimated_cost_min": 0,
      "estimated_cost_max": 0,
      "estimated_nightly_cost_min": 0,
      "estimated_nightly_cost_max": 0,
      "estimated_total_cost_min": 0,
      "estimated_total_cost_max": 0,
      "currency": "${payload.budgetCurrency || "CAD"}",
      "price_confidence": "estimated",
      "booking_label": "Check flights",
      "normal_search_url": "",
      "affiliate_url": "",
      "affiliate_provider": "",
      "provider": "Travelpayouts",
      "booking_status": "needs_booking",
      "why_recommended": "fits the route",
      "advance_booking_recommended": true,
      "free_or_paid": "paid"
    }
  ],
  "pre_trip_essentials": [
    { "title": "item", "reason": "short reason", "category": "Power & tech", "search_query": "Amazon search query", "amazon_url": "", "priority": "medium" }
  ],
  "packing_checklist": ["item"],
  "local_tips": ["tip"],
  "safety_notes": ["note"],
  "emergency_notes": ["note"],
  "regenerate_suggestions": []
}

Rules:
- Write user-facing values in ${outputLanguage}; keep JSON keys in English.
- Build exactly ${tripDays} daily_itinerary entries, day_number 1 through ${tripDays}.
- Every day must have live_timeline with 4 to 7 ordered items, each with startTime and endTime in 24-hour HH:mm, no overlaps.
- Day 1 must start with origin-to-destination travel unless origin is already the destination: departure, departure buffer, main travel, arrival, baggage/customs/station exit when relevant, transfer to lodging, check-in/luggage, rest, then local activity.
- Final day must include checkout/luggage, transfer to departure point, departure buffer, return travel when return_to_origin is yes, and final arrival.
- Add transfer items between different major locations. Do not hide travel time in prose.
- Use item_type only: travel, transfer, hotel, activity, meal, rest, booking, reminder.
- Keep descriptions one sentence. No long paragraphs.
- Leave booking null and URL fields blank. Roamly attaches Travelpayouts, Stay22, Klook, Amazon, and eSIM links server-side.
- Use booking_label only for real booking opportunities: Check flights, Find a hotel, Book activity, Book transfer. Do not put booking_label on ordinary walking/local transfer items.
- Booking suggestions must include at least: one flight, one hotel, one activity/tour or attraction when relevant, one airport transfer when relevant.
- Do not mention or output Google Flights, Google Search, Booking.com, Viator, GetYourGuide, or placeholder URLs.
- Do not invent exact live availability, reservations, confirmation numbers, discounts, ratings, or prices. Use Price summary confidence.
- Include carry-on luggage, packing cubes, travel adapter, and eSIM/roaming prep when relevant in pre_trip_essentials.
- Mention official entry/customs requirements for cross-border/international trips without giving legal advice.`;
}

const translationPreserveKeys = new Set([
  "normal_search_url",
  "affiliate_url",
  "amazon_url",
  "url",
  "href",
  "currency",
  "date",
  "departure_date",
  "return_date",
  "start_date",
  "end_date",
  "searched_at",
  "expires_at",
  "market_search_key",
  "market_source",
  "price_type",
  "market_confidence",
  "price_confidence",
  "booking_status",
  "category",
  "booking_category",
  "free_or_paid",
  "priority",
  "affiliate_provider"
]);

function shouldPreserveString(key: string, value: string) {
  if (translationPreserveKeys.has(key)) return true;
  if (/url$/i.test(key)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  if (/^[A-Z]{3}$/.test(value)) return true;
  return false;
}

function mergeTranslatedJson(original: unknown, translated: unknown, key = ""): unknown {
  if (typeof original === "string") {
    return typeof translated === "string" && !shouldPreserveString(key, original) ? translated : original;
  }

  if (Array.isArray(original)) {
    if (!Array.isArray(translated)) return original;
    return original.map((item, index) => mergeTranslatedJson(item, translated[index], key));
  }

  if (original && typeof original === "object") {
    const source = original as Record<string, unknown>;
    const target = translated && typeof translated === "object" && !Array.isArray(translated)
      ? (translated as Record<string, unknown>)
      : {};
    return Object.fromEntries(
      Object.entries(source).map(([itemKey, value]) => [itemKey, mergeTranslatedJson(value, target[itemKey], itemKey)])
    );
  }

  return original;
}

export async function translateRoamlyItinerary(params: {
  itinerary: RoamlyItinerary;
  language: RoamlyLocale;
  sourceLanguage?: RoamlyLocale;
}) {
  const targetLanguage = languageName(params.language);
  const sourceLanguage = languageName(params.sourceLanguage || "en");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = getClient();

  if (!client) {
    throw new RoamlyItineraryGenerationError(
      "Roamly AI translation is not configured yet.",
      "AI_TRANSLATION_NOT_CONFIGURED",
      503
    );
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You translate Roamly itinerary JSON. Return strict JSON only. Preserve all keys, structure, prices, dates, URLs, IDs, enum values, and provider names."
          },
          {
            role: "user",
            content: `Translate this Roamly itinerary from ${sourceLanguage} to ${targetLanguage}.

Rules:
- Translate user-facing prose, titles, descriptions, itinerary day text, budget notes, booking labels, checklist items, essential item names, essential reasons, and Live Companion descriptions.
- Keep JSON keys exactly the same.
- Preserve all numbers, booleans, nulls, dates, currencies, price ranges, normal_search_url, affiliate_url, amazon_url, provider names, brand names, map URLs, and booking/affiliate links exactly.
- Keep these provider/brand names unchanged when they appear: Klook, Stay22, Amazon, Google Maps, Citymapper, Travelpayouts, Airalo, Roamly.
- Do not regenerate, reorder, add, remove, or replace trip stops, days, activities, prices, URLs, or booking recommendations.
- Search queries may remain as-is if translating them could reduce booking or navigation accuracy.

Itinerary JSON:
${JSON.stringify(params.itinerary)}`
          }
        ]
      },
      {
        maxRetries: 0,
        timeout: OPENAI_ITINERARY_TRANSLATION_TIMEOUT_MS
      }
    );

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text) as unknown;
    return mergeTranslatedJson(params.itinerary, parsed) as RoamlyItinerary;
  } catch (error) {
    if (error instanceof RoamlyItineraryGenerationError) throw error;
    console.error("[Roamly AI] itinerary translation failed", error);
    throw new RoamlyItineraryGenerationError(
      "Roamly could not translate this itinerary. Please try again in a moment.",
      "AI_TRANSLATION_FAILED",
      502
    );
  }
}

export async function generateRoamlyItinerary(
  payload: TripPlannerPayload,
  trace?: RoamlyGenerationTrace
): Promise<GeneratedItineraryResult> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = getClient();
  traceGeneration(trace, "ai_generation_start", {
    provider: "openai",
    model,
    openAiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    daysRequested: payload.daysCount || null,
    hasOrigin: Boolean(payload.origin),
    hasDestination: Boolean(payload.destination),
    hasDates: Boolean(payload.startDate && payload.endDate)
  });

  if (!client) {
    traceGeneration(trace, "ai_generation_client_missing", {
      provider: "openai",
      model,
      status: "failed",
      errorCode: "OPENAI_API_KEY_MISSING",
      fallbackUsed: false,
      fallbackDisabled: true
    });
    throw new RoamlyItineraryGenerationError(
      "Roamly AI generation is not configured in production. No template itinerary was saved.",
      "OPENAI_API_KEY_MISSING",
      503
    );
  }

  const modelCandidates = generationModelCandidates(model);
  let validationErrors: string[] = [];
  let lastProviderError: ReturnType<typeof safeAiError> | null = null;

  traceGeneration(trace, "ai_generation_model_candidates", {
    provider: "openai",
    primaryModel: model,
    modelCandidates,
    modelCandidateCount: modelCandidates.length
  });

  for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
    const activeModel = modelCandidates[modelIndex];
    const failoverFromPrimary = activeModel !== model;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt = buildCompactPrompt(payload, validationErrors);
      traceGeneration(trace, "ai_generation_call_start", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        inputCharacters: prompt.length
      });

      let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
      try {
        completion = await client.chat.completions.create(
          {
            model: activeModel,
            temperature: 0.45,
            max_completion_tokens: 12000,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You are Roamly, a concise AI travel planner. You create practical, safe, budget-aware trip plans in strict JSON."
              },
              { role: "user", content: prompt }
            ]
          },
          {
            maxRetries: 0,
            timeout: OPENAI_ITINERARY_TIMEOUT_MS
          }
        );
      } catch (error) {
        const safeError = safeAiError(error);
        lastProviderError = safeError;
        const hasNextModel = modelIndex < modelCandidates.length - 1;
        const retryWithNextModel = hasNextModel && shouldTryNextAiModel(safeError.errorCategory);
        console.error("[Roamly AI] itinerary generation call failed", safeError);
        traceGeneration(trace, "ai_generation_call_failed", {
          provider: "openai",
          model: activeModel,
          primaryModel: model,
          failoverFromPrimary,
          attempt: attempt + 1,
          status: retryWithNextModel ? "model_failover" : "failed",
          ...safeError,
          modelFailoverAvailable: retryWithNextModel,
          templateFallbackUsed: false,
          fallbackUsed: false,
          fallbackDisabled: true
        });

        if (retryWithNextModel) break;

        throw new RoamlyItineraryGenerationError(
          "Roamly AI provider failed before returning itinerary content. No template itinerary was saved.",
          "AI_PROVIDER_FAILED",
          safeError.httpStatus && safeError.httpStatus >= 400 ? safeError.httpStatus : 502
        );
      }

      const text = completion.choices[0]?.message?.content || "";
      traceGeneration(trace, "ai_generation_call_result", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        status: "success",
        responseContentPresent: Boolean(completion.choices[0]?.message?.content),
        finishReason: completion.choices[0]?.finish_reason || null,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
        totalTokens: completion.usage?.total_tokens ?? null
      });
      if (!text) {
        validationErrors = ["AI returned an empty response."];
        traceGeneration(trace, "ai_generation_empty_response", {
          provider: "openai",
          model: activeModel,
          primaryModel: model,
          failoverFromPrimary,
          attempt: attempt + 1,
          status: attempt < 1 ? "retry" : "failed",
          errorCode: "AI_EMPTY_RESPONSE",
          fallbackUsed: false,
          fallbackDisabled: true
        });
        if (attempt < 1) continue;
        throw new RoamlyItineraryGenerationError(
          "Roamly AI returned an empty itinerary response. No template itinerary was saved.",
          "AI_EMPTY_RESPONSE",
          502
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        validationErrors = ["AI returned invalid JSON."];
        traceGeneration(trace, "ai_generation_parse_failed", {
          provider: "openai",
          model: activeModel,
          primaryModel: model,
          failoverFromPrimary,
          attempt: attempt + 1,
          status: attempt < 1 ? "retry" : "failed",
          errorCode: "AI_RESPONSE_PARSE_FAILED",
          fallbackUsed: false,
          fallbackDisabled: true
        });
        if (attempt < 1) continue;
        throw new RoamlyItineraryGenerationError(
          "Roamly AI returned an invalid itinerary response. No template itinerary was saved.",
          "AI_RESPONSE_PARSE_FAILED",
          502
        );
      }
      const parsedStructureErrors = parsedItineraryStructureErrors(parsed, payload);
      traceGeneration(trace, "ai_generation_response_parsed", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        ...summarizeItineraryShape(parsed)
      });
      if (parsedStructureErrors.length) {
        validationErrors = parsedStructureErrors;
        traceGeneration(trace, "ai_generation_structure_rejected", {
          provider: "openai",
          model: activeModel,
          primaryModel: model,
          failoverFromPrimary,
          attempt: attempt + 1,
          status: attempt < 1 ? "retry" : "failed",
          errorCode: "AI_UNSTRUCTURED_RESPONSE",
          validationErrorCount: parsedStructureErrors.length,
          validationErrorTypes: classifyGenerationValidationErrors(parsedStructureErrors),
          fallbackUsed: false,
          fallbackDisabled: true
        });
        if (attempt < 1) continue;
        throw new RoamlyItineraryGenerationError(
          "Roamly AI did not return a complete structured itinerary. No template itinerary was saved.",
          "AI_UNSTRUCTURED_RESPONSE",
          502
        );
      }
      const normalized = normalizeItinerary(parsed, payload);
      traceGeneration(trace, "ai_generation_normalized", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        ...summarizeItineraryShape(normalized)
      });
      const repaired = repairItineraryForTravelRequirements(normalized, payload);
      const itinerary = enrichItineraryBookingSuggestions(repaired, payload);
      traceGeneration(trace, "ai_generation_post_processed", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        ...summarizeItineraryShape(itinerary)
      });
      const validation = validateItineraryForProduction(itinerary, payload);

      if (validation.ok) {
        traceGeneration(trace, "ai_generation_validation_passed", {
          provider: "openai",
          model: activeModel,
          primaryModel: model,
          failoverFromPrimary,
          attempt: attempt + 1,
          aiUsed: true,
          ...summarizeItineraryShape(itinerary)
        });
        return {
          itinerary,
          model: activeModel,
          aiUsed: true
        };
      }

      validationErrors = validation.errors;
      console.warn("[Roamly AI] itinerary validation failed", {
        model: activeModel,
        attempt: attempt + 1,
        validationErrorCount: validationErrors.length,
        validationErrorTypes: classifyGenerationValidationErrors(validationErrors)
      });
      traceGeneration(trace, "ai_generation_validation_failed", {
        provider: "openai",
        model: activeModel,
        primaryModel: model,
        failoverFromPrimary,
        attempt: attempt + 1,
        status: attempt < 1 ? "retry" : "failed",
        errorCode: "AI_VALIDATION_FAILED",
        validationErrorCount: validationErrors.length,
        validationErrorTypes: classifyGenerationValidationErrors(validationErrors),
        fallbackUsed: false,
        fallbackDisabled: true
      });
    }
  }

  traceGeneration(trace, "ai_generation_failed_no_fallback", {
    provider: "openai",
    model,
    status: "failed",
    errorCode: validationErrors.length ? "AI_VALIDATION_FAILED" : lastProviderError?.errorCode || "AI_PROVIDER_FAILED",
    lastErrorCategory: lastProviderError?.errorCategory || null,
    fallbackUsed: false,
    fallbackDisabled: true,
    templateFallbackUsed: false,
    validationErrorCount: validationErrors.length,
    validationErrorTypes: classifyGenerationValidationErrors(validationErrors)
  });

  if (!validationErrors.length && lastProviderError) {
    throw new RoamlyItineraryGenerationError(
      "Roamly AI provider failed before returning itinerary content. No template itinerary was saved.",
      "AI_PROVIDER_FAILED",
      lastProviderError.httpStatus && lastProviderError.httpStatus >= 400 ? lastProviderError.httpStatus : 502
    );
  }

  throw new RoamlyItineraryGenerationError(
    "Roamly AI generated an itinerary that failed production validation. No template itinerary was saved.",
    "AI_VALIDATION_FAILED",
    502
  );
}
