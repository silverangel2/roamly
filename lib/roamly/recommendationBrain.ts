import { resolveCityPlace } from "@/lib/roamly/placeResolver";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }

  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function money(amount: number | null, currency: string) {
  if (!amount) return "";
  return `${Math.round(amount)} ${currency}`;
}

function nestedNumber(record: AnyRecord, key: string) {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return firstNumber((value as AnyRecord)[key], (value as AnyRecord).hotelNightlyTarget);
}

export function buildRecommendedStaySuggestion(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
}) {
  const trip = params.trip;
  const itinerary = params.itinerary;
  const budget = (itinerary.estimated_budget_breakdown || {}) as AnyRecord;

  const rawDestination = firstText(
    trip.destination,
    itinerary.destination,
    trip.city,
    trip.location,
    "your destination"
  );
  const resolvedDestination = resolveCityPlace(rawDestination);
  if (!resolvedDestination) return null;
  const destination = resolvedDestination.searchLabel;

  const currency = firstText(
    itinerary.budget_currency,
    trip.budget_currency,
    budget.currency,
    "CAD"
  );

  const nightlyTarget = firstNumber(
    budget.hotel_nightly_target_amount,
    nestedNumber(budget, "budget_brain"),
    (budget.budget_brain as AnyRecord | undefined)?.hotelNightlyTarget,
    budget.selected_hotel_estimate_amount,
    budget.hotel_nightly_estimate_amount,
    budget.hotel_estimate_amount
  );

  const includesHotel = trip.budget_includes_hotel !== false;

  if (!includesHotel) return null;

  const destinationLower = `${destination} ${resolvedDestination.asciiName} ${resolvedDestination.name}`.toLowerCase();
  const isMontreal =
    destinationLower.includes("montreal") || destinationLower.includes("montréal");

  const neighborhood = isMontreal
    ? "the Village / Berri-UQAM area"
    : `central ${destination}`;

  const roomType =
    nightlyTarget && nightlyTarget < 150
      ? "private room / 1 bed / non-smoking when requested"
      : "well-rated private room / 1 bed / non-smoking when requested";

  const budgetLabel = nightlyTarget
    ? `${money(nightlyTarget, currency)} per night target`
    : "budget-matched nightly target";

  const stayName = isMontreal
    ? nightlyTarget && nightlyTarget < 150
      ? "M Montreal or similar private/budget room near the Village"
      : "Hotel St-Denis or similar central private room"
    : `budget-matched stay near ${neighborhood}`;

  const reason = isMontreal
    ? "close to Gay Village, Pride events, metro, nightlife, and budget-friendly food"
    : "close to the main trip area, transit, food, and planned activities";

  return {
    booking_category: "hotel",
    category: "hotel",
    title: `Recommended stay: ${stayName}`,
    description:
      `${budgetLabel}. Choose ${roomType} around ${neighborhood}.`,
    destination,
    recommended_stay_name: stayName,
    stay_profile: stayName,
    neighborhood,
    room_type: roomType,
    budget_target: budgetLabel,
    search_query: `${destination} ${neighborhood} ${roomType} ${budgetLabel}`,
    why_recommended: reason,
    recommendation_reason: reason,
    url_type: "affiliate",
    provider: "Recommended stay",
    provider_or_search_source: "Roamly recommendation",
    booking_label: "Find this stay",
    has_affiliate_url: false
  };
}

export function hasBookingCategory(
  suggestions: unknown[],
  category: string
) {
  return suggestions.some((suggestion) => {
    if (!suggestion || typeof suggestion !== "object") return false;

    const record = suggestion as AnyRecord;
    const found = firstText(record.booking_category, record.category).toLowerCase();

    return found === category.toLowerCase();
  });
}
