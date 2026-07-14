import {
  buildBudgetValidationLayer,
  buildItineraryLogisticsValidationLayer,
  buildScheduleValidationLayer,
  validateAndRepairItinerary,
  validationFindingsToInvalidatedStages,
  type ItineraryValidationResult
} from "@/lib/roamly/itineraryValidation";
import type { RoamlyGenerationLayer } from "@/lib/roamly/generationQueue";
import type { RoamlyBrainStageType } from "@/lib/roamly/brain/stages";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type BrainValidationStageType = Extract<
  RoamlyBrainStageType,
  "itinerary_logistics_validation" | "budget_validation" | "schedule_validation"
>;

export function buildBrainValidationLayer(params: {
  stageType: BrainValidationStageType;
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
  layers?: RoamlyGenerationLayer[];
}) {
  if (params.stageType === "itinerary_logistics_validation") {
    return buildItineraryLogisticsValidationLayer(params);
  }
  if (params.stageType === "budget_validation") {
    return buildBudgetValidationLayer(params);
  }
  return buildScheduleValidationLayer(params);
}

export function validationRequiresTargetedRegeneration(result: ItineraryValidationResult) {
  return {
    requires_regeneration: result.requires_regeneration,
    invalidates: validationFindingsToInvalidatedStages(result.findings),
    regeneration_rule: "invalidate and rerun only the relevant Brain layer"
  };
}

export { validateAndRepairItinerary };
