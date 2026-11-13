import { calculateTripDateRange, shiftIsoDate } from "@/lib/roamly/dateUtils";
import { translateExactText, translateKey, type RoamlyLocale } from "@/lib/i18n";

export const ITINERARY_UNLOCK_PRICE = "$4.99 CAD";
export const ITINERARY_UNLOCK_PRICE_PHP = "₱99";
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

/** A typed day count below 1, including 0. Blank is allowed when the dates already stand alone. */
export function invalidTypedDayCount(value: string | number | null | undefined): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value < 1;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed < 1;
}

/** Inclusive days, with nights called out so a 5-day span is not read as 5 nights. */
export function tripLengthCopy(days: number): string {
  const whole = Math.round(days);
  if (!Number.isFinite(whole) || whole < 1) return "";
  if (whole === 1) return "1 day, no overnight";
  const nights = whole - 1;
  return `${whole} days, ${nights} ${nights === 1 ? "night" : "nights"}`;
}

/** Locale-aware trip length (2026-11-12): the plan form's summaries
 * used to render tripLengthCopy's English in every language. Keys live
 * under ui.plan; the English helpers above stay untouched (tests assert
 * their exact English output). */
export function tripLengthCopyLocalized(days: number, locale: RoamlyLocale): string {
  const whole = Math.round(days);
  if (!Number.isFinite(whole) || whole < 1) return "";
  if (whole === 1) return translateKey(locale, "ui.plan.tripLengthOne", "1 day, no overnight");
  const nights = whole - 1;
  if (nights === 1) {
    return translateKey(locale, "ui.plan.tripLengthManyOneNight", "{days} days, 1 night", { days: whole });
  }
  return translateKey(locale, "ui.plan.tripLengthMany", "{days} days, {nights} nights", { days: whole, nights });
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

/** Locale-aware traveller / room counts (2026-11-12). Same contract as
 * the English helpers above, with ui.plan keys carrying the plurals. */
function countNounLocalized(
  count: number,
  locale: RoamlyLocale,
  oneKey: string,
  manyKey: string,
  oneFallback: string,
  manyFallback: string
) {
  const whole = Math.max(0, Math.round(count));
  return whole === 1
    ? translateKey(locale, oneKey, oneFallback)
    : translateKey(locale, manyKey, manyFallback, { count: whole });
}

export function travelerCountPhraseLocalized(adults: number, children: number, infants: number, locale: RoamlyLocale) {
  const parts = [countNounLocalized(adults, locale, "ui.plan.adultOne", "ui.plan.adultMany", "1 adult", "{count} adults")];
  if (children > 0) {
    parts.push(countNounLocalized(children, locale, "ui.plan.childOne", "ui.plan.childMany", "1 child", "{count} children"));
  }
  if (infants > 0) {
    parts.push(countNounLocalized(infants, locale, "ui.plan.infantOne", "ui.plan.infantMany", "1 infant", "{count} infants"));
  }
  return parts.join(", ");
}

export function roomCountPhrase(count: number, locale: RoamlyLocale) {
  return countNounLocalized(count, locale, "ui.plan.roomOne", "ui.plan.roomMany", "1 room", "{count} rooms");
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
  if (invalidTypedDayCount(daysRaw)) {
    return { ...empty, days: "Use at least 1 day." };
  }
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
    // Jakob A10: there is no number-of-days input anymore — the
    // length is computed from the range. The only cure is an end date.
    return { ...empty, days: "Add an end date." };
  }
  if (!hasStart && hasEnd) {
    return { ...empty, start: "Add a start date." };
  }
  if (hasStart && !hasEnd && days) {
    return { ...empty, start: "Enter a real start date." };
  }
  return {
    start: "Add a start and end date.",
    end: "",
    days: "Add both dates."
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
  // Philippines plan context: the traveler's selected destination country.
  // Defaults to the CAD price set when absent — never guessed.
  isPhilippinesTrip?: boolean;
}): PlanEntitlementCopy {
  const price = input.isPhilippinesTrip ? ITINERARY_UNLOCK_PRICE_PHP : ITINERARY_UNLOCK_PRICE;
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

/** Locale-aware style summary (2026-11-12): same three segments, but
 * each option value is translated first and the "(default)" framing
 * comes from ui.plan keys, so the review row reads in the picked
 * language instead of "Balanced style (default), ...". */
export function preferenceStyleSummaryLocalized(
  input: {
    travelStyle: string;
    pace: string;
    walkingTolerance: string;
  },
  locale: RoamlyLocale
) {
  const styleValue = translateExactText(locale, input.travelStyle);
  const paceValue = translateExactText(locale, input.pace);
  const walkingValue = translateExactText(locale, input.walkingTolerance);
  const style = translateKey(
    locale,
    input.travelStyle === PLAN_PREFERENCE_DEFAULTS.travelStyle ? "ui.plan.styleDefault" : "ui.plan.stylePlain",
    input.travelStyle === PLAN_PREFERENCE_DEFAULTS.travelStyle ? "{value} style (default)" : "{value} style",
    { value: styleValue }
  );
  const pace = translateKey(
    locale,
    input.pace === PLAN_PREFERENCE_DEFAULTS.pace ? "ui.plan.paceDefault" : "ui.plan.pacePlain",
    input.pace === PLAN_PREFERENCE_DEFAULTS.pace ? "{value} pace (default)" : "{value} pace",
    { value: paceValue }
  );
  const walking = translateKey(
    locale,
    input.walkingTolerance === PLAN_PREFERENCE_DEFAULTS.walkingTolerance
      ? "ui.plan.walkingDefault"
      : "ui.plan.walkingPlain",
    input.walkingTolerance === PLAN_PREFERENCE_DEFAULTS.walkingTolerance
      ? "{value} walking (default)"
      : "{value} walking",
    { value: walkingValue }
  );
  return [style, pace, walking].join(", ");
}
