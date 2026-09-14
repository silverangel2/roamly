import type { TripPlannerPayload } from "@/lib/trip-planner";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

export type ActivityFeasibilityState = "FEASIBLE" | "INFEASIBLE" | "UNCERTAIN";

export type ActivityDecisionReason =
  | "MATCHES_INTEREST"
  | "DATE_SPECIFIC_OPPORTUNITY"
  | "TEMPORAL_SCARCITY"
  | "FITS_SCHEDULE"
  | "CONFLICTS_CONFIRMED_BOOKING"
  | "CONFLICTS_MUST_DO"
  | "OUTSIDE_TRIP"
  | "ARRIVAL_DEPARTURE_BOUNDARY"
  | "TRAVEL_TIME_UNKNOWN"
  | "TRAVEL_TIME_INFEASIBLE"
  | "EVENT_TIME_UNKNOWN"
  | "PRICE_UNKNOWN"
  | "BUDGET_CONFLICT"
  | "TOO_DENSE_FOR_PACE"
  | "SPECIAL_EVENT_BETTER_FIT"
  | "MUST_DO_PROTECTED"
  | "CONFIRMED_BOOKING_PROTECTED";

export type ActivityFeasibilityCandidate = TravelMarketResult & {
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
};

export type ActivityScheduleAnchor = {
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  travelTimeMinutes?: number | null;
};

export type ActivityFeasibilityContext = {
  payload: Pick<TripPlannerPayload, "destination" | "startDate" | "endDate" | "interests" | "pace" | "budgetAmount" | "budgetCurrency" | "specialNotes">;
  confirmedBookings?: TripPlannerPayload["confirmedBookings"];
  mustDoTitles?: string[];
  mustDoActivities?: Array<{ title: string; date?: string; startTime?: string; endTime?: string }>;
  previous?: ActivityScheduleAnchor | null;
  next?: ActivityScheduleAnchor | null;
  budgetIsHard?: boolean;
};

export type ActivityDecision = {
  candidateId: string;
  feasibility: ActivityFeasibilityState;
  score: number;
  reasons: ActivityDecisionReason[];
  protected: boolean;
  flexible: boolean;
  canDisplaceFlexible: boolean;
};

