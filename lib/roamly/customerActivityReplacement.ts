import type { RoamlyActivitySeed, RoamlyDayPlan, RoamlyItinerary } from "@/lib/itinerary";
import { evaluateActivityFeasibility } from "@/lib/roamly/activityFeasibility";
import { klookActivityActionState } from "@/lib/roamly/affiliateLinks";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";
import { findCustomerRemovalTarget } from "@/lib/roamly/itineraryRepair";

export type GroundedReplacementCandidate = {
  candidateId: string;
  item: RoamlyActivitySeed;
  evidence: Record<string, unknown>;
  bookingSuggestion: RoamlyItinerary["booking_suggestions"][number];
  fitReason: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timeFields(result: TravelMarketResult) {
  const metadata = record(result.metadata);
  return {
    start: text(metadata.startTime || metadata.start_time),
    end: text(metadata.endTime || metadata.end_time)
  };
}

function isFresh(result: TravelMarketResult, now = Date.now()) {
  const expiresAt = Date.parse(result.expires_at || "");
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function candidateDate(result: TravelMarketResult) {
  const date = text(result.start_date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function priorOrNext(day: RoamlyDayPlan, targetItemId: string, direction: "previous" | "next") {
  const index = day.live_timeline.findIndex((item) => item.item_id === targetItemId);
  if (index < 0) return null;
  const items = direction === "previous" ? day.live_timeline.slice(0, index).reverse() : day.live_timeline.slice(index + 1);
  return items.find((item) => item.item_type !== "meal" && item.item_type !== "rest") || null;
}

function makeSuggestion(result: TravelMarketResult, item: RoamlyActivitySeed, date: string) {
  const knownPrice = result.price_amount ?? result.price_min ?? null;
  const klook = result.source === "klook";
  return {
    candidateId: result.id,
    category: result.category === "tour" ? "tour" : "attraction",
    booking_category: result.category === "tour" ? "tour" : "attraction",
    title: result.title,
    description: item.description,
    location: result.city || result.destination,
    city: result.city,
    destination: result.destination,
    date,
    provider: result.provider,
    provider_or_search_source: result.provider,
    booking_status: "needs_booking" as const,
    booking_label: klook ? "Book activity" : "Check activity details",
    normal_search_url: result.normal_search_url || "",
    affiliate_url: klook ? result.affiliate_url || result.booking_url : undefined,
    affiliate_provider: klook ? "klook" : undefined,
    estimated_cost_min: result.price_min ?? knownPrice,
    estimated_cost_max: result.price_max ?? knownPrice,
    currency: result.currency,
    price_confidence: knownPrice == null ? "unknown" as const : "partner" as const,
    market_source: result.source,
    price_type: result.price_type,
    market_confidence: result.confidence,
    searched_at: result.searched_at,
    expires_at: result.expires_at
  } as RoamlyItinerary["booking_suggestions"][number];
}

export function buildGroundedReplacementCandidate(params: {
  result: TravelMarketResult;
  itinerary: RoamlyItinerary;
  target: RoamlyActivitySeed;
  day: RoamlyDayPlan;
  destination: string;
  startDate: string;
  endDate: string;
  interests?: string[];
  budgetAmount?: number | null;
  budgetCurrency?: string | null;
}) : GroundedReplacementCandidate | null {
  const { result, itinerary, target, day } = params;
  if (!result.id || !["attraction", "tour"].includes(result.category)) return null;
  if (result.source === "public_web") return null;
  if (!isFresh(result)) return null;
  if (result.source === "klook" && klookActivityActionState(result) !== "verified_partner") return null;
  const date = candidateDate(result);
  const times = timeFields(result);
  if (!date || date !== day.date || !times.start || !times.end) return null;

  const previous = priorOrNext(day, target.item_id || "", "previous");
  const next = priorOrNext(day, target.item_id || "", "next");
  const decision = evaluateActivityFeasibility(result, {
    payload: {
      destination: params.destination,
      startDate: params.startDate,
      endDate: params.endDate,
      interests: params.interests || [],
      pace: "Balanced",
      budgetAmount: params.budgetAmount ?? null,
      budgetCurrency: params.budgetCurrency || result.currency,
      specialNotes: ""
    },
    previous: previous ? { date: day.date, startTime: previous.startTime || previous.time_label, endTime: previous.endTime, travelTimeMinutes: previous.travelTimeMinutes } : null,
    next: next ? { date: day.date, startTime: next.startTime || next.time_label, endTime: next.endTime, travelTimeMinutes: next.travelTimeMinutes } : null,
    budgetIsHard: false
  });
  if (decision.feasibility !== "FEASIBLE") return null;

  const price = result.price_amount ?? result.price_min ?? null;
  const item: RoamlyActivitySeed = {
    item_id: target.item_id,
    candidateId: result.id,
    source: result.source,
    factualStatus: "verified",
    time_label: times.start,
    startTime: times.start,
    endTime: times.end,
    title: result.title,
    description: `Grounded ${result.provider} activity candidate. Verify final price, availability, hours, and terms before booking.`,
    location_name: result.city || result.destination || result.title,
    estimated_cost: price,
    category: result.category === "tour" ? "Tour" : "Activity",
    map_query: result.city || result.destination || result.title,
    item_type: "activity",
    plan_role: target.plan_role === "alternative" ? "alternative" : "supporting",
    routing_status: "FEASIBLE",
    timing_status: "FACTUAL",
    cost_status: price == null ? "UNKNOWN" : "LIVE_SEARCH",
    uncertainty: price == null ? ["Replacement price is unknown."] : []
  };
  const matchingSuggestion = itinerary.booking_suggestions.find((suggestion) => suggestion.candidateId === result.id);
  const bookingSuggestion = matchingSuggestion && ["suggested", "needs_booking"].includes(String(matchingSuggestion.booking_status).toLowerCase())
    ? matchingSuggestion
    : makeSuggestion(result, item, date);
  return {
    candidateId: result.id,
    item,
    bookingSuggestion,
    fitReason: decision.reasons.includes("MATCHES_INTEREST") ? "Matches your trip preferences." : "Fits the selected day and current schedule.",
    evidence: {
      candidateId: result.id,
      category: result.category,
      source: result.source,
      provider: result.provider,
      currency: result.currency,
      searchedAt: result.searched_at,
      expiresAt: result.expires_at,
      priceType: result.price_type,
      confidence: result.confidence,
      startDate: result.start_date,
      metadata: record(result.metadata),
      feasibility: decision.feasibility,
      priceStatus: price == null ? "unknown" : "observed"
    }
  };
}

export function replaceCustomerOptionalActivity(
  itinerary: RoamlyItinerary,
  target: { dayId: string; itemId: string },
  replacement: GroundedReplacementCandidate
) {
  const current = findCustomerRemovalTarget(itinerary, target.dayId, target.itemId);
  if (!current.ok) throw new Error(current.reason);
  const oldCandidateId = current.item.candidateId;
  const daily_itinerary = itinerary.daily_itinerary.map((day) => day.day_id !== target.dayId ? day : {
    ...day,
    live_timeline: day.live_timeline.map((item) => item.item_id === target.itemId
      ? { ...replacement.item, item_id: target.itemId }
      : item)
  });
  const booking_suggestions = itinerary.booking_suggestions.filter((suggestion) => {
    if (!oldCandidateId || suggestion.candidateId !== oldCandidateId) return true;
    const status = String(suggestion.booking_status || "").toLowerCase();
    return !["suggested", "needs_booking"].includes(status);
  });
  if (!booking_suggestions.some((suggestion) => suggestion.candidateId === replacement.candidateId)) booking_suggestions.push(replacement.bookingSuggestion);
  return { ...itinerary, daily_itinerary, booking_suggestions };
}
