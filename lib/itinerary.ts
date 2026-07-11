import type { TripPlannerPayload } from "@/lib/trip-planner";

export type BudgetBreakdown = {
  lodging: string;
  food: string;
  activities: string;
  transport: string;
  buffer: string;
  total_estimate: string;
  notes: string;
};

export type RoamlyActivitySeed = {
  time_label: string;
  title: string;
  description: string;
  location_name: string;
  estimated_cost: number;
  category: string;
  map_query: string;
};

export type RoamlyBookingCategory = "hotel" | "flight" | "attraction" | "tour" | "transport" | "car_rental";

export type RoamlyBookingSuggestion = {
  booking_category: RoamlyBookingCategory;
  booking_label: string;
  normal_search_url: string;
  affiliate_url?: string;
  affiliate_provider?: string;
  affiliate_disclosure?: string;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  currency: string;
  price_confidence: "estimated" | "partner" | "unknown";
};

export type RoamlyDayPlan = {
  day_number: number;
  date?: string;
  city?: string;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  food: string[];
  estimated_cost: number;
  map_queries: string[];
  live_timeline: RoamlyActivitySeed[];
};

export type RoamlyItinerary = {
  trip_title: string;
  destination_summary: string;
  best_for: string[];
  route_reasoning: string;
  budget_fit_summary: string;
  booking_status_summary: string;
  free_or_low_cost_notes: string[];
  estimated_budget_breakdown: BudgetBreakdown;
  hotel_area_suggestions: string[];
  transport_overview: string;
  daily_itinerary: RoamlyDayPlan[];
  packing_checklist: string[];
  local_tips: string[];
  safety_notes: string[];
  emergency_notes: string[];
  booking_suggestions: RoamlyBookingSuggestion[];
  regenerate_suggestions: string[];
  generation_note?: string;
};

export type RoamlyPreview = {
  trip_title: string;
  destination_summary: string;
  day_outline: Array<{
    day_number: number;
    title: string;
    activity_preview: string;
    estimated_cost: number;
  }>;
  locked_sections: string[];
};

export const lockedPreviewSections = [
  "Full day-by-day schedule",
  "Live Trip Companion",
  "Budget breakdown",
  "Hotel area suggestions",
  "Transport guide",
  "Packing checklist",
  "Emergency and local tips",
  "Live companion add-on"
];

export function clampTripDays(days: number | null | undefined) {
  if (!days || !Number.isFinite(days)) return 3;
  return Math.min(14, Math.max(1, Math.round(days)));
}

export function formatMoney(amount: number | null | undefined, currency = "CAD") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Flexible";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export function cleanList(value: unknown, fallback: string[] = [], limit = 8) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items.slice(0, limit) : fallback;
}

function cleanString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return fallback;
}

function cleanNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return null;
}

export function createMapLink(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function makeTripTitle(payload: Pick<TripPlannerPayload, "destination" | "daysCount" | "travelStyle">) {
  const days = clampTripDays(payload.daysCount);
  return `${payload.destination} ${days}-day ${payload.travelStyle || "smart"} trip`;
}

function searchUrl(baseQuery: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(baseQuery)}`;
}

function buildStarterBookingSuggestions(payload: TripPlannerPayload): RoamlyBookingSuggestion[] {
  const currency = payload.budgetCurrency || "CAD";
  const destination = payload.destination || "your destination";
  const origin = payload.origin || "your origin";
  const perDay = payload.budgetAmount && payload.daysCount ? Math.round(payload.budgetAmount / clampTripDays(payload.daysCount)) : null;

  return [
    {
      booking_category: "flight",
      booking_label: `Flights from ${origin} to ${destination}`,
      normal_search_url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`${origin} to ${destination} flights`)}`,
      estimated_cost_min: null,
      estimated_cost_max: null,
      currency,
      price_confidence: "estimated"
    },
    {
      booking_category: "hotel",
      booking_label: `Hotels in ${destination}`,
      normal_search_url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}`,
      estimated_cost_min: perDay ? Math.round(perDay * 0.28) : null,
      estimated_cost_max: perDay ? Math.round(perDay * 0.55) : null,
      currency,
      price_confidence: "estimated"
    },
    {
      booking_category: "tour",
      booking_label: `Tours and activities in ${destination}`,
      normal_search_url: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(`${destination} tours activities`)}`,
      estimated_cost_min: perDay ? Math.round(perDay * 0.12) : null,
      estimated_cost_max: perDay ? Math.round(perDay * 0.3) : null,
      currency,
      price_confidence: "estimated"
    },
    {
      booking_category: "transport",
      booking_label: `Transport around ${destination}`,
      normal_search_url: searchUrl(`${destination} public transit airport transfer train bus`),
      estimated_cost_min: perDay ? Math.round(perDay * 0.06) : null,
      estimated_cost_max: perDay ? Math.round(perDay * 0.18) : null,
      currency,
      price_confidence: "estimated"
    }
  ];
}

