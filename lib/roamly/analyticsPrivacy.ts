const ANALYTICS_ORIGIN = "https://roamly.invalid";
const UUID_PATH_SEGMENT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const EVENT_TYPES = new Set([
  "page_view", "homepage_view", "plan_started", "origin_selected", "destination_selected", "city_stop_added",
  "dates_selected", "budget_submitted", "price_discovery_started", "price_discovery_completed", "price_discovery_failed",
  "itinerary_generation_started", "itinerary_generation_completed", "itinerary_generation_failed", "itinerary_generation_resumed",
  "multi_city_selected", "booking_link_viewed", "affiliate_provider_missing", "booking_link_clicked"
]);

const ENUMS: Record<string, readonly string[]> = {
  tripType: ["single_destination", "multi_city"],
  budgetStatus: ["within_budget", "tight", "over_budget", "unknown"],
  category: ["hotel", "flight", "activity", "attraction", "restaurant", "transport", "product", "insurance", "other"],
  provider: ["direct", "booking.com", "bookingcom", "stay22", "travelpayouts", "klook", "amazon", "google", "other"],
  affiliateProvider: ["direct", "booking.com", "bookingcom", "stay22", "travelpayouts", "klook", "amazon", "google", "other"],
  urlType: ["affiliate", "normal_search"],
  source: ["places", "geocoding", "curated", "custom", "mapbox", "google"]
};

function countBucket(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return "1";
  if (value === 2) return "2";
  if (value <= 4) return "3-4";
  return "5+";
}

export function sanitizeAnalyticsEventType(value: unknown) {
  return typeof value === "string" && EVENT_TYPES.has(value) ? value : null;
}

export function sanitizeAnalyticsEventMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, string | boolean> = {};
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const candidate = input[key] ?? input[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    if (typeof candidate === "string" && allowed.includes(candidate.toLowerCase())) output[key] = candidate.toLowerCase();
  }
  for (const key of ["daysCount", "travelersCount", "rooms", "stopCount"] as const) {
    const bucket = countBucket(input[key] ?? input[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]);
    if (bucket) output[key] = bucket;
  }
  for (const key of ["budgetIncludesFlights", "budgetIncludesHotel", "budgetIncludesActivities", "hasAffiliateUrl"] as const) {
    const candidate = input[key] ?? input[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    if (typeof candidate === "boolean") output[key] = candidate;
  }
  return output;
}

export function sanitizeAnalyticsLanguage(value: unknown) {
  if (typeof value !== "string" || value.length > 35) return null;
  const language = value.trim();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(language) ? language.toLowerCase() : null;
}

export function sanitizeAnalyticsPlatform(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (/iphone|ipad|ios/.test(normalized)) return "ios";
  if (/android/.test(normalized)) return "android";
  if (/mac/.test(normalized)) return "macos";
  if (/win/.test(normalized)) return "windows";
  if (/linux|x11/.test(normalized)) return "linux";
  return null;
}

export function sanitizeAnalyticsPath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;

  try {
    const parsed = new URL(value.trim(), ANALYTICS_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.pathname.replace(UUID_PATH_SEGMENT, ":id").slice(0, 512) || "/";
  } catch {
    return null;
  }
}

export function analyticsReferrerHost(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) return null;

  try {
    const parsed = new URL(value.trim(), ANALYTICS_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase().slice(0, 253) || null;
  } catch {
    return null;
  }
}

export function sanitizeAnalyticsVisitorKey(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}
