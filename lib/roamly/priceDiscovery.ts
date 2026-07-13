import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateInclusiveTripDays } from "@/lib/roamly/dateUtils";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { NormalizedPlace } from "@/lib/roamly/places";
import type { TravelerDetails, TripType } from "@/lib/trip-planner";
import type { TravelMarketCategory, TravelMarketResult } from "@/lib/roamly/travelMarketSearch";
import {
  compareTransportOptions,
  isTransportOptionMarketResult,
  transportOptionCostCents,
  type TransportOption
} from "@/lib/roamly/transportOptions";

export type BudgetStatus = "within_budget" | "tight" | "over_budget" | "unknown";

export type RouteLegEstimate = {
  from: string;
  to: string;
  estimateCents: number;
  transportMode: "flight" | "rail_bus" | "mixed";
  confidence: "low" | "medium";
  note: string;
};

export type CityCostEstimate = {
  city: string;
  nights: number;
  hotelEstimateCents: number;
  activitiesEstimateCents: number;
  foodEstimateCents: number;
  localTransportEstimateCents: number;
};

export type TripPriceDiscoveryInput = {
  userId?: string;
  tripId?: string | null;
  tripType?: TripType;
  origin?: string;
  originPlace?: NormalizedPlace;
  destination: string;
  destinationPlace?: NormalizedPlace;
  destinationStops?: NormalizedPlace[];
  returnToOrigin?: boolean;
  flexibleCityOrder?: boolean;
  flexibleDates?: boolean;
  startDate?: string;
  endDate?: string;
  daysCount?: number | null;
  travelersCount?: number | null;
  travelers?: TravelerDetails | Record<string, unknown> | null;
  rooms?: number | null;
  bedPreference?: string;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  budgetIncludesFlights?: boolean;
  budgetIncludesHotel?: boolean;
  budgetIncludesActivities?: boolean;
  committedBudgetCents?: number;
  accommodationPreference?: string;
  travelStyle?: string;
  pace?: string;
  walkingTolerance?: string;
  transportationPreference?: string;
  accessibilityNeeds?: string;
  dietaryPreference?: string;
  interests?: string[];
  marketResults?: TravelMarketResult[] | null;
  confirmedBookings?: Array<{
    booking_type?: string | null;
    title?: string | null;
    provider_name?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    city?: string | null;
    country?: string | null;
  }>;
};

export type TripPriceDiscovery = {
  tripType: TripType;
  origin: string;
  destination: string;
  destinationStops: NormalizedPlace[];
  returnToOrigin: boolean;
  flexibleCityOrder: boolean;
  flexibleDates: boolean;
  startDate: string;
  endDate: string;
  daysCount: number;
  travelersCount: number;
  travelers: TravelerDetails;
  rooms: number;
  bedPreference: string;
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetIncludesFlights: boolean;
  budgetIncludesHotel: boolean;
  budgetIncludesActivities: boolean;
  flightEstimateCents: number;
  hotelEstimateCents: number;
  activitiesEstimateCents: number;
  foodEstimateCents: number;
  localTransportEstimateCents: number;
  selectedTransportEstimateCents: number;
  bufferEstimateCents: number;
  totalEstimateCents: number;
  committedBudgetCents: number;
  remainingBudgetCents: number | null;
  budgetStatus: BudgetStatus;
  coverageNote: string;
  routeLegs: RouteLegEstimate[];
  transportOptions: TransportOption[];
  recommendedTransportOption: TransportOption | null;
  transportAssumptions: string[];
  cityEstimates: CityCostEstimate[];
  recommendationNotes: string[];
  sources: Array<{ provider: string; label: string; confidence: "low" | "medium" | "high" }>;
  marketResults: TravelMarketResult[];
  selectedMarketPrices: TravelMarketResult[];
  unknownMarketPriceCount: number;
  unknownMarketPriceCategories: string[];
  priceCoverage: "market" | "partial" | "fallback";
};

function cents(amount: number) {
  return Math.max(0, Math.round(amount * 100));
}

function moneyFromCents(value: number, currency = "CAD") {
  return `${currency.toUpperCase()} ${Math.round(value / 100).toLocaleString("en-CA")}`;
}

function cleanNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanInteger(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  return fallback;
}

function tripDays(input: Pick<TripPriceDiscoveryInput, "startDate" | "endDate" | "daysCount">) {
  return calculateInclusiveTripDays(input.startDate, input.endDate, cleanNumber(input.daysCount, 3));
}

function normalizeTravelers(input: TripPriceDiscoveryInput): TravelerDetails {
  const record = input.travelers && typeof input.travelers === "object" ? (input.travelers as Record<string, unknown>) : {};
  const travelersCount = cleanNumber(input.travelersCount, 1);
  const adults = Math.max(1, cleanInteger(record.adults, travelersCount));
  const children = Math.max(0, cleanInteger(record.children, 0));
  const infants = Math.max(0, cleanInteger(record.infants, 0));
  return { adults, children, infants };
}

function travelerCostFactor(travelers: TravelerDetails) {
  return Math.max(1, travelers.adults + travelers.children * 0.72 + (travelers.infants || 0) * 0.12);
}

