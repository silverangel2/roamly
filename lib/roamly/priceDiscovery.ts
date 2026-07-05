import type { SupabaseClient } from "@supabase/supabase-js";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type BudgetStatus = "within_budget" | "tight" | "over_budget";

export type TripPriceDiscoveryInput = {
  userId?: string;
  tripId?: string | null;
  origin?: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  daysCount?: number | null;
  travelersCount?: number | null;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  budgetIncludesFlights?: boolean;
  budgetIncludesHotel?: boolean;
  committedBudgetCents?: number;
  accommodationPreference?: string;
  travelStyle?: string;
  interests?: string[];
};

export type TripPriceDiscovery = {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  travelersCount: number;
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetIncludesFlights: boolean;
  budgetIncludesHotel: boolean;
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

function isLongHaul(input: TripPriceDiscoveryInput) {
  const text = `${input.origin || ""} ${input.destination}`.toLowerCase();
  return /japan|tokyo|philippines|manila|europe|paris|london|rome|asia|australia|sydney|seoul|thailand|bali|dubai/.test(text);
}

export async function estimateFlights(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesFlights === false) return 0;
  const travelers = cleanNumber(input.travelersCount, 1);
  if (!input.origin?.trim()) return cents(180 * travelers);
  return cents((isLongHaul(input) ? 950 : 320) * travelers);
}

export async function estimateHotels(input: TripPriceDiscoveryInput) {
  if (input.budgetIncludesHotel === false) return 0;
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const nights = Math.max(1, days - 1);
  const style = (input.accommodationPreference || input.travelStyle || "").toLowerCase();
  const nightly = style.includes("luxury") ? 260 : style.includes("budget") ? 95 : 155;
  return cents(nightly * nights);
}

export async function estimateActivities(input: TripPriceDiscoveryInput) {
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const intense = (input.travelStyle || "").toLowerCase().includes("packed") || (input.interests || []).length > 5;
  return cents((intense ? 55 : 35) * days);
}

export async function estimateFood(input: TripPriceDiscoveryInput) {
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const travelers = cleanNumber(input.travelersCount, 1);
  const style = (input.travelStyle || "").toLowerCase();
  const daily = style.includes("luxury") || style.includes("foodie") ? 85 : style.includes("budget") ? 38 : 58;
  return cents(daily * days * travelers);
}

export async function estimateLocalTransport(input: TripPriceDiscoveryInput) {
  const days = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const preference = (input as TripPlannerPayload).transportationPreference?.toLowerCase?.() || "";
  const daily = preference.includes("rental") ? 85 : preference.includes("rideshare") ? 45 : 22;
  return cents(daily * days);
}

export function calculateBudgetStatus(input: {
  budgetAmount: number | null;
  budgetCurrency: string;
  totalEstimateCents: number;
  committedBudgetCents?: number;
}) {
  if (!input.budgetAmount) {
    return { budgetStatus: "within_budget" as BudgetStatus, remainingBudgetCents: null };
  }
  const budgetCents = cents(input.budgetAmount);
  const remainingBudgetCents = budgetCents - input.totalEstimateCents - (input.committedBudgetCents || 0);
  const usedRatio = budgetCents ? (input.totalEstimateCents + (input.committedBudgetCents || 0)) / budgetCents : 0;
  const budgetStatus: BudgetStatus =
    remainingBudgetCents < 0 ? "over_budget" : usedRatio >= 0.86 ? "tight" : "within_budget";
  return { budgetStatus, remainingBudgetCents };
}

export async function discoverTripPrices(input: TripPriceDiscoveryInput): Promise<TripPriceDiscovery> {
  const daysCount = cleanNumber(input.daysCount ?? daysBetween(input.startDate, input.endDate), 3);
  const normalized: TripPriceDiscoveryInput = {
    ...input,
    daysCount,
    travelersCount: cleanNumber(input.travelersCount, 1),
    budgetCurrency: (input.budgetCurrency || "CAD").toUpperCase(),
    budgetIncludesFlights: input.budgetIncludesFlights !== false,
    budgetIncludesHotel: input.budgetIncludesHotel !== false
  };

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

  return {
    origin: normalized.origin?.trim() || "",
    destination: normalized.destination.trim(),
    startDate: normalized.startDate || "",
    endDate: normalized.endDate || "",
    daysCount,
    travelersCount: normalized.travelersCount || 1,
    budgetAmount: normalized.budgetAmount || null,
    budgetCurrency: normalized.budgetCurrency || "CAD",
    budgetIncludesFlights: normalized.budgetIncludesFlights !== false,
    budgetIncludesHotel: normalized.budgetIncludesHotel !== false,
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
    coverageNote: "Prices are estimates and may change before booking.",
    sources: [
      { provider: "roamly_estimator", label: "Provider-ready estimate model", confidence: "medium" },
      { provider: "flightProvider", label: "Placeholder for live airfare provider", confidence: "low" },
      { provider: "hotelProvider", label: "Placeholder for live stay provider", confidence: "low" },
      { provider: "activityProvider", label: "Placeholder for live activity provider", confidence: "low" }
    ]
  };
}

export function buildBudgetConstraintForItinerary(discovery: TripPriceDiscovery) {
  if (discovery.budgetStatus === "over_budget") {
    return "The trip may exceed budget. Build a budget-first itinerary with free or low-cost activities, public transit, affordable food, and clear warnings about expensive choices.";
  }
  if (discovery.budgetStatus === "tight") {
    return "The budget is tight. Prioritize affordable stays, free attractions, public transit, and low-cost food while keeping the trip enjoyable.";
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
    metadata: { budgetConstraint: buildBudgetConstraintForItinerary(discovery) }
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
