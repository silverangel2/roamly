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

export function buildRecommendedStaySuggestion(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
}) {
  const trip = params.trip;
  const itinerary = params.itinerary;
  const budget = (itinerary.estimated_budget_breakdown || {}) as AnyRecord;

  const destination = firstText(
    trip.destination,
    itinerary.destination,
    trip.city,
    trip.location,
    "your destination"
  );

  const currency = firstText(
    itinerary.budget_currency,
    trip.budget_currency,
    budget.currency,
    "CAD"
  );

  const nightlyTarget = firstNumber(
    budget.selected_hotel_estimate_amount,
    budget.hotel_nightly_estimate_amount,
    budget.hotel_estimate_amount
  );

  const includesHotel = trip.budget_includes_hotel !== false;

  if (!includesHotel) return null;

  const destinationLower = destination.toLowerCase();
  const isMontreal =
    destinationLower.includes("montreal") || destinationLower.includes("montréal");

  const neighborhood = isMontreal
    ? "Downtown Montreal or the Village"
    : `central ${destination}`;

  const roomType =
    nightlyTarget && nightlyTarget < 130
      ? "private room, hostel private room, or budget hotel room"
      : "well-rated private hotel room";

  const budgetLabel = nightlyTarget
    ? `${money(nightlyTarget, currency)} per night target`
    : "budget-matched nightly target";

  const reason = isMontreal
    ? "close to Pride events, metro access, nightlife, and walkable food options"
    : "close to the main trip area, transit, food, and planned activities";

  return {
    booking_category: "hotel",
    category: "hotel",
    title: `Recommended stay: ${neighborhood}`,
    description:
      firstText(budget.hotel_estimate_note) ||
      `${budgetLabel}. Look for a ${roomType} because it is ${reason}.`,
    destination,
    neighborhood,
    room_type: roomType,
    search_query: `${destination} ${neighborhood} ${roomType} ${budgetLabel}`,
    recommendation_reason: reason,
    url_type: "affiliate",
    provider: "Stay22",
    has_affiliate_url: true
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