function isLongHaul(input: TripPriceDiscoveryInput) {
  const text = `${input.origin || ""} ${input.destination} ${(input.destinationStops || []).map((stop) => stop.value).join(" ")}`.toLowerCase();
  return /japan|tokyo|philippines|manila|europe|paris|london|rome|asia|australia|sydney|seoul|thailand|bali|dubai/.test(text);
}

function placeLabel(place: NormalizedPlace | undefined, fallback: string) {
  return place?.value || place?.label || fallback;
}

function kmBetween(a?: NormalizedPlace, b?: NormalizedPlace) {
  if (typeof a?.latitude !== "number" || typeof a?.longitude !== "number") return null;
  if (typeof b?.latitude !== "number" || typeof b?.longitude !== "number") return null;
  const radius = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function estimateLegCents(params: {
  from?: NormalizedPlace;
  to?: NormalizedPlace;
  fromLabel: string;
  toLabel: string;
  travelers: TravelerDetails;
  forceFlight?: boolean;
}) {
  const distance = kmBetween(params.from, params.to);
  const factor = travelerCostFactor(params.travelers);
  const textInput = { origin: params.fromLabel, destination: params.toLabel } as TripPriceDiscoveryInput;
  const broad = isLongHaul(textInput) ? 520 : 180;
  const base =
    distance == null
      ? broad
      : distance > 3200
        ? Math.max(360, distance * 0.11)
        : distance > 900
          ? Math.max(170, distance * 0.12)
          : distance > 250
            ? Math.max(70, distance * 0.16)
            : Math.max(28, distance * 0.18);
  const transportMode: RouteLegEstimate["transportMode"] =
    params.forceFlight || (distance != null && distance > 900) || (distance == null && broad > 300)
      ? "flight"
      : distance != null && distance <= 900
        ? "rail_bus"
        : "mixed";

  return {
    from: params.fromLabel,
    to: params.toLabel,
    estimateCents: cents(base * factor),
    transportMode,
    confidence: distance == null ? "low" : "medium",
    note:
      distance == null
        ? "Broad route estimate without live routing distance."
        : `${Math.round(distance).toLocaleString()} km broad route estimate.`
  } satisfies RouteLegEstimate;
}

function routeStops(input: TripPriceDiscoveryInput) {
  if (input.tripType === "multi_city" && input.destinationStops?.length) return input.destinationStops;
  if (input.destinationPlace) return [input.destinationPlace];
  return [{ label: input.destination, value: input.destination, source: "custom" as const }];
}

export function buildRouteLegEstimates(input: TripPriceDiscoveryInput) {
  const travelers = normalizeTravelers(input);
  const stops = routeStops(input);
  const legs: RouteLegEstimate[] = [];
  const originPlace = input.originPlace || (input.origin ? { label: input.origin, value: input.origin, source: "custom" as const } : undefined);
  const originLabel = placeLabel(originPlace, input.origin || "Origin");

  if (stops[0]) {
    legs.push(
      estimateLegCents({
        from: originPlace,
        to: stops[0],
        fromLabel: originLabel,
        toLabel: placeLabel(stops[0], input.destination),
        travelers,
        forceFlight: true
      })
    );
  }

  if (input.tripType === "multi_city") {
    for (let index = 0; index < stops.length - 1; index += 1) {
      legs.push(
        estimateLegCents({
          from: stops[index],
          to: stops[index + 1],
          fromLabel: placeLabel(stops[index], `City ${index + 1}`),
          toLabel: placeLabel(stops[index + 1], `City ${index + 2}`),
          travelers
        })
      );
    }
    if (input.returnToOrigin !== false && stops.at(-1)) {
      legs.push(
        estimateLegCents({
          from: stops.at(-1),
          to: originPlace,
          fromLabel: placeLabel(stops.at(-1), "Final city"),
          toLabel: originLabel,
          travelers,
          forceFlight: true
        })
      );
    }
  }

  return legs;
}

export async function estimateFlights(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesFlights === false) return 0;
  const legs = buildRouteLegEstimates(input);
  if (input.tripType === "multi_city") return legs.reduce((sum, leg) => sum + leg.estimateCents, 0);
  const travelers = travelerCostFactor(normalizeTravelers(input));
  if (!input.origin?.trim()) return cents(180 * travelers);
  return cents((isLongHaul(input) ? 950 : 320) * travelers);
}

export async function estimateHotels(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesHotel === false) return 0;
  const days = tripDays(input);
  const nights = Math.max(1, days - 1);
  const style = (input.accommodationPreference || input.travelStyle || "").toLowerCase();
  const nightly = style.includes("luxury") || style.includes("premium") ? 260 : style.includes("budget") ? 95 : 155;
  const rooms = cleanNumber(input.rooms, 1);
  return cents(nightly * nights * rooms);
}

export async function estimateActivities(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesActivities === false) return 0;
  const days = tripDays(input);
  const pace = `${input.travelStyle || ""} ${input.pace || ""}`.toLowerCase();
  const intense = pace.includes("packed") || (input.interests || []).length > 5;
  const factor = travelerCostFactor(normalizeTravelers(input));
  return cents((intense ? 58 : pace.includes("budget") ? 26 : 38) * days * factor);
}

