import {
  repairItineraryForTravelRequirements,
  validateItineraryForProduction,
  type RoamlyActivitySeed,
  type RoamlyDayPlan,
  type RoamlyItinerary
} from "@/lib/itinerary";
import type { RoamlyBrainStageType } from "@/lib/roamly/brain/stages";
import type { RoamlyGenerationLayer } from "@/lib/roamly/generationQueue";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export const ROAMLY_VALIDATION_LAYER_VERSION = "roamly-validation-v1";

export type ItineraryValidationCode =
  | "overlapping_activities"
  | "impossible_travel_time"
  | "closed_attraction"
  | "insufficient_transfer_time"
  | "missed_check_in_window"
  | "departure_conflict"
  | "budget_overrun"
  | "duplicate_activity"
  | "excessive_walking"
  | "excessive_driving"
  | "missing_meal_time"
  | "missing_rest"
  | "timezone_error"
  | "date_error"
  | "stale_market_data"
  | "missing_reservation_warning"
  | "mixed_currencies"
  | "dependency_mismatch"
  | "hotel_route_inconsistency"
  | "transport_itinerary_inconsistency"
  | "production_validation";

export type ItineraryValidationSeverity = "info" | "warning" | "error";

export type ItineraryValidationFinding = {
  code: ItineraryValidationCode;
  severity: ItineraryValidationSeverity;
  message: string;
  dayNumber?: number | null;
  layerType?: RoamlyBrainStageType | string | null;
  repairable: boolean;
  invalidates: RoamlyBrainStageType[];
  evidence?: Record<string, unknown>;
};

export type ItineraryValidationRepair = {
  code: "arrival_departure_repair" | "meal_note_added" | "rest_note_added" | "travel_transfer_repair";
  message: string;
  dayNumber?: number | null;
};

export type ItineraryValidationResult = {
  version: typeof ROAMLY_VALIDATION_LAYER_VERSION;
  ok: boolean;
  checked_at: string;
  findings: ItineraryValidationFinding[];
  repairs: ItineraryValidationRepair[];
  repaired_itinerary?: RoamlyItinerary | null;
  requires_regeneration: boolean;
  invalidates: RoamlyBrainStageType[];
};

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dayText(day: RoamlyDayPlan) {
  return [day.title, day.morning, day.afternoon, day.evening, day.food.join(" "), ...day.live_timeline.map((item) => `${item.category} ${item.title} ${item.description}`)]
    .join(" ")
    .toLowerCase();
}

function itemText(item: RoamlyActivitySeed) {
  return `${item.item_type || ""} ${item.category || ""} ${item.title || ""} ${item.description || ""} ${item.location_name || ""}`.toLowerCase();
}

function itemKind(item: RoamlyActivitySeed) {
  const raw = item.item_type || "";
  if (raw) return raw;
  const value = itemText(item);
  if (/\bmeal|breakfast|lunch|dinner|restaurant|cafe\b/.test(value)) return "meal";
  if (/\brest|break|buffer|recover\b/.test(value)) return "rest";
  if (/\btransfer|taxi|rideshare|transit|walk\b/.test(value)) return "transfer";
  if (/\bflight|train|bus|ferry|drive|airport|station|depart|arrival\b/.test(value)) return "travel";
  if (/\bhotel|check[- ]?in|check[- ]?out|luggage\b/.test(value)) return "hotel";
  return "activity";
}

function isMajorItem(item: RoamlyActivitySeed) {
  const kind = itemKind(item);
  return kind === "activity" || kind === "hotel" || kind === "travel";
}

function parseClock(value?: string | null) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  const suffix = (match[3] || "").toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function itemStart(item: RoamlyActivitySeed) {
  return parseClock(item.startTime || item.time_label);
}

function itemEnd(item: RoamlyActivitySeed) {
  const explicit = parseClock(item.endTime);
  if (explicit != null) return explicit;
  const start = itemStart(item);
  if (start == null) return null;
  return start + Math.max(15, item.durationMinutes || item.travelTimeMinutes || 60);
}

