import {
  compareTransportOptions,
  type TransportComparison,
  type TransportOption
} from "@/lib/roamly/transportOptions";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

export type TransportationMode = "flight" | "train" | "car" | "rental_car" | "bus" | "ferry" | "mixed";
export type TransportationDataFreshness = "live" | "cached_recent" | "search_ready" | "estimated" | "unavailable";

export type TransportationScoreComponents = {
  customer_fit: number;
  total_cost: number;
  time_efficiency: number;
  convenience: number;
  schedule_compatibility: number;
  reliability: number;
  affiliate_value: 0;
  total: number;
};

export type TransportationCandidate = {
  id: string;
  mode: TransportationMode;
  provider: string;
  provider_identifier: string | null;
  source: string;
  retrieved_at: string;
  availability_at: string | null;
  price: number | null;
  currency: string;
  taxes_and_fees: number | null;
  distance_km: number | null;
  door_to_door_minutes: number | null;
  transfers: number;
  overnight_stops: number;
  estimated_additional_costs: Record<string, number>;
  score_components: TransportationScoreComponents;
  warnings: string[];
  confidence: number;
  data_freshness: TransportationDataFreshness;
  source_url: string | null;
  affiliate_url: string | null;
  rejected_reason?: string;
};

export type TransportationDecision = {
  recommendation: TransportationCandidate | null;
  why_it_wins: string;
  major_tradeoffs: string[];
  rejected_alternatives: TransportationCandidate[];
  backup: TransportationCandidate | null;
  candidates: TransportationCandidate[];
  user_override_supported: true;
  user_facing_recommendation: string;
  evidence: {
    retrieved_at: string;
    provider_sources: string[];
    assumptions: string[];
  };
};