export async function estimateFood(input: TripPriceDiscoveryInput) {
  const days = tripDays(input);
  const travelers = travelerCostFactor(normalizeTravelers(input));
  const style = (input.travelStyle || "").toLowerCase();
  const daily = style.includes("luxury") || style.includes("premium") || style.includes("foodie") ? 85 : style.includes("budget") ? 38 : 58;
  return cents(daily * days * travelers);
}

export async function estimateLocalTransport(input: TripPriceDiscoveryInput) {
  const days = tripDays(input);
  const preference = input.transportationPreference?.toLowerCase?.() || "";
  const travelers = travelerCostFactor(normalizeTravelers(input));
  const daily = preference.includes("rental") ? 85 : preference.includes("rideshare") ? 45 : 22;
  return cents(daily * days * (preference.includes("rental") ? 1 : travelers));
}

export function calculateBudgetStatus(input: {
  budgetAmount: number | null;
  budgetCurrency: string;
  totalEstimateCents: number;
  committedBudgetCents?: number;
}) {
  if (!input.budgetAmount) {
    return { budgetStatus: "unknown" as BudgetStatus, remainingBudgetCents: null };
  }
  const budgetCents = cents(input.budgetAmount);
  const remainingBudgetCents = budgetCents - input.totalEstimateCents;
  const usedRatio = budgetCents ? input.totalEstimateCents / budgetCents : 0;
  const budgetStatus: BudgetStatus =
    remainingBudgetCents < 0 ? "over_budget" : usedRatio >= 0.86 ? "tight" : "within_budget";
  return { budgetStatus, remainingBudgetCents };
}

function distributeNights(daysCount: number, stops: NormalizedPlace[]) {
  const nights = Math.max(1, daysCount - 1);
  if (!stops.length) return [];
  const base = Math.floor(nights / stops.length);
  const extra = nights % stops.length;
  return stops.map((stop, index) => ({
    stop,
    nights: Math.max(1, base + (index < extra ? 1 : 0))
  }));
}

function buildCityEstimates(input: TripPriceDiscoveryInput, totals: {
  hotelEstimateCents: number;
  activitiesEstimateCents: number;
  foodEstimateCents: number;
  localTransportEstimateCents: number;
  daysCount: number;
}) {
  const stops = routeStops(input);
  const nights = distributeNights(totals.daysCount, stops);
  const divisor = Math.max(1, stops.length);
  return stops.map((stop, index) => {
    const nightShare = nights[index]?.nights || Math.max(1, Math.round((totals.daysCount - 1) / divisor));
    const nightsTotal = nights.reduce((sum, item) => sum + item.nights, 0) || 1;
    const hotelRatio = nightShare / nightsTotal;
    return {
      city: placeLabel(stop, `City ${index + 1}`),
      nights: nightShare,
      hotelEstimateCents: Math.round(totals.hotelEstimateCents * hotelRatio),
      activitiesEstimateCents: Math.round(totals.activitiesEstimateCents / divisor),
      foodEstimateCents: Math.round(totals.foodEstimateCents / divisor),
      localTransportEstimateCents: Math.round(totals.localTransportEstimateCents / divisor)
    };
  });
}

function recommendationNotes(status: BudgetStatus, input: TripPriceDiscoveryInput) {
  if (status !== "over_budget") return [];
  return [
    input.flexibleCityOrder ? "Try a cheaper city order with shorter or better-connected inter-city legs." : "Consider enabling flexible city order for a cheaper route.",
    "Shorten the trip or reduce nights in the most expensive city.",
    "Keep fewer paid activities and add free walking areas, markets, parks, and museums with free hours.",
    "Choose lower-cost hotel areas near reliable public transit.",
    "Compare flight, driving, train, bus, and mixed airport routes before accepting an expensive flight.",
    "Use public transit for local movement where practical.",
    "Exclude flights or hotel from this budget if they are already handled.",
    "Increase the total budget if the route and trip length are fixed."
  ];
}

function marketPriceCents(result: TravelMarketResult) {
  const amount = result.price_amount ?? result.price_max ?? result.price_min;
  return typeof amount === "number" && Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : null;
}

function marketRank(result: TravelMarketResult) {
  if (result.price_type === "live_partner") return 2;
  if (result.price_type === "cached_recent") return 3;
  if (result.price_type === "search_ready") return 4;
  if (result.price_type === "estimated_fallback") return 5;
  return 6;
}

function bookingTypeToMarketCategory(value?: string | null): TravelMarketCategory | null {
  if (value === "flight") return "flight";
  if (value === "hotel") return "hotel";
  if (value === "attraction" || value === "event") return "attraction";
  if (value === "transport" || value === "car_rental") return "transport";
  return null;
}