function addFinding(findings: ItineraryValidationFinding[], finding: ItineraryValidationFinding) {
  findings.push(finding);
}

function transportInvalidation(): RoamlyBrainStageType[] {
  return ["daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "final_assembly"];
}

function accommodationInvalidation(): RoamlyBrainStageType[] {
  return ["daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "final_assembly"];
}

function scheduleInvalidation(): RoamlyBrainStageType[] {
  return ["daily_itinerary_generation", "itinerary_logistics_validation", "schedule_validation", "backup_plan_generation", "final_assembly"];
}

function budgetInvalidation(): RoamlyBrainStageType[] {
  return ["budget_validation", "backup_plan_generation", "final_assembly"];
}

function uniqueStages(stages: RoamlyBrainStageType[]) {
  return Array.from(new Set(stages));
}

function expectedDate(payload: TripPlannerPayload, dayNumber: number) {
  if (!payload.startDate) return "";
  const date = new Date(`${payload.startDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

function daysBetweenNow(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return (Date.now() - parsed.getTime()) / 86_400_000;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function validateTimeline(day: RoamlyDayPlan, findings: ItineraryValidationFinding[]) {
  const timeline = [...day.live_timeline].sort((left, right) => (itemStart(left) ?? 9999) - (itemStart(right) ?? 9999));
  let previous: { item: RoamlyActivitySeed; end: number } | null = null;
  let previousMajorIndex = -1;

  timeline.forEach((item, index) => {
    const start = itemStart(item);
    const end = itemEnd(item);
    const kind = itemKind(item);
    const body = itemText(item);

    if (start != null && end != null && previous && start < previous.end) {
      addFinding(findings, {
        code: "overlapping_activities",
        severity: "error",
        message: `Day ${day.day_number} has overlapping activities around ${item.title}.`,
        dayNumber: day.day_number,
        repairable: false,
        invalidates: scheduleInvalidation(),
        evidence: { previous: previous.item.title, current: item.title }
      });
    }
    if (kind === "transfer" || kind === "travel") {
      const duration = item.durationMinutes || item.travelTimeMinutes || (start != null && end != null ? end - start : null);
      if (duration != null && duration > 0 && duration < 10 && !/\bnext door|same building|same block\b/.test(body)) {
        addFinding(findings, {
          code: "impossible_travel_time",
          severity: "error",
          message: `Day ${day.day_number} has an unrealistically short travel segment: ${item.title}.`,
          dayNumber: day.day_number,
          repairable: false,
          invalidates: scheduleInvalidation(),
          evidence: { title: item.title, durationMinutes: duration }
        });
      }
    }
    if (/\bclosed|not open|closure\b/.test(body)) {
      addFinding(findings, {
        code: "closed_attraction",
        severity: "warning",
        message: `Day ${day.day_number} includes a possible closure warning for ${item.title}.`,
        dayNumber: day.day_number,
        repairable: false,
        invalidates: scheduleInvalidation(),
        evidence: { title: item.title }
      });
    }
    if (/\bticket|tour|reservation|reserve|timed entry\b/.test(body) && !item.booking_label) {
      addFinding(findings, {
        code: "missing_reservation_warning",
        severity: "warning",
        message: `Day ${day.day_number} should warn about reservation needs for ${item.title}.`,
        dayNumber: day.day_number,
        repairable: true,
        invalidates: ["final_assembly"],
        evidence: { title: item.title }
      });
    }
    if (isMajorItem(item)) {
      if (previousMajorIndex >= 0) {
        const between = timeline.slice(previousMajorIndex + 1, index);
        const transferBetween = between.some((candidate) => itemKind(candidate) === "transfer");
        if (!transferBetween && previousMajorIndex + 1 === index) {
          addFinding(findings, {
            code: "insufficient_transfer_time",
            severity: "warning",
            message: `Day ${day.day_number} has adjacent major stops without explicit transfer time.`,
            dayNumber: day.day_number,
            repairable: true,
            invalidates: scheduleInvalidation(),
            evidence: { previous: timeline[previousMajorIndex].title, current: item.title }
          });
        }
      }
      previousMajorIndex = index;
    }
    if (/\bcheck[- ]?in\b/.test(body) && start != null && start < 12 * 60 && !/\bstash|store|luggage|early check[- ]?in\b/.test(body)) {
      addFinding(findings, {
        code: "missed_check_in_window",
        severity: "warning",
        message: `Day ${day.day_number} may assume check-in before the usual hotel window.`,
        dayNumber: day.day_number,
        repairable: false,
        invalidates: accommodationInvalidation(),
        evidence: { title: item.title, startMinutes: start }
      });
    }
    previous = end == null ? previous : { item, end };
  });
}

function validateDayShape(day: RoamlyDayPlan, payload: TripPlannerPayload, findings: ItineraryValidationFinding[]) {
  const expected = expectedDate(payload, day.day_number);
  const actual = text(day.date);
  if (expected && actual && actual !== expected) {
    addFinding(findings, {
      code: "date_error",
      severity: "error",
      message: `Day ${day.day_number} date does not match the trip date range.`,
      dayNumber: day.day_number,
      repairable: false,
      invalidates: scheduleInvalidation(),
      evidence: { expected, actual }
    });
  }

  const body = dayText(day);
  const mealItems = day.live_timeline.filter((item) => itemKind(item) === "meal");
  if (!day.food.length && !mealItems.length && !/\bbreakfast|lunch|dinner|meal\b/.test(body)) {
    addFinding(findings, {
      code: "missing_meal_time",
      severity: "warning",
      message: `Day ${day.day_number} is missing meal time.`,
      dayNumber: day.day_number,
      repairable: true,
      invalidates: ["final_assembly"],
      evidence: { dayTitle: day.title }
    });
  }
  if (day.live_timeline.length >= 6 && !/\brest|break|buffer|recover|flex\b/.test(body)) {
    addFinding(findings, {
      code: "missing_rest",
      severity: "warning",
      message: `Day ${day.day_number} is dense and should include a rest or buffer period.`,
      dayNumber: day.day_number,
      repairable: true,
      invalidates: ["final_assembly"],
      evidence: { itemCount: day.live_timeline.length }
    });
  }

  const walkingMinutes = day.live_timeline
    .filter((item) => /\bwalk|walking\b/i.test(`${item.travel_mode || ""} ${item.transportMode || ""} ${item.description || ""}`))
    .reduce((total, item) => total + (item.travelTimeMinutes || item.durationMinutes || 0), 0);
  if (walkingMinutes > 180) {
    addFinding(findings, {
      code: "excessive_walking",
      severity: "warning",
      message: `Day ${day.day_number} may require excessive walking.`,
      dayNumber: day.day_number,
      repairable: false,
      invalidates: scheduleInvalidation(),
      evidence: { walkingMinutes }
    });
  }

  const drivingMinutes = day.live_timeline
    .filter((item) => /\bdrive|car|rental\b/i.test(`${item.travel_mode || ""} ${item.transportMode || ""} ${item.description || ""}`))
    .reduce((total, item) => total + (item.travelTimeMinutes || item.durationMinutes || 0), 0);
  if (drivingMinutes > 8 * 60) {
    addFinding(findings, {
      code: "excessive_driving",
      severity: "error",
      message: `Day ${day.day_number} exceeds a comfortable driving day.`,
      dayNumber: day.day_number,
      repairable: false,
      invalidates: transportInvalidation(),
      evidence: { drivingMinutes }
    });
  }
}

function validateTripWide(itinerary: RoamlyItinerary, payload: TripPlannerPayload, findings: ItineraryValidationFinding[]) {
  const seenTitles = new Map<string, number>();
  const seenDates = new Set<string>();
  for (const day of itinerary.daily_itinerary) {
    const date = text(day.date);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        addFinding(findings, {
          code: "timezone_error",
          severity: "warning",
          message: `Day ${day.day_number} has a non-ISO date that can cause timezone mistakes.`,
          dayNumber: day.day_number,
          repairable: false,
          invalidates: scheduleInvalidation(),
          evidence: { date }
        });
      }
      if (seenDates.has(date)) {
        addFinding(findings, {
          code: "date_error",
          severity: "error",
          message: `Duplicate itinerary date ${date}.`,
          dayNumber: day.day_number,
          repairable: false,
          invalidates: scheduleInvalidation(),
          evidence: { date }
        });
      }
      seenDates.add(date);
    }
    day.live_timeline.forEach((item) => {
      if (!["activity", "booking"].includes(itemKind(item))) return;
      const normalized = text(item.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!normalized) return;
      const previous = seenTitles.get(normalized);
      if (previous) {
        addFinding(findings, {
          code: "duplicate_activity",
          severity: "warning",
          message: `${item.title} appears on both day ${previous} and day ${day.day_number}.`,
          dayNumber: day.day_number,
          repairable: false,
          invalidates: scheduleInvalidation(),
          evidence: { title: item.title, previousDay: previous }
        });
      } else {
        seenTitles.set(normalized, day.day_number);
      }
    });
  }

  const budget = itinerary.estimated_budget_breakdown;
  const estimatedTotal = numeric(budget.total_estimate_amount ?? budget.total_estimate);
  const userBudget = payload.budgetAmount ?? numeric(budget.user_budget_amount);
  if (estimatedTotal != null && userBudget != null && estimatedTotal > userBudget) {
    addFinding(findings, {
      code: "budget_overrun",
      severity: "warning",
      message: `Estimated total exceeds the traveler budget.`,
      repairable: false,
      invalidates: budgetInvalidation(),
      evidence: { estimatedTotal, userBudget, currency: payload.budgetCurrency || budget.currency || "unknown" }
    });
  }

  const expectedCurrency = payload.budgetCurrency || budget.currency || "";
  itinerary.booking_suggestions.forEach((suggestion) => {
    if (expectedCurrency && suggestion.currency && suggestion.currency !== expectedCurrency) {
      addFinding(findings, {
        code: "mixed_currencies",
        severity: "warning",
        message: `${suggestion.title} uses ${suggestion.currency} while the trip budget uses ${expectedCurrency}.`,
        repairable: false,
        invalidates: budgetInvalidation(),
        evidence: { suggestion: suggestion.title, currency: suggestion.currency, expectedCurrency }
      });
    }
    const staleDays = daysBetweenNow(suggestion.expires_at || suggestion.searched_at);
    if (staleDays != null && staleDays > 7) {
      addFinding(findings, {
        code: "stale_market_data",
        severity: "warning",
        message: `${suggestion.title} has stale price or booking evidence.`,
        repairable: false,
        invalidates: budgetInvalidation(),
        evidence: { suggestion: suggestion.title, searchedAt: suggestion.searched_at || null, expiresAt: suggestion.expires_at || null }
      });
    }
  });

  const transportText = itinerary.transport_overview.toLowerCase();
  const hasTransportItems = itinerary.daily_itinerary.some((day) =>
    day.live_timeline.some((item) => itemKind(item) === "travel" || itemKind(item) === "transfer")
  );
  if (transportText && !hasTransportItems) {
    addFinding(findings, {
      code: "transport_itinerary_inconsistency",
      severity: "error",
      message: "The transport overview is not reflected in the day-by-day timeline.",
      repairable: false,
      invalidates: transportInvalidation(),
      evidence: { transportOverviewPresent: true }
    });
  }

  const hotelText = itinerary.hotel_area_suggestions.join(" ").toLowerCase();
  const hasHotelItems = itinerary.daily_itinerary.some((day) => day.live_timeline.some((item) => itemKind(item) === "hotel"));
  if (hotelText && !hasHotelItems) {
    addFinding(findings, {
      code: "hotel_route_inconsistency",
      severity: "warning",
      message: "The accommodation area is not reflected in check-in, checkout, or routing steps.",
      repairable: true,
      invalidates: accommodationInvalidation(),
      evidence: { hotelAreaSuggestions: itinerary.hotel_area_suggestions.slice(0, 3) }
    });
  }
}

function validateDependencyVersions(layers: RoamlyGenerationLayer[] | undefined, findings: ItineraryValidationFinding[]) {
  if (!layers?.length) return;
  const latestByType = new Map<string, string>();
  layers
    .filter((layer) => layer.status === "completed")
    .forEach((layer) => {
      latestByType.set(layer.layer_type, `${layer.generation_version}:${layer.completed_at || "not-completed"}`);
    });
  layers
    .filter((layer) => layer.status === "completed")
    .forEach((layer) => {
      Object.entries(layer.dependency_versions_json || {}).forEach(([dependency, version]) => {
        const latest = latestByType.get(dependency);
        if (latest && typeof version === "string" && version !== latest && !version.endsWith(":not-completed")) {
          addFinding(findings, {
            code: "dependency_mismatch",
            severity: "error",
            message: `${layer.layer_type} was built from stale ${dependency} evidence.`,
            layerType: layer.layer_type,
            repairable: false,
            invalidates: [layer.layer_type as RoamlyBrainStageType, "final_assembly"],
            evidence: { layerType: layer.layer_type, dependency, recorded: version, latest }
          });
        }
      });
    });
}

export function validateItineraryDeterministically(params: {
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
  layers?: RoamlyGenerationLayer[];
  repairs?: ItineraryValidationRepair[];
}): ItineraryValidationResult {
  const findings: ItineraryValidationFinding[] = [];
  const production = validateItineraryForProduction(params.itinerary, params.payload);
  production.errors.forEach((message) =>
    addFinding(findings, {
      code: "production_validation",
      severity: "error",
      message,
      repairable: /transfer|arrival|departure|return travel|checkout/i.test(message),
      invalidates: scheduleInvalidation(),
      evidence: { source: "validateItineraryForProduction" }
    })
  );
  params.itinerary.daily_itinerary.forEach((day) => {
    validateTimeline(day, findings);
    validateDayShape(day, params.payload, findings);
  });
  validateTripWide(params.itinerary, params.payload, findings);
  validateDependencyVersions(params.layers, findings);
  const invalidates = uniqueStages(findings.flatMap((finding) => finding.invalidates));
  return {
    version: ROAMLY_VALIDATION_LAYER_VERSION,
    ok: findings.every((finding) => finding.severity !== "error"),
    checked_at: nowIso(),
    findings,
    repairs: params.repairs || [],
    requires_regeneration: findings.some((finding) => finding.severity === "error" && !finding.repairable),
    invalidates
  };
}

export function repairLowRiskItineraryIssues(params: {
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
}): { itinerary: RoamlyItinerary; repairs: ItineraryValidationRepair[] } {
  const repaired = repairItineraryForTravelRequirements(params.itinerary, params.payload);
  const repairs: ItineraryValidationRepair[] = [];
  if (JSON.stringify(repaired.daily_itinerary) !== JSON.stringify(params.itinerary.daily_itinerary)) {
    repairs.push({
      code: "arrival_departure_repair",
      message: "Repaired arrival, departure, and transfer structure using deterministic travel requirements.",
      dayNumber: null
    });
  }
  const daily_itinerary = repaired.daily_itinerary.map((day) => {
    let next = day;
    if (!next.food.length && !/\bmeal|breakfast|lunch|dinner\b/i.test(dayText(next))) {
      repairs.push({
        code: "meal_note_added",
        message: `Added a meal-planning note to day ${day.day_number}.`,
        dayNumber: day.day_number
      });
      next = { ...next, food: ["Keep time for breakfast, lunch, dinner, and water breaks around the planned route."] };
    }
    if (next.live_timeline.length >= 6 && !/\brest|break|buffer|recover|flex\b/i.test(dayText(next))) {
      repairs.push({
        code: "rest_note_added",
        message: `Added a rest-planning note to day ${day.day_number}.`,
        dayNumber: day.day_number
      });
      next = { ...next, evening: `${next.evening} Build in a short rest buffer before the evening plan.` };
    }
    return next;
  });
  return { itinerary: { ...repaired, daily_itinerary }, repairs };
}

export function validateAndRepairItinerary(params: {
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
  layers?: RoamlyGenerationLayer[];
}): ItineraryValidationResult {
  const repaired = repairLowRiskItineraryIssues(params);
  const result = validateItineraryDeterministically({
    itinerary: repaired.itinerary,
    payload: params.payload,
    layers: params.layers,
    repairs: repaired.repairs
  });
  return {
    ...result,
    repaired_itinerary: repaired.repairs.length ? repaired.itinerary : null
  };
}

export function validationFindingsToInvalidatedStages(findings: ItineraryValidationFinding[]) {
  return uniqueStages(findings.flatMap((finding) => finding.invalidates));
}

export function buildItineraryLogisticsValidationLayer(params: {
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
  layers?: RoamlyGenerationLayer[];
}) {
  const result = validateAndRepairItinerary(params);
  return {
    layer_type: "itinerary_logistics_validation" as const,
    output_json: result,
    evidence_json: {
      source: "deterministic_validation",
      version: ROAMLY_VALIDATION_LAYER_VERSION,
      checked_at: result.checked_at,
      checks: [
        "overlapping_activities",
        "impossible_travel_time",
        "closed_attraction",
        "insufficient_transfer_time",
        "missed_check_in_window",
        "departure_conflict",
        "dependency_mismatch",
        "hotel_route_inconsistency",
        "transport_itinerary_inconsistency"
      ],
      complex_conflicts_are_sent_back_to_relevant_brain_layer: true
    }
  };
}

export function buildBudgetValidationLayer(params: { itinerary: RoamlyItinerary; payload: TripPlannerPayload }) {
  const result = validateItineraryDeterministically(params);
  const budgetFindings = result.findings.filter((finding) =>
    ["budget_overrun", "mixed_currencies", "stale_market_data"].includes(finding.code)
  );
  return {
    layer_type: "budget_validation" as const,
    output_json: {
      version: ROAMLY_VALIDATION_LAYER_VERSION,
      ok: budgetFindings.every((finding) => finding.severity !== "error"),
      findings: budgetFindings,
      checked_at: result.checked_at,
      invalidates: validationFindingsToInvalidatedStages(budgetFindings)
    },
    evidence_json: {
      source: "deterministic_budget_validation",
      checked_at: result.checked_at,
      checks: ["budget_overrun", "mixed_currencies", "stale_market_data"]
    }
  };
}

export function buildScheduleValidationLayer(params: { itinerary: RoamlyItinerary; payload: TripPlannerPayload }) {
  const result = validateItineraryDeterministically(params);
  const scheduleFindings = result.findings.filter((finding) =>
    [
      "overlapping_activities",
      "impossible_travel_time",
      "closed_attraction",
      "insufficient_transfer_time",
      "duplicate_activity",
      "excessive_walking",
      "excessive_driving",
      "missing_meal_time",
      "missing_rest",
      "timezone_error",
      "date_error",
      "missing_reservation_warning"
    ].includes(finding.code)
  );
  return {
    layer_type: "schedule_validation" as const,
    output_json: {
      version: ROAMLY_VALIDATION_LAYER_VERSION,
      ok: scheduleFindings.every((finding) => finding.severity !== "error"),
      findings: scheduleFindings,
      checked_at: result.checked_at,
      invalidates: validationFindingsToInvalidatedStages(scheduleFindings)
    },
    evidence_json: {
      source: "deterministic_schedule_validation",
      checked_at: result.checked_at,
      checks: ["overlapping_activities", "impossible_travel_time", "closed_attraction", "date_error", "missing_rest"]
    }
  };
}
