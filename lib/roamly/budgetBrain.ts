type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== null && parsed > 0) return parsed;
  }

  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }

  return "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export type RoamlyBudgetBrainPlan = {
  totalBudget: number | null;
  currency: string;
  nights: number;
  travelers: number;
  hotelReserve: number;
  transportReserve: number;
  foodReserve: number;
  activitiesReserve: number;
  nightlifeReserve: number;
  bufferReserve: number;
  dailySpendTarget: number;
  hotelNightlyTarget: number;
  transportModeRecommendation: "flight" | "drive" | "train_or_bus" | "mixed" | "unknown";
  budgetVerdict: "comfortable" | "tight" | "too_low" | "unknown";
  recommendation: string;
};

export function calculateRoamlyBudgetBrain(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
  budgetBreakdown: AnyRecord;
  payload?: AnyRecord;
}): RoamlyBudgetBrainPlan {
  const { trip, itinerary, budgetBreakdown, payload = {} } = params;

  const totalBudget = firstNumber(
    payload.budget,
    payload.totalBudget,
    payload.budgetAmount,
    payload.maxBudget,
    trip.budget,
    trip.total_budget,
    trip.budget_amount,
    itinerary.total_budget,
    budgetBreakdown.total_budget,
    budgetBreakdown.total_estimate_amount
  );

  const currency = firstText(
    payload.budgetCurrency,
    trip.budget_currency,
    itinerary.budget_currency,
    budgetBreakdown.currency,
    "CAD"
  );

  const travelers =
    firstNumber(
      payload.travelersCount,
      (payload.travelers as AnyRecord | undefined)?.adults,
      trip.travelers_count,
      trip.travelers
    ) || 1;

  const rawNights =
    firstNumber(payload.nights, trip.nights, itinerary.nights, budgetBreakdown.nights) ||
    3;

  const nights = Math.max(1, Math.round(rawNights));

  if (!totalBudget) {
    return {
      totalBudget: null,
      currency,
      nights,
      travelers,
      hotelReserve: 0,
      transportReserve: 0,
      foodReserve: 0,
      activitiesReserve: 0,
      nightlifeReserve: 0,
      bufferReserve: 0,
      dailySpendTarget: 0,
      hotelNightlyTarget: 0,
      transportModeRecommendation: "unknown",
      budgetVerdict: "unknown",
      recommendation:
        "Add a trip budget so Roamly can reserve hotel, transport, food, activities, nightlife, and buffer in the right order."
    };
  }

  const estimatedTransport =
    firstNumber(
      budgetBreakdown.selected_transport_estimate_amount,
      budgetBreakdown.transport_estimate_amount,
      budgetBreakdown.flight_estimate_amount,
      budgetBreakdown.recommended_transport_estimate_amount
    ) || 0;

  const estimatedHotelNightly =
    firstNumber(
      budgetBreakdown.selected_hotel_estimate_amount,
      budgetBreakdown.hotel_nightly_estimate_amount
    ) || 0;

  const estimatedHotelTotal = estimatedHotelNightly
    ? estimatedHotelNightly * nights
    : 0;

  // Reserve stay first. A travel app should protect sleep/safety before extras.
  const hotelReserve = estimatedHotelTotal
    ? clamp(estimatedHotelTotal, totalBudget * 0.22, totalBudget * 0.55)
    : totalBudget * 0.35;

  // Reserve transport second. If flight is expensive, the brain may recommend driving/train.
  const transportReserve = estimatedTransport
    ? clamp(estimatedTransport, totalBudget * 0.12, totalBudget * 0.45)
    : totalBudget * 0.2;

  const committed = hotelReserve + transportReserve;
  const remaining = Math.max(0, totalBudget - committed);

  const foodReserve = remaining * 0.38;
  const activitiesReserve = remaining * 0.24;
  const nightlifeReserve = remaining * 0.18;
  const bufferReserve = remaining * 0.2;

  const dailySpendTarget = remaining / nights;
  const hotelNightlyTarget = hotelReserve / nights;

  const transportShare = transportReserve / totalBudget;
  const hotelShare = hotelReserve / totalBudget;
  const essentialsShare = (hotelReserve + transportReserve) / totalBudget;

  const transportModeRecommendation =
    transportShare > 0.38
      ? "drive"
      : transportShare > 0.3
        ? "train_or_bus"
        : estimatedTransport
          ? "flight"
          : "mixed";

  const budgetVerdict =
    essentialsShare > 0.82
      ? "too_low"
      : essentialsShare > 0.68 || dailySpendTarget < 75
        ? "tight"
        : hotelShare < 0.2
          ? "tight"
          : "comfortable";

  const recommendation =
    budgetVerdict === "too_low"
      ? `Budget is too low after stay and transport. Prioritize cheaper lodging, driving/train, or fewer nights before adding activities.`
      : budgetVerdict === "tight"
        ? `Budget is tight. Secure the stay and transport first, then keep food/activities simple with a protected buffer.`
        : `Budget is workable. Secure stay and transport first, then split the rest between food, activities, nightlife, and buffer.`;

  return {
    totalBudget,
    currency,
    nights,
    travelers,
    hotelReserve: Math.round(hotelReserve),
    transportReserve: Math.round(transportReserve),
    foodReserve: Math.round(foodReserve),
    activitiesReserve: Math.round(activitiesReserve),
    nightlifeReserve: Math.round(nightlifeReserve),
    bufferReserve: Math.round(bufferReserve),
    dailySpendTarget: Math.round(dailySpendTarget),
    hotelNightlyTarget: Math.round(hotelNightlyTarget),
    transportModeRecommendation,
    budgetVerdict,
    recommendation
  };
}
