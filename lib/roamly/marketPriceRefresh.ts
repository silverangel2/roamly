import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { getConfirmedBookingCostCents, getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import {
  applyPriceDiscoveryToItinerary,
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import {
  searchTripMarketPrices,
  type SelectedHotelRevalidationResult
} from "@/lib/roamly/travelMarketSearch";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { hotelCandidateIsFresh } from "@/lib/roamly/hotelInventory";
import type { TravelerDetails, TripPlannerPayload, TripType } from "@/lib/trip-planner";
import { getTripBundle, syncGeneratedItinerary, type ItineraryRecord, type RoamlyTripRecord } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function tripType(value: unknown): TripType {
  return value === "multi_city" ? "multi_city" : "single_destination";
}

function tripTravelers(trip: RoamlyTripRecord): TravelerDetails {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = getRecord(planning.travelers);
  const travelersCount = positiveNumber(trip.travelers_count, positiveNumber(planning.travelersCount, 1));
  return {
    adults: Math.max(1, Math.round(positiveNumber(travelers.adults, travelersCount || 1))),
    children: Math.max(0, Math.round(positiveNumber(travelers.children, 0))),
    infants: Math.max(0, Math.round(positiveNumber(travelers.infants, 0)))
  };
}

export function payloadFromTrip(trip: RoamlyTripRecord): TripPlannerPayload {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = tripTravelers(trip);
  const startDate = trip.start_date || getString(planning.startDate || planning.start_date);
  const endDate = trip.end_date || getString(planning.endDate || planning.end_date);
  const dateRange = calculateTripDateRange(startDate, endDate);
  return {
    tripType: tripType(planning.tripType || planning.trip_type),
    origin: getTripOriginLabel(trip),
    destination: getTripDestinationLabel(trip),
    destinationCity: getString(trip.destination_city || planning.destinationCity || planning.destination_city),
    destinationCountry: getString(trip.destination_country || planning.destinationCountry || planning.destination_country),
    destinationRegion: getString(trip.destination_region || planning.destinationRegion || planning.destination_region),
    destinationStops: Array.isArray(planning.destinationStops) ? planning.destinationStops as TripPlannerPayload["destinationStops"] : undefined,
    returnToOrigin: planning.returnToOrigin !== false && planning.return_to_origin !== false,
    flexibleCityOrder: planning.flexibleCityOrder === true || planning.flexible_city_order === true,
    flexibleDates: planning.flexibleDates === true || planning.flexible_dates === true,
    startDate,
    endDate,
    daysCount: dateRange.ok ? dateRange.days || 1 : dateRange.errorCode === "MISSING_DATES" ? positiveNumber(trip.days_count, positiveNumber(planning.daysCount, 3)) : 0,
    travelersCount: travelers.adults + travelers.children + (travelers.infants || 0),
    travelers,
    rooms: positiveNumber(planning.rooms, 1),
    bedPreference: getString(planning.bedPreference || planning.bed_preference) || "No preference",
    budgetAmount: getTripBudgetAmount(trip),
    budgetCurrency: getTripBudgetCurrency(trip),
    budgetIncludesFlights: trip.budget_includes_flights !== false && planning.budgetIncludesFlights !== false,
    budgetIncludesHotel: trip.budget_includes_hotel !== false && planning.budgetIncludesHotel !== false,
    budgetIncludesActivities: planning.budgetIncludesActivities !== false && planning.budget_includes_activities !== false,
    travelStyle: getString(trip.travel_style || planning.travelStyle || planning.travel_style) || "Balanced",
    interests: Array.isArray(trip.interests) ? trip.interests.filter((item): item is string => typeof item === "string") : Array.isArray(planning.interests) ? planning.interests.filter((item): item is string => typeof item === "string") : [],
    pace: getString(planning.pace) || "Balanced",
    walkingTolerance: getString(planning.walkingTolerance || planning.walking_tolerance) || "Medium",
    accommodationPreference: getString(trip.accommodation_preference || planning.accommodationPreference || planning.accommodation_preference) || "Not sure",
    transportationPreference: getString(trip.transportation_preference || planning.transportationPreference || planning.transportation_preference) || "Mixed",
    accessibilityNeeds: getString(planning.accessibilityNeeds || planning.accessibility_needs),
    dietaryPreference: getString(planning.dietaryPreference || planning.dietary_preference),
    specialNotes: getString(trip.special_notes || planning.specialNotes || planning.special_notes),
    language: getString(planning.language) || "en"
  };
}

const confirmedStatuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);

export async function findSelectedHotelForRevalidation(
  supabase: SupabaseClient,
  trip: RoamlyTripRecord,
  itinerary: Pick<ItineraryRecord, "full_json"> | null,
  confirmedBookings: Array<{ booking_type?: string | null; booking_status?: string | null }> = []
): Promise<SelectedHotelRevalidationResult | null> {
  const context = await loadSelectedHotelActionContext(supabase, trip, itinerary, confirmedBookings);
  if (!context || context.fresh || context.confirmed) return null;
  return context.selected;
}

export async function loadSelectedHotelActionContext(
  supabase: SupabaseClient,
  trip: RoamlyTripRecord,
  itinerary: Pick<ItineraryRecord, "full_json"> | null,
  confirmedBookings: Array<{ booking_type?: string | null; booking_status?: string | null }> = []
) {
  const confirmed = confirmedBookings.some((booking) => booking.booking_type === "hotel" && confirmedStatuses.has(getString(booking.booking_status).toLowerCase()));
  const suggestions = itinerary?.full_json?.booking_suggestions;
  if (!Array.isArray(suggestions) || !trip.latest_price_discovery_id) return null;
  const { data } = await supabase.from("roamly_price_discoveries").select("metadata").eq("id", trip.latest_price_discovery_id).eq("trip_id", trip.id).eq("user_id", trip.user_id).maybeSingle();
  const metadata = getRecord(data?.metadata);
  const decision = getRecord(metadata.groundedDecision);
  const selectedId = getString(decision.selectedHotelCandidateId);
  if (!selectedId) return null;
  const selectedSuggestion = suggestions.find((item) => {
    const row = getRecord(item);
    const status = getString(row.booking_status).toLowerCase();
    return (row.category === "hotel" || row.booking_category === "hotel") && getString(row.candidateId) === selectedId && !row.booking_id && !confirmedStatuses.has(status) && row.factual_status === "verified";
  });
  if (!selectedSuggestion) return null;
  const marketRows = [...(Array.isArray(metadata.selectedMarketPrices) ? metadata.selectedMarketPrices : []), ...(Array.isArray(metadata.marketResults) ? metadata.marketResults : [])].map(getRecord);
  const market = marketRows.find((row) => getString(row.id) === selectedId && row.category === "hotel");
  if (!market) return null;
  const marketMetadata = getRecord(market.metadata);
  const providerPayload = getRecord(marketMetadata.providerPayload);
  if (market.source !== "booking_demand" || marketMetadata.retrieval_provider !== "provider_api" || !getString(providerPayload.property_id)) return null;
  const expiresAt = getString(market.expires_at);
  const row = getRecord(selectedSuggestion);
  const selected = {
    candidateId: selectedId,
    providerPropertyId: getString(providerPayload.property_id),
    provider: getString(row.provider) || null,
    source: "booking_demand",
    title: getString(row.title || row.booking_label) || null,
    destination: getString(market.destination) || null,
    city: getString(market.city) || null,
    country: getString(market.country) || null,
    start_date: getString(market.start_date) || null,
    end_date: getString(market.end_date) || null,
    travelers: positiveNumber(market.travelers, 0) || null,
    rooms: positiveNumber(market.rooms, 0) || null,
    currency: getString(market.currency) || null,
    price_amount: typeof market.price_amount === "number" ? market.price_amount : null,
    booking_url: getString(market.booking_url) || null,
    searched_at: getString(market.searched_at) || null,
    expires_at: expiresAt,
    metadata: marketMetadata
  };
  return {
    selected,
    selectedSuggestion: row,
    market,
    selectedId,
    confirmed,
    fresh: hotelCandidateIsFresh({ expiresAt }, new Date())
  };
}

export async function refreshTripMarketPricesForTrip(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  trip: RoamlyTripRecord;
  itinerary: Pick<ItineraryRecord, "full_json"> | null;
  forceRefresh?: boolean;
  selectedHotelForRevalidation?: SelectedHotelRevalidationResult | null;
}) {
  const payload = payloadFromTrip(params.trip);
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  if (!dateRange.ok) throw new Error("INVALID_TRIP_DATES");
  const confirmedBookings = await getConfirmedBookingsForItinerary(params.supabase, params.userId, params.tripId);
  const [marketSearch, committed] = await Promise.all([
    searchTripMarketPrices(payload, { supabase: params.supabase, forceRefresh: params.forceRefresh, store: true, selectedHotelForRevalidation: params.selectedHotelForRevalidation }),
    getConfirmedBookingCostCents(params.supabase, params.userId, params.tripId)
  ]);
  const discovery = await discoverTripPrices({ userId: params.userId, tripId: params.tripId, ...payload, committedBudgetCents: committed.amountCents, confirmedBookings: confirmedBookings.bookings, marketResults: marketSearch.results });
  const savedDiscovery = await savePriceDiscovery(params.supabase, { userId: params.userId, tripId: params.tripId, ...payload }, discovery);
  const full = params.itinerary?.full_json || null;
  const updatedItinerary = full ? enrichItineraryBookingSuggestions(applyPriceDiscoveryToItinerary(full, discovery), { ...payload, priceDiscoveryId: savedDiscovery.id || payload.priceDiscoveryId || null, budgetConstraint: buildBudgetConstraintForItinerary(discovery), priceDiscovery: discovery as unknown as Record<string, unknown>, confirmedBookings: confirmedBookings.bookings }) : null;
  if (updatedItinerary) await syncGeneratedItinerary(params.supabase, { tripId: params.tripId, userId: params.userId, itinerary: updatedItinerary, status: "locked" });
  const hotelResult = marketSearch.results.find((result) => result.category === "hotel" && result.id === params.selectedHotelForRevalidation?.candidateId);
  const revalidationState = getString(getRecord(hotelResult?.metadata).revalidation_status);
  return { payload, marketSearch, discovery, savedDiscovery, updatedItinerary, confirmedBookings, revalidationState, refreshedHotelResult: hotelResult || null };
}
