import { randomUUID } from "node:crypto";
import type { RoamlyActivitySeed, RoamlyDayPlan, RoamlyItinerary } from "@/lib/itinerary";

export const PLANNING_REPAIR_OPERATION = "REMOVE_OPTIONAL_ACTIVITY" as const;
export type PlanningRepairOperation = typeof PLANNING_REPAIR_OPERATION;

export type Repairability = "REPAIRABLE" | "NOT_REPAIRABLE" | "UNCERTAIN";

export type RepairTarget = {
  dayId: string;
  dayNumber: number;
  conflictId: string;
  itemId: string;
  title: string;
  reason: "INFEASIBLE_OPTIONAL_ITEM";
};

export type RepairPreview = {
  operation: PlanningRepairOperation;
  conflictId: string;
  dayId: string;
  targetItemId: string;
  protected: string[];
  change: string;
  result: "FEASIBLE" | "INFEASIBLE" | "UNCERTAIN";
};

export type RepairProposalDraft = RepairPreview & {
  repairability: Repairability;
  beforeSnapshot: { dayId: string; conflictId: string; item: RoamlyActivitySeed };
};

export type RepairVerificationState =
  | "APPLIED_RESOLVED"
  | "APPLIED_STILL_INFEASIBLE"
  | "APPLIED_UNCERTAIN";

const protectedBookingStatuses = new Set([
  "confirmed",
  "completed",
  "detected",
  "needs_confirmation",
  "modified",
  "cancelled",
  "refunded",
  "user_uploaded"
]);

function linkedCandidateId(item: RoamlyActivitySeed) {
  return typeof item.candidateId === "string" && item.candidateId.trim() ? item.candidateId.trim() : null;
}

function suggestionCandidateId(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return typeof suggestion.candidateId === "string" && suggestion.candidateId.trim() ? suggestion.candidateId.trim() : null;
}

function suggestionHasBookingIdentity(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const record = suggestion as unknown as Record<string, unknown>;
  return typeof record.booking_id === "string" && record.booking_id.trim().length > 0;
}

function suggestionStatus(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return typeof suggestion.booking_status === "string" ? suggestion.booking_status.trim().toLowerCase() : "";
}

function linkedSuggestionIsProtected(
  itinerary: RoamlyItinerary,
  item: RoamlyActivitySeed
) {
  const candidateId = linkedCandidateId(item);
  if (!candidateId) return false;
  return itinerary.booking_suggestions.some((suggestion) => {
    if (suggestionCandidateId(suggestion) !== candidateId) return false;
    return suggestionHasBookingIdentity(suggestion) || protectedBookingStatuses.has(suggestionStatus(suggestion));
  });
}

/**
 * Removes only an exact candidate-linked, still-unbooked recommendation.
 * Referral/pending/confirmed evidence remains in the itinerary/history.
 * Aggregate budget fields are intentionally preserved because the current
 * schema has no per-expense identity from which a safe subtraction can be
 * derived.
 */
export function reconcileRemovedOptionalActivityDerivedState(
  itinerary: RoamlyItinerary,
  item: RoamlyActivitySeed
) {
  const candidateId = linkedCandidateId(item);
  if (!candidateId) return { itinerary, removedSuggestionCount: 0 };
  const before = itinerary.booking_suggestions.length;
  const booking_suggestions = itinerary.booking_suggestions.filter((suggestion) => {
    if (suggestionCandidateId(suggestion) !== candidateId) return true;
    if (suggestionHasBookingIdentity(suggestion)) return true;
    return !["suggested", "needs_booking"].includes(suggestionStatus(suggestion));
  });
  return {
    itinerary: { ...itinerary, booking_suggestions },
    removedSuggestionCount: before - booking_suggestions.length
  };
}

export function assignStableItineraryIdentities(
  itinerary: RoamlyItinerary,
  idFactory: () => string = randomUUID
): RoamlyItinerary {
  return {
    ...itinerary,
    daily_itinerary: itinerary.daily_itinerary.map((day) => ({
      ...day,
      day_id: day.day_id || idFactory(),
      conflict_id: day.plan_status === "conflict" ? (day.conflict_id || idFactory()) : day.conflict_id,
      live_timeline: day.live_timeline.map((item) => ({
        ...item,
        item_id: item.item_id || idFactory(),
        conflict_id: item.routing_status === "INFEASIBLE" ? (item.conflict_id || idFactory()) : item.conflict_id
      }))
    }))
  };
}

function titleMatchesFlexible(day: RoamlyDayPlan, item: RoamlyActivitySeed) {
  // A title-only match is ambiguous and cannot authorize a persisted repair.
  return item.plan_role === "supporting" || item.plan_role === "alternative";
}

function isProtected(item: RoamlyActivitySeed) {
  return Boolean(
    item.must_do ||
      item.plan_role === "protected_anchor" ||
      item.plan_role === "must_do" ||
      item.booking ||
      String(item.item_type) === "flight" ||
      item.item_type === "hotel" ||
      item.item_type === "booking"
  );
}

