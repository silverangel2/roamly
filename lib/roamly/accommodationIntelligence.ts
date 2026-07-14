import { buildHotelAffiliateUrl } from "@/lib/roamly/affiliateLinks";
import { buildHotelSearchUrl, safeExternalUrl } from "@/lib/roamly/bookingLinks";
import type { TravelerProfile } from "@/lib/roamly/travelerMemory";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type AccommodationFreshness = "live" | "cached_recent" | "search_ready" | "estimated" | "unavailable";

export type AccommodationAreaCandidate = {
  area: string;
  rationale: string;
  score_components: {
    activity_access: number;
    arrival_access: number;
    transit_access: number;
    walking_fit: number;
    noise_fit: number;
    parking_fit: number;
    preference_fit: number;
    total: number;
  };
  warnings: string[];
};

export type AccommodationCandidate = {
  provider: string;
  listing_identifier: string | null;
  title: string;
  source_url: string | null;
  affiliate_url: string | null;
  retrieved_at: string;
  availability_at: string | null;
  price: number | null;
  currency: string;
  taxes_and_fees: number | null;
  neighbourhood: string;
  coordinates: { latitude: number; longitude: number } | null;
  review_evidence: {
    score: number | null;
    count: number | null;
    recent_complaints: string[];
  };
  booking_conditions: {
    cancellation_policy: string | null;
    payment_timing: string | null;
    check_in_time: string | null;
    luggage_storage: string | null;
  };
  score_components: {
    traveler_fit: number;
    location: number;
    total_price: number;
    review_quality: number;
    convenience: number;
    cancellation_flexibility: number;
    amenities: number;
    affiliate_value: 0;
    total: number;
  };
  warnings: string[];
  data_freshness: AccommodationFreshness;
};

