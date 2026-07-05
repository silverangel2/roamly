import OpenAI from "openai";
import { normalizeItinerary, type RoamlyItinerary } from "@/lib/itinerary";
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

function buildPrompt(payload: TripPlannerPayload) {
  return `Create a practical travel itinerary for Roamly.

Traveler input:
- Destination: ${payload.destination}
- Origin: ${payload.origin || "not set"}
- Start date: ${payload.startDate || "not set"}
- End date: ${payload.endDate || "not set"}
- Days: ${payload.daysCount}
- Travelers: ${payload.travelersCount || 1}
- Budget: ${payload.budgetCurrency} ${payload.budgetAmount}
- Budget includes flights: ${payload.budgetIncludesFlights !== false ? "yes" : "no"}
- Budget includes hotel: ${payload.budgetIncludesHotel !== false ? "yes" : "no"}
- Travel style: ${payload.travelStyle}
- Pace: ${payload.pace}
- Interests: ${payload.interests.join(", ") || "balanced travel"}
- Accommodation: ${payload.accommodationPreference}
- Transportation: ${payload.transportationPreference}
- Notes: ${payload.specialNotes || "none"}
- Budget instruction: ${payload.budgetConstraint || "Use practical current-price caution. Prices are estimates and may change before booking."}

Return ONLY valid JSON with this shape:
{
  "trip_title": "short catchy title",
  "destination_summary": "2 concise sentences",
  "best_for": ["short labels"],
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
  "packing_checklist": ["items"],
  "local_tips": ["tips"],
  "safety_notes": ["notes"],
  "emergency_notes": ["notes"],
  "regenerate_suggestions": []
}

Rules:
- Make the plan useful without overstuffing the day.
- Keep each field short enough for mobile cards.
- Give map queries, not URLs.
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
      itinerary: normalizeItinerary(null, payload),
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
      itinerary: normalizeItinerary(parsed, payload),
      model,
      aiUsed: true
    };
  } catch (error) {
    console.error("[Roamly AI] itinerary generation failed", error);
    return {
      itinerary: {
        ...normalizeItinerary(null, payload),
        generation_note: "AI completion failed, so Roamly saved a starter itinerary. Verify details before travel."
      },
      model,
      aiUsed: false
    };
  }
}
