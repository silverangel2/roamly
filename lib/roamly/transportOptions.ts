import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { resolveAffiliateLink } from "@/lib/roamly/affiliateResolver";
import { detectCrossBorderTrip } from "@/lib/roamly/crossBorder";
import { recommendedPlaces, type NormalizedPlace } from "@/lib/roamly/places";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

export type TransportMode = "flight" | "drive" | "train" | "bus" | "mixed";
export type TransportPriceConfidence = "live_partner" | "cached_recent" | "estimated" | "unknown";
export type TransportBudgetFit = "best" | "okay" | "expensive" | "unknown";
export type TransportAvailability = "verified" | "search_ready" | "unverified" | "not_available";

export type TransportOption = {
  mode: TransportMode;
  availability: TransportAvailability;
  realistic: boolean;
  title: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  estimated_duration_hours: number | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  currency: string;
  duration_label?: string;
  distance_km?: number;
  cost_breakdown?: {
    gas?: number;
    parking?: number;
    tolls?: number;
    train_or_bus_ticket?: number;
    flight?: number;
    baggage?: number;
    airport_transfer?: number;
    overnight_stop?: number;
    border_delay_buffer?: number;
    roaming_esim?: number;
  };
  price_confidence: TransportPriceConfidence;
  search_url?: string;
  booking_url?: string;
  reason: string;
  warning: string;
  source: string;
  why_recommended: string;
  budget_fit: TransportBudgetFit;
};

export type TransportComparison = {
  options: TransportOption[];
  recommendedOption: TransportOption | null;
  assumptions: string[];
};

type TransportBuildInput = Partial<
  Pick<
    TripPlannerPayload,
    | "tripType"
    | "origin"
    | "originPlace"
    | "originCity"
    | "originRegion"
    | "originCountry"
    | "originLatitude"
    | "originLongitude"
    | "destination"
    | "destinationPlace"
    | "destinationCity"
    | "destinationRegion"
    | "destinationCountry"
    | "destinationLatitude"
    | "destinationLongitude"
    | "destinationStops"
    | "returnToOrigin"
    | "startDate"
    | "endDate"
    | "daysCount"
    | "travelersCount"
    | "travelers"
    | "budgetAmount"
    | "budgetCurrency"
  >
> & {
  destination: string;
};

type BuildOptionsConfig = {
  marketResults?: TravelMarketResult[] | null;
  flightEstimateCents?: number | null;
  fallbackFlightEstimateCents?: number | null;
  fixedTripCostCents?: number;
};

const DEFAULT_FUEL_L_PER_100KM = 8.5;
const DRIVE_ROUTE_MULTIPLIER = 1.18;
const MAX_REASONABLE_DRIVE_KM = 1200;
const MAX_SAME_COUNTRY_DRIVE_KM = 1400;
const END_DATE_WARNING = "Cheaper is not always better if it costs too much travel time.";

const gasPriceByCountry: Record<string, number> = {
  canada: 1.7,
  "united states": 1.05,
  usa: 1.05,
  france: 1.95,
  "united kingdom": 1.85,
  italy: 1.9,
  spain: 1.7,
  portugal: 1.75,
  australia: 1.85,
  japan: 1.15,
  "south korea": 1.55,
  singapore: 2.75,
  thailand: 1.35,
  indonesia: 0.95,
  "united arab emirates": 0.9
};

const cityParkingDailyByPattern: Array<[RegExp, number]> = [
  [/\bmontreal\b|\bmontr[eé]al\b/i, 28],
  [/\btoronto\b|\bvancouver\b|\bnew york\b|\blos angeles\b|\bparis\b|\blondon\b|\btokyo\b|\bsydney\b/i, 34],
  [/\bottawa\b|\bquebec\b|\bhalifax\b|\bcalgary\b|\blas vegas\b|\bbarcelona\b|\brome\b/i, 22]
];

const regionalAirportOptions: Array<{
  originPattern: RegExp;
  airportName: string;
  airportCode: string;
  driveKm: number;
  driveDuration: string;
}> = [
  {
    originPattern: /\bsaint john\b/i,
    airportName: "Moncton airport",
    airportCode: "YQM",
    driveKm: 155,
    driveDuration: "about 1 hr 45 min to Moncton"
  },
  {
    originPattern: /\bsaint john\b/i,
    airportName: "Halifax airport",
    airportCode: "YHZ",
    driveKm: 415,
    driveDuration: "about 4 hr 15 min to Halifax"
  },
  {
    originPattern: /\bfredericton\b/i,
    airportName: "Moncton airport",
    airportCode: "YQM",
    driveKm: 175,
    driveDuration: "about 2 hr to Moncton"
  }
];

function clean(value?: string | null) {
  return (value || "").trim();
}

function internalTransportDiscoveryUrl(category: string, origin: string, destination: string, date?: string | null) {
  void category;
  void origin;
  void destination;
  void date;
  return "";
}

function cleanCurrency(value?: string | null) {
  return clean(value).toUpperCase() || "CAD";
}

function cleanDate(value?: string | null) {
  const raw = clean(value);
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : raw;
}

function positiveNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function roundedMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function centsToAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value / 100)) : null;
}