export function buildPreviewFromItinerary(itinerary: RoamlyItinerary): RoamlyPreview {
  return {
    trip_title: itinerary.trip_title,
    destination_summary: itinerary.destination_summary,
    day_outline: itinerary.daily_itinerary.map((day) => ({
      day_number: day.day_number,
      title: day.title,
      activity_preview: day.morning || day.afternoon || day.evening,
      estimated_cost: day.estimated_cost
    })),
    locked_sections: lockedPreviewSections
  };
}

export function buildStarterItinerary(payload: TripPlannerPayload): RoamlyItinerary {
  const days = clampTripDays(payload.daysCount);
  const perDay = payload.budgetAmount ? Math.max(35, Math.round(payload.budgetAmount / days)) : 120;
  const interests = payload.interests.length ? payload.interests : ["Food", "Culture", "Hidden gems"];
  const stops = payload.tripType === "multi_city" && payload.destinationStops?.length ? payload.destinationStops : [];

  return {
    trip_title: makeTripTitle(payload),
    destination_summary: `${payload.destination} planned around a ${payload.travelStyle.toLowerCase()} pace, ${formatMoney(
      payload.budgetAmount,
      payload.budgetCurrency
    )} budget, and ${interests.slice(0, 3).join(", ").toLowerCase()} priorities.`,
    best_for: [payload.travelStyle, payload.pace, payload.accommodationPreference],
    route_reasoning:
      payload.tripType === "multi_city"
        ? "The route follows the requested city order and keeps travel days between city blocks."
        : "The route keeps the trip focused on one destination from the selected origin.",
    budget_fit_summary: "Use the budget check as a planning guardrail and verify live prices before booking.",
    booking_status_summary: "No bookings are assumed unless they were uploaded or confirmed in Roamly.",
    free_or_low_cost_notes: ["Balance paid anchors with free neighborhoods, parks, markets, and viewpoints."],
    estimated_budget_breakdown: {
      lodging: "Match the area to your comfort level before booking.",
      food: `${formatMoney(Math.round(perDay * 0.28), payload.budgetCurrency)} per day target.`,
      activities: `${formatMoney(Math.round(perDay * 0.25), payload.budgetCurrency)} per day target.`,
      transport: `${formatMoney(Math.round(perDay * 0.15), payload.budgetCurrency)} per day target.`,
      buffer: "Keep 10-15% flexible for weather, taxis, and spontaneous stops.",
      total_estimate: formatMoney(payload.budgetAmount, payload.budgetCurrency),
      notes: "Starter estimate; verify prices before booking."
    },
    hotel_area_suggestions: [
      `Central ${payload.destination} for first-time convenience`,
      "Transit-connected neighborhood for better value",
      "Quieter local area if you prefer slower evenings"
    ],
    transport_overview: `${payload.transportationPreference} is the preferred transport style. Build each day around nearby clusters to avoid wasted travel time.`,
    daily_itinerary: Array.from({ length: days }, (_, index) => {
      const dayNumber = index + 1;
      const theme = interests[index % interests.length];
      const title = dayNumber === 1 ? `Arrive and get oriented` : `${theme} and local rhythm`;
      const city = stops.length ? stops[Math.min(stops.length - 1, Math.floor((index / days) * stops.length))]?.value : payload.destination;
      const baseQuery = `${city} ${theme}`;

      return {
        day_number: dayNumber,
        city,
        title,
        morning: `Start with a low-friction ${theme.toLowerCase()} area so the day feels easy to enter.`,
        afternoon: `Visit one anchor stop and one nearby flexible stop instead of crossing the city twice.`,
        evening: `Choose dinner close to the last activity, then leave room for a relaxed walk or view spot.`,
        food: [`Local cafe near ${baseQuery}`, `Casual dinner near ${payload.destination}`],
        estimated_cost: perDay,
        map_queries: [baseQuery, `${payload.destination} restaurants`, `${payload.destination} transit`],
        live_timeline: [
          {
            time_label: "9:30 AM",
            title: `${theme} starter stop`,
            description: "Begin with the easiest high-value stop of the day.",
            location_name: payload.destination,
            estimated_cost: Math.round(perDay * 0.2),
            category: "Activity",
            map_query: baseQuery
          },
          {
            time_label: "1:30 PM",
            title: "Neighborhood lunch and explore",
            description: "Keep lunch close to the afternoon plan.",
            location_name: payload.destination,
            estimated_cost: Math.round(perDay * 0.28),
            category: "Food",
            map_query: `${payload.destination} lunch`
          },
          {
            time_label: "6:30 PM",
            title: "Easy evening finish",
            description: "End near food, transit, or your hotel area.",
            location_name: payload.destination,
            estimated_cost: Math.round(perDay * 0.35),
            category: "Evening",
            map_query: `${payload.destination} evening`
          }
        ]
      };
    }),
    packing_checklist: ["Passport/ID", "Phone charger", "Comfortable shoes", "Weather layer", "Payment backup"],
    local_tips: ["Save offline maps.", "Check opening hours the night before.", "Group nearby stops."],
    safety_notes: ["Keep emergency contacts saved.", "Use licensed transport late at night."],
    emergency_notes: ["Find the local emergency number before arrival.", "Save your hotel address offline."],
    booking_suggestions: buildStarterBookingSuggestions(payload),
    regenerate_suggestions: [],
    generation_note: "Starter itinerary generated without live AI completion."
  };
}

