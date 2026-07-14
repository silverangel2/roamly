import {
  buildAccommodationIntelligence,
  selectAccommodationArea,
  type AccommodationDecision
} from "@/lib/roamly/accommodationIntelligence";
import type { TravelerProfile } from "@/lib/roamly/travelerMemory";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export function buildAccommodationAreaSelectionLayer(params: {
  payload: TripPlannerPayload;
  travelerProfile?: TravelerProfile | null;
}) {
  const areas = selectAccommodationArea(params.payload, params.travelerProfile);
  return {
    selectedArea: areas[0],
    areaAlternatives: areas.slice(1),
    scoreBreakdown: areas[0]?.score_components || {},
    evidence: {
      provider: "roamly_area_scoring",
      requiresRouteRevalidationAfterHotelSelection: true
    }
  };
}

export function buildAccommodationSearchLayer(params: {
  payload: TripPlannerPayload;
  marketResults?: TravelMarketResult[] | null;
  travelerProfile?: TravelerProfile | null;
}) {
  const decision = buildAccommodationIntelligence(params);
  return {
    candidates: [decision.recommendation, ...decision.alternatives].filter(Boolean),
    unavailableProviders: decision.evidence.provider_sources.filter((source) => source.toLowerCase().includes("unavailable")),
    selectedArea: decision.selected_area,
    evidence: decision.evidence
  };
}

export function buildAccommodationDecisionLayer(params: {
  payload: TripPlannerPayload;
  marketResults?: TravelMarketResult[] | null;
  travelerProfile?: TravelerProfile | null;
}): AccommodationDecision {
  return buildAccommodationIntelligence(params);
}
