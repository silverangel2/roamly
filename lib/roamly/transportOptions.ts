import { buildFlightSearchUrl, googleSearchUrl, safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { recommendedPlaces, type NormalizedPlace } from "@/lib/roamly/places";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

export type TransportMode = "flight" | "drive" | "train" | "bus" | "mixed";
export type TransportPriceConfidence = "live_partner" | "cached_recent" | "estimated" | "unknown";
export type TransportBudgetFit = "best" | "okay" | "expensive" | "unknown";

export type TransportOption = {
  mode: TransportMode;
  title: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
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
  };
  price_confidence: TransportPriceConfidence;
  search_url?: string;
  booking_url?: string;
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

function sameCountry(origin: NormalizedPlace | undefined, destination: NormalizedPlace | undefined, input: TransportBuildInput) {
  const originCountry = placeCountry(origin, input.originCountry).toLowerCase();
  const destinationCountry = placeCountry(destination, input.destinationCountry).toLowerCase();
  return Boolean(originCountry && destinationCountry && originCountry === destinationCountry);
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
  const hours = Math.max(1, distanceKm / 86 + Math.min(1.5, distanceKm / 650));
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes >= 10 ? `about ${whole} hr ${minutes} min one way` : `about ${Math.round(hours)} hr one way`;
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
    bookingUrl: safeExternalUrl(priced.booking_url) || safeExternalUrl(priced.affiliate_url) || safeExternalUrl(priced.normal_search_url) || undefined,
    searchUrl: safeExternalUrl(priced.normal_search_url) || undefined
  } satisfies {
    min: number | null;
    max: number | null;
    confidence: TransportPriceConfidence;
    bookingUrl?: string;
    searchUrl?: string;
  };
}