function confirmedMarketResults(input: TripPriceDiscoveryInput, searchedAt: string) {
  return (input.confirmedBookings || [])
    .map((booking): TravelMarketResult | null => {
      const category = bookingTypeToMarketCategory(booking.booking_type);
      if (!category || typeof booking.amount_cents !== "number" || !Number.isFinite(booking.amount_cents) || booking.amount_cents <= 0) {
        return null;
      }
      return {
        id: `user-uploaded-${category}-${booking.title || booking.provider_name || booking.start_date || searchedAt}`,
        category,
        title: booking.title || `${category} uploaded booking`,
        provider: booking.provider_name || "User-uploaded booking",
        source: "fallback_estimate",
        city: booking.city || undefined,
        country: booking.country || undefined,
        start_date: booking.start_date || undefined,
        end_date: booking.end_date || undefined,
        price_amount: Math.round(booking.amount_cents) / 100,
        currency: (booking.currency || input.budgetCurrency || "CAD").toUpperCase(),
        price_type: "live_partner",
        confidence: "high",
        searched_at: searchedAt,
        expires_at: new Date(new Date(searchedAt).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          source: "user_uploaded_confirmation",
          priceHierarchy: 1
        }
      };
    })
    .filter((result): result is TravelMarketResult => Boolean(result));
}

function fallbackMarketResult(params: {
  category: TravelMarketCategory;
  title: string;
  amountCents: number;
  currency: string;
  input: TripPriceDiscoveryInput;
  searchedAt: string;
}) {
  return {
    id: `fallback-${params.category}`,
    category: params.category,
    title: params.title,
    provider: "Roamly fallback estimate",
    source: "fallback_estimate",
    origin: params.input.origin || undefined,
    destination: params.input.destination || undefined,
    city: params.input.destination || undefined,
    start_date: params.input.startDate || undefined,
    end_date: params.input.endDate || undefined,
    travelers: params.input.travelersCount || undefined,
    rooms: params.input.rooms || undefined,
    price_amount: Math.round(params.amountCents) / 100,
    currency: params.currency,
    price_type: "estimated_fallback",
    confidence: "low",
    normal_search_url: undefined,
    searched_at: params.searchedAt,
    expires_at: new Date(new Date(params.searchedAt).getTime() + 60 * 60 * 1000).toISOString(),
    metadata: {
      warning: "Estimated fallback used only because no exact market price was available.",
      priceHierarchy: 5
    }
  } satisfies TravelMarketResult;
}

function selectMarketPrices(params: {
  input: TripPriceDiscoveryInput;
  marketResults: TravelMarketResult[];
  fallbackCents: Record<TravelMarketCategory, number>;
  currency: string;
}) {
  const searchedAt = new Date().toISOString();
  const withUserUploaded = [...confirmedMarketResults(params.input, searchedAt), ...params.marketResults];
  const categories = Object.entries(params.fallbackCents)
    .filter(([, amount]) => amount > 0)
    .map(([category]) => category as TravelMarketCategory);
  const selected: TravelMarketResult[] = [];
  const unknownCategories: string[] = [];

  for (const category of categories) {
    const matches = withUserUploaded
      .filter((result) => result.category === category)
      .sort((a, b) => marketRank(a) - marketRank(b));
    const exact = matches.find((result) => marketPriceCents(result) != null && (result.price_type === "live_partner" || result.price_type === "cached_recent"));
    if (exact) {
      selected.push(exact);
      continue;
    }

    const searchReady = matches.find((result) => result.price_type === "search_ready" || result.price_type === "unknown");
    if (searchReady) {
      unknownCategories.push(category);
    }

    selected.push(
      fallbackMarketResult({
        category,
        title:
          category === "flight"
            ? "Fallback flight planning estimate"
            : category === "hotel"
              ? "Fallback stay planning estimate"
              : category === "transport"
                ? "Fallback transport planning estimate"
                : "Fallback activity planning estimate",
        amountCents: params.fallbackCents[category],
        currency: params.currency,
        input: params.input,
        searchedAt
      })
    );
  }

  return {
    allMarketResults: withUserUploaded,
    selectedMarketPrices: selected,
    unknownMarketPriceCategories: Array.from(new Set(unknownCategories)),
    unknownMarketPriceCount: Array.from(new Set(unknownCategories)).length
  };
}

