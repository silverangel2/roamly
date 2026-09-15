import type { RoamlyItinerary, RoamlyBookingSuggestion } from "@/lib/itinerary";

export type ExploreCandidate = {
  id: string;
  title: string;
  category: "activity" | "event";
  reason: string;
  location?: string;
  date?: string;
  time?: string;
  duration?: string;
  priceLabel?: string;
  priceKnown: boolean;
  href?: string;
  publicEvent: boolean;
  evidenceLabel: "Grounded event" | "Trip recommendation";
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isGeneric(title: string) {
  return /^(things to do|book activities|activities\/tours to reserve|museum or gallery|nightlife district|local bistro|explore nearby)$/i.test(title);
}

function suggestionId(suggestion: RoamlyBookingSuggestion, index: number) {
  return text(suggestion.candidateId) || `${suggestion.category}-${index}-${text(suggestion.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function priceLabel(suggestion: RoamlyBookingSuggestion) {
  const min = suggestion.estimated_cost_min;
  const max = suggestion.estimated_cost_max;
  if (min == null && max == null) return undefined;
  if (suggestion.price_confidence === "unknown") return "Price not confirmed";
  const currency = text(suggestion.currency) || "CAD";
  const format = (value: number) => `${currency} ${Math.round(value).toLocaleString()}`;
  return min != null && max != null && min !== max ? `Estimate: ${format(min)}–${format(max)}` : `Estimate: ${format(min ?? max ?? 0)}`;
}

function isGrounded(suggestion: RoamlyBookingSuggestion) {
  return Boolean(
    suggestion.market_source === "public_web" ||
      suggestion.factual_status === "verified" ||
      suggestion.factual_status === "search_ready" ||
      suggestion.market_confidence === "high" ||
      suggestion.price_type === "live_partner" ||
      suggestion.price_type === "cached_recent"
  );
}

function isPublicEvent(suggestion: RoamlyBookingSuggestion) {
  return suggestion.market_source === "public_web" || /official event|festival|concert|nightlife|dj|parade|market|theatre|theater|exhibition|sports? event|show/i.test(`${suggestion.title} ${suggestion.provider_or_search_source || ""}`) && suggestion.factual_status === "verified";
}

export function buildExploreCandidates(itinerary: RoamlyItinerary | null, limit = 5): ExploreCandidate[] {
  if (!itinerary) return [];
  const seen = new Set<string>();
  return (itinerary.booking_suggestions || [])
    .filter((suggestion) => ["activity", "attraction", "tour"].includes(suggestion.category))
    .filter((suggestion) => !isGeneric(text(suggestion.title)))
    .filter(isGrounded)
    .map((suggestion, index) => {
      const title = text(suggestion.title) || "Trip discovery";
      const publicEvent = isPublicEvent(suggestion);
      const id = suggestionId(suggestion, index);
      return {
        id,
        title,
        category: publicEvent ? ("event" as const) : ("activity" as const),
        reason: text(suggestion.why_recommended) || text(suggestion.description) || "A grounded option from your trip plan.",
        location: text(suggestion.location) || text(suggestion.neighborhood) || text(suggestion.city) || undefined,
        date: text(suggestion.date) || text(suggestion.departure_date) || undefined,
        time: text(suggestion.time_window) || undefined,
        duration: text(suggestion.duration) || undefined,
        priceLabel: priceLabel(suggestion),
        priceKnown: suggestion.price_confidence !== "unknown" && (suggestion.estimated_cost_min != null || suggestion.estimated_cost_max != null),
        href: safeUrl(suggestion.normal_search_url) || safeUrl(suggestion.affiliate_url) || undefined,
        publicEvent,
        evidenceLabel: publicEvent ? ("Grounded event" as const) : ("Trip recommendation" as const)
      };
    })
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .sort((left, right) => Number(right.publicEvent) - Number(left.publicEvent))
    .slice(0, Math.max(0, limit));
}