function travelersCount(input: TransportBuildInput) {
  if (typeof input.travelersCount === "number" && Number.isFinite(input.travelersCount) && input.travelersCount > 0) {
    return Math.max(1, Math.round(input.travelersCount));
  }
  const travelers = input.travelers;
  if (travelers && typeof travelers === "object") {
    return Math.max(1, Math.round((travelers.adults || 1) + (travelers.children || 0) + (travelers.infants || 0)));
  }
  return 1;
}

function placeFromInput(
  input: TransportBuildInput,
  side: "origin" | "destination",
  fallbackLabel: string
): NormalizedPlace | undefined {
  const explicit = side === "origin" ? input.originPlace : input.destinationPlace;
  if (explicit) return explicit;

  const label = side === "origin" ? input.origin : input.destination;
  const city = side === "origin" ? input.originCity : input.destinationCity;
  const region = side === "origin" ? input.originRegion : input.destinationRegion;
  const country = side === "origin" ? input.originCountry : input.destinationCountry;
  const latitude = side === "origin" ? input.originLatitude : input.destinationLatitude;
  const longitude = side === "origin" ? input.originLongitude : input.destinationLongitude;
  if (typeof latitude === "number" && typeof longitude === "number") {
    return {
      label: clean(label) || fallbackLabel,
      value: clean(label) || fallbackLabel,
      city: city || undefined,
      region: region || undefined,
      country: country || undefined,
      latitude,
      longitude,
      source: "custom"
    };
  }

  const search = [label, city, region, country].filter(Boolean).join(" ").toLowerCase();
  if (search) {
    const match = recommendedPlaces.find((place) => {
      const haystack = [place.label, place.value, place.city, place.region, place.country]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search) || search.includes((place.city || place.label).toLowerCase());
    });
    if (match) return match;
  }

  if (!clean(label)) return undefined;
  return {
    label: clean(label),
    value: clean(label),
    city: city || undefined,
    region: region || undefined,
    country: country || undefined,
    source: "custom"
  };
}

function destinationPlace(input: TransportBuildInput) {
  if (input.tripType === "multi_city" && input.destinationStops?.length) return input.destinationStops[0];
  return placeFromInput(input, "destination", input.destination || "Destination");
}

function placeLabel(place: NormalizedPlace | undefined, fallback: string) {
  return place?.value || place?.label || fallback;
}

function placeCountry(place: NormalizedPlace | undefined, fallback?: string | null) {
  return clean(place?.country || fallback);
}

function countryHintFromLabel(label: string) {
  const text = label.toLowerCase();
  if (/\bsaint john\b|\bmoncton\b|\bfredericton\b|\bhalifax\b|\bmontreal\b|\bmontr[eé]al\b|\btoronto\b|\bottawa\b|\bquebec\b/.test(text)) {
    return "canada";
  }
  if (/\bnew york\b|\bboston\b|\bwashington\b|\bphiladelphia\b|\bchicago\b|\blos angeles\b|\blas vegas\b/.test(text)) {
    return "united states";
  }
  return "";
}

function inferredCountry(place: NormalizedPlace | undefined, fallback: string | null | undefined, label: string) {
  return placeCountry(place, fallback).toLowerCase() || countryHintFromLabel(label);
}

function sameCountry(origin: NormalizedPlace | undefined, destination: NormalizedPlace | undefined, input: TransportBuildInput) {
  const originCountry = inferredCountry(origin, input.originCountry, input.origin || "");
  const destinationCountry = inferredCountry(destination, input.destinationCountry, input.destination || "");
  return Boolean(originCountry && destinationCountry && originCountry === destinationCountry);
}

function crossBorder(origin: NormalizedPlace | undefined, destination: NormalizedPlace | undefined, input: TransportBuildInput, originLabel: string, destinationLabel: string) {
  const detected = detectCrossBorderTrip({
    origin: originLabel,
    originCountry: inferredCountry(origin, input.originCountry, originLabel),
    destination: destinationLabel,
    destinationCountry: inferredCountry(destination, input.destinationCountry, destinationLabel),
    routeText: `${originLabel} ${destinationLabel}`
  });
  return detected.cross_border;
}