export async function discoverTripPrices(input: TripPriceDiscoveryInput): Promise<TripPriceDiscovery> {
  const daysCount = tripDays(input);
  const travelers = normalizeTravelers(input);
  const destinationStops = routeStops(input);
  const normalized: TripPriceDiscoveryInput = {
    ...input,
    tripType: input.tripType === "multi_city" ? "multi_city" : "single_destination",
    destinationStops: input.tripType === "multi_city" ? destinationStops : input.destinationStops,
    daysCount,
    travelersCount: travelers.adults + travelers.children + (travelers.infants || 0),
    travelers,
    rooms: cleanNumber(input.rooms, 1),
    budgetCurrency: (input.budgetCurrency || "CAD").toUpperCase(),
    budgetIncludesFlights: input.budgetIncludesFlights !== false,
    budgetIncludesHotel: input.budgetIncludesHotel !== false,
    budgetIncludesActivities: input.budgetIncludesActivities !== false
  };
  const routeLegs = buildRouteLegEstimates(normalized);

  const [
    fallbackFlightEstimateCents,
    fallbackHotelEstimateCents,
    fallbackActivitiesEstimateCents,
    foodEstimateCents,
    fallbackLocalTransportEstimateCents
  ] = await Promise.all([
    estimateFlights(normalized),
    estimateHotels(normalized),
    estimateActivities(normalized),
    estimateFood(normalized),
    estimateLocalTransport(normalized)
  ]);

  const fallbackCents: Record<TravelMarketCategory, number> = {
    flight: normalized.budgetIncludesFlights === false ? 0 : fallbackFlightEstimateCents,
    hotel: normalized.budgetIncludesHotel === false ? 0 : fallbackHotelEstimateCents,
    attraction: normalized.budgetIncludesActivities === false ? 0 : Math.round(fallbackActivitiesEstimateCents * 0.45),
    tour: normalized.budgetIncludesActivities === false ? 0 : Math.round(fallbackActivitiesEstimateCents * 0.55),
    transport: fallbackLocalTransportEstimateCents
  };
  const marketSelection = selectMarketPrices({
    input: normalized,
    marketResults: (input.marketResults || []).filter((result) => !isTransportOptionMarketResult(result)),
    fallbackCents,
    currency: normalized.budgetCurrency || "CAD"
  });
  const selectedCentsByCategory = marketSelection.selectedMarketPrices.reduce<Record<TravelMarketCategory, number>>(
    (acc, result) => {
      const amount = marketPriceCents(result) || 0;
      acc[result.category] += amount;
      return acc;
    },
    { flight: 0, hotel: 0, attraction: 0, tour: 0, transport: 0 }
  );
  const selectedUserUploadedCents = marketSelection.selectedMarketPrices
    .filter((result) => result.metadata?.source === "user_uploaded_confirmation")
    .reduce((sum, result) => sum + (marketPriceCents(result) || 0), 0);
  const committedBudgetCents = Math.max(0, Math.round(input.committedBudgetCents || 0));
  const uncategorizedCommittedBudgetCents = Math.max(0, committedBudgetCents - selectedUserUploadedCents);
  const flightEstimateCents = selectedCentsByCategory.flight;
  const hotelEstimateCents = selectedCentsByCategory.hotel;
  const activitiesEstimateCents = selectedCentsByCategory.attraction + selectedCentsByCategory.tour;
  const localTransportEstimateCents = selectedCentsByCategory.transport;
  const fixedTripCostCents =
    hotelEstimateCents +
    activitiesEstimateCents +
    foodEstimateCents +
    localTransportEstimateCents +
    uncategorizedCommittedBudgetCents;
  const transportComparison = compareTransportOptions({ ...normalized, travelers }, {
    marketResults: input.marketResults || [],
    flightEstimateCents,
    fallbackFlightEstimateCents,
    fixedTripCostCents
  });
  const selectedTransportEstimateCents =
    normalized.budgetIncludesFlights === false
      ? 0
      : transportOptionCostCents(transportComparison.recommendedOption) || flightEstimateCents;

  const subtotal = selectedTransportEstimateCents + fixedTripCostCents;
  const bufferEstimateCents = Math.round(subtotal * 0.12);
  const totalEstimateCents = subtotal + bufferEstimateCents;
  const budget = calculateBudgetStatus({
    budgetAmount: normalized.budgetAmount || null,
    budgetCurrency: normalized.budgetCurrency || "CAD",
    totalEstimateCents,
    committedBudgetCents
  });
  const cityEstimates = buildCityEstimates(normalized, {
    hotelEstimateCents,
    activitiesEstimateCents,
    foodEstimateCents,
    localTransportEstimateCents,
    daysCount
  });
  const coverageNote =
    marketSelection.unknownMarketPriceCount > 0
      ? `Budget incomplete — live price needed for ${marketSelection.unknownMarketPriceCount} item${marketSelection.unknownMarketPriceCount === 1 ? "" : "s"}. Fallback estimates are marked and must be verified before booking. Transport comparison includes estimated/search-ready alternatives.`
      : marketSelection.selectedMarketPrices.some((result) => result.price_type === "live_partner")
        ? "Budget uses live partner/search market prices where available. Transport alternatives are compared and estimates must be verified before booking."
        : marketSelection.selectedMarketPrices.some((result) => result.price_type === "cached_recent")
          ? "Budget uses recently searched market prices. Refresh stale prices before booking. Transport alternatives are compared with estimates where live data is missing."
          : "Budget uses estimated fallback prices because live market prices were not available. Transport comparison includes driving assumptions and search-ready train/bus links. Verify before booking.";
  const priceCoverage =
    marketSelection.selectedMarketPrices.every((result) => result.price_type === "estimated_fallback")
      ? "fallback"
      : marketSelection.selectedMarketPrices.some((result) => result.price_type === "estimated_fallback")
        ? "partial"
        : "market";

  return {
    tripType: normalized.tripType || "single_destination",
    origin: normalized.origin?.trim() || "",
    destination: normalized.destination.trim(),
    destinationStops: normalized.tripType === "multi_city" ? destinationStops : [],
    returnToOrigin: normalized.returnToOrigin !== false,
    flexibleCityOrder: normalized.flexibleCityOrder === true,
    flexibleDates: normalized.flexibleDates === true,
    startDate: normalized.startDate || "",
    endDate: normalized.endDate || "",
    daysCount,
    travelersCount: normalized.travelersCount || 1,
    travelers,
    rooms: normalized.rooms || 1,
    bedPreference: normalized.bedPreference || "No preference",
    budgetAmount: normalized.budgetAmount || null,
    budgetCurrency: normalized.budgetCurrency || "CAD",
    budgetIncludesFlights: normalized.budgetIncludesFlights !== false,
    budgetIncludesHotel: normalized.budgetIncludesHotel !== false,
    budgetIncludesActivities: normalized.budgetIncludesActivities !== false,
    flightEstimateCents,
    hotelEstimateCents,
    activitiesEstimateCents,
    foodEstimateCents,
    localTransportEstimateCents,
    selectedTransportEstimateCents,
    bufferEstimateCents,
    totalEstimateCents,
    committedBudgetCents,
    remainingBudgetCents: budget.remainingBudgetCents,
    budgetStatus: budget.budgetStatus,
    coverageNote,
    routeLegs,
    transportOptions: transportComparison.options,
    recommendedTransportOption: transportComparison.recommendedOption,
    transportAssumptions: transportComparison.assumptions,
    cityEstimates,
    recommendationNotes: recommendationNotes(budget.budgetStatus, normalized),
    sources: [
      ...marketSelection.selectedMarketPrices.map((result) => ({
        provider: result.provider,
        label:
          result.metadata?.source === "user_uploaded_confirmation"
            ? "Uploaded booking price"
            : result.price_type === "live_partner"
            ? "Live partner price"
            : result.price_type === "cached_recent"
              ? "Recently searched price"
              : result.price_type === "estimated_fallback"
                ? "Estimated fallback"
                : "Search-ready result",
        confidence: result.confidence
      })),
      ...transportComparison.options.map((option) => ({
        provider:
          option.mode === "drive"
            ? "Google Maps search"
            : option.mode === "train"
              ? "Train search"
              : option.mode === "bus"
                ? "Bus search"
                : option.mode === "mixed"
                  ? "Mixed route estimate"
                  : "Flight search",
        label:
          option.budget_fit === "best"
            ? `Recommended ${option.mode} transport option`
            : `${option.mode} transport comparison option`,
        confidence: option.price_confidence === "live_partner" ? ("high" as const) : option.price_confidence === "cached_recent" ? ("medium" as const) : ("low" as const)
      })),
      { provider: "roamly_food_buffer", label: "Food and buffer planning estimate", confidence: "low" as const }
    ],
    marketResults: marketSelection.allMarketResults,
    selectedMarketPrices: marketSelection.selectedMarketPrices,
    unknownMarketPriceCount: marketSelection.unknownMarketPriceCount,
    unknownMarketPriceCategories: marketSelection.unknownMarketPriceCategories,
    priceCoverage
  };
}

