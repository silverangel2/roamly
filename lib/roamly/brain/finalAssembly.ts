import { ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE } from "@/lib/roamly/affiliateNeutrality";
import {
  ROAMLY_BRAIN_VERSION,
  dependentStagesForRegeneration,
  stagesInvalidatedBy,
  type BrainChangeType,
  type RoamlyBrainStageType
} from "@/lib/roamly/brain/stages";
import type { RoamlyGenerationLayer } from "@/lib/roamly/generationQueue";
import type { RoamlyItinerary, RoamlyBookingSuggestion } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export const ROAMLY_FINAL_ASSEMBLY_VERSION = "roamly-final-assembly-v1";

export type RoamlyTargetedItineraryChange =
  | "replace_activity"
  | "regenerate_day"
  | "change_transport"
  | "change_hotel"
  | "change_budget"
  | "change_pace"
  | "change_dates";

export type RoamlyVersionedFinalItinerary = {
  version: typeof ROAMLY_FINAL_ASSEMBLY_VERSION;
  brain_version: typeof ROAMLY_BRAIN_VERSION;
  assembled_at: string;
  trip_overview: {
    title: string;
    destination_summary: string;
    route_reasoning: string;
    booking_status_summary: string;
  };
  traveler_fit_summary: string;
  recommended_transportation: Record<string, unknown> | null;
  transportation_alternatives: unknown[];
  recommended_accommodation: Record<string, unknown> | null;
  accommodation_alternatives: unknown[];
  area_rationale: Record<string, unknown> | null;
  daily_itinerary: RoamlyItinerary["daily_itinerary"];
  travel_times: Array<Record<string, unknown>>;
  estimated_total_cost: {
    amount: number | null;
    currency: string;
    status: string | null;
  };
  cost_breakdown: RoamlyItinerary["estimated_budget_breakdown"];
  reservations: Array<Record<string, unknown>>;
  warnings: string[];
  backup_options: unknown[];
  booking_links: Array<Record<string, unknown>>;
  affiliate_disclosure: string;
  source_timestamps: Array<{
    layer_type: string;
    completed_at: string | null;
    retrieved_at: string | null;
    evidence_source: string | null;
  }>;
  why_trip_fits_traveler: string[];
  legacy_itinerary: RoamlyItinerary;
  structured_layers: Record<
    string,
    {
      status: string;
      generation_version: string;
      completed_at: string | null;
      output_json: Record<string, unknown>;
      evidence_json: Record<string, unknown>;
      dependency_versions_json: Record<string, unknown>;
    }
  >;
  supported_targeted_changes: RoamlyTargetedItineraryChange[];
};