function cleanBookingCategory(value: unknown): RoamlyBookingCategory {
  if (value === "hotel" || value === "flight" || value === "attraction" || value === "tour" || value === "transport" || value === "car_rental") {
    return value;
  }
  return "attraction";
}

function cleanPriceConfidence(value: unknown): RoamlyBookingSuggestion["price_confidence"] {
  if (value === "estimated" || value === "partner" || value === "unknown") return value;
  return "unknown";
}

function cleanBookingSuggestions(value: unknown, fallback: RoamlyBookingSuggestion[], payload: TripPlannerPayload) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const category = cleanBookingCategory(record.booking_category);
      const label = cleanString(record.booking_label, fallback[0]?.booking_label || `${payload.destination} booking`);
      const url = cleanString(record.normal_search_url, searchUrl(label));
      return {
        booking_category: category,
        booking_label: label,
        normal_search_url: url,
        affiliate_url: cleanString(record.affiliate_url, ""),
        affiliate_provider: cleanString(record.affiliate_provider, ""),
        affiliate_disclosure: cleanString(record.affiliate_disclosure, ""),
        estimated_cost_min: cleanNullableNumber(record.estimated_cost_min),
        estimated_cost_max: cleanNullableNumber(record.estimated_cost_max),
        currency: cleanString(record.currency, payload.budgetCurrency || "CAD"),
        price_confidence: cleanPriceConfidence(record.price_confidence)
      };
    })
    .slice(0, 12);
  return cleaned.length ? cleaned : fallback;
}