function transportRangeLabel(option: TransportOption | null | undefined, currency: string) {
  if (!option) return "No recommended transport option selected.";
  const min = option.estimated_cost_min == null ? null : moneyFromCents(option.estimated_cost_min * 100, currency);
  const max = option.estimated_cost_max == null ? null : moneyFromCents(option.estimated_cost_max * 100, currency);
  const range = min && max ? `${min}-${max}` : min || max || "price unknown";
  return `${option.title}: ${range} (${option.price_confidence}). ${option.why_recommended}`;
}

export function buildBudgetConstraintForItinerary(discovery: TripPriceDiscovery) {
  const transportComparison = [
    `Recommended transport: ${transportRangeLabel(discovery.recommendedTransportOption, discovery.budgetCurrency)}`,
    `Transport options: ${discovery.transportOptions.map((option) => transportRangeLabel(option, discovery.budgetCurrency)).join(" | ") || "none"}.`,
    "Before finalizing the itinerary, compare flight, driving, train, bus, and mixed transport modes. Do not default to flights.",
    "If the budget is tight, prefer realistic cheaper options and explain tradeoffs with the phrases: \"Recommended because it keeps the trip closer to your budget\" or \"Faster but more expensive\" as appropriate."
  ].join(" ");
  const marketNote = [
    `Price coverage: ${discovery.priceCoverage}.`,
    discovery.unknownMarketPriceCount
      ? `Budget incomplete — live price needed for ${discovery.unknownMarketPriceCount} item${discovery.unknownMarketPriceCount === 1 ? "" : "s"} (${discovery.unknownMarketPriceCategories.join(", ")}).`
      : "All selected market categories have a selected price or fallback value.",
    "Use selectedMarketPrices and transportOptions for booking recommendation prices. Never invent exact prices.",
    transportComparison
  ].join(" ");
  if (discovery.budgetStatus === "over_budget") {
    return [
      "The trip may exceed budget. Build a budget-first itinerary with free or low-cost activities, public transit, affordable food, and clear warnings about expensive choices.",
      "Suggest cheaper city order, shorter trip length, fewer paid activities, lower-cost hotel areas, public transit, excluding flights/hotel if already handled, or increasing budget where needed.",
      `Selected total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}. Uploaded/saved booking costs: ${discovery.budgetCurrency} ${Math.round(discovery.committedBudgetCents / 100)}.`,
      marketNote
    ].join(" ");
  }
  if (discovery.budgetStatus === "tight") {
    return `The budget is tight. Prioritize affordable stays, free attractions, public transit, and low-cost food while keeping the trip enjoyable. Selected total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}. ${marketNote}`;
  }
  if (discovery.budgetStatus === "unknown") {
    return `No total budget was provided. Keep prices transparent, separate free and paid activities, and remind the traveler to verify costs before booking. ${marketNote}`;
  }
  return `The trip appears possible within budget. Keep the itinerary practical and include price verification reminders. ${marketNote}`;
}

