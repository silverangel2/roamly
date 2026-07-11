import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedPlace } from "@/lib/roamly/places";
import type { TravelerDetails, TripType } from "@/lib/trip-planner";

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
  bufferEstimateCents: number;
  totalEstimateCents: number;
  committedBudgetCents: number;
  remainingBudgetCents: number | null;
  budgetStatus: BudgetStatus;
  coverageNote: string;
  routeLegs: RouteLegEstimate[];
  cityEstimates: CityCostEstimate[];
  recommendationNotes: string[];
  sources: Array<{ provider: string; label: string; confidence: "low" | "medium" | "high" }>;
};

function daysBetween(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function cents(amount: number) {
  return Math.max(0, Math.round(amount * 100));
}

function cleanNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanInteger(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  return fallback;
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
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const nights = Math.max(1, days - 1);
  const style = (input.accommodationPreference || input.travelStyle || "").toLowerCase();
  const nightly = style.includes("luxury") || style.includes("premium") ? 260 : style.includes("budget") ? 95 : 155;
  const rooms = cleanNumber(input.rooms, 1);
  return cents(nightly * nights * rooms);
}

export async function estimateActivities(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesActivities === false) return 0;
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const pace = `${input.travelStyle || ""} ${input.pace || ""}`.toLowerCase();
  const intense = pace.includes("packed") || (input.interests || []).length > 5;
  const factor = travelerCostFactor(normalizeTravelers(input));
  return cents((intense ? 58 : pace.includes("budget") ? 26 : 38) * days * factor);
}

export async function estimateFood(input: TripPriceDiscoveryInput) {
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const travelers = travelerCostFactor(normalizeTravelers(input));
  const style = (input.travelStyle || "").toLowerCase();
  const daily = style.includes("luxury") || style.includes("premium") || style.includes("foodie") ? 85 : style.includes("budget") ? 38 : 58;
  return cents(daily * days * travelers);
}

export async function estimateLocalTransport(input: TripPriceDiscoveryInput) {
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
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
  const remainingBudgetCents = budgetCents - input.totalEstimateCents - (input.committedBudgetCents || 0);
  const usedRatio = budgetCents ? (input.totalEstimateCents + (input.committedBudgetCents || 0)) / budgetCents : 0;
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
    "Use public transit for local movement where practical.",
    "Exclude flights or hotel from this budget if they are already handled.",
    "Increase the total budget if the route and trip length are fixed."
  ];
}

export async function discoverTripPrices(input: TripPriceDiscoveryInput): Promise<TripPriceDiscovery> {
  const daysCount = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
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
    flightEstimateCents,
    hotelEstimateCents,
    activitiesEstimateCents,
    foodEstimateCents,
    localTransportEstimateCents
  ] = await Promise.all([
    estimateFlights(normalized),
    estimateHotels(normalized),
    estimateActivities(normalized),
    estimateFood(normalized),
    estimateLocalTransport(normalized)
  ]);

  const subtotal =
    flightEstimateCents +
    hotelEstimateCents +
    activitiesEstimateCents +
    foodEstimateCents +
    localTransportEstimateCents;
  const bufferEstimateCents = Math.round(subtotal * 0.12);
  const totalEstimateCents = subtotal + bufferEstimateCents;
  const committedBudgetCents = Math.max(0, Math.round(input.committedBudgetCents || 0));
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
    normalized.tripType === "multi_city"
      ? "Multi-city estimates use broad travel ranges until live routing partners are connected."
      : "Prices are estimates and may change before booking.";

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
    bufferEstimateCents,
    totalEstimateCents,
    committedBudgetCents,
    remainingBudgetCents: budget.remainingBudgetCents,
    budgetStatus: budget.budgetStatus,
    coverageNote,
    routeLegs,
    cityEstimates,
    recommendationNotes: recommendationNotes(budget.budgetStatus, normalized),
    sources: [
      { provider: "roamly_estimator", label: "Provider-ready estimate model", confidence: "medium" },
      { provider: "routeEstimator", label: "Broad route and inter-city travel estimate", confidence: "low" },
      { provider: "flightProvider", label: "Live airfare provider pending", confidence: "low" },
      { provider: "hotelProvider", label: "Live stay provider pending", confidence: "low" },
      { provider: "activityProvider", label: "Live activity provider pending", confidence: "low" }
    ]
  };
}

export function buildBudgetConstraintForItinerary(discovery: TripPriceDiscovery) {
  if (discovery.budgetStatus === "over_budget") {
    return [
      "The trip may exceed budget. Build a budget-first itinerary with free or low-cost activities, public transit, affordable food, and clear warnings about expensive choices.",
      "Suggest cheaper city order, shorter trip length, fewer paid activities, lower-cost hotel areas, public transit, excluding flights/hotel if already handled, or increasing budget where needed.",
      `Estimated total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}. Committed bookings from uploaded or confirmed costs: ${discovery.budgetCurrency} ${Math.round(discovery.committedBudgetCents / 100)}.`
    ].join(" ");
  }
  if (discovery.budgetStatus === "tight") {
    return `The budget is tight. Prioritize affordable stays, free attractions, public transit, and low-cost food while keeping the trip enjoyable. Estimated total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}.`;
  }
  if (discovery.budgetStatus === "unknown") {
    return "No total budget was provided. Keep prices transparent, separate free and paid activities, and remind the traveler to verify costs before booking.";
  }
  return "The trip appears possible within budget. Keep the itinerary practical and include price verification reminders.";
}

export function discoveryToDatabaseRow(discovery: TripPriceDiscovery, input: TripPriceDiscoveryInput & { userId: string }) {
  const budgetCents = discovery.budgetAmount == null ? null : cents(discovery.budgetAmount);
  const lowEstimate = Math.round(discovery.totalEstimateCents * 0.88);
  const highEstimate = Math.round(discovery.totalEstimateCents * 1.12);
  const lowRemaining = budgetCents == null ? null : budgetCents - highEstimate - discovery.committedBudgetCents;
  const highRemaining = budgetCents == null ? null : budgetCents - lowEstimate - discovery.committedBudgetCents;

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
      providers: discovery.sources
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
      cityEstimates: discovery.cityEstimates,
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
    await supabase
      .from("roamly_trips")
      .update({ latest_price_discovery_id: data.id })
      .eq("id", input.tripId)
      .eq("user_id", input.userId);
  }
  return { id: data?.id as string, error: null };
}
