import OpenAI from "openai";
import { buildStarterItinerary, normalizeItinerary, type RoamlyItinerary } from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { calculateInclusiveTripDays } from "@/lib/roamly/dateUtils";
import { describeBudgetBalanceCents, formatBudgetMoneyCents } from "@/lib/roamly/budget";

export type GeneratedItineraryResult = {
  itinerary: RoamlyItinerary;
  model: string;
  aiUsed: boolean;
};

export const ROAMLY_AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
export const ROAMLY_AI_GENERATION_FAILED_MESSAGE =
  "Roamly could not finish itinerary generation. Please try again in a moment.";
const OPENAI_ITINERARY_TIMEOUT_MS = 45_000;

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

function buildFallbackItinerary(payload: TripPlannerPayload, generationNote: string): GeneratedItineraryResult {
  return {
    itinerary: enrichItineraryBookingSuggestions(
      {
        ...buildStarterItinerary(payload),
        generation_note: generationNote
      },
      payload
    ),
    model: "local-starter-itinerary",
    aiUsed: false
  };
}

function centsToMoney(value: unknown, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `${currency} ${Math.round(value / 100)}`;
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
    selected_market_prices: discovery.selectedMarketPrices || [],
    market_results: discovery.marketResults || [],
    route_legs: discovery.routeLegs || [],
    city_estimates: discovery.cityEstimates || [],
    over_budget_recommendations: discovery.recommendationNotes || []
  };
}

function routeSummary(payload: TripPlannerPayload) {
  const stops = payload.tripType === "multi_city" ? payload.destinationStops?.map((stop) => stop.value) || [] : [payload.destination];
  const route = [payload.origin || "Origin", ...stops].filter(Boolean);
  if (payload.tripType === "multi_city" && payload.returnToOrigin !== false && payload.origin) route.push(payload.origin);
  return route.join(" \u2192 ");
}