export function discoveryToDatabaseRow(discovery: TripPriceDiscovery, input: TripPriceDiscoveryInput & { userId: string }) {
  const budgetCents = discovery.budgetAmount == null ? null : cents(discovery.budgetAmount);
  const lowEstimate = Math.round(discovery.totalEstimateCents * 0.88);
  const highEstimate = Math.round(discovery.totalEstimateCents * 1.12);
  const lowRemaining = budgetCents == null ? null : budgetCents - highEstimate;
  const highRemaining = budgetCents == null ? null : budgetCents - lowEstimate;

  return {
    user_id: input.userId,
    trip_id: input.tripId || null,
    origin: discovery.origin || null,
    destination: discovery.destination,
    start_date: discovery.startDate || null,
    end_date: discovery.endDate || null,
    days_count: discovery.daysCount,
    travelers_count: discovery.travelersCount,
    budget_amount: discovery.budgetAmount,
    budget_currency: discovery.budgetCurrency,
    budget_includes_flights: discovery.budgetIncludesFlights,
    budget_includes_hotel: discovery.budgetIncludesHotel,
    total_budget_cents: budgetCents,
    includes_flights: discovery.budgetIncludesFlights,
    includes_hotel: discovery.budgetIncludesHotel,
    flight_estimate_cents: discovery.flightEstimateCents,
    hotel_estimate_cents: discovery.hotelEstimateCents,
    activities_estimate_cents: discovery.activitiesEstimateCents,
    food_estimate_cents: discovery.foodEstimateCents,
    local_transport_estimate_cents: discovery.localTransportEstimateCents,
    buffer_estimate_cents: discovery.bufferEstimateCents,
    total_estimate_cents: discovery.totalEstimateCents,
    estimated_flight_min_cents: Math.round(discovery.flightEstimateCents * 0.88),
    estimated_flight_max_cents: Math.round(discovery.flightEstimateCents * 1.12),
    estimated_hotel_min_cents: Math.round(discovery.hotelEstimateCents * 0.88),
    estimated_hotel_max_cents: Math.round(discovery.hotelEstimateCents * 1.12),
    estimated_activities_min_cents: Math.round(discovery.activitiesEstimateCents * 0.88),
    estimated_activities_max_cents: Math.round(discovery.activitiesEstimateCents * 1.12),
    estimated_food_min_cents: Math.round(discovery.foodEstimateCents * 0.88),
    estimated_food_max_cents: Math.round(discovery.foodEstimateCents * 1.12),
    estimated_transport_min_cents: Math.round(discovery.localTransportEstimateCents * 0.88),
    estimated_transport_max_cents: Math.round(discovery.localTransportEstimateCents * 1.12),
    estimated_total_min_cents: lowEstimate,
    estimated_total_max_cents: highEstimate,
    remaining_budget_cents: discovery.remainingBudgetCents,
    remaining_budget_min_cents: lowRemaining,
    remaining_budget_max_cents: highRemaining,
    committed_budget_cents: discovery.committedBudgetCents,
    budget_status: discovery.budgetStatus,
    coverage_note: discovery.coverageNote,
    sources: discovery.sources,
    source_summary: {
      note: discovery.coverageNote,
      providers: discovery.sources,
      priceCoverage: discovery.priceCoverage,
      unknownMarketPriceCount: discovery.unknownMarketPriceCount,
      recommendedTransportOption: discovery.recommendedTransportOption,
      selectedTransportEstimateCents: discovery.selectedTransportEstimateCents
    },
    metadata: {
      budgetConstraint: buildBudgetConstraintForItinerary(discovery),
      tripType: discovery.tripType,
      destinationStops: discovery.destinationStops,
      returnToOrigin: discovery.returnToOrigin,
      flexibleCityOrder: discovery.flexibleCityOrder,
      flexibleDates: discovery.flexibleDates,
      travelers: discovery.travelers,
      rooms: discovery.rooms,
      bedPreference: discovery.bedPreference,
      budgetIncludesActivities: discovery.budgetIncludesActivities,
      routeLegs: discovery.routeLegs,
      transportOptions: discovery.transportOptions,
      recommendedTransportOption: discovery.recommendedTransportOption,
      selectedTransportEstimateCents: discovery.selectedTransportEstimateCents,
      transportAssumptions: discovery.transportAssumptions,
      cityEstimates: discovery.cityEstimates,
      marketResults: discovery.marketResults,
      selectedMarketPrices: discovery.selectedMarketPrices,
      unknownMarketPriceCount: discovery.unknownMarketPriceCount,
      unknownMarketPriceCategories: discovery.unknownMarketPriceCategories,
      priceCoverage: discovery.priceCoverage,
      recommendationNotes: discovery.recommendationNotes,
      preferences: {
        accommodationPreference: input.accommodationPreference || null,
        travelStyle: input.travelStyle || null,
        pace: input.pace || null,
        walkingTolerance: input.walkingTolerance || null,
        transportationPreference: input.transportationPreference || null,
        accessibilityNeeds: input.accessibilityNeeds || null,
        dietaryPreference: input.dietaryPreference || null,
        interests: input.interests || []
      }
    }
  };
}

