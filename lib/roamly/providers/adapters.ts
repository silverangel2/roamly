import { resolveAffiliateLink, type AffiliateCategory } from "@/lib/roamly/affiliateResolver";
import { buildTravelMarketSearchKey, type TravelMarketSearchRequest } from "@/lib/roamly/travelMarketSearch";

export type RoamlyProviderKind =
  | "flights"
  | "rail"
  | "bus"
  | "ferry"
  | "driving_distance"
  | "maps"
  | "hotels"
  | "activities"
  | "reviews"
  | "weather"
  | "currency_conversion"
  | "affiliates";

export type RoamlyProviderStatus = "available" | "unavailable" | "degraded";
export type RoamlyProviderStaleStatus = "fresh" | "stale" | "unknown" | "not_applicable";

export type RoamlyProviderError = {
  code: string;
  message: string;
  required_env?: string[];
  retryable: boolean;
};

export type RoamlyProviderRateLimit = {
  limited: boolean;
  remaining: number | null;
  reset_at: string | null;
};

export type RoamlyProviderResponse<T = unknown> = {
  provider: string;
  kind: RoamlyProviderKind;
  status: RoamlyProviderStatus;
  source: string;
  provider_identifier: string | null;
  retrieved_at: string;
  availability_at: string | null;
  raw_result: unknown;
  normalized_result: T | null;
  confidence: number;
  stale_status: RoamlyProviderStaleStatus;
  errors: RoamlyProviderError[];
  rate_limit: RoamlyProviderRateLimit | null;
};

export type RoamlyProviderDiagnostics = {
  kind: RoamlyProviderKind;
  provider: string;
  configured: boolean;
  required_env: string[];
  status: RoamlyProviderStatus;
};

type AdapterConfig = {
  kind: RoamlyProviderKind;
  provider: string;
  requiredEnv: string[];
  source: string;
  allowHonestEstimate?: boolean;
};

const ADAPTERS: Record<RoamlyProviderKind, AdapterConfig> = {
  flights: {
    kind: "flights",
    provider: "travelpayouts",
    requiredEnv: ["TRAVELPAYOUTS_API_TOKEN", "ROAMLY_TRAVELPAYOUTS_MARKER"],
    source: "Travelpayouts flight prices"
  },
  rail: {
    kind: "rail",
    provider: "rail_provider",
    requiredEnv: ["ROAMLY_RAIL_PROVIDER_API_KEY"],
    source: "Configured rail provider"
  },
  bus: {
    kind: "bus",
    provider: "bus_provider",
    requiredEnv: ["ROAMLY_BUS_PROVIDER_API_KEY"],
    source: "Configured bus provider"
  },
  ferry: {
    kind: "ferry",
    provider: "ferry_provider",
    requiredEnv: ["ROAMLY_FERRY_PROVIDER_API_KEY"],
    source: "Configured ferry provider"
  },
  driving_distance: {
    kind: "driving_distance",
    provider: "google_maps_distance_matrix",
    requiredEnv: ["GOOGLE_MAPS_API_KEY"],
    source: "Google Maps distance/directions",
    allowHonestEstimate: true
  },
  maps: {
    kind: "maps",
    provider: "google_maps",
    requiredEnv: ["GOOGLE_MAPS_API_KEY"],
    source: "Google Maps"
  },
  hotels: {
    kind: "hotels",
    provider: "stay22",
    requiredEnv: ["ROAMLY_STAY22_SMART_LINK_URL or traveler-safe ROAMLY_STAY22_REFERRAL_URL"],
    source: "Stay22 hotel links"
  },
  activities: {
    kind: "activities",
    provider: "klook",
    requiredEnv: ["KLOOK_API_KEY", "ROAMLY_KLOOK_PARTNER_ID"],
    source: "Klook activities"
  },
  reviews: {
    kind: "reviews",
    provider: "reviews_provider",
    requiredEnv: ["ROAMLY_REVIEWS_PROVIDER_API_KEY"],
    source: "Configured reviews provider"
  },
  weather: {
    kind: "weather",
    provider: "weather_provider",
    requiredEnv: ["ROAMLY_WEATHER_API_KEY"],
    source: "Configured weather provider"
  },
  currency_conversion: {
    kind: "currency_conversion",
    provider: "currency_provider",
    requiredEnv: ["ROAMLY_CURRENCY_API_KEY"],
    source: "Configured currency provider"
  },
  affiliates: {
    kind: "affiliates",
    provider: "roamly_affiliate_resolver",
    requiredEnv: ["ROAMLY_AFFILIATES_ENABLED", "ROAMLY_STAY22_SMART_LINK_URL or ROAMLY_KLOOK_PARTNER_ID or ROAMLY_TRAVELPAYOUTS_MARKER"],
    source: "Roamly affiliate resolver"
  }
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function envConfigured(requirement: string) {
  if (requirement.includes(" or ")) {
    return requirement.split(" or ").some((key) => Boolean(clean(process.env[key])));
  }
  if (requirement === "ROAMLY_AFFILIATES_ENABLED") {
    const value = clean(process.env.ROAMLY_AFFILIATES_ENABLED).toLowerCase();
    return value !== "false" && value !== "0" && value !== "disabled";
  }
  return Boolean(clean(process.env[requirement]));
}

function configured(config: AdapterConfig) {
  return config.requiredEnv.every(envConfigured);
}

function unavailable<T>(config: AdapterConfig, requiredEnv = config.requiredEnv): RoamlyProviderResponse<T> {
  return {
    provider: config.provider,
    kind: config.kind,
    status: "unavailable",
    source: config.source,
    provider_identifier: null,
    retrieved_at: nowIso(),
    availability_at: null,
    raw_result: null,
    normalized_result: config.allowHonestEstimate ? ({ estimate_allowed: true } as T) : null,
    confidence: 0,
    stale_status: "unknown",
    errors: [
      {
        code: "PROVIDER_CREDENTIALS_MISSING",
        message: `${config.provider} is not configured. Roamly will not fabricate live availability, schedules, ratings, reviews, prices, or distances.`,
        required_env: requiredEnv,
        retryable: false
      }
    ],
    rate_limit: null
  };
}

function available<T>(config: AdapterConfig, normalized: T, raw: unknown = null): RoamlyProviderResponse<T> {
  const now = nowIso();
  return {
    provider: config.provider,
    kind: config.kind,
    status: "available",
    source: config.source,
    provider_identifier: null,
    retrieved_at: now,
    availability_at: now,
    raw_result: raw,
    normalized_result: normalized,
    confidence: 0.65,
    stale_status: "fresh",
    errors: [],
    rate_limit: { limited: false, remaining: null, reset_at: null }
  };
}

export function providerDiagnostics(): RoamlyProviderDiagnostics[] {
  return Object.values(ADAPTERS).map((adapter) => {
    const isConfigured = configured(adapter);
    return {
      kind: adapter.kind,
      provider: adapter.provider,
      configured: isConfigured,
      required_env: adapter.requiredEnv,
      status: isConfigured ? "available" : "unavailable"
    };
  });
}

export function validateProviderEnvironment(kind: RoamlyProviderKind) {
  const adapter = ADAPTERS[kind];
  const missing = adapter.requiredEnv.filter((requirement) => !envConfigured(requirement));
  return {
    ok: missing.length === 0,
    kind,
    provider: adapter.provider,
    required_env: adapter.requiredEnv,
    missing_env: missing
  };
}

export async function flightProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.flights;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    search_key: buildTravelMarketSearchKey({ ...request, category: "flight" }),
    provider_backed: true,
    live_prices_require_query: true
  });
}

