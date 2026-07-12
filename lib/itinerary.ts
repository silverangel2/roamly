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

export type RoamlyBookingCategory = "flight" | "hotel" | "attraction" | "tour" | "transport" | "restaurant" | "car_rental";
export type RoamlyPriceConfidence = "estimated" | "partner" | "user_uploaded" | "unknown";
export type RoamlyBookingStatus = "suggested" | "user_uploaded" | "needs_booking";

export type RoamlyBookingSuggestion = {
  category: RoamlyBookingCategory;
  booking_category: RoamlyBookingCategory;
  title: string;
  description: string;
  location?: string;
  city?: string;
  country?: string;
  date?: string;
  time_window?: string;
  origin?: string;
  destination?: string;
  departure_date?: string;
  return_date?: string;
  room_type?: string;
  neighborhood?: string;
  duration?: string;
  provider?: string;
  booking_status: RoamlyBookingStatus;
  why_recommended?: string;
  advance_booking_recommended?: boolean;
  free_or_paid?: "free" | "paid" | "mixed" | "unknown";
  booking_label: string;
  normal_search_url: string;
  affiliate_url?: string;
  affiliate_provider?: string;
  affiliate_disclosure?: string;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  estimated_nightly_cost_min?: number | null;
  estimated_nightly_cost_max?: number | null;
  estimated_total_cost_min?: number | null;
  estimated_total_cost_max?: number | null;
  currency: string;
  price_confidence: RoamlyPriceConfidence;
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

function googleFlightsUrl(origin: string, destination: string) {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`${origin} to ${destination} flights`)}`;
}

function bookingSearchUrl(destination: string) {
  return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}`;
}

function tourSearchUrl(query: string) {
  return `https://www.viator.com/searchResults/all?text=${encodeURIComponent(query)}`;
}

function defaultBookingAction(category: RoamlyBookingCategory) {
  if (category === "flight") return "Find this flight";
  if (category === "hotel") return "Find this room";
  if (category === "attraction") return "Book ticket";
  if (category === "tour") return "Find tour";
  if (category === "transport" || category === "car_rental") return "Open directions";
  if (category === "restaurant") return "Find restaurant";
  return "Find option";
}

function stopValue(stop: NonNullable<TripPlannerPayload["destinationStops"]>[number], fallback: string) {
  return stop?.value || stop?.label || fallback;
}

function tripCities(payload: TripPlannerPayload) {
  if (payload.tripType === "multi_city" && payload.destinationStops?.length) {
    return payload.destinationStops.map((stop, index) => ({
      label: stopValue(stop, `City ${index + 1}`),
      city: stop.city || stop.value || stop.label || `City ${index + 1}`,
      country: stop.country || payload.destinationCountry || ""
    }));
  }
  return [
    {
      label: payload.destination,
      city: payload.destinationCity || payload.destination,
      country: payload.destinationCountry || ""
    }
  ];
}

function roomTypeForPayload(payload: TripPlannerPayload) {
  const text = `${payload.bedPreference || ""} ${payload.accommodationPreference || ""}`.toLowerCase();
  if ((payload.travelers?.children || 0) > 0 || text.includes("family")) return "Family room";
  if (text.includes("budget")) return "Budget private room";
  if (text.includes("two")) return "Twin room";
  return "Standard queen room";
}

function centsRange(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return { min: null, max: null };
  const amount = Math.round(value / 100);
  return {
    min: Math.max(1, Math.round(amount * 0.88)),
    max: Math.max(1, Math.round(amount * 1.12))
  };
}

function discoveryList(payload: TripPlannerPayload, key: string) {
  const value = payload.priceDiscovery?.[key];
  return Array.isArray(value) ? value : [];
}

function buildSuggestion(input: Omit<RoamlyBookingSuggestion, "category" | "booking_category" | "booking_label" | "normal_search_url" | "estimated_cost_min" | "estimated_cost_max" | "currency" | "price_confidence" | "booking_status"> & {
  category: RoamlyBookingCategory;
  booking_label?: string;
  normal_search_url: string;
  estimated_cost_min?: number | null;
  estimated_cost_max?: number | null;
  currency: string;
  price_confidence?: RoamlyPriceConfidence;
  booking_status?: RoamlyBookingStatus;
}): RoamlyBookingSuggestion {
  return {
    ...input,
    category: input.category,
    booking_category: input.category,
    booking_label: input.booking_label || defaultBookingAction(input.category),
    normal_search_url: input.normal_search_url,
    estimated_cost_min: input.estimated_cost_min ?? null,
    estimated_cost_max: input.estimated_cost_max ?? null,
    currency: input.currency,
    price_confidence: input.price_confidence || "estimated",
    booking_status: input.booking_status || "needs_booking"
  };
}