export function findRepairTarget(
  itinerary: RoamlyItinerary,
  conflictId: string,
  itemId: string
): { repairability: Repairability; target?: RepairTarget; item?: RoamlyActivitySeed; day?: RoamlyDayPlan } {
  const day = itinerary.daily_itinerary.find((candidate) =>
    candidate.conflict_id === conflictId || candidate.live_timeline.some((item) => item.conflict_id === conflictId)
  );
  if (!day || day.plan_status !== "conflict" || !day.day_id) return { repairability: "NOT_REPAIRABLE" };
  const item = day.live_timeline.find((candidate) => candidate.item_id === itemId);
  if (!item) return { repairability: "NOT_REPAIRABLE" };
  if (item.conflict_id !== conflictId) return { repairability: "NOT_REPAIRABLE", item, day };
  if (isProtected(item)) return { repairability: "NOT_REPAIRABLE", item, day };
  if (linkedSuggestionIsProtected(itinerary, item)) return { repairability: "NOT_REPAIRABLE", item, day };
  if (item.routing_status !== "INFEASIBLE") return { repairability: "UNCERTAIN", item, day };
  if (!titleMatchesFlexible(day, item)) return { repairability: "NOT_REPAIRABLE", item, day };
  return {
    repairability: "REPAIRABLE",
    item,
    day,
    target: {
      dayId: day.day_id,
      dayNumber: day.day_number,
      conflictId,
      itemId,
      title: item.title,
      reason: "INFEASIBLE_OPTIONAL_ITEM"
    }
  };
}

export function removeOptionalActivity(
  itinerary: RoamlyItinerary,
  target: Pick<RepairTarget, "dayId" | "conflictId" | "itemId">
): RoamlyItinerary {
  const match = findRepairTarget(itinerary, target.conflictId, target.itemId);
  if (match.repairability !== "REPAIRABLE" || match.target?.dayId !== target.dayId) {
    throw new Error("REPAIR_TARGET_NOT_ALLOWED");
  }
  const matchingItems = itinerary.daily_itinerary
    .find((day) => day.day_id === target.dayId)
    ?.live_timeline.filter((item) => item.item_id === target.itemId) || [];
  if (matchingItems.length !== 1) throw new Error("REPAIR_TARGET_ID_NOT_UNIQUE");
  const removed = {
    ...itinerary,
    daily_itinerary: itinerary.daily_itinerary.map((day) =>
      day.day_id !== target.dayId
        ? day
        : { ...day, live_timeline: day.live_timeline.filter((item) => item.item_id !== target.itemId) }
    )
  };
  return reconcileRemovedOptionalActivityDerivedState(removed, matchingItems[0]).itinerary;
}

export function verifyAppliedRepair(params: {
  itinerary: RoamlyItinerary;
  dayId: string;
  conflictId: string;
  targetItemId: string;
  validationOk: boolean;
}): RepairVerificationState {
  const day = params.itinerary.daily_itinerary.find((candidate) => candidate.day_id === params.dayId);
  if (!day) return "APPLIED_UNCERTAIN";
  const target = day.live_timeline.filter((item) => item.item_id === params.targetItemId);
  if (target.length > 0) {
    return target.some((item) => item.routing_status === "INFEASIBLE")
      ? "APPLIED_STILL_INFEASIBLE"
      : "APPLIED_UNCERTAIN";
  }
  const remainingConflictItems = day.live_timeline.filter((item) => item.conflict_id === params.conflictId);
  if (remainingConflictItems.some((item) => item.routing_status === "INFEASIBLE")) return "APPLIED_STILL_INFEASIBLE";
  if (remainingConflictItems.some((item) => item.routing_status === "UNCERTAIN")) return "APPLIED_UNCERTAIN";
  if (day.plan_status === "conflict") return "APPLIED_STILL_INFEASIBLE";
  if (day.plan_status === "uncertain" || !params.validationOk) return "APPLIED_UNCERTAIN";
  return "APPLIED_RESOLVED";
}

export function buildRepairProposalDraft(
  itinerary: RoamlyItinerary,
  conflictId: string,
  itemId: string,
  result: RepairPreview["result"]
): RepairProposalDraft {
  const match = findRepairTarget(itinerary, conflictId, itemId);
  if (match.repairability !== "REPAIRABLE" || !match.target || !match.item) {
    return {
      repairability: match.repairability,
      operation: PLANNING_REPAIR_OPERATION,
      conflictId,
      dayId: match.day?.day_id || "",
      targetItemId: itemId,
      protected: match.item?.title ? [match.item.title] : [],
      change: "No safe customer repair is available for this item.",
      result,
      beforeSnapshot: { dayId: match.day?.day_id || "", conflictId, item: match.item || ({} as RoamlyActivitySeed) }
    };
  }
  return {
    repairability: "REPAIRABLE",
    operation: PLANNING_REPAIR_OPERATION,
    conflictId,
    dayId: match.target.dayId,
    targetItemId: match.target.itemId,
    protected: itinerary.daily_itinerary
      .find((day) => day.day_id === match.target?.dayId)
      ?.live_timeline.filter((item) => isProtected(item))
      .map((item) => item.title) || [],
    change: `Remove ${match.target.title} from day ${match.target.dayNumber}.`,
    result,
    beforeSnapshot: { dayId: match.target.dayId, conflictId, item: match.item }
  };
}