export async function savePriceDiscovery(
  supabase: SupabaseClient,
  input: TripPriceDiscoveryInput & { userId: string },
  discovery: TripPriceDiscovery
) {
  const { data, error } = await supabase
    .from("roamly_price_discoveries")
    .insert(discoveryToDatabaseRow(discovery, input))
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };
  if (input.tripId && data?.id) {
    const linked = await supabase
      .from("roamly_trips")
      .update({ latest_price_discovery_id: data.id })
      .eq("id", input.tripId)
      .eq("user_id", input.userId);
    if (linked.error && !linked.error.message.includes("latest_price_discovery_id")) {
      return { id: data.id as string, error: linked.error.message };
    }
  }
  return { id: data?.id as string, error: null };
}

export function applyPriceDiscoveryToItinerary(itinerary: RoamlyItinerary, discovery: TripPriceDiscovery): RoamlyItinerary {
  const remaining =
    typeof discovery.remainingBudgetCents === "number"
      ? Math.round(discovery.remainingBudgetCents / 100)
      : itinerary.estimated_budget_breakdown.remaining_budget_amount;
  const totalAmount = Math.round(discovery.totalEstimateCents / 100);
  const balance =
    remaining == null
      ? "Budget total updated from market search."
      : remaining < 0
        ? `Over budget by ${moneyFromCents(Math.abs(discovery.remainingBudgetCents || 0), discovery.budgetCurrency)}`
        : `Remaining budget: ${moneyFromCents(discovery.remainingBudgetCents || 0, discovery.budgetCurrency)}`;
  const incomplete = discovery.unknownMarketPriceCount
    ? `Budget incomplete — live price needed for ${discovery.unknownMarketPriceCount} item${discovery.unknownMarketPriceCount === 1 ? "" : "s"}. `
    : "";
  const recommendedTransport = transportRangeLabel(discovery.recommendedTransportOption, discovery.budgetCurrency);
  const otherTransportOptions = discovery.transportOptions
    .filter((option) => option.budget_fit !== "best")
    .map((option) => transportRangeLabel(option, discovery.budgetCurrency))
    .join(" | ");

  return {
    ...itinerary,
    budget_fit_summary: `${balance}. ${incomplete}Verify before booking.`,
    booking_status_summary:
      discovery.unknownMarketPriceCount > 0
        ? `Search-ready market options were refreshed, but ${discovery.unknownMarketPriceCount} price${discovery.unknownMarketPriceCount === 1 ? "" : "s"} still need live verification.`
        : "Market prices were refreshed. Verify live price and availability before booking.",
    estimated_budget_breakdown: {
      ...itinerary.estimated_budget_breakdown,
      lodging: `Selected stay market amount: ${moneyFromCents(discovery.hotelEstimateCents, discovery.budgetCurrency)}.`,
      activities: `Selected ticket/tour market amount: ${moneyFromCents(discovery.activitiesEstimateCents, discovery.budgetCurrency)}.`,
      transport: `Recommended transport: ${recommendedTransport}. Other options: ${otherTransportOptions || "none"}. Local transport estimate: ${moneyFromCents(discovery.localTransportEstimateCents, discovery.budgetCurrency)}.`,
      food: `Food planning estimate: ${moneyFromCents(discovery.foodEstimateCents, discovery.budgetCurrency)}.`,
      buffer: `Buffer: ${moneyFromCents(discovery.bufferEstimateCents, discovery.budgetCurrency)}.`,
      total_estimate: moneyFromCents(discovery.totalEstimateCents, discovery.budgetCurrency),
      notes: `${incomplete}${balance}. ${discovery.coverageNote}`,
      total_estimate_amount: totalAmount,
      remaining_budget_amount: remaining,
      budget_status: discovery.budgetStatus,
      currency: discovery.budgetCurrency,
      recommended_transport_option: discovery.recommendedTransportOption,
      transport_options: discovery.transportOptions,
      selected_transport_estimate_amount: Math.round(discovery.selectedTransportEstimateCents / 100),
      transport_assumptions: discovery.transportAssumptions
    }
  };
}
