import { normalizeLocale, translateExactText, type RoamlyLocale } from "@/lib/i18n";

export const ROAMLY_GENERATION_LANGUAGE_INSTRUCTION = (locale: RoamlyLocale | string | null | undefined) => {
  const selected = normalizeLocale(locale);
  const names: Record<RoamlyLocale, string> = {
    en: "English", fr: "French", es: "Spanish", ja: "Japanese", ko: "Korean", zh: "Simplified Chinese"
  };
  return `Language contract: write ALL Roamly descriptive and customer-facing prose in ${names[selected]}. Preserve official proper nouns exactly, including hotel names, airline names, business and restaurant names, airport codes, addresses, booking/reference codes, provider/brand names (Amazon, Stay22, Travelpayouts, Google Maps, Apple Maps, Citymapper), product/model names, and URLs. JSON keys and schema remain unchanged; localize only customer-facing values. Return valid JSON matching the required schema.`;
};

export const ROAMLY_TRAVELER_PRIORITY_CONTRACT = `Traveler priority contract:
1. Confirmed bookings are fixed anchors and must not be moved, replaced, or treated as recommendations.
2. Explicit traveler must-do events, booking comments, special requests, festivals, concerts, appointments, and named activities are primary itinerary anchors.
3. Build the itinerary around those anchors, reserving known dates, times, venues, travel buffers, and nearby logistics first.
4. Generic recommendations fill only the remaining time.
5. Affiliate relationships, payout, or provider availability must never override traveler intent or objective fit.
6. If an explicit request cannot be verified or is impossible, preserve it as a must-do requiring verification, explain the conflict, and propose the nearest feasible alternative; never silently drop it or invent a time, price, availability, or booking.`;

const protectedKeys = new Set([
  "id", "activity_id", "booking_id", "trip_id", "user_id", "url", "href", "normal_search_url", "affiliate_url",
  "amazon_url", "map_query", "search_query", "currency", "provider", "provider_or_search_source", "affiliate_provider",
  "category", "item_type", "booking_category", "booking_status", "free_or_paid", "priority", "price_type", "market_confidence",
  "status", "mode", "travel_mode", "transportMode", "source", "evidence_status",
  "flight_number", "airport_code", "iata", "latitude", "longitude", "date", "start_date", "end_date",
  "scheduled_start", "scheduled_end", "startTime", "endTime", "time_label", "timeZone", "timezone"
]);

function shouldPreserve(key: string, value: string) {
  return protectedKeys.has(key) || /^(Amazon|Stay22|Travelpayouts|Google Maps|Apple Maps|Citymapper|Roamly|Airalo)$/i.test(value) || /(?:url|code|number|timestamp|_at)$/i.test(key) || /^https?:\/\//i.test(value);
}

/** Localizes exact known Roamly-owned fallback phrases without touching itinerary facts or provider data. */
export function localizeGeneratedExactText(value: unknown, locale: RoamlyLocale | string | null | undefined, key = ""): unknown {
  if (typeof value === "string") return shouldPreserve(key, value) ? value : translateExactText(normalizeLocale(locale), value);
  if (Array.isArray(value)) return value.map((item) => localizeGeneratedExactText(item, locale, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, localizeGeneratedExactText(child, locale, childKey)]));
  }
  return value;
}