export function normalizeItinerary(raw: unknown, payload: TripPlannerPayload): RoamlyItinerary {
  const fallback = buildStarterItinerary(payload);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const budget = record.estimated_budget_breakdown as Record<string, unknown> | undefined;

  const rawDays = Array.isArray(record.daily_itinerary) ? record.daily_itinerary : [];
  const days = rawDays.length
    ? rawDays.slice(0, clampTripDays(payload.daysCount)).map((item, index) => {
        const day = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const dayNumber = cleanNumber(day.day_number, index + 1);
        const title = cleanString(day.title, fallback.daily_itinerary[index]?.title || `Day ${dayNumber}`);
        const mapQueries = cleanList(day.map_queries, [`${payload.destination} ${title}`], 6);
        const liveTimelineRaw = Array.isArray(day.live_timeline) ? day.live_timeline : [];
        const liveTimeline = liveTimelineRaw.length
          ? liveTimelineRaw.slice(0, 6).map((activity, activityIndex) => {
              const itemRecord = activity && typeof activity === "object" ? (activity as Record<string, unknown>) : {};
              return {
                time_label: cleanString(itemRecord.time_label, ["9:30 AM", "1:30 PM", "6:30 PM"][activityIndex] || "Anytime"),
                title: cleanString(itemRecord.title, `${title} stop`),
                description: cleanString(itemRecord.description, cleanString(day.morning, "Enjoy this planned stop.")),
                location_name: cleanString(itemRecord.location_name, payload.destination),
                estimated_cost: cleanNumber(itemRecord.estimated_cost, 0),
                category: cleanString(itemRecord.category, "Activity"),
                map_query: cleanString(itemRecord.map_query, mapQueries[0] || payload.destination)
              };
            })
          : fallback.daily_itinerary[index]?.live_timeline || [];

        return {
          day_number: dayNumber,
          date: cleanString(day.date, ""),
          city: cleanString(day.city, fallback.daily_itinerary[index]?.city || payload.destination),
          title,
          morning: cleanString(day.morning, fallback.daily_itinerary[index]?.morning || ""),
          afternoon: cleanString(day.afternoon, fallback.daily_itinerary[index]?.afternoon || ""),
          evening: cleanString(day.evening, fallback.daily_itinerary[index]?.evening || ""),
          food: cleanList(day.food, fallback.daily_itinerary[index]?.food || [], 5),
          estimated_cost: cleanNumber(day.estimated_cost, fallback.daily_itinerary[index]?.estimated_cost || 100),
          map_queries: mapQueries,
          live_timeline: liveTimeline
        };
      })
    : fallback.daily_itinerary;

  return {
    trip_title: cleanString(record.trip_title, fallback.trip_title),
    destination_summary: cleanString(record.destination_summary, fallback.destination_summary),
    best_for: cleanList(record.best_for, fallback.best_for, 6),
    route_reasoning: cleanString(record.route_reasoning, fallback.route_reasoning),
    budget_fit_summary: cleanString(record.budget_fit_summary, fallback.budget_fit_summary),
    booking_status_summary: cleanString(record.booking_status_summary, fallback.booking_status_summary),
    free_or_low_cost_notes: cleanList(record.free_or_low_cost_notes, fallback.free_or_low_cost_notes, 8),
    estimated_budget_breakdown: {
      lodging: cleanString(budget?.lodging, fallback.estimated_budget_breakdown.lodging),
      food: cleanString(budget?.food, fallback.estimated_budget_breakdown.food),
      activities: cleanString(budget?.activities, fallback.estimated_budget_breakdown.activities),
      transport: cleanString(budget?.transport, fallback.estimated_budget_breakdown.transport),
      buffer: cleanString(budget?.buffer, fallback.estimated_budget_breakdown.buffer),
      total_estimate: cleanString(budget?.total_estimate, fallback.estimated_budget_breakdown.total_estimate),
      notes: cleanString(budget?.notes, fallback.estimated_budget_breakdown.notes)
    },
    hotel_area_suggestions: cleanList(record.hotel_area_suggestions, fallback.hotel_area_suggestions, 6),
    transport_overview: cleanString(record.transport_overview, fallback.transport_overview),
    daily_itinerary: days,
    packing_checklist: cleanList(record.packing_checklist, fallback.packing_checklist, 16),
    local_tips: cleanList(record.local_tips, fallback.local_tips, 10),
    safety_notes: cleanList(record.safety_notes, fallback.safety_notes, 8),
    emergency_notes: cleanList(record.emergency_notes, fallback.emergency_notes, 8),
    booking_suggestions: cleanBookingSuggestions(record.booking_suggestions, fallback.booking_suggestions, payload),
    regenerate_suggestions: cleanList(record.regenerate_suggestions, fallback.regenerate_suggestions, 8),
    generation_note: cleanString(record.generation_note, "")
  };
}

export function getTripDayFromDate(startDate: string | null | undefined, daysCount: number | null | undefined) {
  if (!startDate) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const now = new Date();
  if (!Number.isFinite(start.getTime())) return 1;
  const diff = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 1), clampTripDays(daysCount));
}
