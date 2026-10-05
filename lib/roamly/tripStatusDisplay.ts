import type { TripPhase, TripReadinessState } from "@/lib/roamly/tripReadiness";

/** Display-only trip status. Does not replace the readiness engine. */
export type TravelerStatusCode =
  | "DRAFT"
  | "NEEDS_CONFIRMATION"
  | "READY_TO_TRAVEL"
  | "LIVE"
  | "COMPLETED"
  | "UNKNOWN";

export type TravelerStatusTone = "ocean" | "sun" | "coral" | "ink";

export type TravelerTripStatus = {
  code: TravelerStatusCode;
  badge: string;
  tone: TravelerStatusTone;
};

export function mapTravelerTripStatus(input: {
  completed?: boolean;
  phase?: TripPhase | null;
  readinessState?: TripReadinessState | null;
  hasItinerary?: boolean;
  companionUnlocked?: boolean;
  budgetOver?: boolean;
  building?: boolean;
  /** Saved draft cannot generate until unlock, and generation is not running. */
  awaitingUnlock?: boolean;
  /** Explicit lack of signals. Never render Ready in this case. */
  signalsUnknown?: boolean;
}): TravelerTripStatus {
  if (input.signalsUnknown) return { code: "UNKNOWN", badge: "UNKNOWN", tone: "ink" };
  if (input.completed || input.phase === "completed") return { code: "COMPLETED", badge: "Completed", tone: "ink" };
  if (input.awaitingUnlock && !input.building) return { code: "DRAFT", badge: "Needs unlock", tone: "sun" };
  if (input.building) return { code: "DRAFT", badge: "Building", tone: "sun" };

  const actionNeeded =
    Boolean(input.budgetOver) ||
    input.readinessState === "ACTION_NEEDED" ||
    input.readinessState === "ATTENTION_REQUIRED" ||
    (input.readinessState === "UNCERTAIN" && Boolean(input.hasItinerary));

  if (actionNeeded) return { code: "NEEDS_CONFIRMATION", badge: "Action needed", tone: "sun" };

  if (input.phase === "active" && input.companionUnlocked && input.readinessState === "READY" && !input.budgetOver) {
    return { code: "LIVE", badge: "Live", tone: "ocean" };
  }

  if (!input.hasItinerary) return { code: "DRAFT", badge: "Planning", tone: "ink" };
  if (input.readinessState === "READY" && !input.budgetOver) return { code: "READY_TO_TRAVEL", badge: "Ready", tone: "ocean" };
  if (input.readinessState == null) return { code: "UNKNOWN", badge: "UNKNOWN", tone: "ink" };
  return { code: "NEEDS_CONFIRMATION", badge: "Action needed", tone: "sun" };
}
