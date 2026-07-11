import OpenAI from "openai";
import { normalizeItinerary, type RoamlyItinerary } from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type GeneratedItineraryResult = {
  itinerary: RoamlyItinerary;
  model: string;
  aiUsed: boolean;
};

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function centsToMoney(value: unknown, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `${currency} ${Math.round(value / 100)}`;
}

function priceDiscoverySummary(payload: TripPlannerPayload) {
  const discovery = payload.priceDiscovery || {};
  const currency = typeof discovery.budgetCurrency === "string" ? discovery.budgetCurrency : payload.budgetCurrency || "CAD";
  return {
    status: discovery.budgetStatus || "unknown",
    total_estimate: centsToMoney(discovery.totalEstimateCents, currency),
    remaining_budget: centsToMoney(discovery.remainingBudgetCents, currency),
    committed_bookings: centsToMoney(discovery.committedBudgetCents, currency),
    coverage_note: discovery.coverageNote || "Prices are estimates and may change before booking.",
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
- Days: ${payload.daysCount}
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
- Uploaded/confirmed booking costs: ${priceSummary.committed_bookings}. Treat these as already committed costs from bookings or screenshots when present; do not invent new bookings.
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
    "notes": "verify prices note"
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
      "booking_category": "hotel | flight | attraction | tour | transport | car_rental",
      "booking_label": "short booking/search label",
      "normal_search_url": "normal search URL",
      "affiliate_url": "",
      "affiliate_provider": "",
      "estimated_cost_min": 0,
      "estimated_cost_max": 0,
      "currency": "${payload.budgetCurrency || "CAD"}",
      "price_confidence": "estimated | partner | unknown"
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
- Booking suggestions must include normal search URLs, not invented reservation URLs. Leave affiliate_url and affiliate_provider blank; Roamly will attach partner links if configured.
- Include a flight, hotel, activity or tour, and local transport booking suggestion when relevant.
- Explain what still needs booking and what is already booked or committed based on the committed cost signal.
- Respect fixed bookings, booked dates, addresses, and check-in/check-out times from the booking summary when present.
- Separate free/cheap activities from paid anchors.
- Respect walking tolerance, accessibility needs, dietary preference, travel pace, and Live Companion timeline needs.
- Account for hotel check-in/check-out timing and inter-city travel time when useful.
- For multi-city trips, group daily_itinerary entries by city in route order, include travel days between cities, and keep city blocks contiguous. If flexible city order is yes, you may recommend a cheaper or smoother order in route_reasoning while still producing a coherent day sequence.
- Mention users must verify opening hours and prices.
- Mention: "Prices are estimates and may change before booking."
- Do not invent reservations or claim bookings are made.
- Build exactly ${payload.daysCount || 3} itinerary days.`;
}

export async function generateRoamlyItinerary(payload: TripPlannerPayload): Promise<GeneratedItineraryResult> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = getClient();

  if (!client) {
    return {
      itinerary: enrichItineraryBookingSuggestions(normalizeItinerary(null, payload), payload),
      model: "starter",
      aiUsed: false
    };
  }

  try {
    const completion = await client.chat.completions.create({
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
    });

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text) as unknown;

    return {
      itinerary: enrichItineraryBookingSuggestions(normalizeItinerary(parsed, payload), payload),
      model,
      aiUsed: true
    };
  } catch (error) {
    console.error("[Roamly AI] itinerary generation failed", error);
    return {
      itinerary: {
        ...enrichItineraryBookingSuggestions(normalizeItinerary(null, payload), payload),
        generation_note: "AI completion failed, so Roamly saved a starter itinerary. Verify details before travel."
      },
      model,
      aiUsed: false
    };
  }
}