export async function railProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.rail;
  if (!configured(config)) return unavailable(config);
  return available(config, { search_key: buildTravelMarketSearchKey({ ...request, category: "transport" }), provider_backed: true });
}

export async function busProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.bus;
  if (!configured(config)) return unavailable(config);
  return available(config, { search_key: buildTravelMarketSearchKey({ ...request, category: "transport" }), provider_backed: true });
}

export async function ferryProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.ferry;
  if (!configured(config)) return unavailable(config);
  return available(config, { search_key: buildTravelMarketSearchKey({ ...request, category: "transport" }), provider_backed: true });
}

export async function drivingDistanceProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.driving_distance;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    origin: request.origin || null,
    destination: request.destination || request.city || null,
    provider_backed: true,
    live_distance_requires_query: true
  });
}

export async function mapsProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.maps;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    destination: request.destination || request.city || null,
    provider_backed: true,
    geocoding_or_places_query_required: true
  });
}

export async function hotelProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.hotels;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    search_key: buildTravelMarketSearchKey({ ...request, category: "hotel" }),
    provider_backed: true,
    affiliate_link_available: true
  });
}

export async function activitiesProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.activities;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    search_key: buildTravelMarketSearchKey({ ...request, category: "attraction" }),
    provider_backed: true,
    live_activity_prices_require_query: true
  });
}

export async function reviewsProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.reviews;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    destination: request.destination || request.city || null,
    provider_backed: true,
    live_reviews_require_query: true
  });
}

export async function weatherProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.weather;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    destination: request.destination || request.city || null,
    start_date: request.start_date || null,
    end_date: request.end_date || null,
    provider_backed: true,
    live_weather_requires_query: true
  });
}

export async function currencyConversionProviderAdapter(request: TravelMarketSearchRequest) {
  const config = ADAPTERS.currency_conversion;
  if (!configured(config)) return unavailable(config);
  return available(config, {
    currency: request.currency || null,
    provider_backed: true,
    live_rates_require_query: true
  });
}

export async function affiliateProviderAdapter(input: {
  category: AffiliateCategory;
  destination?: string | null;
  origin?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const config = ADAPTERS.affiliates;
  const resolved = resolveAffiliateLink(input);
  if (!resolved.configured || !resolved.finalUrl) {
    return unavailable<typeof resolved>(config, resolved.missingConfiguration.length ? resolved.missingConfiguration : config.requiredEnv);
  }
  return available(config, resolved, resolved);
}

export const ROAMLY_PROVIDER_ADAPTERS = {
  flights: flightProviderAdapter,
  rail: railProviderAdapter,
  bus: busProviderAdapter,
  ferry: ferryProviderAdapter,
  driving_distance: drivingDistanceProviderAdapter,
  maps: mapsProviderAdapter,
  hotels: hotelProviderAdapter,
  activities: activitiesProviderAdapter,
  reviews: reviewsProviderAdapter,
  weather: weatherProviderAdapter,
  currency_conversion: currencyConversionProviderAdapter,
  affiliates: affiliateProviderAdapter
};