function buildStarterBookingSuggestions(payload: TripPlannerPayload): RoamlyBookingSuggestion[] {
  const currency = payload.budgetCurrency || "CAD";
  const destination = payload.destination || "your destination";
  const origin = payload.origin || "your origin";
  const perDay = payload.budgetAmount && payload.daysCount ? Math.round(payload.budgetAmount / clampTripDays(payload.daysCount)) : null;
  const cities = tripCities(payload);
  const routeLegs = discoveryList(payload, "routeLegs") as Array<Record<string, unknown>>;
  const cityEstimates = discoveryList(payload, "cityEstimates") as Array<Record<string, unknown>>;
  const roomType = roomTypeForPayload(payload);
  const suggestions: RoamlyBookingSuggestion[] = [];

  if (routeLegs.length) {
    for (const leg of routeLegs.slice(0, 8)) {
      const from = cleanString(leg.from, origin);
      const to = cleanString(leg.to, destination);
      const mode = cleanString(leg.transportMode, "mixed");
      const category: RoamlyBookingCategory = mode === "flight" ? "flight" : "transport";
      const range = centsRange(leg.estimateCents);
      suggestions.push(
        buildSuggestion({
          category,
          title: category === "flight" ? `Suggested flight search: ${from} to ${to}` : `Inter-city transport search: ${from} to ${to}`,
          description:
            category === "flight"
              ? "Search-ready flight option. Compare live schedules, baggage rules, and total fare before booking."
              : "Search-ready transport option. Compare train, bus, rideshare, or regional flight schedules before booking.",
          location: `${from} to ${to}`,
          origin: from,
          destination: to,
          departure_date: payload.startDate || undefined,
          return_date: payload.returnToOrigin !== false ? payload.endDate || undefined : undefined,
          provider: category === "flight" ? "Google Flights search" : "Transport search",
          normal_search_url: category === "flight" ? googleFlightsUrl(from, to) : searchUrl(`${from} to ${to} train bus flights`),
          estimated_cost_min: range.min,
          estimated_cost_max: range.max,
          currency,
          why_recommended: "Matches the planned route without claiming a reservation or live fare.",
          free_or_paid: "paid"
        })
      );
    }
  } else if (origin && destination) {
    suggestions.push(
      buildSuggestion({
        category: "flight",
        title: `Suggested flight search: ${origin} to ${destination}`,
        description: "Search-ready flight option. Verify live fare, baggage, seat, and schedule details before booking.",
        location: `${origin} to ${destination}`,
        origin,
        destination,
        departure_date: payload.startDate || undefined,
        return_date: payload.returnToOrigin !== false ? payload.endDate || undefined : undefined,
        provider: "Google Flights search",
        normal_search_url: googleFlightsUrl(origin, destination),
        currency,
        why_recommended: "Connects the selected origin with the trip destination.",
        free_or_paid: "paid"
      })
    );
  }

  for (const [index, city] of cities.entries()) {
    const estimate = cityEstimates.find((item) => cleanString(item.city, "").toLowerCase() === city.label.toLowerCase());
    const nights = typeof estimate?.nights === "number" && Number.isFinite(estimate.nights) ? Math.max(1, Math.round(estimate.nights)) : Math.max(1, Math.round((clampTripDays(payload.daysCount) - 1) / Math.max(1, cities.length)));
    const hotelRange = centsRange(estimate?.hotelEstimateCents);
    const nightlyMin = hotelRange.min == null ? (perDay ? Math.round(perDay * 0.28) : null) : Math.max(1, Math.round(hotelRange.min / nights));
    const nightlyMax = hotelRange.max == null ? (perDay ? Math.round(perDay * 0.55) : null) : Math.max(1, Math.round(hotelRange.max / nights));
    const activityRange = centsRange(estimate?.activitiesEstimateCents);

    suggestions.push(
      buildSuggestion({
        category: "hotel",
        title: `${roomType} in central ${city.city}`,
        description: "Search-ready stay option. Confirm cancellation policy, taxes, resort fees, and exact room details before booking.",
        location: `Central ${city.city}`,
        city: city.city,
        country: city.country || undefined,
        room_type: roomType,
        neighborhood: `Central ${city.city} near reliable transit`,
        provider: "Booking.com search",
        normal_search_url: bookingSearchUrl(city.label),
        estimated_cost_min: hotelRange.min,
        estimated_cost_max: hotelRange.max,
        estimated_nightly_cost_min: nightlyMin,
        estimated_nightly_cost_max: nightlyMax,
        estimated_total_cost_min: hotelRange.min,
        estimated_total_cost_max: hotelRange.max,
        currency,
        why_recommended: "Keeps the stay close to transit and day-plan clusters.",
        free_or_paid: "paid"
      }),
      buildSuggestion({
        category: "attraction",
        title: `Search-ready ticket: key paid attraction in ${city.city}`,
        description: "Compare official attraction tickets and timed-entry options before adding this paid anchor to the day plan.",
        location: city.city,
        city: city.city,
        country: city.country || undefined,
        provider: "Attraction ticket search",
        normal_search_url: searchUrl(`${city.label} official attraction tickets timed entry`),
        estimated_cost_min: activityRange.min ? Math.max(10, Math.round(activityRange.min / 3)) : perDay ? Math.round(perDay * 0.12) : null,
        estimated_cost_max: activityRange.max ? Math.max(20, Math.round(activityRange.max / 2)) : perDay ? Math.round(perDay * 0.28) : null,
        currency,
        why_recommended: "Adds one bookable paid anchor while leaving room for free neighborhoods and flexible stops.",
        advance_booking_recommended: true,
        free_or_paid: "paid"
      }),
      buildSuggestion({
        category: "tour",
        title: `${city.city} small-group highlights tour`,
        description: "Search-ready tour option. Compare duration, meeting point, cancellation terms, and traveler reviews before booking.",
        location: city.city,
        city: city.city,
        country: city.country || undefined,
        duration: "2-4 hours",
        time_window: index === 0 ? "afternoon" : "morning",
        provider: "Viator search",
        normal_search_url: tourSearchUrl(`${city.label} small group highlights tour`),
        estimated_cost_min: activityRange.min ? Math.max(25, Math.round(activityRange.min / 3)) : perDay ? Math.round(perDay * 0.18) : null,
        estimated_cost_max: activityRange.max ? Math.max(45, Math.round(activityRange.max / 2)) : perDay ? Math.round(perDay * 0.35) : null,
        currency,
        why_recommended: "Gives structure early in the city block without filling the whole day.",
        advance_booking_recommended: true,
        free_or_paid: "paid"
      }),
      buildSuggestion({
        category: "transport",
        title: `${city.city} airport transfer and local transit`,
        description: "Search-ready local movement option. Compare transit passes, airport train, taxi, and rideshare before arrival.",
        location: city.city,
        city: city.city,
        country: city.country || undefined,
        provider: "Google Maps search",
        normal_search_url: searchUrl(`${city.label} airport transfer public transit pass`),
        estimated_cost_min: perDay ? Math.round(perDay * 0.06) : null,
        estimated_cost_max: perDay ? Math.round(perDay * 0.18) : null,
        currency,
        why_recommended: "Keeps daily logistics realistic and avoids last-minute airport transfer decisions.",
        free_or_paid: "mixed"
      })
    );
  }

  if (payload.interests.some((interest) => interest.toLowerCase().includes("food"))) {
    const city = cities[0];
    suggestions.push(
      buildSuggestion({
        category: "restaurant",
        title: `Dinner reservation search in ${city.city}`,
        description: "Search restaurants near the final activity area and verify opening hours, reservation availability, and dietary fit.",
        location: city.city,
        city: city.city,
        country: city.country || undefined,
        provider: "Restaurant search",
        normal_search_url: searchUrl(`${city.label} restaurants reservations ${payload.dietaryPreference || ""}`),
        estimated_cost_min: perDay ? Math.round(perDay * 0.18) : null,
        estimated_cost_max: perDay ? Math.round(perDay * 0.36) : null,
        currency,
        booking_label: "Find restaurant",
        why_recommended: "Supports the trip's food interests without claiming a reservation.",
        free_or_paid: "paid"
      })
    );
  }

  return suggestions.slice(0, 24);
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
      notes: "Planning estimate; verify prices before booking."
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
            title: `${theme} first stop`,
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
    generation_note: ""
  };
}