const interestCategories: Array<[RegExp, RegExp[]]> = [
  [/\b(food|culinary|restaurant|eat)\b/i, [/\b(food|culinary|gastronomy|market)\b/i]],
  [/\b(music|concert|nightlife|party|club|dj)\b/i, [/\b(music|concert|nightlife|party|club|dj)\b/i]],
  [/\b(culture|cultural|history|art)\b/i, [/\b(cultural|culture|museum|exhibition|theatre|theater|show|festival)\b/i]],
  [/\b(sport|sports)\b/i, [/\b(sport|game|match|tournament)\b/i]]
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown) {
  return text(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function date(value: unknown) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function minutes(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

function eventDates(candidate: ActivityFeasibilityCandidate) {
  const metadata = candidate.metadata && typeof candidate.metadata.public_event === "object"
    ? candidate.metadata.public_event as Record<string, unknown>
    : {};
  return {
    start: date(candidate.start_date) || date(metadata.startDate),
    end: date(candidate.end_date) || date(metadata.endDate) || date(candidate.start_date) || date(metadata.startDate),
    startTime: text(metadata.startTime) || text(candidate.start_time),
    endTime: text(metadata.endTime) || text(candidate.end_time),
    special: candidate.source === "public_web" || Boolean(candidate.metadata?.public_event),
    recurrence: text(metadata.recurrenceStatus)
  };
}

function intervalsOverlap(startA: number | null, endA: number | null, startB: number | null, endB: number | null) {
  if (startA == null || startB == null) return false;
  const safeEndA = endA == null ? startA : endA;
  const safeEndB = endB == null ? startB : endB;
  return startA < safeEndB && startB < safeEndA;
}

function candidateTitleMatches(title: string, expected: string) {
  const actual = normalized(title);
  const wanted = normalized(expected);
  return Boolean(actual && wanted && (actual === wanted || actual.includes(wanted) || wanted.includes(actual)));
}

function confirmedConflict(candidate: ActivityFeasibilityCandidate, context: ActivityFeasibilityContext) {
  const occurrence = eventDates(candidate);
  const confirmedStatuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);
  for (const booking of context.confirmedBookings || []) {
    const bookingType = text(booking.booking_type).toLowerCase();
    if (!confirmedStatuses.has(text(booking.booking_status).toLowerCase())) continue;
    if (!bookingType || !["flight", "hotel", "attraction", "event", "restaurant", "transport"].includes(bookingType)) continue;
    const bookingStart = date(booking.start_date);
    const bookingEnd = date(booking.end_date) || bookingStart;
    if (!bookingStart || !occurrence.start || bookingEnd < occurrence.start || occurrence.end < bookingStart) continue;
    const sameDay = occurrence.start <= bookingEnd && bookingStart <= occurrence.end;
    if (!sameDay) continue;
    const bookingStartTime = minutes(booking.start_time);
    const bookingEndTime = minutes(booking.end_time);
    if (occurrence.start === occurrence.end && bookingStart === bookingEnd && (minutes(occurrence.startTime) != null || bookingStartTime != null)) {
      if (intervalsOverlap(minutes(occurrence.startTime), minutes(occurrence.endTime), bookingStartTime, bookingEndTime)) return true;
    } else if (bookingType === "flight" || bookingType === "event" || bookingType === "attraction" || bookingType === "restaurant") {
      return true;
    }
  }
  return false;
}

function mustDoConflict(candidate: ActivityFeasibilityCandidate, context: ActivityFeasibilityContext) {
  const occurrence = eventDates(candidate);
  return (context.mustDoActivities || []).some((mustDo) => {
    if (candidateTitleMatches(candidate.title, mustDo.title)) return false;
    if (!occurrence.start || !mustDo.date || occurrence.start !== date(mustDo.date)) return false;
    return intervalsOverlap(minutes(occurrence.startTime), minutes(occurrence.endTime), minutes(mustDo.startTime), minutes(mustDo.endTime)) ||
      (minutes(occurrence.startTime) == null && (minutes(mustDo.startTime) != null || minutes(mustDo.endTime) != null));
  });
}

function transitionState(candidate: ActivityFeasibilityCandidate, anchor: ActivityScheduleAnchor | null | undefined, direction: "previous" | "next") {
  if (!anchor) return { state: "FEASIBLE" as const, reason: null };
  const occurrence = eventDates(candidate);
  const eventStart = minutes(occurrence.startTime);
  const eventEnd = minutes(occurrence.endTime);
  const anchorTime = minutes(direction === "previous" ? anchor.endTime : anchor.startTime);
  if (!occurrence.start || !anchor.date || occurrence.start !== date(anchor.date)) return { state: "UNCERTAIN" as const, reason: "TRAVEL_TIME_UNKNOWN" as const };
  if (eventStart == null || eventEnd == null || anchorTime == null) return { state: "UNCERTAIN" as const, reason: "EVENT_TIME_UNKNOWN" as const };
  if (anchor.travelTimeMinutes == null) return { state: "UNCERTAIN" as const, reason: "TRAVEL_TIME_UNKNOWN" as const };
  if (direction === "previous" && anchorTime + anchor.travelTimeMinutes > eventStart) return { state: "INFEASIBLE" as const, reason: "TRAVEL_TIME_INFEASIBLE" as const };
  if (direction === "next" && eventEnd + anchor.travelTimeMinutes > anchorTime) return { state: "INFEASIBLE" as const, reason: "TRAVEL_TIME_INFEASIBLE" as const };
  return { state: "FEASIBLE" as const, reason: "FITS_SCHEDULE" as const };
}

export function evaluateActivityFeasibility(candidate: ActivityFeasibilityCandidate, context: ActivityFeasibilityContext): ActivityDecision {
  const occurrence = eventDates(candidate);
  const reasons: ActivityDecisionReason[] = [];
  let feasibility: ActivityFeasibilityState = "FEASIBLE";
  let score = 0;
  const tripStart = date(context.payload.startDate);
  const tripEnd = date(context.payload.endDate);
  if (!occurrence.start || !tripStart || !tripEnd) {
    feasibility = "UNCERTAIN";
    reasons.push("EVENT_TIME_UNKNOWN");
  } else if (occurrence.end < tripStart || occurrence.start > tripEnd) {
    feasibility = "INFEASIBLE";
    reasons.push("OUTSIDE_TRIP");
  }
  if (occurrence.start && (minutes(occurrence.startTime) == null || minutes(occurrence.endTime) == null) && feasibility === "FEASIBLE") {
    feasibility = "UNCERTAIN";
    reasons.push("EVENT_TIME_UNKNOWN");
  }
  if (occurrence.special) {
    reasons.push("DATE_SPECIFIC_OPPORTUNITY", "TEMPORAL_SCARCITY");
    score += occurrence.recurrence === "multi_day" ? 10 : 20;
  }
  const haystack = `${candidate.title} ${candidate.metadata?.public_event && typeof candidate.metadata.public_event === "object" ? JSON.stringify(candidate.metadata.public_event) : ""}`;
  const matchedInterest = (context.payload.interests || []).some((interest) => interestCategories.some(([interestPattern, eventPatterns]) => interestPattern.test(interest) && eventPatterns.some((pattern) => pattern.test(haystack))));
  if (matchedInterest) {
    reasons.push("MATCHES_INTEREST");
    score += 30;
  }
  const mustDo = (context.mustDoTitles || []).some((title) => candidateTitleMatches(candidate.title, title));
  if (mustDo) {
    reasons.push("MUST_DO_PROTECTED");
    score += 50;
  }
  if (confirmedConflict(candidate, context)) {
    feasibility = "INFEASIBLE";
    reasons.push("CONFLICTS_CONFIRMED_BOOKING", "CONFIRMED_BOOKING_PROTECTED");
  }
  if (mustDoConflict(candidate, context)) {
    feasibility = "INFEASIBLE";
    reasons.push("CONFLICTS_MUST_DO", "MUST_DO_PROTECTED");
  }
  for (const [anchor, direction] of [[context.previous, "previous"], [context.next, "next"]] as const) {
    if (!anchor) continue;
    const transition = transitionState(candidate, anchor, direction);
    if (transition.reason) reasons.push(transition.reason);
    if (transition.state === "INFEASIBLE") feasibility = "INFEASIBLE";
    else if (transition.state === "UNCERTAIN" && feasibility === "FEASIBLE") feasibility = "UNCERTAIN";
    if (transition.state === "FEASIBLE") {
      reasons.push("FITS_SCHEDULE");
      score += 10;
    }
  }
  const price = typeof candidate.price_amount === "number" && Number.isFinite(candidate.price_amount) ? candidate.price_amount : null;
  if (price == null) reasons.push("PRICE_UNKNOWN");
  if (price != null && context.payload.budgetAmount != null && price > context.payload.budgetAmount) {
    reasons.push("BUDGET_CONFLICT");
    if (context.budgetIsHard) feasibility = "INFEASIBLE";
  }
  const pace = text(context.payload.pace).toLowerCase();
  const end = minutes(occurrence.endTime);
  const nextStart = minutes(context.next?.startTime);
  if ((pace.includes("relaxed") || pace.includes("slow")) && occurrence.special) score -= 5;
  if (end != null && nextStart != null && end > 23 * 60 && nextStart < 9 * 60) {
    reasons.push("TOO_DENSE_FOR_PACE");
    score -= 15;
  }
  const protectedCandidate = mustDo || confirmedConflict(candidate, context);
  return {
    candidateId: candidate.id,
    feasibility,
    score,
    reasons: Array.from(new Set(reasons)),
    protected: protectedCandidate,
    flexible: !protectedCandidate,
    canDisplaceFlexible: feasibility !== "INFEASIBLE" && !protectedCandidate
  };
}

export function rankActivityCandidates(candidates: ActivityFeasibilityCandidate[], context: ActivityFeasibilityContext) {
  return candidates
    .map((candidate) => ({ candidate, decision: evaluateActivityFeasibility(candidate, context) }))
    .sort((a, b) => {
      const feasibilityRank = { FEASIBLE: 0, UNCERTAIN: 1, INFEASIBLE: 2 };
      return feasibilityRank[a.decision.feasibility] - feasibilityRank[b.decision.feasibility] || b.decision.score - a.decision.score || a.candidate.id.localeCompare(b.candidate.id);
    });
}

export function activityDecisionForPrompt(candidate: ActivityFeasibilityCandidate, context: ActivityFeasibilityContext) {
  const decision = evaluateActivityFeasibility(candidate, context);
  return {
    candidateId: decision.candidateId,
    feasibility: decision.feasibility,
    fitScore: decision.score,
    reasons: decision.reasons,
    protected: decision.protected,
    flexibleDisplacementAllowed: decision.canDisplaceFlexible
  };
}
