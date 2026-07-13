import OpenAI from "openai";
import { buildStarterItinerary, normalizeItinerary, type RoamlyItinerary } from "@/lib/itinerary";
import { normalizeLocale, type RoamlyLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { describeBudgetBalanceCents, formatBudgetMoneyCents } from "@/lib/roamly/budget";
import { describeTravelEssentialsContext } from "@/lib/roamly/amazonAffiliate";

export type GeneratedItineraryResult = {
  itinerary: RoamlyItinerary;
  model: string;
  aiUsed: boolean;
};

export const ROAMLY_AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
export const ROAMLY_AI_GENERATION_FAILED_MESSAGE =
  "Roamly could not finish itinerary generation. Please try again in a moment.";
const OPENAI_ITINERARY_TIMEOUT_MS = 45_000;
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
    transport_options: discovery.transportOptions || [],
    recommended_transport_option: discovery.recommendedTransportOption || null,
    selected_transport_estimate: centsToMoney(discovery.selectedTransportEstimateCents, currency),
    transport_assumptions: discovery.transportAssumptions || [],
    city_estimates: discovery.cityEstimates || [],
    budget_category_confidence: discovery.budgetCategoryConfidence || [],
    hotel_estimate_note: discovery.hotelEstimateNote || "",
    cross_border: discovery.cross_border === true,
    cross_border_warnings: discovery.crossBorderWarnings || [],
    origin_currency: discovery.originCurrency || currency,
    destination_currency: discovery.destinationCurrency || currency,
    currency_change: discovery.currencyChange === true,
    over_budget_recommendations: discovery.recommendationNotes || []
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

function buildPrompt(payload: TripPlannerPayload) {
  const outputLanguage = languageName(payload.language);
  const priceSummary = priceDiscoverySummary(payload);
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  const tripDays = dateRange.ok ? dateRange.days || 1 : payload.daysCount || 3;
  const essentialsContext = describeTravelEssentialsContext(payload);

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
- Pre-trip essentials context: ${essentialsContext}
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
  "pre_trip_essentials": [
    {
      "title": "item name",
      "reason": "why this item fits this destination, dates, weather/season, activities, trip length, or travel style",
      "category": "Luggage & packing | Power & tech | Comfort | Weather gear | Documents & safety | Destination-specific items",
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
- Include clean location names and addresses when possible in location_name and map_query so Google Maps, Apple Maps, and Citymapper link-outs work reliably.
- Booking suggestions must be specific and practical, like real travel-site searches: suggested flight searches, hotel room/stay options, entrance tickets, attractions, tours, airport transfers, inter-city transport, local transport, and restaurants when useful.
- Pre-trip essentials must recommend travel items based on destination, dates, likely weather/season, planned activities/interests, trip length, travelers, and travel style.
- Include essentials across these categories when relevant: Luggage & packing, Power & tech, Comfort, Weather gear, Documents & safety, Destination-specific items.
- Each pre_trip_essentials item must include title, reason, category, search_query, amazon_url, and priority. Use priority "high", "medium", or "low".
- Do not include exact Amazon prices, discounts, ratings, review counts, ASINs, or claims that a product is currently available. Roamly will attach the Amazon Associates search URL, so leave amazon_url blank and make search_query search-ready.
- Include carry-on luggage, packing cubes, and a travel adapter unless clearly irrelevant.
- Never output generic placeholder titles or descriptions such as "Flights to book", "Hotel/stay to book", "Find hotels", "Activities/tours to reserve", "Things to do", or "Book activities". Every booking title must name a route, room type + area, attraction/ticket, tour concept, transport option, or restaurant area.
- Use the required booking recommendation shape. Include provider_or_search_source on every booking suggestion. Keep booking_category equal to category for backward compatibility.
- Use real provider/search links only. Use normal search URLs, not invented reservation URLs. Leave affiliate_url and affiliate_provider blank; Roamly will attach partner links if configured.
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
- Add phone reminders for cross-border/international trips: roaming plan, eSIM/SIM option, offline maps, and emergency contact/local emergency number note when available.
- Do not give legal immigration, customs, or duty advice; tell the traveler to check official sources.
- Include at least one recommended transport option, one flight alternative when relevant, one hotel/stay option, one paid ticket or attraction, one tour/activity, and one local transport option when relevant.
- For flights, include origin city/airport, destination city/airport, departure date, return date when relevant, estimated price range when present in Price discovery summary, booking_label "Find this flight", and a normal search URL. Say "Faster but more expensive" when the flight is not the budget recommendation.
- For driving, include a gas/parking estimate if Price discovery summary provides it, booking_label "Open driving route", and a Google Maps directions URL. Say the estimate uses fuel assumptions until live maps/gas providers are connected.
- For train and bus, include search-ready links when live provider APIs are unavailable, booking_label "Check train" or "Check bus", and say "Verify live schedule and price." Do not invent exact ticket prices.
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
- Keep these provider/brand names unchanged when they appear: Klook, Stay22, Amazon, Google Maps, Citymapper, Travelpayouts, Viator, GetYourGuide, Booking.com, Google Flights, Roamly.
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
