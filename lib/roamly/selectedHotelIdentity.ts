import type { RoamlyBookingSuggestion, RoamlyItinerary } from "@/lib/itinerary";

type SelectedHotelState = {
  confirmedBookings?: Array<{ booking_type?: string | null; booking_status?: string | null }> | null;
  priceDiscovery?: Record<string, unknown> | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function httpsUrl(value: unknown) {
  const raw = text(value);
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function bookingProviderUrl(value: unknown) {
  const href = httpsUrl(value);
  if (!href) return "";
  try {
    const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "booking.com" || hostname.endsWith(".booking.com") ? href : "";
  } catch {
    return "";
  }
}

function factualStatus(value: unknown): NonNullable<RoamlyBookingSuggestion["factual_status"]> {
  return value === "verified" || value === "search_ready" || value === "estimated" || value === "unknown" || value === "DISCOVERY_SUGGESTION"
    ? value
    : "unknown";
}

function hasConfirmedHotelBooking(state: SelectedHotelState) {
  const confirmedStatuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);
  return (state.confirmedBookings || []).some((booking) => booking.booking_type === "hotel" && confirmedStatuses.has((booking.booking_status || "").toLowerCase()));
}

function selectedHotelCandidate(state: SelectedHotelState) {
  const decision = record(record(state.priceDiscovery)?.groundedDecision);
  const selectedId = text(decision?.selectedHotelCandidateId);
  if (!selectedId || !Array.isArray(decision?.candidates)) return null;
  return decision.candidates
    .map(record)
    .find((candidate) => candidate && text(candidate.candidateId) === selectedId && text(candidate.category) === "hotel") || null;
}

function stripUntrustedProviderActions(itinerary: RoamlyItinerary): RoamlyItinerary {
  return {
    ...itinerary,
    booking_suggestions: itinerary.booking_suggestions.map((suggestion) =>
      suggestion.booking_category === "hotel" || suggestion.category === "hotel"
        ? { ...suggestion, provider_action_url: null, provider_action_origin: undefined }
        : suggestion
    )
  };
}

export function enforceSelectedHotelIdentity(itinerary: RoamlyItinerary, state: SelectedHotelState): RoamlyItinerary {
  const sanitized = stripUntrustedProviderActions(itinerary);
  if (hasConfirmedHotelBooking(state)) return sanitized;
  const candidate = selectedHotelCandidate(state);
  const candidateId = text(candidate?.candidateId);
  const name = text(candidate?.name);
  if (!candidate || !candidateId || !name) return sanitized;
  const source = text(candidate.source);
  const propertyId = text(candidate.providerPropertyId) || null;
  const status = factualStatus(candidate.factualStatus);
  const providerActionUrl = status === "verified" && candidate.sourceType === "provider_api" && /booking\.com demand api/i.test(source) ? bookingProviderUrl(candidate.deepLink) : "";
  const total = status === "verified" && typeof candidate.totalStayPrice === "number" && Number.isFinite(candidate.totalStayPrice) ? candidate.totalStayPrice : null;
  const currency = text(candidate.currency);
  const searchedAt = text(candidate.searchedAt);
  const expiresAt = text(candidate.expiresAt);
  const daily_itinerary = sanitized.daily_itinerary.map((day) => ({
    ...day,
    live_timeline: day.live_timeline.map((item) => {
      const raw = item as unknown as Record<string, unknown>;
      if (item.item_type !== "hotel" || raw.booking_id || raw.booking_status === "confirmed") return item;
      return { ...item, candidateId, source: source || item.source, factualStatus: status, title: name, location_name: text(candidate.address) || name, map_query: name, ...(total !== null ? { estimated_cost: total } : {}) };
    })
  }));
  const booking_suggestions = [...sanitized.booking_suggestions];
  const hotelIndex = booking_suggestions.findIndex((suggestion) => suggestion.booking_category === "hotel" || suggestion.category === "hotel");
  const existing = hotelIndex >= 0 ? booking_suggestions[hotelIndex] : null;
  const selectedSuggestion = {
    ...(existing || { category: "hotel" as const, booking_category: "hotel" as const, description: "Selected hotel from the grounded travel search.", booking_status: "suggested" as const, booking_label: "View hotel options", normal_search_url: "", estimated_cost_min: null, estimated_cost_max: null, currency: currency, price_confidence: "unknown" as const }),
    candidateId,
    provider_property_id: propertyId,
    provider_action_url: providerActionUrl || null,
    provider_action_origin: providerActionUrl ? "provider_response" as const : undefined,
    factual_status: status,
    title: name,
    provider: source || existing?.provider,
    provider_or_search_source: source || existing?.provider_or_search_source,
    ...(total !== null ? { estimated_cost_min: total, estimated_cost_max: total, estimated_total_cost_min: total, estimated_total_cost_max: total } : {}),
    ...(currency ? { currency } : {}),
    ...(searchedAt ? { searched_at: searchedAt } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(status === "verified" ? { price_confidence: "partner" as const, price_type: "live_partner" as const } : {})
  };
  if (hotelIndex >= 0) booking_suggestions[hotelIndex] = selectedSuggestion;
  else booking_suggestions.unshift(selectedSuggestion);
  return { ...itinerary, daily_itinerary, booking_suggestions };
}