export type AccommodationDecision = {
  selected_area: AccommodationAreaCandidate;
  area_alternatives: AccommodationAreaCandidate[];
  recommendation: AccommodationCandidate | null;
  alternatives: AccommodationCandidate[];
  why_it_wins: string;
  requires_route_revalidation: boolean;
  evidence: {
    retrieved_at: string;
    provider_sources: string[];
    disclosure: string;
  };
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function list(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function destination(payload: TripPlannerPayload) {
  return clean(payload.destinationCity) || clean(payload.destination) || "your destination";
}

function currency(payload: TripPlannerPayload) {
  return clean(payload.budgetCurrency).toUpperCase() || "CAD";
}

function nights(payload: TripPlannerPayload) {
  return Math.max(1, Math.round((payload.daysCount || 3) - 1));
}

function roomType(payload: TripPlannerPayload) {
  const text = `${payload.bedPreference || ""} ${payload.accommodationPreference || ""}`.toLowerCase();
  if (text.includes("hostel")) return "Hostel or simple private room";
  if (text.includes("apartment")) return "Apartment-style stay";
  if (text.includes("luxury")) return "Upper-upscale hotel room";
  if (text.includes("budget")) return "Budget private room";
  return "Standard hotel room";
}

function travelerPreferenceText(profile?: TravelerProfile | null) {
  if (!profile || profile.personalization_enabled === false) return "";
  return [
    profile.preferred_neighbourhood_style,
    ...profile.hotel_priorities,
    ...profile.accommodation_types,
    ...profile.room_preferences
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function areaScore(area: string, payload: TripPlannerPayload, profile?: TravelerProfile | null) {
  const pref = travelerPreferenceText(profile);
  const areaText = area.toLowerCase();
  const wantsNightlife = pref.includes("nightlife") || `${payload.interests.join(" ")}`.toLowerCase().includes("nightlife");
  const wantsQuiet = pref.includes("quiet") || pref.includes("calm");
  const wantsParking = pref.includes("parking") || payload.transportationPreference?.toLowerCase().includes("drive");
  const activityAccess = areaText.includes("central") ? 84 : areaText.includes("transit") ? 76 : 68;
  const arrivalAccess = areaText.includes("station") || areaText.includes("transit") ? 82 : 70;
  const transitAccess = areaText.includes("transit") || areaText.includes("central") ? 86 : 62;
  const walkingFit = profile?.walking_tolerance?.toLowerCase().includes("low") ? (areaText.includes("central") ? 86 : 60) : 78;
  const noiseFit = wantsQuiet ? (areaText.includes("quiet") ? 88 : 54) : wantsNightlife ? (areaText.includes("central") ? 80 : 64) : 72;
  const parkingFit = wantsParking ? (areaText.includes("parking") || areaText.includes("quiet") ? 82 : 55) : 72;
  const preferenceFit = pref && areaText.split(/\s+/).some((token) => pref.includes(token)) ? 88 : 68;
  const total = Math.round(
    activityAccess * 0.22 +
      arrivalAccess * 0.16 +
      transitAccess * 0.18 +
      walkingFit * 0.14 +
      noiseFit * 0.12 +
      parkingFit * 0.08 +
      preferenceFit * 0.1
  );
  return {
    activity_access: activityAccess,
    arrival_access: arrivalAccess,
    transit_access: transitAccess,
    walking_fit: walkingFit,
    noise_fit: noiseFit,
    parking_fit: parkingFit,
    preference_fit: preferenceFit,
    total
  };
}

export function selectAccommodationArea(payload: TripPlannerPayload, profile?: TravelerProfile | null) {
  const city = destination(payload);
  const preferredStyle = clean(profile?.preferred_neighbourhood_style);
  const candidates = [
    `Central ${city}`,
    `${city} transit-connected area`,
    preferredStyle ? `${preferredStyle} area in ${city}` : `Quieter ${city} base with better parking`
  ].map((area) => {
    const score = areaScore(area, payload, profile);
    return {
      area,
      rationale:
        area.includes("Central")
          ? "Keeps first-time activity clusters and meals close together."
          : area.includes("transit")
            ? "Balances value with station and public-transit access."
            : "Useful when noise, parking, or neighbourhood style matters more than being central.",
      score_components: score,
      warnings: area.includes("Central") ? ["Central areas can be noisier and pricier; verify room noise reviews."] : []
    } satisfies AccommodationAreaCandidate;
  });
  return [...candidates].sort((a, b) => b.score_components.total - a.score_components.total);
}

function marketHotelCandidates(params: {
  payload: TripPlannerPayload;
  area: string;
  marketResults?: TravelMarketResult[] | null;
  retrievedAt: string;
}) {
  return (params.marketResults || [])
    .filter((result) => result.category === "hotel")
    .slice(0, 8)
    .map((result) => {
      const price = result.price_amount ?? result.price_max ?? result.price_min ?? null;
      return {
        provider: result.provider || result.source || "Hotel market result",
        listing_identifier: result.id,
        title: result.title,
        source_url: safeExternalUrl(result.normal_search_url) || safeExternalUrl(result.booking_url) || null,
        affiliate_url: safeExternalUrl(result.affiliate_url) || safeExternalUrl(result.booking_url) || null,
        retrieved_at: result.searched_at || params.retrievedAt,
        availability_at: result.price_type === "live_partner" || result.price_type === "cached_recent" ? result.searched_at : null,
        price,
        currency: result.currency || currency(params.payload),
        taxes_and_fees: null,
        neighbourhood: result.city || params.area,
        coordinates: null,
        review_evidence: { score: null, count: null, recent_complaints: [] },
        booking_conditions: {
          cancellation_policy: null,
          payment_timing: null,
          check_in_time: null,
          luggage_storage: null
        },
        warnings: [
          result.price_type === "live_partner" || result.price_type === "cached_recent"
            ? "Verify taxes, fees, cancellation, reviews, and exact room details before booking."
            : "Search-ready hotel result. Roamly does not treat this as live availability."
        ],
        data_freshness:
          result.price_type === "live_partner"
            ? "live"
            : result.price_type === "cached_recent"
              ? "cached_recent"
              : result.price_type === "search_ready"
                ? "search_ready"
                : "estimated"
      } satisfies Omit<AccommodationCandidate, "score_components">;
    });
}

function searchReadyCandidate(payload: TripPlannerPayload, area: string, retrievedAt: string) {
  const affiliate = buildHotelAffiliateUrl({
    destination: destination(payload),
    startDate: payload.startDate,
    endDate: payload.endDate,
    adults: payload.travelers?.adults || payload.travelersCount || 1,
    children: payload.travelers?.children || 0,
    rooms: payload.rooms || 1,
    neighborhood: area,
    roomType: roomType(payload)
  });
  return {
    provider: affiliate.affiliate_enabled ? "Stay22 hotel search" : "Hotel search unavailable",
    listing_identifier: null,
    title: `${roomType(payload)} near ${area}`,
    source_url:
      buildHotelSearchUrl({
        destination: destination(payload),
        checkInDate: payload.startDate,
        checkOutDate: payload.endDate,
        adults: payload.travelers?.adults || payload.travelersCount || 1,
        children: payload.travelers?.children || 0,
        rooms: payload.rooms || 1,
        neighborhood: area,
        roomType: roomType(payload)
      }) || null,
    affiliate_url: affiliate.affiliate_enabled ? affiliate.href : null,
    retrieved_at: retrievedAt,
    availability_at: null,
    price: null,
    currency: currency(payload),
    taxes_and_fees: null,
    neighbourhood: area,
    coordinates: null,
    review_evidence: { score: null, count: null, recent_complaints: [] },
    booking_conditions: {
      cancellation_policy: null,
      payment_timing: null,
      check_in_time: null,
      luggage_storage: null
    },
    warnings: ["Search-ready accommodation option only. Roamly will not invent live price, review score, taxes, or availability."],
    data_freshness: "search_ready"
  } satisfies Omit<AccommodationCandidate, "score_components">;
}

function scoreCandidate(candidate: Omit<AccommodationCandidate, "score_components">, area: AccommodationAreaCandidate, profile?: TravelerProfile | null) {
  const prefs = travelerPreferenceText(profile);
  const travelerFit = prefs && `${candidate.title} ${candidate.neighbourhood}`.toLowerCase().split(/\s+/).some((token) => prefs.includes(token)) ? 88 : 68;
  const location = area.score_components.total;
  const totalPrice = candidate.price == null ? 55 : Math.max(35, 95 - Math.min(60, candidate.price / 20));
  const reviewQuality = candidate.review_evidence.score ? Math.min(100, Math.round(candidate.review_evidence.score * 20)) : 55;
  const convenience = candidate.booking_conditions.luggage_storage ? 82 : candidate.data_freshness === "live" ? 76 : 62;
  const cancellation = candidate.booking_conditions.cancellation_policy ? 78 : 55;
  const amenities = list(profile?.hotel_priorities).some((priority) => candidate.title.toLowerCase().includes(priority.toLowerCase())) ? 78 : 60;
  const total = Math.round(
    travelerFit * 0.25 +
      location * 0.2 +
      totalPrice * 0.15 +
      reviewQuality * 0.15 +
      convenience * 0.1 +
      cancellation * 0.1 +
      amenities * 0.05
  );
  return {
    traveler_fit: Math.round(travelerFit),
    location: Math.round(location),
    total_price: Math.round(totalPrice),
    review_quality: Math.round(reviewQuality),
    convenience: Math.round(convenience),
    cancellation_flexibility: Math.round(cancellation),
    amenities: Math.round(amenities),
    affiliate_value: 0 as const,
    total
  };
}

export function buildAccommodationIntelligence(params: {
  payload: TripPlannerPayload;
  marketResults?: TravelMarketResult[] | null;
  travelerProfile?: TravelerProfile | null;
}): AccommodationDecision {
  const retrievedAt = new Date().toISOString();
  const areas = selectAccommodationArea(params.payload, params.travelerProfile);
  const selectedArea = areas[0];
  const rawCandidates = marketHotelCandidates({
    payload: params.payload,
    area: selectedArea.area,
    marketResults: params.marketResults,
    retrievedAt
  });
  const candidates = (rawCandidates.length ? rawCandidates : [searchReadyCandidate(params.payload, selectedArea.area, retrievedAt)]).map((candidate) => ({
    ...candidate,
    neighbourhood: candidate.neighbourhood || selectedArea.area,
    score_components: scoreCandidate(candidate, selectedArea, params.travelerProfile)
  }));
  const sorted = [...candidates].sort((a, b) => b.score_components.total - a.score_components.total);
  const recommendation = sorted[0] || null;

  return {
    selected_area: selectedArea,
    area_alternatives: areas.slice(1),
    recommendation,
    alternatives: sorted.slice(1),
    why_it_wins: recommendation
      ? `${recommendation.title} best fits the selected base area after location, traveler fit, price, reviews, convenience, cancellation, and amenities were compared.`
      : "No accommodation recommendation is available until hotel search data is available.",
    requires_route_revalidation: true,
    evidence: {
      retrieved_at: retrievedAt,
      provider_sources: Array.from(new Set(candidates.map((candidate) => candidate.provider))),
      disclosure: "Roamly may earn a commission from some booking links. Recommendations are ranked according to your trip needs, not commission."
    }
  };
}
