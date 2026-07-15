import { resolveTravelIataCode } from "@/lib/roamly/airportResolver";
import { resolveCityPlace } from "@/lib/roamly/placeResolver";

export type BookingUrlType = "affiliate" | "normal_search" | "fallback";

export type TravelersInput =
  | number
  | {
      adults?: number | null;
      children?: number | null;
      infants?: number | null;
    }
  | null
  | undefined;

export type BookingLinkResult = {
  href: string;
  provider: string;
  urlType: BookingUrlType;
  hasAffiliateUrl: boolean;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function positiveInteger(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return fallback;
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => clean(part)).filter(Boolean).join(" ");
}

function parseDate(value?: string | null) {
  const raw = clean(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatDate(value?: string | null, month: "short" | "long" = "short") {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month,
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function isoDate(value?: string | null) {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

export function safeExternalUrl(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function roamlyDiscoveryUrl(category: string, query: string, params: Record<string, string | number | null | undefined> = {}) {
  const cleaned = clean(query);
  const url = new URL("/plan", "https://roamlyhq.com");
  url.searchParams.set("source", "booking_fallback");
  url.searchParams.set("category", category);
  if (cleaned) url.searchParams.set("destination", cleaned);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim()) url.searchParams.set(key, String(value).trim());
  }
  return `${url.pathname}${url.search}`;
}

function googleMapsSearchUrl(query: string) {
  const cleaned = clean(query);
  if (!cleaned) return "";
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", cleaned);
  return url.toString();
}

function withParams(base: string, params: Record<string, string | number | null | undefined>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value).trim());
    }
  }
  return url.toString();
}

export function resolveAviasalesCode(value?: string | null) {
  return resolveTravelIataCode(value);
}

export function formatAviasalesDate(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}${iso[2]}`;

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return "";

  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${day}${month}`;
}

export function buildAviasalesSearchPath({
  origin,
  destination,
  departureDate,
  returnDate,
  travelers
}: {
  origin?: string | null;
  destination?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  travelers?: TravelersInput;
}) {
  const originCode = resolveAviasalesCode(origin);
  const destinationCode = resolveAviasalesCode(destination);
  const departure = formatAviasalesDate(departureDate);
  const returning = formatAviasalesDate(returnDate);
  const passengerCount = typeof travelers === "number"
    ? positiveInteger(travelers, 1)
    : positiveInteger(travelers?.adults, 1);

  if (!originCode || !destinationCode || !departure || !returning) return "";

  return `${originCode}${departure}${destinationCode}${returning}${Math.max(1, Math.min(9, passengerCount))}`;
}

export function buildAviasalesDeepLink({
  origin,
  destination,
  departureDate,
  returnDate,
  travelers,
  marker
}: {
  origin?: string | null;
  destination?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  travelers?: TravelersInput;
  marker?: string | null;
}) {
  const path = buildAviasalesSearchPath({ origin, destination, departureDate, returnDate, travelers });
  if (!path) return "";

  const url = new URL(`https://www.aviasales.com/search/${path}`);
  const affiliateMarker = clean(marker);
  if (affiliateMarker) url.searchParams.set("marker", affiliateMarker);
  return url.toString();
}

function withAirportHint(value?: string | null) {
  const label = clean(value);
  if (!label) return "";
  if (/\b[A-Z]{3}\b/.test(label)) return label;
  const code = resolveTravelIataCode(label);
  return code ? `${label} ${code}` : label;
}

function resolvedPlaceLabel(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  return resolveCityPlace(raw)?.searchLabel || "";
}