export type TransportationIntelligenceConfig = {
  marketResults?: TravelMarketResult[] | null;
  fixedTripCostCents?: number;
  flightEstimateCents?: number | null;
  fallbackFlightEstimateCents?: number | null;
  maximumComfortableDrivingHours?: number | null;
  transportationPreferences?: string[] | null;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function averageCost(option: TransportOption) {
  if (option.estimated_cost_min != null && option.estimated_cost_max != null) {
    return Math.round((option.estimated_cost_min + option.estimated_cost_max) / 2);
  }
  return option.estimated_cost_max ?? option.estimated_cost_min ?? null;
}

function freshness(option: TransportOption): TransportationDataFreshness {
  if (option.price_confidence === "live_partner") return "live";
  if (option.price_confidence === "cached_recent") return "cached_recent";
  if (option.availability === "search_ready") return "search_ready";
  if (option.availability === "not_available") return "unavailable";
  return "estimated";
}

function modeFromOption(mode: TransportOption["mode"]): TransportationMode {
  if (mode === "drive") return "car";
  return mode;
}

function defaultComfortableDrivingHours(config: TransportationIntelligenceConfig) {
  if (typeof config.maximumComfortableDrivingHours === "number" && Number.isFinite(config.maximumComfortableDrivingHours) && config.maximumComfortableDrivingHours > 0) {
    return Math.min(10, Math.max(3, config.maximumComfortableDrivingHours));
  }
  return 7.5;
}

export function drivingDaysRequired(doorToDoorMinutes: number | null, comfortableHours = 7.5) {
  if (!doorToDoorMinutes || doorToDoorMinutes <= 0) return 0;
  return Math.max(1, Math.ceil(doorToDoorMinutes / 60 / Math.max(3, comfortableHours)));
}

export function drivingOvernightStops(doorToDoorMinutes: number | null, comfortableHours = 7.5) {
  return Math.max(0, drivingDaysRequired(doorToDoorMinutes, comfortableHours) - 1);
}

function tripDays(payload: TripPlannerPayload) {
  return Math.max(1, Math.round(payload.daysCount || 3));
}

function travelers(payload: TripPlannerPayload) {
  return Math.max(1, Math.round(payload.travelersCount || payload.travelers?.adults || 1));
}

function preferenceMatches(mode: TransportationMode, config: TransportationIntelligenceConfig, payload: TripPlannerPayload) {
  const preferences = [
    ...(config.transportationPreferences || []),
    payload.transportationPreference || ""
  ]
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  if (!preferences.length || preferences.some((item) => item.includes("mixed"))) return 0.72;
  if (preferences.some((item) => item.includes(mode) || (mode === "car" && item.includes("drive")))) return 1;
  if (mode === "flight" && preferences.some((item) => item.includes("fly"))) return 1;
  if (mode === "train" && preferences.some((item) => item.includes("rail"))) return 1;
  return 0.56;
}

function sourceUrl(option: TransportOption) {
  return clean(option.search_url) || clean(option.booking_url) || null;
}

function affiliateUrl(option: TransportOption) {
  const url = clean(option.booking_url);
  if (!url || url.includes("google.com/maps")) return null;
  return url;
}

function scoreCandidate(params: {
  candidate: Omit<TransportationCandidate, "score_components">;
  maxCost: number;
  maxMinutes: number;
  preferenceFit: number;
  realistic: boolean;
}) {
  const candidate = params.candidate;
  const price = candidate.price ?? params.maxCost;
  const minutes = candidate.door_to_door_minutes ?? params.maxMinutes;
  const costScore = Math.max(0, 100 - (price / Math.max(1, params.maxCost)) * 82);
  const timeScore = Math.max(0, 100 - (minutes / Math.max(1, params.maxMinutes)) * 82);
  const convenience = Math.max(0, 100 - candidate.transfers * 9 - candidate.overnight_stops * 18);
  const reliability =
    candidate.data_freshness === "live"
      ? 88
      : candidate.data_freshness === "cached_recent"
        ? 78
        : candidate.data_freshness === "search_ready"
          ? 64
          : candidate.data_freshness === "estimated"
            ? 55
            : 10;
  const customerFit = Math.round((params.preferenceFit * 85 + (params.realistic ? 15 : 0)));
  const schedule = Math.max(0, 86 - candidate.transfers * 8 - candidate.overnight_stops * 10);
  const total =
    customerFit * 0.25 +
    costScore * 0.2 +
    timeScore * 0.2 +
    convenience * 0.15 +
    schedule * 0.1 +
    reliability * 0.1;
  return {
    customer_fit: Math.round(customerFit),
    total_cost: Math.round(costScore),
    time_efficiency: Math.round(timeScore),
    convenience: Math.round(convenience),
    schedule_compatibility: Math.round(schedule),
    reliability: Math.round(reliability),
    affiliate_value: 0,
    total: Math.round(total)
  } satisfies TransportationScoreComponents;
}

function baseCandidate(option: TransportOption, payload: TripPlannerPayload, config: TransportationIntelligenceConfig, retrievedAt: string) {
  const mode = modeFromOption(option.mode);
  const doorToDoorMinutes = option.estimated_duration_hours == null ? null : Math.round(option.estimated_duration_hours * 60);
  const comfortableHours = defaultComfortableDrivingHours(config);
  const driveOvernights = mode === "car" ? drivingOvernightStops(doorToDoorMinutes, comfortableHours) : 0;
  const additionalCosts = Object.fromEntries(
    Object.entries(option.cost_breakdown || {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
  );
  if (driveOvernights > 0 && !additionalCosts.overnight_hotel) {
    additionalCosts.overnight_hotel = Math.round(150 * driveOvernights);
    additionalCosts.transit_meals = Math.round(35 * travelers(payload) * drivingDaysRequired(doorToDoorMinutes, comfortableHours));
  }
  const transfers =
    mode === "flight" ? 2 : mode === "mixed" ? 3 : mode === "train" || mode === "bus" ? 1 : 0;
  const price = averageCost(option);
  const warnings = [option.warning].filter(Boolean);
  if (driveOvernights > 0) warnings.push(`Driving requires ${driveOvernights} overnight stop${driveOvernights === 1 ? "" : "s"} at your comfort limit.`);

  return {
    id: `${mode}-${option.origin}-${option.destination}-${option.departure_date}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    mode,
    provider: option.source,
    provider_identifier: null,
    source: option.source,
    retrieved_at: retrievedAt,
    availability_at: option.price_confidence === "live_partner" || option.price_confidence === "cached_recent" ? retrievedAt : null,
    price,
    currency: option.currency,
    taxes_and_fees: null,
    distance_km: option.distance_km ?? null,
    door_to_door_minutes: doorToDoorMinutes,
    transfers,
    overnight_stops: driveOvernights,
    estimated_additional_costs: additionalCosts,
    warnings,
    confidence: option.price_confidence === "live_partner" ? 0.88 : option.price_confidence === "cached_recent" ? 0.72 : option.realistic ? 0.58 : 0.25,
    data_freshness: freshness(option),
    source_url: sourceUrl(option),
    affiliate_url: affiliateUrl(option),
    rejected_reason: option.realistic ? undefined : option.reason
  } satisfies Omit<TransportationCandidate, "score_components">;
}

function rentalCarCandidateFromDrive(candidate: TransportationCandidate, payload: TripPlannerPayload, config: TransportationIntelligenceConfig) {
  const days = tripDays(payload);
  const rentalFee = Math.round(days * 68);
  const oneWayFee = payload.returnToOrigin === false ? 180 : 0;
  const price = candidate.price == null ? null : candidate.price + rentalFee + oneWayFee;
  const additional = {
    ...candidate.estimated_additional_costs,
    rental_car: rentalFee,
    ...(oneWayFee ? { one_way_fee: oneWayFee } : {})
  };
  const base = {
    ...candidate,
    id: candidate.id.replace(/^car-/, "rental-car-"),
    mode: "rental_car" as const,
    provider: "Rental-car estimate",
    source: "Roamly rental-car estimate",
    price,
    estimated_additional_costs: additional,
    warnings: [
      ...candidate.warnings,
      "Rental-car estimate is not live availability. Verify pickup, one-way fees, insurance, deposits, and parking before booking."
    ],
    confidence: Math.min(candidate.confidence, 0.52),
    data_freshness: "estimated" as const,
    affiliate_url: null,
    source_url: candidate.source_url
  };
  return {
    ...base,
    score_components: scoreCandidate({
      candidate: base,
      maxCost: Math.max(1, price || candidate.price || 1),
      maxMinutes: Math.max(1, candidate.door_to_door_minutes || 1),
      preferenceFit: preferenceMatches("rental_car", config, payload),
      realistic: candidate.rejected_reason ? false : true
    })
  } satisfies TransportationCandidate;
}

function unavailableFerryCandidate(payload: TripPlannerPayload, retrievedAt: string) {
  const origin = clean(payload.origin) || "Origin";
  const destination = clean(payload.destination) || "Destination";
  const base = {
    id: `ferry-${origin}-${destination}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    mode: "ferry" as const,
    provider: "Ferry provider unavailable",
    provider_identifier: null,
    source: "No configured ferry provider",
    retrieved_at: retrievedAt,
    availability_at: null,
    price: null,
    currency: payload.budgetCurrency || "CAD",
    taxes_and_fees: null,
    distance_km: null,
    door_to_door_minutes: null,
    transfers: 0,
    overnight_stops: 0,
    estimated_additional_costs: {},
    warnings: ["No ferry provider is configured for this route. Roamly will not invent ferry prices or schedules."],
    confidence: 0,
    data_freshness: "unavailable" as const,
    source_url: null,
    affiliate_url: null,
    rejected_reason: "Ferry was not evaluated as a live option because no ferry provider is configured."
  };
  return {
    ...base,
    score_components: {
      customer_fit: 0,
      total_cost: 0,
      time_efficiency: 0,
      convenience: 0,
      schedule_compatibility: 0,
      reliability: 0,
      affiliate_value: 0,
      total: 0
    }
  } satisfies TransportationCandidate;
}

export function buildTransportationIntelligence(
  payload: TripPlannerPayload,
  config: TransportationIntelligenceConfig = {}
): TransportationDecision {
  const retrievedAt = new Date().toISOString();
  const comparison: TransportComparison = compareTransportOptions(payload, {
    marketResults: config.marketResults,
    fixedTripCostCents: config.fixedTripCostCents,
    flightEstimateCents: config.flightEstimateCents,
    fallbackFlightEstimateCents: config.fallbackFlightEstimateCents
  });
  const baseCandidates = comparison.options.map((option) => baseCandidate(option, payload, config, retrievedAt));
  const maxCost = Math.max(1, ...baseCandidates.map((candidate) => candidate.price || 0));
  const maxMinutes = Math.max(1, ...baseCandidates.map((candidate) => candidate.door_to_door_minutes || 0));
  const scored = baseCandidates.map((candidate, index) => {
    const option = comparison.options[index];
    return {
      ...candidate,
      score_components: scoreCandidate({
        candidate,
        maxCost,
        maxMinutes,
        preferenceFit: preferenceMatches(candidate.mode, config, payload),
        realistic: option.realistic && candidate.data_freshness !== "unavailable"
      })
    } satisfies TransportationCandidate;
  });
  const drive = scored.find((candidate) => candidate.mode === "car");
  const expanded = [
    ...scored,
    ...(drive ? [rentalCarCandidateFromDrive(drive, payload, config)] : []),
    unavailableFerryCandidate(payload, retrievedAt)
  ];
  const viable = expanded.filter((candidate) => candidate.data_freshness !== "unavailable" && !candidate.rejected_reason && candidate.score_components.total > 0);
  const sorted = [...viable].sort((a, b) => b.score_components.total - a.score_components.total);
  const recommendation = sorted[0] || null;
  const backup = sorted.find((candidate) => candidate.id !== recommendation?.id) || null;
  const rejected = expanded
    .filter((candidate) => candidate.id !== recommendation?.id && candidate.id !== backup?.id)
    .map((candidate) => ({
      ...candidate,
      rejected_reason:
        candidate.rejected_reason ||
        (candidate.score_components.total < 45 ? "Lower customer-fit score after cost, time, convenience, and reliability were compared." : undefined)
    }));

  return {
    recommendation,
    why_it_wins: recommendation
      ? `${recommendation.mode.replace("_", " ")} has the strongest customer-fit score after cost, door-to-door time, convenience, and reliability were compared.`
      : "No reliable transportation recommendation is available until provider data is configured or the route is clarified.",
    major_tradeoffs: recommendation?.warnings || ["Provider data may be unavailable. Roamly did not invent live schedules or prices."],
    rejected_alternatives: rejected,
    backup,
    candidates: expanded,
    user_override_supported: true,
    user_facing_recommendation: recommendation
      ? "Roamly recommends this option for your trip."
      : "Roamly needs more transportation data before recommending one option for your trip.",
    evidence: {
      retrieved_at: retrievedAt,
      provider_sources: Array.from(new Set(expanded.map((candidate) => candidate.source))),
      assumptions: comparison.assumptions
    }
  };
}