function nowIso() {
  return new Date().toISOString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function layerByType(layers: RoamlyGenerationLayer[]) {
  return Object.fromEntries(layers.map((layer) => [layer.layer_type, layer])) as Record<string, RoamlyGenerationLayer | undefined>;
}

function recommendation(output: Record<string, unknown>) {
  return record(output.recommendation || record(output.output_json).recommendation);
}

function alternatives(output: Record<string, unknown>) {
  return array(output.alternatives || output.rejected_alternatives || output.transportation_alternatives || output.accommodation_alternatives);
}

function sourceTimestamp(layer: RoamlyGenerationLayer) {
  const evidence = record(layer.evidence_json);
  const output = record(layer.output_json);
  const outputEvidence = record(output.evidence);
  return {
    layer_type: layer.layer_type,
    completed_at: layer.completed_at,
    retrieved_at:
      clean(evidence.retrieved_at) ||
      clean(evidence.retrievedAt) ||
      clean(evidence.processedAt) ||
      clean(outputEvidence.retrieved_at) ||
      null,
    evidence_source: clean(evidence.source) || clean(outputEvidence.provider) || clean(outputEvidence.source) || null
  };
}

function structuredLayers(layers: RoamlyGenerationLayer[]) {
  return Object.fromEntries(
    layers.map((layer) => [
      layer.layer_type,
      {
        status: layer.status,
        generation_version: layer.generation_version,
        completed_at: layer.completed_at,
        output_json: record(layer.output_json),
        evidence_json: record(layer.evidence_json),
        dependency_versions_json: record(layer.dependency_versions_json)
      }
    ])
  );
}

function timelineBookingLinks(itinerary: RoamlyItinerary) {
  return itinerary.daily_itinerary.flatMap((day) =>
    day.live_timeline
      .filter((item) => item.booking?.url)
      .map((item) => ({
        day_number: day.day_number,
        title: item.title,
        provider: item.booking?.provider || null,
        url: item.booking?.url || null,
        cta_label: item.booking?.ctaLabel || item.booking_label || "Book",
        category: item.affiliate_category || item.category || null,
        disclosure_required: item.booking?.disclosureRequired === true
      }))
  );
}

function suggestionBookingLinks(suggestions: RoamlyBookingSuggestion[]) {
  return suggestions.map((suggestion) => ({
    title: suggestion.title,
    category: suggestion.category,
    provider: suggestion.affiliate_provider || suggestion.provider || suggestion.provider_or_search_source || null,
    source_url: suggestion.normal_search_url || null,
    affiliate_url: suggestion.affiliate_url || null,
    booking_label: suggestion.booking_label,
    price_min: suggestion.estimated_cost_min,
    price_max: suggestion.estimated_cost_max,
    currency: suggestion.currency,
    price_confidence: suggestion.price_confidence,
    searched_at: suggestion.searched_at || null,
    expires_at: suggestion.expires_at || null
  }));
}

function validationWarnings(layers: RoamlyGenerationLayer[]) {
  return layers
    .filter((layer) => ["itinerary_logistics_validation", "budget_validation", "schedule_validation"].includes(layer.layer_type))
    .flatMap((layer) => array(record(layer.output_json).findings))
    .map((finding) => record(finding))
    .map((finding) => clean(finding.message))
    .filter(Boolean);
}

function reservationWarnings(itinerary: RoamlyItinerary) {
  return itinerary.booking_suggestions
    .filter((suggestion) => suggestion.advance_booking_recommended || suggestion.booking_status === "needs_booking")
    .map((suggestion) => ({
      title: suggestion.title,
      category: suggestion.category,
      time_window: suggestion.time_window || null,
      booking_status: suggestion.booking_status,
      why_recommended: suggestion.why_recommended || null,
      source: suggestion.market_source || suggestion.provider_or_search_source || suggestion.provider || null
    }));
}

function travelTimes(itinerary: RoamlyItinerary) {
  return itinerary.daily_itinerary.flatMap((day) =>
    day.live_timeline
      .filter((item) => item.item_type === "travel" || item.item_type === "transfer" || item.travelTimeMinutes || item.durationMinutes)
      .map((item) => ({
        day_number: day.day_number,
        title: item.title,
        mode: item.travel_mode || item.transportMode || item.item_type || null,
        duration_minutes: item.travelTimeMinutes || item.durationMinutes || null,
        origin: item.origin || null,
        destination: item.destination || null,
        map_query: item.map_query || null
      }))
  );
}

function backupOptions(layers: RoamlyGenerationLayer[], itinerary: RoamlyItinerary) {
  const backupLayer = layers.find((layer) => layer.layer_type === "backup_plan_generation");
  const backupPlans = array(record(backupLayer?.output_json).backupPlans);
  if (backupPlans.length) return backupPlans;
  return itinerary.daily_itinerary.map((day) => ({
    day_number: day.day_number,
    backup_plan: `Keep ${day.title} flexible with indoor, nearby, or lower-cost alternates if weather, timing, or reservations change.`
  }));
}

function travelerFit(layers: RoamlyGenerationLayer[], itinerary: RoamlyItinerary) {
  const profile = record(layerByType(layers).traveler_profile?.output_json);
  const influence = array(profile.preferenceInfluence || record(profile.profile).preferenceInfluence);
  const fromInfluence = influence.map((item) => (typeof item === "string" ? item : clean(record(item).label || record(item).preference))).filter(Boolean);
  return [...itinerary.best_for, ...fromInfluence].slice(0, 10);
}

function totalCost(itinerary: RoamlyItinerary, payload?: TripPlannerPayload | null) {
  const budget = itinerary.estimated_budget_breakdown;
  const amount =
    typeof budget.total_estimate_amount === "number"
      ? budget.total_estimate_amount
      : typeof payload?.budgetAmount === "number"
        ? null
        : null;
  return {
    amount,
    currency: budget.currency || payload?.budgetCurrency || "CAD",
    status: budget.budget_status || null
  };
}

export function assembleFinalItinerary(params: {
  itinerary: RoamlyItinerary;
  layers: RoamlyGenerationLayer[];
  payload?: TripPlannerPayload | null;
  assembledAt?: string;
}): RoamlyVersionedFinalItinerary {
  const byType = layerByType(params.layers);
  const transportOutput = record(byType.transport_decision?.output_json);
  const accommodationOutput = record(byType.accommodation_decision?.output_json);
  const areaOutput = record(byType.accommodation_area_selection?.output_json);
  const fit = travelerFit(params.layers, params.itinerary);
  return {
    version: ROAMLY_FINAL_ASSEMBLY_VERSION,
    brain_version: ROAMLY_BRAIN_VERSION,
    assembled_at: params.assembledAt || nowIso(),
    trip_overview: {
      title: params.itinerary.trip_title,
      destination_summary: params.itinerary.destination_summary,
      route_reasoning: params.itinerary.route_reasoning,
      booking_status_summary: params.itinerary.booking_status_summary
    },
    traveler_fit_summary: params.itinerary.best_for.join(", ") || "Built around the saved trip requirements and traveler preferences.",
    recommended_transportation: recommendation(transportOutput) || null,
    transportation_alternatives: alternatives(transportOutput),
    recommended_accommodation: recommendation(accommodationOutput) || null,
    accommodation_alternatives: alternatives(accommodationOutput),
    area_rationale: record(areaOutput.selectedArea || areaOutput.selected_area || accommodationOutput.selected_area) || null,
    daily_itinerary: params.itinerary.daily_itinerary,
    travel_times: travelTimes(params.itinerary),
    estimated_total_cost: totalCost(params.itinerary, params.payload),
    cost_breakdown: params.itinerary.estimated_budget_breakdown,
    reservations: reservationWarnings(params.itinerary),
    warnings: [...params.itinerary.safety_notes, ...validationWarnings(params.layers)],
    backup_options: backupOptions(params.layers, params.itinerary),
    booking_links: [...suggestionBookingLinks(params.itinerary.booking_suggestions), ...timelineBookingLinks(params.itinerary)],
    affiliate_disclosure: ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE,
    source_timestamps: params.layers.map(sourceTimestamp),
    why_trip_fits_traveler: fit.length ? fit : ["Uses the saved trip dates, budget, pace, transportation, accommodation, and interest constraints."],
    legacy_itinerary: params.itinerary,
    structured_layers: structuredLayers(params.layers),
    supported_targeted_changes: [
      "replace_activity",
      "regenerate_day",
      "change_transport",
      "change_hotel",
      "change_budget",
      "change_pace",
      "change_dates"
    ]
  };
}

export function buildFinalAssemblyLayer(params: {
  itinerary: RoamlyItinerary;
  layers: RoamlyGenerationLayer[];
  payload?: TripPlannerPayload | null;
}) {
  const final = assembleFinalItinerary(params);
  return {
    layer_type: "final_assembly" as const,
    output_json: {
      version: final.version,
      itinerary: final,
      sourceTimestamps: final.source_timestamps,
      legacy_itinerary: params.itinerary
    },
    evidence_json: {
      source: "roamly_brain_final_assembly",
      assembled_at: final.assembled_at,
      affiliate_disclosure: ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE,
      preserved_structured_layers: true,
      legacy_itinerary_compatible: true
    },
    dependency_versions_json: Object.fromEntries(
      params.layers
        .filter((layer) => layer.status === "completed")
        .map((layer) => [layer.layer_type, `${layer.generation_version}:${layer.completed_at || "not-completed"}`])
    )
  };
}

function changeToBrainChange(change: RoamlyTargetedItineraryChange): BrainChangeType {
  if (change === "change_dates") return "travel_dates";
  if (change === "change_hotel") return "hotel";
  if (change === "change_transport") return "transport";
  if (change === "change_budget") return "budget";
  if (change === "change_pace") return "pace";
  return "activity";
}

export function targetedItineraryChangePlan(params: {
  change: RoamlyTargetedItineraryChange;
  dayNumber?: number | null;
  activityId?: string | null;
}) {
  const changeType = changeToBrainChange(params.change);
  const stageSet = new Set<RoamlyBrainStageType>(stagesInvalidatedBy(changeType));
  if (params.change === "replace_activity" || params.change === "regenerate_day") {
    stageSet.clear();
    ["daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "backup_plan_generation", "final_assembly"].forEach(
      (stage) => stageSet.add(stage as RoamlyBrainStageType)
    );
  }
  if (params.change === "change_transport") {
    dependentStagesForRegeneration("transport_decision").forEach((stage) => stageSet.add(stage));
  }
  if (params.change === "change_hotel") {
    dependentStagesForRegeneration("accommodation_decision").forEach((stage) => stageSet.add(stage));
  }
  return {
    change: params.change,
    change_type: changeType,
    day_number: params.dayNumber ?? null,
    activity_id: params.activityId ?? null,
    invalidates: Array.from(stageSet).sort((a, b) => {
      const order = [
        "traveler_profile",
        "trip_requirements",
        "destination_research",
        "transport_search",
        "transport_decision",
        "destination_structure",
        "accommodation_area_selection",
        "accommodation_search",
        "accommodation_decision",
        "daily_itinerary_generation",
        "itinerary_logistics_validation",
        "budget_validation",
        "schedule_validation",
        "backup_plan_generation",
        "final_assembly",
        "completion_notification"
      ];
      return order.indexOf(a) - order.indexOf(b);
    }),
    rule: "Only dependent layers are invalidated; completed unrelated layers are preserved."
  };
}