function flightOption(input: TransportBuildInput, origin: string, destination: string, config: BuildOptionsConfig): TransportOption {
  const currency = cleanCurrency(input.budgetCurrency);
  const market = flightMarketPrice(config.marketResults);
  const fallback = centsToAmount(config.flightEstimateCents || config.fallbackFlightEstimateCents || null);
  const travelers = travelersCount(input);
  const min = market?.min ?? (fallback ? Math.max(1, Math.round(fallback * 0.88)) : null);
  const max = market?.max ?? (fallback ? Math.max(1, Math.round(fallback * 1.12)) : null);
  const baggage = max ? Math.round(45 * travelers) : undefined;
  const normalSearchUrl = buildFlightSearchUrl({
    origin,
    destination,
    departureDate: input.startDate,
    returnDate: input.returnToOrigin === false ? undefined : input.endDate,
    travelers: input.travelers || travelers
  });

  return {
    mode: "flight",
    title: `${origin} to ${destination} flight option`,
    origin,
    destination,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency,
    duration_label: "faster, airport time required",
    cost_breakdown: {
      flight: max ?? undefined,
      baggage
    },
    price_confidence: market?.confidence || (fallback ? "estimated" : "unknown"),
    search_url: normalSearchUrl || undefined,
    booking_url: market?.bookingUrl || normalSearchUrl || undefined,
    why_recommended:
      "Faster but more expensive. Use this when time matters more than keeping transport cost low.",
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
  const canEstimate =
    distanceKm == null
      ? sameCountry(originPlace, destinationPlaceValue, input)
      : distanceKm <= MAX_REASONABLE_DRIVE_KM || (sameCountry(originPlace, destinationPlaceValue, input) && distanceKm <= MAX_SAME_COUNTRY_DRIVE_KM);
  if (!canEstimate) return null;

  const oneWayKm = distanceKm || 520;
  const roundTripMultiplier = input.returnToOrigin === false ? 1 : 2;
  const country = placeCountry(originPlace, input.originCountry) || placeCountry(destinationPlaceValue, input.destinationCountry);
  const fuelLiters = (oneWayKm * roundTripMultiplier * DEFAULT_FUEL_L_PER_100KM) / 100;
  const gas = Math.round(fuelLiters * gasPricePerLiter(country));
  const dailyParking = parkingDaily(destinationLabel);
  const parking = dailyParking ? Math.round(dailyParking * Math.min(10, tripNights(input))) : 0;
  const low = Math.max(1, Math.round((gas + parking) * 0.9));
  const high = Math.max(low, Math.round((gas + parking) * 1.15));

  return {
    mode: "drive",
    title: `${originLabel} to ${destinationLabel} driving estimate`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_cost_min: low,
    estimated_cost_max: high,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: durationLabelFromDistance(oneWayKm),
    distance_km: Math.round(oneWayKm),
    cost_breakdown: {
      gas,
      parking: parking || undefined
    },
    price_confidence: "estimated",
    search_url: drivingUrl(originLabel, destinationLabel),
    booking_url: drivingUrl(originLabel, destinationLabel),
    why_recommended:
      "Recommended because it can keep the trip closer to your budget. Driving estimate uses fuel assumptions until live maps/gas providers are connected. Tolls are not included unless known.",
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
  if (!trainAvailable(input, originPlace, destinationPlaceValue)) return null;
  const travelers = travelersCount(input);
  const roughBase = distanceKm ? Math.max(80, distanceKm * 0.16) : 160;
  const min = Math.round(roughBase * travelers * (input.returnToOrigin === false ? 0.72 : 1.15));
  const max = Math.round(Math.max(min + 40, roughBase * travelers * (input.returnToOrigin === false ? 1.1 : 1.7)));
  const query = `VIA Rail train ${originLabel} to ${destinationLabel} ${cleanDate(input.startDate)} ${cleanDate(input.endDate)}`;

  return {
    mode: "train",
    title: `${originLabel} to ${destinationLabel} train search`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: "schedule varies by connection",
    distance_km: distanceKm ? Math.round(distanceKm) : undefined,
    cost_breakdown: {
      train_or_bus_ticket: max
    },
    price_confidence: "estimated",
    search_url: googleSearchUrl(query),
    booking_url: googleSearchUrl(query),
    why_recommended: "Search-ready rail option. Verify live schedule and price before booking.",
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function buildBusOption(input: TransportBuildInput, originLabel: string, destinationLabel: string, distanceKm: number | null) {
  const travelers = travelersCount(input);
  const roughBase = distanceKm ? Math.max(55, distanceKm * 0.105) : 115;
  const min = Math.round(roughBase * travelers * (input.returnToOrigin === false ? 0.75 : 1.15));
  const max = Math.round(Math.max(min + 25, roughBase * travelers * (input.returnToOrigin === false ? 1.1 : 1.75)));
  const query = `bus ${originLabel} to ${destinationLabel} ${cleanDate(input.startDate)} ${cleanDate(input.endDate)}`;

  return {
    mode: "bus",
    title: `${originLabel} to ${destinationLabel} bus search`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_cost_min: min,
    estimated_cost_max: max,
    currency: cleanCurrency(input.budgetCurrency),
    duration_label: "longer, schedule varies",
    distance_km: distanceKm ? Math.round(distanceKm) : undefined,
    cost_breakdown: {
      train_or_bus_ticket: max
    },
    price_confidence: "estimated",
    search_url: googleSearchUrl(query),
    booking_url: googleSearchUrl(query),
    why_recommended: "Search-ready bus option. Verify live schedule and price before booking.",
    budget_fit: "unknown"
  } satisfies TransportOption;
}

function buildMixedOption(input: TransportBuildInput, originLabel: string, destinationLabel: string, config: BuildOptionsConfig) {
  const airport = regionalAirportOptions.find((item) => item.originPattern.test(originLabel));
  if (!airport) return null;
  const currency = cleanCurrency(input.budgetCurrency);
  const travelers = travelersCount(input);
  const country = clean(input.originCountry || "Canada");
  const gas = Math.round(((airport.driveKm * (input.returnToOrigin === false ? 1 : 2) * DEFAULT_FUEL_L_PER_100KM) / 100) * gasPricePerLiter(country));
  const airportParking = input.returnToOrigin === false ? 0 : Math.round(18 * Math.min(10, tripNights(input)));
  const flightFallback = centsToAmount(config.flightEstimateCents || config.fallbackFlightEstimateCents || null);
  const flight = flightFallback ? Math.round(flightFallback * 0.82) : Math.round(240 * travelers);
  const transfer = Math.round(25 * travelers);
  const low = Math.max(1, Math.round((gas + airportParking + flight + transfer) * 0.9));
  const high = Math.max(low, Math.round((gas + airportParking + flight + transfer) * 1.18));
  const flightSearch = buildFlightSearchUrl({
    origin: `${airport.airportCode} ${airport.airportName}`,
    destination: destinationLabel,
    departureDate: input.startDate,
    returnDate: input.returnToOrigin === false ? undefined : input.endDate,
    travelers: input.travelers || travelers
  });

  return {
    mode: "mixed",
    title: `Drive to ${airport.airportName}, then fly to ${destinationLabel}`,
    origin: originLabel,
    destination: destinationLabel,
    departure_date: cleanDate(input.startDate),
    return_date: input.returnToOrigin === false ? undefined : cleanDate(input.endDate),
    estimated_cost_min: low,
    estimated_cost_max: high,
    currency,
    duration_label: `${airport.driveDuration}, then flight time`,
    distance_km: airport.driveKm,
    cost_breakdown: {
      gas,
      parking: airportParking || undefined,
      flight,
      airport_transfer: transfer
    },
    price_confidence: "estimated",
    search_url: flightSearch || googleSearchUrl(`${airport.airportName} to ${destinationLabel} flights`),
    booking_url: flightSearch || googleSearchUrl(`${airport.airportName} to ${destinationLabel} flights`),
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
  const practicalOptions = options.filter((option) => optionAverage(option) != null);
  if (!practicalOptions.length) return options[0] || null;

  const fitsBudget = practicalOptions.filter((option) => fitForOption(option, budgetAmount, fixedTripCostCents) !== "expensive");
  const candidates = fitsBudget.length ? fitsBudget : practicalOptions;
  return [...candidates].sort((a, b) => {
    const aAverage = optionAverage(a) || Number.MAX_SAFE_INTEGER;
    const bAverage = optionAverage(b) || Number.MAX_SAFE_INTEGER;
    const aDrivePenalty = a.mode === "drive" && (a.distance_km || 0) > MAX_REASONABLE_DRIVE_KM ? 120 : 0;
    const bDrivePenalty = b.mode === "drive" && (b.distance_km || 0) > MAX_REASONABLE_DRIVE_KM ? 120 : 0;
    return aAverage + aDrivePenalty - (bAverage + bDrivePenalty);
  })[0];
}

export function compareTransportOptions(input: TransportBuildInput, config: BuildOptionsConfig = {}): TransportComparison {
  const originPlace = placeFromInput(input, "origin", input.origin || "Origin");
  const destination = destinationPlace(input);
  const originLabel = placeLabel(originPlace, input.origin || "Origin");
  const destinationLabel = placeLabel(destination, input.destination || "Destination");
  const distanceKm = routeDistanceKm(originPlace, destination, originLabel, destinationLabel);
  const options = [
    flightOption(input, originLabel, destinationLabel, config),
    buildDrivingOption(input, originPlace, destination, originLabel, destinationLabel),
    buildTrainOption(input, originPlace, destination, originLabel, destinationLabel, distanceKm),
    buildBusOption(input, originLabel, destinationLabel, distanceKm),
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
      budget_fit: recommended && option.mode === recommended.mode && option.title === recommended.title ? "best" : fit
    };
  });

  return {
    options: updatedOptions,
    recommendedOption: updatedOptions.find((option) => option.budget_fit === "best") || null,
    assumptions: [
      "Driving estimate uses fuel assumptions until live maps/gas providers are connected.",
      "Train and bus options are search-ready when live provider APIs are not configured. Verify live schedule and price."
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
          ? "google_search"
          : option.price_confidence === "live_partner"
            ? "travelpayouts"
            : "fallback_estimate";
    const priceType =
      option.price_confidence === "live_partner"
        ? "live_partner"
        : option.price_confidence === "cached_recent"
          ? "cached_recent"
          : option.mode === "train" || option.mode === "bus"
            ? "search_ready"
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
        duration_label: option.duration_label,
        distance_km: option.distance_km,
        cost_breakdown: option.cost_breakdown,
        why_recommended: option.why_recommended,
        warning:
          option.mode === "train" || option.mode === "bus"
            ? "Search-ready option. Verify live schedule and price."
            : option.mode === "drive"
              ? "Estimated fallback using fuel and parking assumptions."
              : "Verify live price before booking."
      }
    } satisfies TravelMarketResult;
  });
}
