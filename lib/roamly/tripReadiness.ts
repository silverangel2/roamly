export type TripActionFocus = "flight" | "hotel" | "activity" | "budget" | `day-${number}`;

export function parseTripActionFocus(value: string | null | undefined): TripActionFocus | null {
  if (value === "flight" || value === "hotel" || value === "activity" || value === "budget") return value;
  if (/^day-[1-9]\d*$/.test(value || "")) return value as `day-${number}`;
  return null;
}

function buildTripActionHref(tripId: string, surface: "trip" | "bookings", focus: TripActionFocus | null, anchor: string) {
  const query = focus ? `?focus=${encodeURIComponent(focus)}` : "";
  const path = surface === "bookings" ? `/trip/${tripId}/bookings` : `/trip/${tripId}`;
  return `${path}${query}${anchor ? `#${anchor}` : ""}`;
}

export type TripReadinessState = "READY" | "ACTION_NEEDED" | "ATTENTION_REQUIRED" | "UNCERTAIN";
export type TripPhase = "upcoming" | "active" | "completed" | "unknown";

export type TripReadinessAction = {
  id: "generation" | "conflict" | "bookings" | "budget" | "plan";
  label: string;
  href: string;
};

export type TripReadiness = {
  state: TripReadinessState;
  phase: TripPhase;
  primaryAction: TripReadinessAction;
  urgentItems: string[];
  upcomingActions: string[];
  confirmations: string[];
  uncertainties: string[];
};

export type TripReadinessInput = {
  tripId: string;
  startDate?: string | null;
  endDate?: string | null;
  generationStatus?: string | null;
  paymentNeedsAttention?: boolean;
  hasItinerary: boolean;
  confirmedBookingCount?: number;
  bookingsNeedingReview?: number;
  bookingsToArrange?: number;
  conflictCount?: number;
  uncertainItemCount?: number;
  bookingFocus?: "flight" | "hotel" | "activity" | null;
  conflictDay?: number | null;
  budgetStatus?: "WITHIN_BUDGET" | "LIKELY_WITHIN_BUDGET" | "OVER_BUDGET" | "BUDGET_UNCERTAIN" | null;
  now?: Date;
};

function dateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Date.parse(`${value}T00:00:00Z`);
}

export function tripPhase(input: Pick<TripReadinessInput, "startDate" | "endDate" | "now">): TripPhase {
  const start = dateOnly(input.startDate);
  const end = dateOnly(input.endDate);
  if (start == null || end == null || end < start) return "unknown";
  const today = Date.UTC(
    (input.now || new Date()).getUTCFullYear(),
    (input.now || new Date()).getUTCMonth(),
    (input.now || new Date()).getUTCDate()
  );
  if (today < start) return "upcoming";
  if (today > end) return "completed";
  return "active";
}

function action(id: TripReadinessAction["id"], tripId: string, label: string, surface: "trip" | "bookings", focus: TripActionFocus | null, anchor: string): TripReadinessAction {
  return { id, label, href: buildTripActionHref(tripId, surface, focus, anchor) };
}

export function deriveTripReadiness(input: TripReadinessInput): TripReadiness {
  const phase = tripPhase(input);
  const generationStatus = String(input.generationStatus || "").toLowerCase();
  const confirmed = Math.max(0, input.confirmedBookingCount || 0);
  const needsReview = Math.max(0, input.bookingsNeedingReview || 0);
  const toArrange = Math.max(0, input.bookingsToArrange || 0);
  const conflicts = Math.max(0, input.conflictCount || 0);
  const uncertainties = Math.max(0, input.uncertainItemCount || 0);
  const urgentItems: string[] = [];
  const upcomingActions: string[] = [];
  const confirmations = confirmed ? [`${confirmed} ${confirmed === 1 ? "booking" : "bookings"} confirmed`] : [];
  const uncertaintyItems: string[] = [];

  if (input.paymentNeedsAttention) {
    urgentItems.push("Payment still needs confirmation before this trip can be unlocked.");
    return {
      state: "ACTION_NEEDED",
      phase,
      primaryAction: action("generation", input.tripId, "Review trip access", "trip", null, ""),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (["failed", "partially_failed"].includes(generationStatus)) {
    urgentItems.push("Your itinerary needs another generation pass.");
    return {
      state: "ACTION_NEEDED",
      phase,
      primaryAction: action("generation", input.tripId, "Review generation", "trip", null, ""),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (!input.hasItinerary) {
    urgentItems.push("Your itinerary is still being prepared.");
    return {
      state: "UNCERTAIN",
      phase,
      primaryAction: action("generation", input.tripId, "View trip progress", "trip", null, ""),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (conflicts > 0) {
    urgentItems.push(`${conflicts} planning ${conflicts === 1 ? "conflict needs" : "conflicts need"} review.`);
    return {
      state: "ATTENTION_REQUIRED",
      phase,
      primaryAction: action("conflict", input.tripId, "Review the plan", "trip", input.conflictDay ? `day-${input.conflictDay}` : null, "day-by-day"),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (phase !== "completed" && needsReview > 0) {
    urgentItems.push(`${needsReview} ${needsReview === 1 ? "booking needs" : "bookings need"} your review.`);
    return {
      state: "ACTION_NEEDED",
      phase,
      primaryAction: action("bookings", input.tripId, "Review bookings", "bookings", input.bookingFocus || null, input.bookingFocus ? `booking-${input.bookingFocus}` : ""),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (phase === "upcoming" && toArrange > 0) {
    upcomingActions.push(`${toArrange} important ${toArrange === 1 ? "booking is" : "bookings are"} ready to arrange.`);
    return {
      state: "ACTION_NEEDED",
      phase,
      primaryAction: action("bookings", input.tripId, "Review what to book", "trip", input.bookingFocus || null, "bookings"),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (input.budgetStatus === "OVER_BUDGET") {
    urgentItems.push("The current plan is over your stated budget.");
    return {
      state: "ATTENTION_REQUIRED",
      phase,
      primaryAction: action("budget", input.tripId, "Review the budget", "trip", "budget", "budget"),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (input.budgetStatus === "BUDGET_UNCERTAIN" || uncertainties > 0) {
    uncertaintyItems.push("Some trip details still need confirmation.");
    return {
      state: "UNCERTAIN",
      phase,
      primaryAction: action("budget", input.tripId, "Review what is uncertain", "trip", "budget", "budget"),
      urgentItems,
      upcomingActions,
      confirmations,
      uncertainties: uncertaintyItems
    };
  }

  if (phase === "upcoming") upcomingActions.push("Review the day plan before you go.");
  if (phase === "active") upcomingActions.push("Open today’s plan for the next step.");
  return {
    state: "READY",
    phase,
    primaryAction: action("plan", input.tripId, phase === "active" ? "Open today’s plan" : "Open your plan", "trip", null, "day-by-day"),
    urgentItems,
    upcomingActions,
    confirmations,
    uncertainties: uncertaintyItems
  };
}
