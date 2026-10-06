import { calculateTripDateRange, shiftIsoDate } from "@/lib/roamly/dateUtils";

export const ITINERARY_UNLOCK_PRICE = "$4.99 CAD";
export const PLAN_START_NOTE = `Free to start. Another trip is ${ITINERARY_UNLOCK_PRICE}.`;

export const PLAN_PREFERENCE_DEFAULTS = {
  travelStyle: "Balanced",
  pace: "Balanced",
  walkingTolerance: "Medium",
  transportation: "Mixed",
  accommodation: "Mid-range"
} as const;

export function positiveDayCount(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : null;
}

/** Inclusive days, with nights called out so a 5-day span is not read as 5 nights. */
export function tripLengthCopy(days: number): string {
  const whole = Math.round(days);
  if (!Number.isFinite(whole) || whole < 1) return "";
  if (whole === 1) return "1 day, no overnight";
  const nights = whole - 1;
  return `${whole} days, ${nights} ${nights === 1 ? "night" : "nights"}`;
}

export function countNoun(count: number, singular: string, plural: string) {
  const whole = Math.max(0, Math.round(count));
  return `${whole} ${whole === 1 ? singular : plural}`;
}

export function travelerCountPhrase(adults: number, children: number, infants: number) {
  const parts = [countNoun(adults, "adult", "adults")];
  if (children > 0) parts.push(countNoun(children, "child", "children"));
  if (infants > 0) parts.push(countNoun(infants, "infant", "infants"));
  return parts.join(", ");
}

/**
 * Exact dates win when both are valid.
 * A start date plus a day count fills the missing end date.
 * A day count alone never invents a calendar date.
 */
export function syncPlanDates(startDate: string, endDate: string, daysRaw: string) {
  const range = calculateTripDateRange(startDate, endDate);
  if (range.ok && range.days) return { startDate, endDate, days: range.days };
  const days = positiveDayCount(daysRaw);
  if (range.errorCode === "MISSING_DATES" && startDate.trim() && !endDate.trim() && days) {
    const end = shiftIsoDate(startDate, days - 1);
    if (end) return { startDate, endDate: end, days };
  }
  return { startDate, endDate, days };
}

export function planDateFieldErrors(startDate: string, endDate: string, daysRaw: string) {
  const empty = { start: "", end: "", days: "" };
  const range = calculateTripDateRange(startDate, endDate);
  if (range.ok) return empty;
  if (range.errorCode === "END_BEFORE_START") {
    return { ...empty, end: "End date must be on or after the start date." };
  }
  if (range.errorCode === "INVALID_DATES") {
    return { start: "Enter a real start date.", end: "Enter a real end date.", days: "" };
  }

  const days = positiveDayCount(daysRaw);
  const hasStart = Boolean(startDate.trim());
  const hasEnd = Boolean(endDate.trim());
  if (!hasStart && !hasEnd && days) {
    return {
      ...empty,
      start: `Add a start date. ${tripLengthCopy(days)} will set the end date.`
    };
  }
  if (hasStart && !hasEnd && !days) {
    return { ...empty, days: "Add the number of days, or an end date." };
  }
  if (!hasStart && hasEnd) {
    return { ...empty, start: "Add a start date." };
  }
  if (hasStart && !hasEnd && days) {
    return { ...empty, start: "Enter a real start date." };
  }
  return {
    start: "Add a start and end date, or a start date and number of days.",
    end: "",
    days: "Add the number of days, or both dates."
  };
}

export type PlanEntitlementCopy = {
  stepNote: string;
  reviewLead: string;
  nextStep: string;
  cta: string;
  footnote: string;
};

export function planEntitlementCopy(input: {
  signedIn: boolean;
  freeItineraryUsed: boolean;
  testerAccess?: boolean;
}): PlanEntitlementCopy {
  const price = ITINERARY_UNLOCK_PRICE;
  if (!input.signedIn) {
    return {
      stepNote: `Free to start — no account needed for one itinerary. Saving it needs an account. Another trip is ${price}.`,
      reviewLead: "Your free itinerary has not been used. No account is required to generate it.",
      nextStep: `Next: generate your free itinerary. To save it, sign in. Another trip is ${price}. Live Companion is separate.`,
      cta: "Generate my free itinerary",
      footnote: "One free itinerary. No subscription."
    };
  }
  if (input.freeItineraryUsed && input.testerAccess) {
    return {
      stepNote: `This account already used its free itinerary. Tester access can continue without the ${price} unlock.`,
      reviewLead: "This account already used its free itinerary. Tester access does not charge the unlock.",
      nextStep: "Next: continue as a tester. This does not buy an itinerary for a regular account.",
      cta: "Continue as tester",
      footnote: "Tester activity is excluded from revenue totals where possible."
    };
  }
  if (input.freeItineraryUsed) {
    return {
      stepNote: `This account already used its free itinerary. The next one is ${price}.`,
      reviewLead: "This account already used its free itinerary.",
      nextStep: `Next: unlock this itinerary for ${price}. Live Companion is a separate add-on after unlock.`,
      cta: `Unlock itinerary — ${price}`,
      footnote: "One custom itinerary for one trip. No subscription."
    };
  }
  return {
    stepNote: `This account includes one free itinerary. Another trip is ${price}.`,
    reviewLead: "This account still has its free itinerary.",
    nextStep: `Next: generate your free itinerary. Another trip is ${price}. Live Companion is separate.`,
    cta: "Generate my free itinerary",
    footnote: "One free itinerary on this account. No subscription."
  };
}

function withDefault(value: string, fallback: string, noun: string) {
  return value === fallback ? `${value} ${noun} (default)` : `${value} ${noun}`;
}

export function preferenceStyleSummary(input: {
  travelStyle: string;
  pace: string;
  walkingTolerance: string;
}) {
  return [
    withDefault(input.travelStyle, PLAN_PREFERENCE_DEFAULTS.travelStyle, "style"),
    withDefault(input.pace, PLAN_PREFERENCE_DEFAULTS.pace, "pace"),
    withDefault(input.walkingTolerance, PLAN_PREFERENCE_DEFAULTS.walkingTolerance, "walking")
  ].join(", ");
}