function buildPrompt(payload: TripPlannerPayload) {
  const languageNames: Record<string, string> = {
    en: "English",
    fr: "French",
    es: "Spanish",
    ja: "Japanese",
    ko: "Korean",
    zh: "Simplified Chinese"
  };
  const outputLanguage = languageNames[normalizeLocale(payload.language)] || "English";
  const priceSummary = priceDiscoverySummary(payload);
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const tripDays = calculateInclusiveTripDays(payload.startDate, payload.endDate, payload.daysCount || 3);

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
- Fixed bookings and screenshots: ${JSON.stringify(payload.confirmedBookings || [])}
- Output language: ${outputLanguage}

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
          "title": "activity title",
          "description": "one helpful sentence",
          "location_name": "place or area",
          "estimated_cost": 20,
          "category": "Activity",
          "map_query": "Google Maps search query"
        }
      ]
    }
  ],
  "booking_suggestions": [
    {
      "category": "flight | hotel | attraction | tour | transport | restaurant",
      "booking_category": "same as category",
      "title": "specific search-ready option title",
      "provider_or_search_source": "Google Flights search | Booking.com search | official attraction site | Viator search | Google Maps | public transit search",
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
      "booking_label": "Find this flight | Find this room | Book ticket | Find tour | Open directions",
      "normal_search_url": "normal Google Flights, Booking, attraction, tour, transit, or maps search URL",
      "affiliate_url": "",
      "affiliate_provider": "",
      "provider": "Google Flights search | Booking.com search | Viator search | GetYourGuide search | Google Maps | public transit search",
      "booking_status": "suggested | user_uploaded | needs_booking",
      "why_recommended": "why this option fits the route, budget, travelers, area, or day",
      "advance_booking_recommended": true,
      "free_or_paid": "free | paid | mixed"
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
- Make the plan useful without overstuffing the day.
- Keep each field short enough for mobile cards.
- Give map queries, not URLs.
- Include clean location names and addresses when possible in location_name and map_query so Google Maps, Apple Maps, and Citymapper link-outs work reliably.
- Booking suggestions must be specific and practical, like real travel-site searches: suggested flight searches, hotel room/stay options, entrance tickets, attractions, tours, airport transfers, inter-city transport, local transport, and restaurants when useful.
- Never output generic placeholder titles or descriptions such as "Flights to book", "Hotel/stay to book", "Find hotels", "Activities/tours to reserve", "Things to do", or "Book activities". Every booking title must name a route, room type + area, attraction/ticket, tour concept, transport option, or restaurant area.
- Use the required booking recommendation shape. Include provider_or_search_source on every booking suggestion. Keep booking_category equal to category for backward compatibility.
- Use real provider/search links only. Use normal search URLs, not invented reservation URLs. Leave affiliate_url and affiliate_provider blank; Roamly will attach partner links if configured.
- Use selected_market_prices and market_results from the Price discovery summary for exact booking recommendation prices, provider/source labels, timestamps, and booking/search URLs.
- If a selected market result has price_type "live_partner", you may call it a live partner price. If it has "cached_recent", call it recently searched. If it has "search_ready", say live price is needed. If it has "estimated_fallback", call it an estimated fallback.
- If live partner APIs are not in the price discovery summary, label options as "Suggested option", "Estimated fallback", or "Search-ready option". Use price_confidence "estimated" unless a real partner/live price source or uploaded user booking is present.
- Do not claim exact live prices unless a real partner/live API returned them. Do not invent confirmation numbers.
- Do not say "booked", "reserved", or "confirmed" unless the user uploaded a booking screenshot or confirmed booking in Fixed bookings and screenshots. Those can use booking_status "user_uploaded" and price_confidence "user_uploaded".
- For non-uploaded recommendations, make clear they are search-ready only and that price and availability must be verified before booking.
- Budget math must use the selected total from Price discovery summary: remaining_budget_amount = user_budget_amount - total_estimate_amount. If the value is negative, budget_fit_summary and estimated_budget_breakdown.notes must say "Over budget by ${payload.budgetCurrency || "CAD"} X"; if positive, say "Remaining budget: ${payload.budgetCurrency || "CAD"} X". Never show a positive remaining budget when the total estimate is higher than the user budget.
- When Price discovery summary includes total_estimate_display, use that same total estimate in estimated_budget_breakdown.total_estimate and total_estimate_amount.
- If unknown_market_price_count is greater than 0, estimated_budget_breakdown.notes must start with "Budget incomplete — live price needed for X items." Do not present fallback estimates as exact.
- Include at least one flight or arrival transport option, one hotel/stay option, one paid ticket or attraction, one tour/activity, and one local transport option when relevant.
- For flights, include origin city/airport, destination city/airport, departure date, return date when relevant, estimated price range, booking_label "Find this flight", and a normal search URL.
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

export async function generateRoamlyItinerary(payload: TripPlannerPayload): Promise<GeneratedItineraryResult> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = getClient();

  if (!client) {
    return buildFallbackItinerary(
      payload,
      "Generated with Roamly's local itinerary builder because AI generation is not configured."
    );
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.45,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Roamly, a concise AI travel planner. You create practical, safe, budget-aware trip plans in strict JSON."
          },
          { role: "user", content: buildPrompt(payload) }
        ]
      },
      {
        maxRetries: 0,
        timeout: OPENAI_ITINERARY_TIMEOUT_MS
      }
    );

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text) as unknown;

    return {
      itinerary: enrichItineraryBookingSuggestions(normalizeItinerary(parsed, payload), payload),
      model,
      aiUsed: true
    };
  } catch (error) {
    if (error instanceof RoamlyItineraryGenerationError) throw error;
    console.error("[Roamly AI] itinerary generation failed", error);
    return buildFallbackItinerary(
      payload,
      "Generated with Roamly's local itinerary builder because AI generation did not finish in time."
    );
  }
}