function haversineKm(a?: NormalizedPlace, b?: NormalizedPlace) {
  if (typeof a?.latitude !== "number" || typeof a?.longitude !== "number") return null;
  if (typeof b?.latitude !== "number" || typeof b?.longitude !== "number") return null;
  const radius = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fallbackDistanceKm(originLabel: string, destinationLabel: string) {
  const text = `${originLabel} ${destinationLabel}`.toLowerCase();
  if (text.includes("saint john") && (text.includes("montreal") || text.includes("montréal"))) return 755;
  if (text.includes("saint john") && text.includes("new york")) return 1110;
  if (text.includes("toronto") && (text.includes("montreal") || text.includes("montréal"))) return 545;
  if (text.includes("ottawa") && (text.includes("montreal") || text.includes("montréal"))) return 200;
  return null;
}

function routeDistanceKm(origin: NormalizedPlace | undefined, destination: NormalizedPlace | undefined, originLabel: string, destinationLabel: string) {
  const fallback = fallbackDistanceKm(originLabel, destinationLabel);
  if (fallback) return fallback;
  const straightLine = haversineKm(origin, destination);
  return straightLine == null ? null : Math.round(straightLine * DRIVE_ROUTE_MULTIPLIER);
}

function tripNights(input: TransportBuildInput) {
  const days = positiveNumber(input.daysCount, 3);
  return Math.max(1, Math.round(days) - 1);
}

function tripDays(input: TransportBuildInput) {
  return Math.max(1, Math.round(positiveNumber(input.daysCount, 3)));
}

function gasPricePerLiter(country: string) {
  return gasPriceByCountry[country.toLowerCase()] || 1.55;
}

function parkingDaily(destinationLabel: string) {
  const match = cityParkingDailyByPattern.find(([pattern]) => pattern.test(destinationLabel));
  return match?.[1] || 0;
}

function drivingUrl(origin: string, destination: string) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

function durationLabelFromDistance(distanceKm: number | null) {
  if (!distanceKm) return undefined;
  const hours = driveHoursFromDistance(distanceKm) || 1;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes >= 10 ? `about ${whole} hr ${minutes} min one way` : `about ${Math.round(hours)} hr one way`;
}

function driveHoursFromDistance(distanceKm: number | null) {
  if (!distanceKm) return null;
  return Math.max(1, distanceKm / 86 + Math.min(1.5, distanceKm / 650));
}

function surfaceHoursFromDistance(distanceKm: number | null, mode: "train" | "bus") {
  if (!distanceKm) return null;
  const speed = mode === "train" ? 88 : 72;
  const transferPadding = mode === "train" ? 1.5 : 2.25;
  return Math.max(1, distanceKm / speed + transferPadding);
}

function flightHoursFromDistance(distanceKm: number | null) {
  if (!distanceKm) return null;
  return Math.max(3.5, distanceKm / 760 + 3);
}

function maxSurfaceHoursForTrip(days: number, mode: TransportMode) {
  if (mode === "drive") {
    if (days <= 3) return 6;
    if (days <= 5) return 9;
    if (days <= 8) return 13;
    return 15;
  }
  if (days <= 3) return 5;
  if (days <= 5) return 8;
  if (days <= 8) return 10;
  return 12;
}

function tooLongForTrip(hours: number | null, days: number, mode: TransportMode) {
  if (hours == null) return false;
  if (mode === "flight" || mode === "mixed") return false;
  return hours > maxSurfaceHoursForTrip(days, mode);
}

function knownRailCorridor(originLabel: string, destinationLabel: string) {
  const text = `${originLabel} ${destinationLabel}`.toLowerCase();
  return (
    (text.includes("toronto") && (text.includes("montreal") || text.includes("montréal"))) ||
    (text.includes("ottawa") && (text.includes("montreal") || text.includes("montréal"))) ||
    (text.includes("quebec") && (text.includes("montreal") || text.includes("montréal"))) ||
    (text.includes("toronto") && text.includes("ottawa"))
  );
}

function knownBusCorridor(originLabel: string, destinationLabel: string, distanceKm: number | null, isCrossBorder: boolean) {
  if (isCrossBorder && (distanceKm == null || distanceKm > 350)) return false;
  if (distanceKm != null && distanceKm <= 450) return true;
  const text = `${originLabel} ${destinationLabel}`.toLowerCase();
  return (
    (text.includes("toronto") && (text.includes("montreal") || text.includes("montréal"))) ||
    (text.includes("ottawa") && (text.includes("montreal") || text.includes("montréal"))) ||
    (text.includes("halifax") && text.includes("moncton")) ||
    (text.includes("saint john") && text.includes("moncton"))
  );
}

function unavailableOption(params: {
  mode: TransportMode;
  origin: string;
  destination: string;
  input: TransportBuildInput;
  title: string;
  reason: string;
  warning: string;
  source: string;
}) {
  return {
    mode: params.mode,
    availability: "not_available",
    realistic: false,
    title: params.title,
    origin: params.origin,
    destination: params.destination,
    departure_date: cleanDate(params.input.startDate),
    return_date: params.input.returnToOrigin === false ? undefined : cleanDate(params.input.endDate),
    estimated_duration_hours: null,
    estimated_cost_min: null,
    estimated_cost_max: null,
    currency: cleanCurrency(params.input.budgetCurrency),
    price_confidence: "unknown",
    reason: params.reason,
    warning: params.warning,
    source: params.source,
    why_recommended: params.reason,
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function optionAverage(option: Pick<TransportOption, "estimated_cost_min" | "estimated_cost_max">) {
  if (option.estimated_cost_min != null && option.estimated_cost_max != null) {
    return (option.estimated_cost_min + option.estimated_cost_max) / 2;
  }
  return option.estimated_cost_min ?? option.estimated_cost_max ?? null;
}

function optionMax(option: Pick<TransportOption, "estimated_cost_min" | "estimated_cost_max">) {
  return option.estimated_cost_max ?? option.estimated_cost_min ?? null;
}

function flightMarketPrice(marketResults: TravelMarketResult[] | null | undefined) {
  const matches = (marketResults || [])
    .filter((result) => result.category === "flight")
    .sort((a, b) => {
      const rank = (value: TravelMarketResult) => (value.price_type === "live_partner" ? 0 : value.price_type === "cached_recent" ? 1 : 2);
      return rank(a) - rank(b);
    });
  const priced = matches.find((result) => {
    const price = result.price_amount ?? result.price_max ?? result.price_min;
    return typeof price === "number" && Number.isFinite(price) && price > 0;
  });
  if (!priced) return null;
  const min = roundedMoney(priced.price_min ?? priced.price_amount);
  const max = roundedMoney(priced.price_max ?? priced.price_amount);
  return {
    min,
    max,
    confidence: priced.price_type === "live_partner" ? "live_partner" : priced.price_type === "cached_recent" ? "cached_recent" : "estimated",
    source: priced.provider || priced.source || "Flight market search",
    bookingUrl: safeExternalUrl(priced.booking_url) || safeExternalUrl(priced.affiliate_url) || safeExternalUrl(priced.normal_search_url) || undefined,
    searchUrl: safeExternalUrl(priced.normal_search_url) || undefined
  } satisfies {
    min: number | null;
    max: number | null;
    confidence: TransportPriceConfidence;
    source: string;
    bookingUrl?: string;
    searchUrl?: string;
  };
}

function flightAffiliateSearchUrl(input: TransportBuildInput, origin: string, destination: string) {
  return safeExternalUrl(
    resolveAffiliateLink({
      category: "flight",
      origin,
      destination,
      startDate: input.startDate,
      endDate: input.returnToOrigin === false ? undefined : input.endDate,
      travelers: input.travelers || travelersCount(input),
      adults: travelersCount(input),
      currency: input.budgetCurrency
    }).finalUrl
  );
}

function flightOption(input: TransportBuildInput, origin: string, destination: string, config: BuildOptionsConfig, distanceKm: number | null): TransportOption {
  const currency = cleanCurrency(input.budgetCurrency);
  const market = flightMarketPrice(config.marketResults);
  const fallback = centsToAmount(config.flightEstimateCents || config.fallbackFlightEstimateCents || null);
  const travelers = travelersCount(input);
  const routeCrossesBorder = crossBorder(undefined, undefined, input, origin, destination);
  const baseMin = market?.min ?? (fallback ? Math.max(1, Math.round(fallback * 0.88)) : null);
  const baseMax = market?.max ?? (fallback ? Math.max(1, Math.round(fallback * 1.12)) : null);
  const baggage = baseMax ? Math.round(45 * travelers) : undefined;
  const transfer = baseMax ? Math.round(35 * travelers) : undefined;
  const roamingEsim = routeCrossesBorder ? 35 : 0;
  const min = baseMin == null ? null : baseMin + Math.round(20 * travelers) + roamingEsim;
  const max = baseMax == null ? null : baseMax + (baggage || 0) + (transfer || 0) + roamingEsim;
  const flightSearchUrl = flightAffiliateSearchUrl(input, origin, destination);
  const availability: TransportAvailability = market?.confidence === "live_partner" || market?.confidence === "cached_recent" ? "verified" : "search_ready";
  const warning =
    availability === "verified"
      ? `Verify baggage, seat, transfer, and schedule details before booking.${routeCrossesBorder ? " Estimate includes a roaming/eSIM planning buffer; check coverage and device compatibility before buying." : ""}`
      : `Conservative flight estimate — refresh live prices before booking.${routeCrossesBorder ? " Estimate includes a roaming/eSIM planning buffer; check coverage and device compatibility before buying." : ""}`;
  const reason = "Fastest practical long-distance option when the route or trip length makes surface transport costly in time.";

  return {
    mode: "flight",
    availability,
    realistic: true,
    title: `${origin} to ${destination} flight option`,
    origin,
    destination,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_duration_hours: flightHoursFromDistance(distanceKm),
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency,
    duration_label: "faster, airport time required",
    cost_breakdown: {
      flight: baseMax ?? undefined,
      baggage,
      airport_transfer: transfer,
      roaming_esim: roamingEsim || undefined
    },
    price_confidence: market?.confidence || (fallback ? "estimated" : "unknown"),
    search_url: flightSearchUrl || undefined,
    booking_url: market?.bookingUrl || flightSearchUrl || undefined,
    reason,
    warning,
    source: market?.source || (flightSearchUrl ? "Travelpayouts flight search" : "Roamly flight estimate"),
    why_recommended: "Faster but more expensive. Use this when time matters more than keeping transport cost low.",
    budget_fit: "unknown"
  };
}

function buildDrivingOption(
  input: TransportBuildInput,
  originPlace: NormalizedPlace | undefined,
  destinationPlaceValue: NormalizedPlace | undefined,
  originLabel: string,
  destinationLabel: string
) {
  const distanceKm = routeDistanceKm(originPlace, destinationPlaceValue, originLabel, destinationLabel);
  const routeCrossesBorder = crossBorder(originPlace, destinationPlaceValue, input, originLabel, destinationLabel);
  const canEstimate =
    distanceKm == null
      ? sameCountry(originPlace, destinationPlaceValue, input)
      : distanceKm <= MAX_REASONABLE_DRIVE_KM || (sameCountry(originPlace, destinationPlaceValue, input) && distanceKm <= MAX_SAME_COUNTRY_DRIVE_KM);
  if (!canEstimate) {
    return unavailableOption({
      mode: "drive",
      origin: originLabel,
      destination: destinationLabel,
      input,
      title: `${originLabel} to ${destinationLabel} driving route`,
      reason: "Driving was not selected because Roamly cannot estimate a realistic road route for this distance with the current data.",
      warning: "Needs live route verification before considering driving.",
      source: "Google Maps search"
    });
  }

  const oneWayKm = distanceKm || 520;
  const roundTripMultiplier = input.returnToOrigin === false ? 1 : 2;
  const country = placeCountry(originPlace, input.originCountry) || placeCountry(destinationPlaceValue, input.destinationCountry);
  const fuelLiters = (oneWayKm * roundTripMultiplier * DEFAULT_FUEL_L_PER_100KM) / 100;
  const gas = Math.round(fuelLiters * gasPricePerLiter(country));
  const dailyParking = parkingDaily(destinationLabel);
  const parking = dailyParking ? Math.round(dailyParking * Math.min(10, tripNights(input))) : 0;
  const tolls = routeCrossesBorder || /\bnew york\b|\bboston\b|\btoronto\b/i.test(destinationLabel) ? Math.round(45 * roundTripMultiplier) : 0;
  const borderDelayHours = routeCrossesBorder ? 1.5 : 0;
  const oneWayHours = (driveHoursFromDistance(oneWayKm) || 0) + borderDelayHours;
  const needsOvernightStop = oneWayHours != null && oneWayHours > 9;
  const overnightStop = needsOvernightStop ? Math.round(145 * roundTripMultiplier) : 0;
  const borderDelayBuffer = routeCrossesBorder ? Math.round(30 * roundTripMultiplier) : 0;
  const roamingEsim = routeCrossesBorder ? 35 : 0;
  const base = gas + parking + tolls + overnightStop + borderDelayBuffer + roamingEsim;
  const low = Math.max(1, Math.round(base * 0.9));
  const high = Math.max(low, Math.round(base * 1.18));
  const isTooLong = tooLongForTrip(oneWayHours, tripDays(input), "drive");
  const warning = isTooLong
    ? `Too long for this trip. ${END_DATE_WARNING}`
    : needsOvernightStop
      ? `Long drive. Estimate includes an overnight-stop buffer${routeCrossesBorder ? ", border time buffer, tolls, and roaming/eSIM planning estimate" : ""}; verify live route time, border timing, tolls, and parking.`
      : routeCrossesBorder
        ? "Border wait times can change. Allow extra time. Estimate includes border, toll, parking, and roaming/eSIM planning buffers."
        : "Driving estimate uses fuel, parking, and known toll assumptions until live maps/gas providers are connected.";
  const reason = isTooLong
    ? "Driving is possible to search, but the one-way travel time consumes too much of this trip."
    : "Driving can be realistic when the traveler has access to a car and accepts the time tradeoff.";

  return {
    mode: "drive",
    availability: "search_ready",
    realistic: !isTooLong,
    title: `${originLabel} to ${destinationLabel} driving estimate`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_duration_hours: oneWayHours,
    estimated_cost_min: low,
    estimated_cost_max: high,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: durationLabelFromDistance(oneWayKm),
    distance_km: Math.round(oneWayKm),
    cost_breakdown: {
      gas,
      parking: parking || undefined,
      tolls: tolls || undefined,
      overnight_stop: overnightStop || undefined,
      border_delay_buffer: borderDelayBuffer || undefined,
      roaming_esim: roamingEsim || undefined
    },
    price_confidence: "estimated",
    search_url: drivingUrl(originLabel, destinationLabel),
    booking_url: drivingUrl(originLabel, destinationLabel),
    reason,
    warning,
    source: "Google Maps route search",
    why_recommended:
      isTooLong
        ? `Not recommended because the drive takes too much travel time. ${END_DATE_WARNING}`
        : `Recommended because it can keep the trip closer to your budget. Driving estimate uses fuel, parking, toll, overnight-stop${routeCrossesBorder ? ", border, and roaming/eSIM" : ""} assumptions until live providers are connected.`,
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function trainAvailable(input: TransportBuildInput, originPlace: NormalizedPlace | undefined, destinationPlaceValue: NormalizedPlace | undefined) {
  return sameCountry(originPlace, destinationPlaceValue, input) && placeCountry(destinationPlaceValue, input.destinationCountry).toLowerCase() === "canada";
}

function buildTrainOption(
  input: TransportBuildInput,
  originPlace: NormalizedPlace | undefined,
  destinationPlaceValue: NormalizedPlace | undefined,
  originLabel: string,
  destinationLabel: string,
  distanceKm: number | null
) {
  const sameCountryCanada = trainAvailable(input, originPlace, destinationPlaceValue) || (sameCountry(originPlace, destinationPlaceValue, input) && countryHintFromLabel(destinationLabel) === "canada");
  const corridorReady = sameCountryCanada && knownRailCorridor(originLabel, destinationLabel);
  const availability: TransportAvailability = corridorReady ? "search_ready" : sameCountryCanada ? "unverified" : "not_available";
  const oneWayHours = surfaceHoursFromDistance(distanceKm, "train");
  const isTooLong = tooLongForTrip(oneWayHours, tripDays(input), "train");
  if (availability === "not_available") {
    return unavailableOption({
      mode: "train",
      origin: originLabel,
      destination: destinationLabel,
      input,
      title: `${originLabel} to ${destinationLabel} train route`,
      reason: "Roamly did not find a plausible rail corridor for this route without a live rail provider.",
      warning: "Train route not available from current data.",
      source: "Rail route estimate"
    });
  }
  const travelers = travelersCount(input);
  const roughBase = distanceKm ? Math.max(80, distanceKm * 0.16) : 160;
  const min = Math.round(roughBase * travelers * (input.returnToOrigin === false ? 0.72 : 1.15));
  const max = Math.round(Math.max(min + 40, roughBase * travelers * (input.returnToOrigin === false ? 1.1 : 1.7)));
  const trainUrl = internalTransportDiscoveryUrl("train", originLabel, destinationLabel, cleanDate(input.startDate));
  const realistic = availability === "search_ready" && !isTooLong;
  const warning =
    availability === "unverified"
      ? "Rail route is unverified without a live rail provider. Not recommended unless a provider confirms it."
      : isTooLong
        ? `Too long for this trip. ${END_DATE_WARNING}`
        : "Search-ready rail option. Refresh live schedule and price before booking.";
  const reason = realistic
    ? "Rail is on a plausible corridor and may be comfortable if the live schedule works."
    : "Rail is not recommended unless live provider search confirms a practical schedule.";

  return {
    mode: "train",
    availability,
    realistic,
    title: `${originLabel} to ${destinationLabel} train search`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_duration_hours: oneWayHours,
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: oneWayHours ? `about ${Math.round(oneWayHours)} hr one way if the schedule works` : "schedule varies by connection",
    distance_km: distanceKm ? Math.round(distanceKm) : undefined,
    cost_breakdown: {
      train_or_bus_ticket: max
    },
    price_confidence: "estimated",
    search_url: trainUrl,
    booking_url: trainUrl,
    reason,
    warning,
    source: "Rail schedule search",
    why_recommended: realistic ? "Search-ready rail option. Verify live schedule and price before booking." : warning,
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function buildBusOption(
  input: TransportBuildInput,
  originPlace: NormalizedPlace | undefined,
  destinationPlaceValue: NormalizedPlace | undefined,
  originLabel: string,
  destinationLabel: string,
  distanceKm: number | null
) {
  const isCrossBorder = crossBorder(originPlace, destinationPlaceValue, input, originLabel, destinationLabel);
  const corridorReady = knownBusCorridor(originLabel, destinationLabel, distanceKm, isCrossBorder);
  const availability: TransportAvailability =
    corridorReady
      ? "search_ready"
      : distanceKm != null && distanceKm > 900
        ? "not_available"
        : "unverified";
  const oneWayHours = (surfaceHoursFromDistance(distanceKm, "bus") || 0) + (isCrossBorder ? 1.5 : 0);
  const isTooLong = tooLongForTrip(oneWayHours, tripDays(input), "bus") || (isCrossBorder && (distanceKm == null || distanceKm > 500));
  if (availability === "not_available") {
    return unavailableOption({
      mode: "bus",
      origin: originLabel,
      destination: destinationLabel,
      input,
      title: `${originLabel} to ${destinationLabel} bus route`,
      reason: "Roamly did not find a practical bus route for this distance without a live provider.",
      warning: `Not recommended. ${END_DATE_WARNING}`,
      source: "Bus route estimate"
    });
  }
  const travelers = travelersCount(input);
  const roughBase = distanceKm ? Math.max(55, distanceKm * 0.105) : 115;
  const roamingEsim = isCrossBorder ? 35 : 0;
  const min = Math.round(roughBase * travelers * (input.returnToOrigin === false ? 0.75 : 1.15)) + roamingEsim;
  const max = Math.round(Math.max(min + 25, roughBase * travelers * (input.returnToOrigin === false ? 1.1 : 1.75) + roamingEsim));
  const busUrl = internalTransportDiscoveryUrl("bus", originLabel, destinationLabel, cleanDate(input.startDate));
  const realistic = availability === "search_ready" && !isTooLong;
  const warning =
    availability === "unverified"
      ? isCrossBorder
        ? "Cross-border route not verified — not recommended as primary option. Border wait times can change. Allow extra time."
        : "Bus route is unverified without a live provider. Not recommended unless a provider confirms a reasonable schedule."
      : isTooLong
        ? `Too long for this trip. ${END_DATE_WARNING}`
        : isCrossBorder
          ? "Border wait times can change. Allow extra time. Refresh live schedule and price before booking."
          : "Search-ready bus option. Refresh live schedule and price before booking.";
  const reason = realistic
    ? "Bus may be practical on this corridor if live schedule confirms reasonable travel time."
    : "Bus is not recommended unless a live provider confirms the route and timing.";

  return {
    mode: "bus",
    availability,
    realistic,
    title: `${originLabel} to ${destinationLabel} bus search`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_duration_hours: oneWayHours,
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: oneWayHours ? `about ${Math.round(oneWayHours)} hr one way if available` : "longer, schedule varies",
    distance_km: distanceKm ? Math.round(distanceKm) : undefined,
    cost_breakdown: {
      train_or_bus_ticket: max,
      roaming_esim: roamingEsim || undefined
    },
    price_confidence: "estimated",
    search_url: busUrl,
    booking_url: busUrl,
    reason,
    warning,
    source: "Bus schedule search",
    why_recommended: realistic ? "Search-ready bus option. Verify live schedule and price before booking." : warning,
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function buildMixedOption(input: TransportBuildInput, originLabel: string, destinationLabel: string, config: BuildOptionsConfig) {
  const airport = regionalAirportOptions.find((item) => item.originPattern.test(originLabel));
  if (!airport) {
    return unavailableOption({
      mode: "mixed",
      origin: originLabel,
      destination: destinationLabel,
      input,
      title: `${originLabel} to ${destinationLabel} mixed route`,
      reason: "Roamly did not find a practical drive-to-airport or mixed route strategy for this origin.",
      warning: "Mixed route not available from current data.",
      source: "Mixed route estimate"
    });
  }
  const currency = cleanCurrency(input.budgetCurrency);
  const travelers = travelersCount(input);
  const country = clean(input.originCountry || "Canada");
  const gas = Math.round(((airport.driveKm * (input.returnToOrigin === false ? 1 : 2) * DEFAULT_FUEL_L_PER_100KM) / 100) * gasPricePerLiter(country));
  const airportParking = input.returnToOrigin === false ? 0 : Math.round(18 * Math.min(10, tripNights(input)));
  const flightFallback = centsToAmount(config.flightEstimateCents || config.fallbackFlightEstimateCents || null);
  const flight = flightFallback ? Math.round(flightFallback * 0.82) : Math.round(240 * travelers);
  const transfer = Math.round(25 * travelers);
  const routeCrossesBorder = crossBorder(undefined, undefined, input, originLabel, destinationLabel);
  const roamingEsim = routeCrossesBorder ? 35 : 0;
  const low = Math.max(1, Math.round((gas + airportParking + flight + transfer + roamingEsim) * 0.9));
  const high = Math.max(low, Math.round((gas + airportParking + flight + transfer + roamingEsim) * 1.18));
  const airportDriveHours = driveHoursFromDistance(airport.driveKm) || 0;
  const estimatedDurationHours = Math.max(4, airportDriveHours + 3.5);
  const flightSearch = flightAffiliateSearchUrl(input, `${airport.airportCode} ${airport.airportName}`, destinationLabel);

  return {
    mode: "mixed",
    availability: "search_ready",
    realistic: true,
    title: `Drive to ${airport.airportName}, then fly to ${destinationLabel}`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_duration_hours: estimatedDurationHours,
    estimated_cost_min: low,
    estimated_cost_max: high,
    currency,
    duration_label: `${airport.driveDuration}, then flight time`,
    distance_km: airport.driveKm,
    cost_breakdown: {
      gas,
      parking: airportParking || undefined,
      flight,
      airport_transfer: transfer,
      roaming_esim: roamingEsim || undefined
    },
    price_confidence: "estimated",
    search_url: flightSearch || undefined,
    booking_url: flightSearch || undefined,
    reason: "Mixed route can be practical when the nearest airport is costly or poorly connected.",
    warning: `Conservative mixed-route estimate — refresh live flight, parking, and transfer prices before booking.${routeCrossesBorder ? " Estimate includes a roaming/eSIM planning buffer; check coverage and device compatibility before buying." : ""}`,
    source: "Regional airport route estimate",
    why_recommended: "This option may reduce transport cost but increases travel time.",
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function fitForOption(option: TransportOption, budgetAmount: number | null, fixedTripCostCents: number) {
  const max = optionMax(option);
  if (max == null) return "unknown" as TransportBudgetFit;
  if (!budgetAmount) return "okay" as TransportBudgetFit;
  const totalWithBuffer = (fixedTripCostCents / 100 + max) * 1.12;
  if (totalWithBuffer > budgetAmount) return "expensive" as TransportBudgetFit;
  return "okay" as TransportBudgetFit;
}

export function pickRecommendedTransportOption(
  options: TransportOption[],
  input: { budgetAmount?: number | null; fixedTripCostCents?: number } = {}
) {
  const budgetAmount = input.budgetAmount ?? null;
  const fixedTripCostCents = Math.max(0, Math.round(input.fixedTripCostCents || 0));
  const practicalOptions = options.filter((option) => {
    if (!option.realistic) return false;
    if (option.availability !== "verified" && option.availability !== "search_ready") return false;
    return optionAverage(option) != null;
  });
  if (!practicalOptions.length) {
    const flight = options.find((option) => option.mode === "flight" && option.realistic);
    return flight || options.find((option) => option.realistic) || null;
  }

  const fitsBudget = practicalOptions.filter((option) => fitForOption(option, budgetAmount, fixedTripCostCents) !== "expensive");
  const candidates = fitsBudget.length ? fitsBudget : practicalOptions;
  return [...candidates].sort((a, b) => {
    const score = (option: TransportOption) => {
      const average = optionAverage(option) || Number.MAX_SAFE_INTEGER;
      const duration = option.estimated_duration_hours ?? (option.mode === "flight" ? 5 : 10);
      const budgetFit = fitForOption(option, budgetAmount, fixedTripCostCents);
      const budgetPenalty = budgetFit === "expensive" ? 55 : 0;
      const modePenalty =
        option.mode === "flight"
          ? 6
          : option.mode === "mixed"
            ? 16
            : option.mode === "drive"
              ? 24
              : option.mode === "train"
                ? 30
                : 46;
      const availabilityPenalty = option.availability === "verified" ? 0 : option.availability === "search_ready" ? 8 : 100;
      const costWeight = budgetAmount && budgetAmount > 0 ? (average / budgetAmount) * 35 : average / 80;
      const durationWeight = duration * (option.mode === "bus" ? 4.5 : option.mode === "train" ? 3.2 : option.mode === "drive" ? 2.8 : 1.8);
      return availabilityPenalty + budgetPenalty + modePenalty + costWeight + durationWeight;
    };
    return score(a) - score(b);
  })[0];
}

export function compareTransportOptions(input: TransportBuildInput, config: BuildOptionsConfig = {}): TransportComparison {
  const originPlace = placeFromInput(input, "origin", input.origin || "Origin");
  const destination = destinationPlace(input);
  const originLabel = placeLabel(originPlace, input.origin || "Origin");
  const destinationLabel = placeLabel(destination, input.destination || "Destination");
  const distanceKm = routeDistanceKm(originPlace, destination, originLabel, destinationLabel);
  const options = [
    flightOption(input, originLabel, destinationLabel, config, distanceKm),
    buildDrivingOption(input, originPlace, destination, originLabel, destinationLabel),
    buildTrainOption(input, originPlace, destination, originLabel, destinationLabel, distanceKm),
    buildBusOption(input, originPlace, destination, originLabel, destinationLabel, distanceKm),
    buildMixedOption(input, originLabel, destinationLabel, config)
  ].filter((option): option is TransportOption => Boolean(option));

  const recommended = pickRecommendedTransportOption(options, {
    budgetAmount: input.budgetAmount,
    fixedTripCostCents: config.fixedTripCostCents
  });
  const updatedOptions = options.map((option) => {
    const fit = fitForOption(option, input.budgetAmount ?? null, config.fixedTripCostCents || 0);
    return {
      ...option,
      budget_fit: recommended && option.mode === recommended.mode && option.title === recommended.title ? "best" : option.realistic ? fit : "unknown"
    };
  });

  return {
    options: updatedOptions,
    recommendedOption: updatedOptions.find((option) => option.budget_fit === "best") || null,
    assumptions: [
      "Driving estimate uses fuel, parking, toll, and overnight-stop assumptions until live maps/gas providers are connected.",
      "Train and bus are not recommended unless route availability is verified or search-ready and the travel time fits the trip.",
      "Conservative estimates are used when exact live prices are not available; refresh live prices before booking."
    ]
  };
}

export function transportOptionCostCents(option: TransportOption | null | undefined) {
  const amount = option ? optionAverage(option) : null;
  return amount == null ? 0 : Math.max(0, Math.round(amount * 100));
}

export function isTransportOptionMarketResult(result: TravelMarketResult) {
  return result.category === "transport" && result.metadata?.transport_option === true;
}

export function transportOptionsToMarketResults(input: TransportBuildInput, options: TransportOption[], searchedAt = new Date().toISOString()) {
  const expiresAt = new Date(new Date(searchedAt).getTime() + 12 * 60 * 60 * 1000).toISOString();
  return options.map((option) => {
    const searchUrl = safeExternalUrl(option.search_url) || safeExternalUrl(option.booking_url) || "";
    const source =
      option.mode === "flight" && (option.price_confidence === "live_partner" || option.price_confidence === "cached_recent")
        ? "travelpayouts"
        : option.mode === "drive"
          ? "roamly_internal"
          : option.price_confidence === "live_partner"
            ? "travelpayouts"
            : "fallback_estimate";
    const priceType =
      option.price_confidence === "live_partner"
        ? "live_partner"
        : option.price_confidence === "cached_recent"
          ? "cached_recent"
          : option.availability === "search_ready"
            ? "search_ready"
            : option.availability === "unverified" || option.availability === "not_available"
              ? "unknown"
              : "estimated_fallback";

    return {
      id: `transport-${option.mode}-${option.origin}-${option.destination}-${option.departure_date}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      category: "transport",
      title: option.title,
      provider:
        option.mode === "drive"
          ? "Google Maps search"
          : option.mode === "train"
            ? "Train search"
            : option.mode === "bus"
              ? "Bus search"
              : option.mode === "mixed"
                ? "Mixed route search"
                : "Flight search",
      source,
      origin: option.origin,
      destination: option.destination,
      city: input.destinationCity || option.destination,
      country: input.destinationCountry || undefined,
      start_date: option.departure_date || undefined,
      end_date: option.return_date || undefined,
      travelers: travelersCount(input),
      price_min: option.estimated_cost_min ?? undefined,
      price_max: option.estimated_cost_max ?? undefined,
      currency: option.currency,
      price_type: priceType,
      confidence: option.price_confidence === "live_partner" ? "high" : option.price_confidence === "cached_recent" ? "medium" : "low",
      booking_url: option.booking_url,
      normal_search_url: searchUrl || undefined,
      searched_at: searchedAt,
      expires_at: expiresAt,
      metadata: {
        transport_option: true,
        transport_mode: option.mode,
        transport_source:
          option.mode === "drive"
            ? "google_maps_search"
            : option.mode === "flight" && (option.price_confidence === "live_partner" || option.price_confidence === "cached_recent")
              ? "travelpayouts"
              : "fallback_estimate",
        price_confidence: option.price_confidence,
        budget_fit: option.budget_fit,
        availability: option.availability,
        realistic: option.realistic,
        estimated_duration_hours: option.estimated_duration_hours,
        duration_label: option.duration_label,
        distance_km: option.distance_km,
        cost_breakdown: option.cost_breakdown,
        reason: option.reason,
        why_recommended: option.why_recommended,
        warning: option.warning,
        source: option.source
      }
    } satisfies TravelMarketResult;
  });
}