function travelersText(travelers: TravelersInput) {
  if (typeof travelers === "number") {
    const adults = positiveInteger(travelers, 1);
    return `${adults} ${adults === 1 ? "adult" : "adults"}`;
  }
  const adults = positiveInteger(travelers?.adults, 1);
  const children = positiveInteger(travelers?.children, 0);
  const infants = positiveInteger(travelers?.infants, 0);
  return [
    `${adults} ${adults === 1 ? "adult" : "adults"}`,
    children ? `${children} ${children === 1 ? "child" : "children"}` : "",
    infants ? `${infants} ${infants === 1 ? "infant" : "infants"}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function roomText(rooms?: number | null) {
  const count = positiveInteger(rooms, 1);
  return `${count} ${count === 1 ? "room" : "rooms"}`;
}

export function buildFlightSearchUrl({
  origin,
  destination,
  departureDate,
  returnDate,
  travelers
}: {
  origin?: string | null;
  destination?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  travelers?: TravelersInput;
}) {
  const from = withAirportHint(origin);
  const to = withAirportHint(destination);
  const route = from && to ? compact([from, "to", to]) : to ? compact(["flights to", to]) : from ? compact(["flights from", from]) : "";
  const query = compact([route || compact(["flights to", withAirportHint(destination)]), formatDate(departureDate), formatDate(returnDate), travelersText(travelers), "flight"]);
  if (!query) return "";
  return roamlyDiscoveryUrl("flight", to || destination || query, {
    origin: from,
    startDate: isoDate(departureDate),
    endDate: isoDate(returnDate)
  });
}

export function buildHotelSearchUrl({
  destination,
  checkInDate,
  checkOutDate,
  adults,
  children,
  rooms,
  neighborhood,
  roomType
}: {
  destination?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
  neighborhood?: string | null;
  roomType?: string | null;
}) {
  const adultCount = positiveInteger(adults, 1);
  const childCount = positiveInteger(children, 0);
  const area = clean(neighborhood);
  const city = resolvedPlaceLabel(destination);
  if (clean(destination) && !city) return "";
  const destinationPart = area && city && !area.toLowerCase().includes(city.toLowerCase()) ? city : "";
  const query = compact([
    area || city,
    destinationPart,
    roomType,
    formatDate(checkInDate),
    formatDate(checkOutDate),
    `${adultCount} ${adultCount === 1 ? "adult" : "adults"}`,
    childCount ? `${childCount} ${childCount === 1 ? "child" : "children"}` : "",
    roomText(rooms),
    "hotel"
  ]);
  if (!query) return "";
  return roamlyDiscoveryUrl("hotel", area || city || query, {
    checkInDate: isoDate(checkInDate),
    checkOutDate: isoDate(checkOutDate),
    adults: adultCount,
    children: childCount || undefined,
    rooms: positiveInteger(rooms, 1)
  });
}

export function buildAttractionTicketSearchUrl({
  attractionName,
  destination,
  date
}: {
  attractionName?: string | null;
  destination?: string | null;
  date?: string | null;
}) {
  const name = clean(attractionName);
  const place = destination ? resolvedPlaceLabel(destination) : "";
  if (clean(destination) && !place) return "";
  const query = compact([name, place, formatDate(date, "long"), "official site details"]);
  if (!query) return "";
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

export function buildTourSearchUrl({
  tourName,
  destination,
  date
}: {
  tourName?: string | null;
  destination?: string | null;
  date?: string | null;
}) {
  const place = destination ? resolvedPlaceLabel(destination) : "";
  if (clean(destination) && !place) return "";
  const query = compact([tourName, place, formatDate(date, "long")]);
  if (!query) return "";
  return roamlyDiscoveryUrl("tour", place || tourName || query, { query });
}

export function buildTransportSearchUrl({
  origin,
  destination,
  date
}: {
  origin?: string | null;
  destination?: string | null;
  date?: string | null;
}) {
  const from = clean(origin);
  const to = clean(destination);
  if (from && to) {
    return withParams("https://www.google.com/maps/dir/", {
      api: "1",
      origin: from,
      destination: to,
      travelmode: "transit"
    });
  }
  return googleMapsSearchUrl(compact([from || to, formatDate(date), "transport directions"]));
}

export function normalBookingLink(href: string, provider: string, urlType: BookingUrlType = "normal_search"): BookingLinkResult | null {
  const safe = safeExternalUrl(href);
  return safe ? { href: safe, provider, urlType, hasAffiliateUrl: urlType === "affiliate" } : null;
}