function cleanBookingCategory(value: unknown): RoamlyBookingCategory {
  if (
    value === "hotel" ||
    value === "flight" ||
    value === "attraction" ||
    value === "tour" ||
    value === "transport" ||
    value === "restaurant" ||
    value === "car_rental"
  ) {
    return value;
  }
  if (value === "ticket") return "attraction";
  return "attraction";
}

function cleanPriceConfidence(value: unknown): RoamlyBookingSuggestion["price_confidence"] {
  if (value === "estimated" || value === "partner" || value === "user_uploaded" || value === "unknown") return value;
  return "unknown";
}

function cleanBookingStatus(value: unknown): RoamlyBookingStatus {
  if (value === "suggested" || value === "user_uploaded" || value === "needs_booking") return value;
  return "needs_booking";
}

function cleanFreeOrPaid(value: unknown): RoamlyBookingSuggestion["free_or_paid"] {
  if (value === "free" || value === "paid" || value === "mixed" || value === "unknown") return value;
  return "unknown";
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function cleanBookingSuggestions(value: unknown, fallback: RoamlyBookingSuggestion[], payload: TripPlannerPayload) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const category = cleanBookingCategory(record.category || record.booking_category);
      const legacyLabel = cleanString(record.booking_label, fallback[0]?.title || `${payload.destination} booking`);
      const title = cleanString(record.title, legacyLabel);
      const actionLabel = cleanString(record.title ? record.booking_label : "", defaultBookingAction(category));
      const description = cleanString(record.description, cleanString(record.why_recommended, "Search current availability and verify prices before booking."));
      const url = cleanString(record.normal_search_url, searchUrl(`${title} ${payload.destination}`));
      return {
        category,
        booking_category: category,
        title,
        description,
        location: cleanOptionalString(record.location),
        city: cleanOptionalString(record.city),
        country: cleanOptionalString(record.country),
        date: cleanOptionalString(record.date),
        time_window: cleanOptionalString(record.time_window),
        origin: cleanOptionalString(record.origin),
        destination: cleanOptionalString(record.destination),
        departure_date: cleanOptionalString(record.departure_date),
        return_date: cleanOptionalString(record.return_date),
        room_type: cleanOptionalString(record.room_type),
        neighborhood: cleanOptionalString(record.neighborhood || record.area),
        duration: cleanOptionalString(record.duration),
        provider: cleanOptionalString(record.provider),
        booking_status: cleanBookingStatus(record.booking_status),
        why_recommended: cleanOptionalString(record.why_recommended),
        advance_booking_recommended: cleanOptionalBoolean(record.advance_booking_recommended),
        free_or_paid: cleanFreeOrPaid(record.free_or_paid),
        booking_label: actionLabel,
        normal_search_url: url,
        affiliate_url: cleanString(record.affiliate_url, ""),
        affiliate_provider: cleanString(record.affiliate_provider, ""),
        affiliate_disclosure: cleanString(record.affiliate_disclosure, ""),
        estimated_cost_min: cleanNullableNumber(record.estimated_cost_min),
        estimated_cost_max: cleanNullableNumber(record.estimated_cost_max),
        estimated_nightly_cost_min: cleanNullableNumber(record.estimated_nightly_cost_min),
        estimated_nightly_cost_max: cleanNullableNumber(record.estimated_nightly_cost_max),
        estimated_total_cost_min: cleanNullableNumber(record.estimated_total_cost_min),
        estimated_total_cost_max: cleanNullableNumber(record.estimated_total_cost_max),
        currency: cleanString(record.currency, payload.budgetCurrency || "CAD"),
        price_confidence: cleanPriceConfidence(record.price_confidence)
      };
    })
    .slice(0, 24);
  return cleaned.length ? cleaned : fallback;
}

export function normalizeItinerary(raw: unknown, payload: TripPlannerPayload): RoamlyItinerary {
  const fallback = buildStarterItinerary(payload);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const budget = record.estimated_budget_breakdown as Record<string, unknown> | undefined;
  const targetDays = clampTripDays(payload.daysCount);

  const rawDays = Array.isArray(record.daily_itinerary) ? record.daily_itinerary : [];
  const normalizedDays = rawDays.length
    ? rawDays.slice(0, targetDays).map((item, index) => {
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
    : [];
  const days = normalizedDays.length
    ? [...normalizedDays, ...fallback.daily_itinerary.slice(normalizedDays.length, targetDays)].slice(0, targetDays)
    : fallback.daily_itinerary.slice(0, targetDays);

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
