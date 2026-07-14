import { buildTransportationIntelligence, type TransportationDecision } from "@/lib/roamly/transportationIntelligence";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";
import type { TravelerProfile } from "@/lib/roamly/travelerMemory";

function preferenceList(profile?: TravelerProfile | null) {
  if (!profile || profile.personalization_enabled === false) return [];
  return profile.transportation_preferences || [];
}

export function buildTransportSearchLayer(params: {
  payload: TripPlannerPayload;
  marketResults?: TravelMarketResult[] | null;
  travelerProfile?: TravelerProfile | null;
}) {
  const decision = buildTransportationIntelligence(params.payload, {
    marketResults: params.marketResults,
    maximumComfortableDrivingHours: params.travelerProfile?.maximum_comfortable_driving_hours,
    transportationPreferences: preferenceList(params.travelerProfile)
  });

  return {
    candidates: decision.candidates,
    unavailableProviders: decision.candidates
      .filter((candidate) => candidate.data_freshness === "unavailable")
      .map((candidate) => ({
        provider: candidate.provider,
        mode: candidate.mode,
        warning: candidate.warnings[0] || "Provider unavailable."
      })),
    evidence: decision.evidence
  };
}

export function buildTransportDecisionLayer(params: {
  payload: TripPlannerPayload;
  marketResults?: TravelMarketResult[] | null;
  travelerProfile?: TravelerProfile | null;
}): TransportationDecision {
  return buildTransportationIntelligence(params.payload, {
    marketResults: params.marketResults,
    maximumComfortableDrivingHours: params.travelerProfile?.maximum_comfortable_driving_hours,
    transportationPreferences: preferenceList(params.travelerProfile)
  });
}
