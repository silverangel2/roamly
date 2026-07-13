import type { TripPlannerPayload } from "@/lib/trip-planner";
import {
  calculateRemainingBudget,
  centsToAmount,
  formatBudgetMoney,
  parseBudgetAmount
} from "@/lib/roamly/budget";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  googleSearchUrl
} from "@/lib/roamly/bookingLinks";
import {
  buildPreTripEssentials,
  normalizePreTripEssentials,
  type RoamlyPreTripEssential
} from "@/lib/roamly/amazonAffiliate";
import { crossBorderTravelDocumentReminders, crossBorderTravelNotes, detectCrossBorderTrip } from "@/lib/roamly/crossBorder";
import type { TransportOption } from "@/lib/roamly/transportOptions";
import type { TravelMarketConfidence, TravelMarketPriceType, TravelMarketSource } from "@/lib/roamly/travelMarketSearch";
import type { BudgetCategoryConfidence } from "@/lib/roamly/priceDiscovery";

export type BudgetBreakdown = {
  lodging: string;
  food: string;
  activities: string;
  transport: string;
  buffer: string;
  total_estimate: string;
  notes: string;
  user_budget_amount?: number | null;
  total_estimate_amount?: number | null;
  remaining_budget_amount?: number | null;
  budget_status?: "within_budget" | "tight" | "over_budget" | "unknown";
  currency?: string;
  recommended_transport_option?: TransportOption | null;
  transport_options?: TransportOption[];
  selected_transport_estimate_amount?: number | null;
  selected_hotel_estimate_amount?: number | null;
  tickets_tours_estimate_amount?: number | null;
  food_estimate_amount?: number | null;
  local_transport_estimate_amount?: number | null;
  buffer_estimate_amount?: number | null;
  committed_bookings_amount?: number | null;
  hotel_nights?: number | null;
  hotel_nightly_estimate_amount?: number | null;
  hotel_taxes_fees_buffer_amount?: number | null;
  hotel_estimate_note?: string;
  budget_category_confidence?: BudgetCategoryConfidence[];
  cross_border?: boolean;
  cross_border_warnings?: string[];
  origin_currency?: string;
  destination_currency?: string;
  currency_change?: boolean;
  transport_assumptions?: string[];
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
  provider_or_search_source?: string;
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
  market_source?: TravelMarketSource;
  price_type?: TravelMarketPriceType;
  market_confidence?: TravelMarketConfidence;
  searched_at?: string;
  expires_at?: string;
  market_search_key?: string;
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
  pre_trip_essentials: RoamlyPreTripEssential[];
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

function formatRange(min: number | null | undefined, max: number | null | undefined, currency = "CAD") {
  if (min == null && max == null) return "";
  if (min != null && max != null) return `${formatMoney(min, currency)}-${formatMoney(max, currency)}`;
  return formatMoney(min ?? max, currency);
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
  return googleSearchUrl(baseQuery);
}

function googleFlightsUrl(
  origin: string,
  destination: string,
  departureDate?: string,
  returnDate?: string,
  travelers?: TripPlannerPayload["travelers"] | number | null
) {
  return (
    buildFlightSearchUrl({
      origin,
      destination,
      departureDate,
      returnDate,
      travelers
    }) || searchUrl(`${origin} to ${destination} flights`)
  );
}

function bookingSearchUrl({
  destination,
  checkInDate,
  checkOutDate,
  adults,
  children,
  rooms,
  neighborhood,
  roomType
}: {
  destination: string;
  checkInDate?: string;
  checkOutDate?: string;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
  neighborhood?: string | null;
  roomType?: string | null;
}) {
  return (
    buildHotelSearchUrl({
      destination,
      checkInDate,
      checkOutDate,
      adults,
      children,
      rooms,
      neighborhood,
      roomType
    }) || searchUrl(`${destination} ${neighborhood || ""} ${roomType || ""} hotel`)
  );
}

function tourSearchUrl(query: string, destination?: string, date?: string) {
  return buildTourSearchUrl({ tourName: query, destination, date }) || searchUrl(query);
}

function dateOffset(startDate: string | undefined, offsetDays: number) {
  if (!startDate) return "";
  const date = new Date(`${startDate}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function destinationProfile(city: string) {
  const normalized = city.toLowerCase();
  if (normalized.includes("montreal") || normalized.includes("montréal")) {
    return {
      neighborhoods: ["Plateau Mont-Royal", "Ville-Marie"],
      hotelWhy: "These areas keep nightlife, food, Old Montreal, and STM metro access close without forcing long rides every day.",
      attractions: [
        {
          title: "Notre-Dame Basilica admission",
          description: "Search timed admission for Notre-Dame Basilica in Old Montreal. Search-ready suggestion; verify price and availability before booking.",
          query: "Notre-Dame Basilica Montreal admission tickets",
          min: 16,
          max: 20,
          free_or_paid: "paid" as const,
          time_window: "morning",
          advance_booking_recommended: true
        },
        {
          title: "Pointe-a-Calliere Museum ticket",
          description: "Search admission for Montreal's archaeology and history museum near the Old Port. Search-ready suggestion; verify price and availability before booking.",
          query: "Pointe-a-Calliere Museum Montreal tickets",
          min: 22,
          max: 30,
          free_or_paid: "paid" as const,
          time_window: "afternoon",
          advance_booking_recommended: true
        },
        {
          title: "Montreal Museum of Fine Arts ticket",
          description: "Search current exhibition admission for the Montreal Museum of Fine Arts. Search-ready suggestion; verify price and availability before booking.",
          query: "Montreal Museum of Fine Arts tickets",
          min: 18,
          max: 30,
          free_or_paid: "paid" as const,
          time_window: "afternoon",
          advance_booking_recommended: true
        },
        {
          title: "Mount Royal lookout walk",
          description: "Mount Royal is free; verify trail conditions and use this as a low-cost skyline anchor.",
          query: "Mount Royal lookout Montreal directions",
          min: 0,
          max: 0,
          free_or_paid: "free" as const,
          time_window: "morning",
          advance_booking_recommended: false
        }
      ],
      tours: [
        {
          title: "Old Montreal walking tour",
          description: "Search a 2-hour Old Montreal walking tour with a meeting point near Place d'Armes or the Old Port.",
          query: "Old Montreal walking tour",
          min: 28,
          max: 55,
          duration: "2 hours",
          time_window: "morning",
          why: "Adds context to Old Montreal without filling the whole day."
        },
        {
          title: "Montreal food tasting tour",
          description: "Search a Mile End, Little Italy, or Old Montreal food tasting tour with small-group reviews.",
          query: "Montreal food tasting tour Mile End",
          min: 75,
          max: 130,
          duration: "3 hours",
          time_window: "afternoon",
          why: "Matches the food interest while reducing restaurant research."
        },
        {
          title: "Plateau street art walk",
          description: "Search a Plateau Mont-Royal mural and street art walk near Saint-Laurent Boulevard.",
          query: "Plateau Montreal street art walking tour",
          min: 25,
          max: 55,
          duration: "2 hours",
          time_window: "afternoon",
          why: "Fits culture and nightlife areas in the same part of the city."
        },
        {
          title: "Evening jazz or nightlife experience",
          description: "Search an evening jazz, speakeasy, or guided nightlife experience around Quartier des Spectacles or Plateau.",
          query: "Montreal evening jazz nightlife experience",
          min: 25,
          max: 90,
          duration: "2-3 hours",
          time_window: "evening",
          why: "Fits the nightlife interest without implying a completed table or ticket booking."
        }
      ],
      transport: {
        title: "YUL airport transfer and STM transit pass",
        description:
          "Compare the 747 YUL airport bus, taxi/rideshare to Ville-Marie or Plateau, and an STM multi-day pass for local movement.",
        query: "YUL 747 airport bus STM transit pass Montreal",
        min: 11,
        max: 45,
        why: "Keeps arrival and daily transit decisions clear before departure."
      },
      restaurantArea: "Plateau Mont-Royal, Mile End, or Old Montreal"
    };
  }

  return {
    neighborhoods: [`central ${city}`, "a transit-connected neighborhood"],
    hotelWhy: "Keeps the stay close to daily activity clusters and reliable transport.",
    attractions: [
      {
        title: `${city} official museum or landmark ticket`,
        description: `Search the official ticket page for a major ${city} museum, landmark, or timed-entry attraction. Search-ready suggestion; verify price and availability before booking.`,
        query: `${city} official museum landmark tickets timed entry`,
        min: 15,
        max: 40,
        free_or_paid: "paid" as const,
        time_window: "morning",
        advance_booking_recommended: true
      }
    ],
    tours: [
      {
        title: `${city} walking highlights tour`,
        description: `Search a small-group ${city} walking tour with a clear meeting point, duration, and cancellation policy.`,
        query: `${city} small group walking tour`,
        min: 25,
        max: 70,
        duration: "2-3 hours",
        time_window: "morning",
        why: "Gives structure early without overfilling the day."
      }
    ],
    transport: {
      title: `${city} airport transfer and local transit`,
      description: `Compare airport transfer options, local transit passes, taxi/rideshare, and walking clusters in ${city}.`,
      query: `${city} airport transfer local transit pass`,
      min: 10,
      max: 60,
      why: "Reduces arrival-day logistics and daily routing decisions."
    },
    restaurantArea: `central ${city}`
  };
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

function cleanTransportMode(value: unknown): TransportOption["mode"] {
  if (value === "flight" || value === "drive" || value === "train" || value === "bus" || value === "mixed") return value;
  return "mixed";
}

function cleanTransportPriceConfidence(value: unknown): TransportOption["price_confidence"] {
  if (value === "live_partner" || value === "cached_recent" || value === "estimated" || value === "unknown") return value;
  return "unknown";
}

function cleanTransportBudgetFit(value: unknown): TransportOption["budget_fit"] {
  if (value === "best" || value === "okay" || value === "expensive" || value === "unknown") return value;
  return "unknown";
}

function cleanTransportAvailability(value: unknown): TransportOption["availability"] {
  if (value === "verified" || value === "search_ready" || value === "unverified" || value === "not_available") return value;
  return "unverified";
}

function cleanTransportOption(value: unknown, currency: string): TransportOption | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!record) return null;
  const title = cleanString(record.title, "");
  const origin = cleanString(record.origin, "");
  const destination = cleanString(record.destination, "");
  if (!title || !destination) return null;
  const costBreakdown = record.cost_breakdown && typeof record.cost_breakdown === "object" ? (record.cost_breakdown as Record<string, unknown>) : {};
  return {
    mode: cleanTransportMode(record.mode),
    availability: cleanTransportAvailability(record.availability),
    realistic: typeof record.realistic === "boolean" ? record.realistic : cleanTransportAvailability(record.availability) === "verified" || cleanTransportAvailability(record.availability) === "search_ready",
    title,
    origin,
    destination,
    departure_date: cleanString(record.departure_date, ""),
    return_date: cleanOptionalString(record.return_date),
    estimated_duration_hours: cleanNullableNumber(record.estimated_duration_hours),
    estimated_cost_min: cleanNullableNumber(record.estimated_cost_min),
    estimated_cost_max: cleanNullableNumber(record.estimated_cost_max),
    currency: cleanString(record.currency, currency),
    duration_label: cleanOptionalString(record.duration_label),
    distance_km: cleanNullableNumber(record.distance_km) ?? undefined,
    cost_breakdown: {
      gas: cleanNullableNumber(costBreakdown.gas) ?? undefined,
      parking: cleanNullableNumber(costBreakdown.parking) ?? undefined,
      tolls: cleanNullableNumber(costBreakdown.tolls) ?? undefined,
      train_or_bus_ticket: cleanNullableNumber(costBreakdown.train_or_bus_ticket) ?? undefined,
      flight: cleanNullableNumber(costBreakdown.flight) ?? undefined,
      baggage: cleanNullableNumber(costBreakdown.baggage) ?? undefined,
      airport_transfer: cleanNullableNumber(costBreakdown.airport_transfer) ?? undefined,
      overnight_stop: cleanNullableNumber(costBreakdown.overnight_stop) ?? undefined,
      border_delay_buffer: cleanNullableNumber(costBreakdown.border_delay_buffer) ?? undefined,
      roaming_esim: cleanNullableNumber(costBreakdown.roaming_esim) ?? undefined
    },
    price_confidence: cleanTransportPriceConfidence(record.price_confidence),
    search_url: cleanOptionalString(record.search_url),
    booking_url: cleanOptionalString(record.booking_url),
    reason: cleanString(record.reason, cleanString(record.why_recommended, "Verify route practicality before booking.")),
    warning: cleanString(record.warning, "Refresh live price and route details before booking."),
    source: cleanString(record.source, "Roamly transport comparison"),
    why_recommended: cleanString(record.why_recommended, "Verify current price and schedule before booking."),
    budget_fit: cleanTransportBudgetFit(record.budget_fit)
  };
}

function cleanTransportOptions(value: unknown, currency: string) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanTransportOption(item, currency))
    .filter((item): item is TransportOption => Boolean(item))
    .slice(0, 8);
}

function discoveryTransportOptions(payload: TripPlannerPayload) {
  return cleanTransportOptions(payload.priceDiscovery?.transportOptions, payload.budgetCurrency || "CAD");
}

function discoveryRecommendedTransportOption(payload: TripPlannerPayload, options: TransportOption[]) {
  return (
    cleanTransportOption(payload.priceDiscovery?.recommendedTransportOption, payload.budgetCurrency || "CAD") ||
    options.find((option) => option.budget_fit === "best") ||
    null
  );
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

function transportBookingLabel(mode: TransportOption["mode"]) {
  if (mode === "flight") return "Find this flight";
  if (mode === "train") return "Check train";
  if (mode === "bus") return "Check bus";
  if (mode === "drive") return "Open driving route";
  return "Search mixed route";
}

function transportProviderLabel(mode: TransportOption["mode"]) {
  if (mode === "flight") return "Google Flights search";
  if (mode === "drive") return "Google Maps driving directions";
  if (mode === "train") return "Train search";
  if (mode === "bus") return "Bus search";
  return "Mixed transport search";
}

function transportPriceConfidence(value: TransportOption["price_confidence"]): RoamlyPriceConfidence {
  if (value === "live_partner" || value === "cached_recent") return "partner";
  if (value === "estimated") return "estimated";
  return "unknown";
}

function transportOptionDescription(option: TransportOption) {
  const verify =
    option.availability === "unverified" || option.availability === "not_available"
      ? " Not recommended as the primary option unless a provider confirms the route."
      : option.mode === "train" || option.mode === "bus"
        ? " Verify live schedule and price."
        : " Verify price, timing, and availability.";
  const confidence =
    option.price_confidence === "live_partner"
      ? "Live partner price."
      : option.price_confidence === "cached_recent"
        ? "Recently searched price."
        : option.price_confidence === "estimated"
          ? option.availability === "search_ready" ? "Market estimate." : "Conservative estimate."
          : "Search-ready option.";
  return `${confidence} ${option.duration_label ? `${option.duration_label}. ` : ""}${option.why_recommended} ${option.warning}${verify}`;
}

function buildStarterBookingSuggestions(payload: TripPlannerPayload): RoamlyBookingSuggestion[] {
  const currency = payload.budgetCurrency || "CAD";
  const destination = payload.destination || "your destination";
  const origin = payload.origin || "your origin";
  const perDay = payload.budgetAmount && payload.daysCount ? Math.round(payload.budgetAmount / clampTripDays(payload.daysCount)) : null;
  const cities = tripCities(payload);
  const transportOptions = discoveryTransportOptions(payload);
  const routeLegs = discoveryList(payload, "routeLegs") as Array<Record<string, unknown>>;
  const cityEstimates = discoveryList(payload, "cityEstimates") as Array<Record<string, unknown>>;
  const roomType = roomTypeForPayload(payload);
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const adults = travelers.adults || payload.travelersCount || 1;
  const children = travelers.children || 0;
  const rooms = payload.rooms || 1;
  const suggestions: RoamlyBookingSuggestion[] = [];

  if (transportOptions.length) {
    for (const option of transportOptions.slice(0, 8)) {
      const category: RoamlyBookingCategory = option.mode === "flight" ? "flight" : "transport";
      suggestions.push(
        buildSuggestion({
          category,
          title: option.budget_fit === "best" ? `Recommended: ${option.title}` : option.title,
          description: transportOptionDescription(option),
          location: `${option.origin} to ${option.destination}`,
          origin: option.origin,
          destination: option.destination,
          departure_date: option.departure_date || payload.startDate || undefined,
          return_date: option.return_date,
          duration: option.duration_label,
          provider: transportProviderLabel(option.mode),
          provider_or_search_source: transportProviderLabel(option.mode),
          normal_search_url:
            option.search_url ||
            option.booking_url ||
            (option.mode === "flight"
              ? googleFlightsUrl(option.origin, option.destination, option.departure_date, option.return_date, travelers)
              : buildTransportSearchUrl({ origin: option.origin, destination: option.destination, date: option.departure_date }) ||
                searchUrl(`${option.origin} to ${option.destination} ${option.mode}`)),
          estimated_cost_min: option.estimated_cost_min,
          estimated_cost_max: option.estimated_cost_max,
          currency: option.currency || currency,
          price_confidence: transportPriceConfidence(option.price_confidence),
          price_type:
            option.price_confidence === "live_partner"
              ? "live_partner"
              : option.price_confidence === "cached_recent"
                ? "cached_recent"
                : option.availability === "search_ready"
                  ? "search_ready"
                  : option.availability === "unverified" || option.availability === "not_available"
                    ? "unknown"
                    : "estimated_fallback",
          market_confidence: option.price_confidence === "live_partner" ? "high" : option.price_confidence === "cached_recent" ? "medium" : "low",
          booking_label: transportBookingLabel(option.mode),
          why_recommended: option.why_recommended,
          free_or_paid: "paid"
        })
      );
    }
  } else if (routeLegs.length) {
    for (const leg of routeLegs.slice(0, 8)) {
      const from = cleanString(leg.from, origin);
      const to = cleanString(leg.to, destination);
      const mode = cleanString(leg.transportMode, "mixed");
      const category: RoamlyBookingCategory = mode === "flight" ? "flight" : "transport";
      const range = centsRange(leg.estimateCents);
      const departureDate = payload.startDate || undefined;
      const returnDate = payload.returnToOrigin !== false ? payload.endDate || undefined : undefined;
      const priceTarget =
        range.max != null ? ` Target total trip price under ${formatBudgetMoney(range.max, currency)} if possible.` : "";
      suggestions.push(
        buildSuggestion({
          category,
          title: category === "flight" ? `${from} to ${to} ${returnDate ? "round-trip " : ""}flight search` : `${from} to ${to} inter-city transport search`,
          description:
            category === "flight"
              ? `Look for an early outbound ${from} to ${to} flight${departureDate ? ` on ${departureDate}` : ""}${
                  returnDate ? ` and an afternoon return on ${returnDate}` : ""
                }. Prioritize one carry-on fare, practical arrival time, and no forced overnight layover.${priceTarget} Search-ready suggestion; verify price and availability before booking.`
              : `Compare train, bus, rideshare, or regional flight schedules from ${from} to ${to}. Search-ready suggestion; verify price and availability before booking.`,
          location: `${from} to ${to}`,
          origin: from,
          destination: to,
          departure_date: departureDate,
          return_date: returnDate,
          provider: category === "flight" ? "Google Flights search" : "Transport search",
          provider_or_search_source: category === "flight" ? "Google Flights search" : "Google transport search",
          normal_search_url:
            category === "flight"
              ? googleFlightsUrl(from, to, departureDate, returnDate, travelers)
              : buildTransportSearchUrl({ origin: from, destination: to, date: departureDate }) || searchUrl(`${from} to ${to} train bus flights`),
          estimated_cost_min: range.min,
          estimated_cost_max: range.max,
          currency,
          why_recommended: "Matches the planned route without claiming a completed booking or current fare.",
          free_or_paid: "paid"
        })
      );
    }
  } else if (origin && destination) {
    const departureDate = payload.startDate || undefined;
    const returnDate = payload.returnToOrigin !== false ? payload.endDate || undefined : undefined;
    suggestions.push(
      buildSuggestion({
        category: "flight",
        title: `${origin} to ${destination} ${returnDate ? "round-trip " : ""}flight search`,
        description: `Look for an early outbound ${origin} to ${destination} flight${departureDate ? ` on ${departureDate}` : ""}${
          returnDate ? ` and an afternoon return on ${returnDate}` : ""
        }. Verify current fare, baggage, seat, and schedule details before booking. Search-ready suggestion; verify price and availability before booking.`,
        location: `${origin} to ${destination}`,
        origin,
        destination,
        departure_date: departureDate,
        return_date: returnDate,
        provider: "Google Flights search",
        provider_or_search_source: "Google Flights search",
        normal_search_url: googleFlightsUrl(origin, destination, departureDate, returnDate, travelers),
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
    const profile = destinationProfile(city.city);
    const stayArea = profile.neighborhoods.slice(0, 2).join(" or ");
    const hotelTarget = nightlyMin && nightlyMax ? ` targeting ${formatBudgetMoney(nightlyMin, currency)}-${formatBudgetMoney(nightlyMax, currency)} per night` : "";
    const hotelPriceType: TravelMarketPriceType = "estimated_fallback";

    suggestions.push(
      buildSuggestion({
        category: "hotel",
        title: `${roomType} near ${stayArea}`,
        description: `Search for a ${roomType.toLowerCase()} near ${stayArea}${hotelTarget}. Conservative hotel estimate — refresh live prices before booking. Confirm cancellation policy, taxes, resort fees, and exact room details before booking.`,
        location: stayArea,
        city: city.city,
        country: city.country || undefined,
        room_type: roomType,
        neighborhood: stayArea,
        provider: "Booking.com search",
        provider_or_search_source: "Booking.com or hotel map search",
        normal_search_url: bookingSearchUrl({
          destination: city.label,
          checkInDate: payload.startDate,
          checkOutDate: payload.endDate,
          adults,
          children,
          rooms,
          neighborhood: stayArea,
          roomType
        }),
        estimated_cost_min: hotelRange.min,
        estimated_cost_max: hotelRange.max,
        estimated_nightly_cost_min: nightlyMin,
        estimated_nightly_cost_max: nightlyMax,
        estimated_total_cost_min: hotelRange.min,
        estimated_total_cost_max: hotelRange.max,
        currency,
        price_type: hotelPriceType,
        market_confidence: "low",
        why_recommended: profile.hotelWhy,
        free_or_paid: "paid"
      })
    );

    profile.attractions.slice(0, 4).forEach((attraction, attractionIndex) => {
      const attractionDate = dateOffset(payload.startDate, Math.min(clampTripDays(payload.daysCount) - 1, attractionIndex + index)) || undefined;
      suggestions.push(
        buildSuggestion({
          category: "attraction",
          title: attraction.title,
          description: attraction.description,
          location: city.city,
          city: city.city,
          country: city.country || undefined,
          date: attractionDate,
          time_window: attraction.time_window,
          provider: "Official attraction ticket search",
          provider_or_search_source: "Official attraction site or ticket search",
          normal_search_url: buildAttractionTicketSearchUrl({
            attractionName: attraction.title,
            destination: city.city,
            date: attractionDate
          }) || searchUrl(attraction.query),
          estimated_cost_min:
            attraction.min === 0
              ? 0
              : activityRange.min
                ? Math.max(attraction.min, Math.round(activityRange.min / 4))
                : attraction.min,
          estimated_cost_max:
            attraction.max === 0
              ? 0
              : activityRange.max
                ? Math.max(attraction.max, Math.round(activityRange.max / 3))
                : attraction.max,
          currency,
          booking_label: attraction.free_or_paid === "free" ? "Open directions" : "Book ticket",
          why_recommended:
            attraction.free_or_paid === "free"
              ? "Adds a free anchor that protects the budget."
              : "Adds a specific bookable culture anchor without pretending availability is guaranteed.",
          advance_booking_recommended: attraction.advance_booking_recommended,
          free_or_paid: attraction.free_or_paid,
          booking_status: attraction.free_or_paid === "free" ? "suggested" : "needs_booking"
        })
      );
    });

    profile.tours.slice(0, 4).forEach((tour, tourIndex) => {
      const tourDate = dateOffset(payload.startDate, Math.min(clampTripDays(payload.daysCount) - 1, tourIndex + index + 1)) || undefined;
      suggestions.push(
        buildSuggestion({
          category: "tour",
          title: tour.title,
          description: `${tour.description} Compare duration, meeting point, cancellation terms, and traveler reviews before booking. Search-ready suggestion; verify price and availability before booking.`,
          location: city.city,
          city: city.city,
          country: city.country || undefined,
          date: tourDate,
          duration: tour.duration,
          time_window: tour.time_window,
          provider: "Viator or GetYourGuide search",
          provider_or_search_source: "Viator, GetYourGuide, or local tour search",
          normal_search_url: tourSearchUrl(tour.title || tour.query, city.city, tourDate),
          estimated_cost_min: activityRange.min ? Math.max(tour.min, Math.round(activityRange.min / 4)) : tour.min,
          estimated_cost_max: activityRange.max ? Math.max(tour.max, Math.round(activityRange.max / 2)) : tour.max,
          currency,
          booking_label: "Find tour",
          why_recommended: tour.why,
          advance_booking_recommended: true,
          free_or_paid: "paid"
        })
      );
    });

    suggestions.push(
      buildSuggestion({
        category: "transport",
        title: profile.transport.title,
        description: `${profile.transport.description} Search-ready suggestion; verify price and availability before booking.`,
        location: city.city,
        city: city.city,
        country: city.country || undefined,
        provider: "Google Maps and public transit search",
        provider_or_search_source: "Google Maps and official transit search",
        normal_search_url: buildTransportSearchUrl({ destination: `${city.label} ${profile.transport.query}`, date: payload.startDate }) || searchUrl(profile.transport.query),
        estimated_cost_min: perDay ? Math.max(profile.transport.min, Math.round(perDay * 0.04)) : profile.transport.min,
        estimated_cost_max: perDay ? Math.max(profile.transport.max, Math.round(perDay * 0.16)) : profile.transport.max,
        currency,
        why_recommended: profile.transport.why,
        free_or_paid: "mixed"
      })
    );
  }

  if (payload.interests.some((interest) => interest.toLowerCase().includes("food"))) {
    const city = cities[0];
    const profile = destinationProfile(city.city);
    suggestions.push(
      buildSuggestion({
        category: "restaurant",
        title: `Dinner reservation search near ${profile.restaurantArea}`,
        description: `Search restaurants around ${profile.restaurantArea} and verify opening hours, reservation availability, and dietary fit. Search-ready suggestion; verify price and availability before booking.`,
        location: profile.restaurantArea,
        city: city.city,
        country: city.country || undefined,
        provider: "Restaurant search",
        provider_or_search_source: "Google, OpenTable, or restaurant site search",
        normal_search_url: searchUrl(`${city.label} restaurants reservations ${profile.restaurantArea} ${payload.dietaryPreference || ""}`),
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

function discoveryAmount(payload: TripPlannerPayload, key: string) {
  return centsToAmount(payload.priceDiscovery?.[key] as number | null | undefined);
}

function cleanSignedNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function cleanBudgetStatus(value: unknown): BudgetBreakdown["budget_status"] {
  if (value === "within_budget" || value === "tight" || value === "over_budget" || value === "unknown") return value;
  return undefined;
}

function budgetStatusFromRemaining(remaining: number | null) {
  if (remaining == null) return "unknown" as const;
  return remaining < 0 ? "over_budget" : "within_budget";
}

function cleanBudgetCategoryConfidenceList(value: unknown): BudgetCategoryConfidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const category = cleanString(record.category, "");
      const label = cleanString(record.label, "");
      if (!category || !label) return null;
      return {
        category: category as BudgetCategoryConfidence["category"],
        label: label as BudgetCategoryConfidence["label"],
        amountCents: cleanNumber(record.amountCents ?? record.amount_cents, 0),
        source: cleanString(record.source, "Roamly estimate"),
        note: cleanString(record.note, "Refresh live prices before booking.")
      };
    })
    .filter((item): item is BudgetCategoryConfidence => Boolean(item));
}

function budgetBreakdownNumbers(payload: TripPlannerPayload, budget?: Record<string, unknown>) {
  const currency = payload.budgetCurrency || cleanString(budget?.currency, "CAD");
  const discoveredTotal = discoveryAmount(payload, "totalEstimateCents");
  const discoveredRemaining = discoveryAmount(payload, "remainingBudgetCents");
  const rawTotal = cleanNullableNumber(budget?.total_estimate_amount ?? budget?.totalEstimateAmount);
  const rawRemaining = cleanSignedNullableNumber(budget?.remaining_budget_amount ?? budget?.remainingBudgetAmount);
  const parsedTotal = parseBudgetAmount(budget?.total_estimate);
  const totalEstimateAmount = discoveredTotal ?? rawTotal ?? parsedTotal;
  const userBudgetAmount = payload.budgetAmount ?? cleanNullableNumber(budget?.user_budget_amount ?? budget?.userBudgetAmount);
  const remainingBudgetAmount =
    discoveredRemaining ?? rawRemaining ?? calculateRemainingBudget(userBudgetAmount, totalEstimateAmount);
  const budgetStatus =
    cleanBudgetStatus(payload.priceDiscovery?.budgetStatus) ||
    cleanBudgetStatus(budget?.budget_status ?? budget?.budgetStatus) ||
    budgetStatusFromRemaining(remainingBudgetAmount);

  return {
    currency,
    userBudgetAmount,
    totalEstimateAmount,
    remainingBudgetAmount,
    budgetStatus
  };
}

export function getItineraryTotalEstimateAmount(itinerary: Pick<RoamlyItinerary, "estimated_budget_breakdown" | "daily_itinerary">) {
  const explicit = itinerary.estimated_budget_breakdown.total_estimate_amount;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  const parsed = parseBudgetAmount(itinerary.estimated_budget_breakdown.total_estimate);
  if (parsed != null) return parsed;
  const daily = itinerary.daily_itinerary.reduce((sum, day) => sum + (day.estimated_cost || 0), 0);
  return daily || null;
}

export function buildStarterItinerary(payload: TripPlannerPayload): RoamlyItinerary {
  const days = clampTripDays(payload.daysCount);
  const perDay = payload.budgetAmount ? Math.max(35, Math.round(payload.budgetAmount / days)) : 120;
  const interests = payload.interests.length ? payload.interests : ["Food", "Culture", "Hidden gems"];
  const stops = payload.tripType === "multi_city" && payload.destinationStops?.length ? payload.destinationStops : [];
  const budgetNumbers = budgetBreakdownNumbers(payload);
  const totalEstimate = budgetNumbers.totalEstimateAmount ?? payload.budgetAmount;
  const transportOptions = discoveryTransportOptions(payload);
  const recommendedTransportOption = discoveryRecommendedTransportOption(payload, transportOptions);
  const preTripEssentials = buildPreTripEssentials(payload);
  const crossBorder =
    typeof payload.priceDiscovery?.cross_border === "boolean"
      ? payload.priceDiscovery.cross_border
      : detectCrossBorderTrip({
          origin: payload.origin,
          originCountry: payload.originCountry,
          destination: payload.destination,
          destinationCountry: payload.destinationCountry,
          routeText: `${payload.origin || ""} ${payload.destination}`
        }).cross_border;
  const originCurrency = cleanString(payload.priceDiscovery?.originCurrency, payload.budgetCurrency || "CAD");
  const destinationCurrency = cleanString(payload.priceDiscovery?.destinationCurrency, payload.budgetCurrency || "CAD");
  const crossBorderWarnings = crossBorder
    ? cleanList(payload.priceDiscovery?.crossBorderWarnings, crossBorderTravelNotes({ originCurrency, destinationCurrency, driving: recommendedTransportOption?.mode === "drive" }), 8)
    : [];
  const documentReminders = crossBorderTravelDocumentReminders(recommendedTransportOption?.mode === "drive");
  const recommendedTransportSummary = recommendedTransportOption
    ? `${recommendedTransportOption.title}: ${formatRange(recommendedTransportOption.estimated_cost_min, recommendedTransportOption.estimated_cost_max, recommendedTransportOption.currency)}. ${recommendedTransportOption.why_recommended}`
    : `${payload.transportationPreference} is the preferred transport style.`;

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
    budget_fit_summary: "Use the budget check as a planning guardrail and verify current prices before booking.",
    booking_status_summary: "No bookings are assumed unless they were uploaded or saved in Roamly.",
    free_or_low_cost_notes: ["Balance paid anchors with free neighborhoods, parks, markets, and viewpoints."],
    estimated_budget_breakdown: {
      lodging: cleanString(payload.priceDiscovery?.hotelEstimateNote, "Conservative hotel estimate — refresh live prices before booking."),
      food: `${formatMoney(Math.round(perDay * 0.28), payload.budgetCurrency)} per day target.`,
      activities: `${formatMoney(Math.round(perDay * 0.25), payload.budgetCurrency)} per day target.`,
      transport: transportOptions.length
        ? `Recommended transport: ${recommendedTransportSummary} Other options: ${transportOptions
            .filter((option) => option.budget_fit !== "best")
            .map((option) => `${option.mode} ${formatRange(option.estimated_cost_min, option.estimated_cost_max, option.currency) || "search-ready"}`)
            .join(" | ") || "none"}.`
        : `${formatMoney(Math.round(perDay * 0.15), payload.budgetCurrency)} per day target.`,
      buffer: "Keep 10-15% flexible for weather, taxis, and spontaneous stops.",
      total_estimate: totalEstimate == null ? "Confirm after live booking prices." : formatBudgetMoney(totalEstimate, payload.budgetCurrency),
      notes: "Planning estimate; verify prices before booking. Suggested booking options are search-ready only.",
      user_budget_amount: budgetNumbers.userBudgetAmount,
      total_estimate_amount: budgetNumbers.totalEstimateAmount,
      remaining_budget_amount: budgetNumbers.remainingBudgetAmount,
      budget_status: budgetNumbers.budgetStatus,
      currency: budgetNumbers.currency,
      recommended_transport_option: recommendedTransportOption,
      transport_options: transportOptions,
      selected_transport_estimate_amount: centsToAmount(payload.priceDiscovery?.selectedTransportEstimateCents as number | null | undefined),
      selected_hotel_estimate_amount: discoveryAmount(payload, "hotelEstimateCents"),
      tickets_tours_estimate_amount: discoveryAmount(payload, "activitiesEstimateCents"),
      food_estimate_amount: discoveryAmount(payload, "foodEstimateCents"),
      local_transport_estimate_amount: discoveryAmount(payload, "localTransportEstimateCents"),
      buffer_estimate_amount: discoveryAmount(payload, "bufferEstimateCents"),
      committed_bookings_amount: discoveryAmount(payload, "committedBudgetCents"),
      hotel_nights: cleanNullableNumber(payload.priceDiscovery?.hotelNights),
      hotel_nightly_estimate_amount: discoveryAmount(payload, "hotelNightlyEstimateCents"),
      hotel_taxes_fees_buffer_amount: discoveryAmount(payload, "hotelTaxesFeesBufferCents"),
      hotel_estimate_note: cleanOptionalString(payload.priceDiscovery?.hotelEstimateNote),
      budget_category_confidence: Array.isArray(payload.priceDiscovery?.budgetCategoryConfidence)
        ? (payload.priceDiscovery.budgetCategoryConfidence as BudgetCategoryConfidence[])
        : [],
      cross_border: crossBorder,
      cross_border_warnings: crossBorderWarnings,
      origin_currency: originCurrency,
      destination_currency: destinationCurrency,
      currency_change: Boolean(originCurrency && destinationCurrency && originCurrency !== destinationCurrency),
      transport_assumptions: cleanList(payload.priceDiscovery?.transportAssumptions, [], 4)
    },
    hotel_area_suggestions: [
      `Central ${payload.destination} for first-time convenience`,
      "Transit-connected neighborhood for better value",
      "Quieter local area if you prefer slower evenings"
    ],
    transport_overview: transportOptions.length
      ? `Roamly compared flight, driving, train, bus, and mixed transport. ${recommendedTransportSummary}`
      : `${payload.transportationPreference} is the preferred transport style. Build each day around nearby clusters to avoid wasted travel time.`,
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
    packing_checklist: [
      ...(crossBorder ? documentReminders : ["Passport/ID"]),
      "Phone charger",
      "Comfortable shoes",
      "Weather layer",
      "Payment backup"
    ],
    local_tips: [
      ...(crossBorder ? crossBorderWarnings.slice(1, 5) : []),
      "Save offline maps.",
      "Check opening hours the night before.",
      "Group nearby stops."
    ],
    safety_notes: [
      ...(crossBorder ? ["Check official entry requirements before travel.", "Review customs rules before crossing. Food, alcohol, tobacco, medication, plants, and large purchases may have restrictions."] : []),
      "Keep emergency contacts saved.",
      "Use licensed transport late at night."
    ],
    emergency_notes: [
      ...(crossBorder ? ["Confirm roaming or eSIM/SIM coverage before departure.", "Save emergency contacts and the local emergency number before travel."] : []),
      "Find the local emergency number before arrival.",
      "Save your hotel address offline."
    ],
    booking_suggestions: buildStarterBookingSuggestions(payload),
    pre_trip_essentials: preTripEssentials,
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

function cleanMarketSource(value: unknown): TravelMarketSource | undefined {
  if (
    value === "travelpayouts" ||
    value === "stay22" ||
    value === "getyourguide" ||
    value === "viator" ||
    value === "klook" ||
    value === "google_search" ||
    value === "fallback_estimate"
  ) {
    return value;
  }
  return undefined;
}

function cleanMarketPriceType(value: unknown): TravelMarketPriceType | undefined {
  if (
    value === "live_partner" ||
    value === "cached_recent" ||
    value === "search_ready" ||
    value === "estimated_fallback" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function cleanMarketConfidence(value: unknown): TravelMarketConfidence | undefined {
  if (value === "high" || value === "medium" || value === "low") return value;
  return undefined;
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

function bookingSuggestionFallbackUrl(
  record: Record<string, unknown>,
  category: RoamlyBookingCategory,
  title: string,
  payload: TripPlannerPayload
) {
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const adults = travelers.adults || payload.travelersCount || 1;
  const children = travelers.children || 0;
  const destination = cleanString(record.destination, cleanString(record.city, payload.destination));
  const date = cleanString(record.date, payload.startDate || "");

  if (category === "flight") {
    return (
      buildFlightSearchUrl({
        origin: cleanString(record.origin, payload.origin || ""),
        destination,
        departureDate: cleanString(record.departure_date, payload.startDate || ""),
        returnDate: cleanString(record.return_date, payload.endDate || ""),
        travelers
      }) || searchUrl(`${title} ${payload.destination}`)
    );
  }

  if (category === "hotel") {
    return (
      buildHotelSearchUrl({
        destination,
        checkInDate: payload.startDate,
        checkOutDate: payload.endDate,
        adults,
        children,
        rooms: payload.rooms || 1,
        neighborhood: cleanString(record.neighborhood || record.area || record.location, ""),
        roomType: cleanString(record.room_type, roomTypeForPayload(payload))
      }) || searchUrl(`${title} ${payload.destination}`)
    );
  }

  if (category === "attraction") {
    return buildAttractionTicketSearchUrl({ attractionName: title, destination, date }) || searchUrl(`${title} ${destination}`);
  }

  if (category === "tour") {
    return buildTourSearchUrl({ tourName: title, destination, date }) || searchUrl(`${title} ${destination}`);
  }

  if (category === "transport" || category === "car_rental") {
    return (
      buildTransportSearchUrl({
        origin: cleanString(record.origin, ""),
        destination: cleanString(record.destination || record.location, destination || title),
        date
      }) || searchUrl(`${title} ${destination} transport`)
    );
  }

  return searchUrl(`${title} ${payload.destination}`);
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
      const url = cleanString(record.normal_search_url, bookingSuggestionFallbackUrl(record, category, title, payload));
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
        provider_or_search_source: cleanOptionalString(record.provider_or_search_source || record.provider || record.search_source),
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
        price_confidence: cleanPriceConfidence(record.price_confidence),
        market_source: cleanMarketSource(record.market_source || record.source),
        price_type: cleanMarketPriceType(record.price_type) || (category === "hotel" && cleanPriceConfidence(record.price_confidence) === "estimated" ? "estimated_fallback" : undefined),
        market_confidence: cleanMarketConfidence(record.market_confidence || record.confidence),
        searched_at: cleanOptionalString(record.searched_at),
        expires_at: cleanOptionalString(record.expires_at),
        market_search_key: cleanOptionalString(record.market_search_key || record.search_key)
      };
    })
    .slice(0, 24);
  const merged = cleaned.length ? [...cleaned] : [...fallback];
  for (const requiredCategory of ["hotel", "transport"] as RoamlyBookingCategory[]) {
    if (!merged.some((item) => item.category === requiredCategory)) {
      const fallbackItem = fallback.find((item) => item.category === requiredCategory);
      if (fallbackItem) merged.push(fallbackItem);
    }
  }
  return merged.slice(0, 24);
}

export function normalizeItinerary(raw: unknown, payload: TripPlannerPayload): RoamlyItinerary {
  const fallback = buildStarterItinerary(payload);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const budget = record.estimated_budget_breakdown as Record<string, unknown> | undefined;
  const budgetNumbers = budgetBreakdownNumbers(payload, budget);
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
      total_estimate:
        budgetNumbers.totalEstimateAmount == null
          ? cleanString(budget?.total_estimate, fallback.estimated_budget_breakdown.total_estimate)
          : formatBudgetMoney(budgetNumbers.totalEstimateAmount, budgetNumbers.currency),
      notes: cleanString(budget?.notes, fallback.estimated_budget_breakdown.notes),
      user_budget_amount: budgetNumbers.userBudgetAmount,
      total_estimate_amount: budgetNumbers.totalEstimateAmount,
      remaining_budget_amount: budgetNumbers.remainingBudgetAmount,
      budget_status: budgetNumbers.budgetStatus,
      currency: budgetNumbers.currency,
      recommended_transport_option:
        cleanTransportOption(budget?.recommended_transport_option ?? budget?.recommendedTransportOption, budgetNumbers.currency) ||
        fallback.estimated_budget_breakdown.recommended_transport_option ||
        null,
      transport_options: cleanTransportOptions(
        budget?.transport_options ?? budget?.transportOptions,
        budgetNumbers.currency
      ).length
        ? cleanTransportOptions(budget?.transport_options ?? budget?.transportOptions, budgetNumbers.currency)
        : fallback.estimated_budget_breakdown.transport_options || [],
      selected_transport_estimate_amount:
        cleanNullableNumber(budget?.selected_transport_estimate_amount ?? budget?.selectedTransportEstimateAmount) ??
        fallback.estimated_budget_breakdown.selected_transport_estimate_amount ??
        null,
      selected_hotel_estimate_amount:
        cleanNullableNumber(budget?.selected_hotel_estimate_amount ?? budget?.selectedHotelEstimateAmount) ??
        fallback.estimated_budget_breakdown.selected_hotel_estimate_amount ??
        null,
      tickets_tours_estimate_amount:
        cleanNullableNumber(budget?.tickets_tours_estimate_amount ?? budget?.ticketsToursEstimateAmount) ??
        fallback.estimated_budget_breakdown.tickets_tours_estimate_amount ??
        null,
      food_estimate_amount:
        cleanNullableNumber(budget?.food_estimate_amount ?? budget?.foodEstimateAmount) ??
        fallback.estimated_budget_breakdown.food_estimate_amount ??
        null,
      local_transport_estimate_amount:
        cleanNullableNumber(budget?.local_transport_estimate_amount ?? budget?.localTransportEstimateAmount) ??
        fallback.estimated_budget_breakdown.local_transport_estimate_amount ??
        null,
      buffer_estimate_amount:
        cleanNullableNumber(budget?.buffer_estimate_amount ?? budget?.bufferEstimateAmount) ??
        fallback.estimated_budget_breakdown.buffer_estimate_amount ??
        null,
      committed_bookings_amount:
        cleanNullableNumber(budget?.committed_bookings_amount ?? budget?.committedBookingsAmount) ??
        fallback.estimated_budget_breakdown.committed_bookings_amount ??
        null,
      hotel_nights:
        cleanNullableNumber(budget?.hotel_nights ?? budget?.hotelNights) ??
        fallback.estimated_budget_breakdown.hotel_nights ??
        null,
      hotel_nightly_estimate_amount:
        cleanNullableNumber(budget?.hotel_nightly_estimate_amount ?? budget?.hotelNightlyEstimateAmount) ??
        fallback.estimated_budget_breakdown.hotel_nightly_estimate_amount ??
        null,
      hotel_taxes_fees_buffer_amount:
        cleanNullableNumber(budget?.hotel_taxes_fees_buffer_amount ?? budget?.hotelTaxesFeesBufferAmount) ??
        fallback.estimated_budget_breakdown.hotel_taxes_fees_buffer_amount ??
        null,
      hotel_estimate_note: cleanOptionalString(budget?.hotel_estimate_note ?? budget?.hotelEstimateNote) || fallback.estimated_budget_breakdown.hotel_estimate_note,
      budget_category_confidence: cleanBudgetCategoryConfidenceList(budget?.budget_category_confidence ?? budget?.budgetCategoryConfidence).length
        ? cleanBudgetCategoryConfidenceList(budget?.budget_category_confidence ?? budget?.budgetCategoryConfidence)
        : fallback.estimated_budget_breakdown.budget_category_confidence || [],
      cross_border:
        typeof budget?.cross_border === "boolean"
          ? budget.cross_border
          : typeof budget?.crossBorder === "boolean"
            ? budget.crossBorder
            : fallback.estimated_budget_breakdown.cross_border,
      cross_border_warnings: cleanList(
        budget?.cross_border_warnings ?? budget?.crossBorderWarnings,
        fallback.estimated_budget_breakdown.cross_border_warnings || [],
        8
      ),
      origin_currency: cleanOptionalString(budget?.origin_currency ?? budget?.originCurrency) || fallback.estimated_budget_breakdown.origin_currency,
      destination_currency:
        cleanOptionalString(budget?.destination_currency ?? budget?.destinationCurrency) || fallback.estimated_budget_breakdown.destination_currency,
      currency_change:
        typeof budget?.currency_change === "boolean"
          ? budget.currency_change
          : typeof budget?.currencyChange === "boolean"
            ? budget.currencyChange
            : fallback.estimated_budget_breakdown.currency_change,
      transport_assumptions: cleanList(
        budget?.transport_assumptions ?? budget?.transportAssumptions,
        fallback.estimated_budget_breakdown.transport_assumptions || [],
        4
      )
    },
    hotel_area_suggestions: cleanList(record.hotel_area_suggestions, fallback.hotel_area_suggestions, 6),
    transport_overview: cleanString(record.transport_overview, fallback.transport_overview),
    daily_itinerary: days,
    packing_checklist: cleanList(record.packing_checklist, fallback.packing_checklist, 16),
    local_tips: cleanList(record.local_tips, fallback.local_tips, 10),
    safety_notes: cleanList(record.safety_notes, fallback.safety_notes, 8),
    emergency_notes: cleanList(record.emergency_notes, fallback.emergency_notes, 8),
    booking_suggestions: cleanBookingSuggestions(record.booking_suggestions, fallback.booking_suggestions, payload),
    pre_trip_essentials: normalizePreTripEssentials(
      record.pre_trip_essentials ?? record.preTripEssentials,
      fallback.pre_trip_essentials,
      payload
    ),
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
