import type { NormalizedPlace } from "@/lib/roamly/places";

export type TripGeographyScope = "DOMESTIC" | "INTERNATIONAL" | "MULTI_COUNTRY_INTERNATIONAL" | "UNKNOWN";
export type TravelEssentialState = "RELEVANT" | "NOT_RELEVANT" | "UNKNOWN";
export type CurrencyRelationship = "SAME" | "DIFFERENT" | "UNKNOWN";

export type GeographyReason =
  | "SAME_COUNTRY"
  | "CROSSES_INTERNATIONAL_BORDER"
  | "MULTIPLE_DESTINATION_COUNTRIES"
  | "GEOGRAPHY_INCOMPLETE"
  | "TRANSIT_COUNTRY_PRESENT"
  | "INTERNATIONAL_CONNECTIVITY_RELEVANT"
  | "MULTI_COUNTRY_CONNECTIVITY_RELEVANT"
  | "PLUG_COMPATIBILITY_REQUIRES_EVALUATION"
  | "CURRENCY_REQUIRES_EVALUATION"
  | "ENTRY_REQUIREMENTS_REQUIRE_EVALUATION";

export type GeographyEvidence = {
  countryCode: string;
  source: "structured_trip" | "structured_place" | "confirmed_booking";
  role: "origin" | "destination" | "transit";
};

export type TripGeographyInput = {
  originCountry?: string | null;
  destinationCountry?: string | null;
  originPlace?: Pick<NormalizedPlace, "country" | "currency"> | null;
  destinationPlace?: Pick<NormalizedPlace, "country" | "currency"> | null;
  destinationStops?: Array<Pick<NormalizedPlace, "country" | "currency"> & { role?: "destination" | "transit" }> | null;
  returnToOrigin?: boolean;
  originCurrency?: string | null;
  destinationCurrency?: string | null;
  confirmedGeography?: GeographyEvidence[] | null;
  transitCountries?: string[] | null;
  drivingTrip?: boolean | null;
};

export type TravelEssentialSignals = {
  internationalConnectivity: TravelEssentialState;
  multiCountryConnectivity: TravelEssentialState;
  plugCompatibility: TravelEssentialState;
  currencyDifference: CurrencyRelationship;
  borderEntryEvaluation: TravelEssentialState;
  internationalDriving: TravelEssentialState;
  reasons: GeographyReason[];
};

export type TripGeography = {
  scope: TripGeographyScope;
  originCountryCode: string | null;
  destinationCountryCodes: string[];
  transitCountryCodes: string[];
  evidence: GeographyEvidence[];
  reasons: GeographyReason[];
  travelEssentialSignals: TravelEssentialSignals;
};

const countryAliases: Record<string, string> = {
  CA: "CA", CAN: "CA", CANADA: "CA",
  US: "US", USA: "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US",
  MX: "MX", MEX: "MX", MEXICO: "MX",
  FR: "FR", FRA: "FR", FRANCE: "FR",
  IT: "IT", ITA: "IT", ITALY: "IT",
  JP: "JP", JPN: "JP", JAPAN: "JP",
  GB: "GB", GBR: "GB", UK: "GB", "UNITED KINGDOM": "GB",
  DE: "DE", DEU: "DE", GERMANY: "DE",
  ES: "ES", ESP: "ES", SPAIN: "ES",
  PT: "PT", PRT: "PT", PORTUGAL: "PT",
  AU: "AU", AUS: "AU", AUSTRALIA: "AU",
  NZ: "NZ", NZL: "NZ", "NEW ZEALAND": "NZ"
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeCountryCode(value?: string | null) {
  const normalized = clean(value).replace(/[.]/g, "").replace(/\s+/g, " ").toUpperCase();
  if (!normalized) return "";
  return countryAliases[normalized] || "";
}

function placeCountry(place?: Pick<NormalizedPlace, "country"> | null) {
  return normalizeCountryCode(place?.country);
}

function sideCountry(values: Array<{ value?: string | null; source: GeographyEvidence["source"] }>) {
  const grounded = values
    .map((item) => ({ code: normalizeCountryCode(item.value), source: item.source }))
    .filter((item): item is { code: string; source: GeographyEvidence["source"] } => Boolean(item.code));
  const sourceOrder: GeographyEvidence["source"][] = ["confirmed_booking", "structured_place", "structured_trip"];
  for (const source of sourceOrder) {
    const match = grounded.find((item) => item.source === source);
    if (match) return { code: match.code, source: match.source };
  }
  return { code: "", source: null };
}

function destinationCountries(input: TripGeographyInput) {
  const stops = input.destinationStops || [];
  if (stops.length) {
    const destinationStops = stops.filter((stop) => stop.role !== "transit");
    const known = destinationStops.map((stop) => placeCountry(stop));
    return { codes: unique(known), complete: known.every(Boolean) };
  }
  const side = sideCountry([
    { value: input.destinationCountry, source: "structured_trip" },
    { value: input.destinationPlace?.country, source: "structured_place" }
  ]);
  return { codes: side.code ? [side.code] : [], complete: Boolean(side.code) };
}

function transitCodes(input: TripGeographyInput) {
  const fromStops = (input.destinationStops || [])
    .filter((stop) => stop.role === "transit")
    .map((stop) => placeCountry(stop));
  return unique([
    ...fromStops,
    ...(input.transitCountries || []).map((country) => normalizeCountryCode(country))
  ]);
}

function currencyRelationship(input: TripGeographyInput): CurrencyRelationship {
  const origin = clean(input.originCurrency || input.originPlace?.currency).toUpperCase();
  const destination = clean(input.destinationCurrency || input.destinationPlace?.currency).toUpperCase();
  if (!origin || !destination) return "UNKNOWN";
  return origin === destination ? "SAME" : "DIFFERENT";
}

function essentialSignals(scope: TripGeographyScope, currency: CurrencyRelationship, transit: string[], drivingTrip?: boolean | null): TravelEssentialSignals {
  const international = scope === "INTERNATIONAL" || scope === "MULTI_COUNTRY_INTERNATIONAL";
  const multi = scope === "MULTI_COUNTRY_INTERNATIONAL";
  const reasons: GeographyReason[] = [];
  if (transit.length) reasons.push("TRANSIT_COUNTRY_PRESENT");
  if (international) reasons.push("INTERNATIONAL_CONNECTIVITY_RELEVANT", "PLUG_COMPATIBILITY_REQUIRES_EVALUATION", "ENTRY_REQUIREMENTS_REQUIRE_EVALUATION");
  if (multi) reasons.push("MULTI_COUNTRY_CONNECTIVITY_RELEVANT");
  if (currency === "DIFFERENT") reasons.push("CURRENCY_REQUIRES_EVALUATION");
  return {
    internationalConnectivity: scope === "UNKNOWN" ? "UNKNOWN" : international ? "RELEVANT" : "NOT_RELEVANT",
    multiCountryConnectivity: scope === "UNKNOWN" ? "UNKNOWN" : multi ? "RELEVANT" : "NOT_RELEVANT",
    plugCompatibility: scope === "UNKNOWN" ? "UNKNOWN" : international ? "UNKNOWN" : "NOT_RELEVANT",
    currencyDifference: currency,
    borderEntryEvaluation: scope === "UNKNOWN" ? "UNKNOWN" : international ? "RELEVANT" : "NOT_RELEVANT",
    internationalDriving: scope === "UNKNOWN" || drivingTrip == null ? "UNKNOWN" : international && drivingTrip ? "RELEVANT" : "NOT_RELEVANT",
    reasons: unique(reasons) as GeographyReason[]
  };
}

export function classifyTripGeography(input: TripGeographyInput): TripGeography {
  const confirmed = input.confirmedGeography || [];
  const originSide = sideCountry([
    { value: confirmed.find((item) => item.role === "origin")?.countryCode, source: "confirmed_booking" },
    { value: input.originCountry, source: "structured_trip" },
    { value: input.originPlace?.country, source: "structured_place" }
  ]);
  const destinations = destinationCountries(input);
  const confirmedDestinations = confirmed.filter((item) => item.role === "destination").map((item) => normalizeCountryCode(item.countryCode));
  const destinationCodes = confirmedDestinations.length ? unique(confirmedDestinations) : destinations.codes;
  const transit = unique([...transitCodes(input), ...confirmed.filter((item) => item.role === "transit").map((item) => normalizeCountryCode(item.countryCode))]);
  const evidence: GeographyEvidence[] = [];
  if (originSide.code) evidence.push({ countryCode: originSide.code, source: originSide.source || "structured_trip", role: "origin" });
  for (const code of destinationCodes) evidence.push({ countryCode: code, source: confirmedDestinations.includes(code) ? "confirmed_booking" : "structured_trip", role: "destination" });
  for (const code of transit) evidence.push({ countryCode: code, source: "confirmed_booking", role: "transit" });

  let scope: TripGeographyScope = "UNKNOWN";
  let reasons: GeographyReason[] = [];
  const destinationComplete = confirmedDestinations.length ? true : destinations.complete;
  if (originSide.code && destinationComplete && destinationCodes.length) {
    const outsideOrigin = destinationCodes.filter((code) => code !== originSide.code);
    scope = outsideOrigin.length === 0 ? "DOMESTIC" : outsideOrigin.length === 1 ? "INTERNATIONAL" : "MULTI_COUNTRY_INTERNATIONAL";
    reasons = outsideOrigin.length === 0 ? ["SAME_COUNTRY"] : outsideOrigin.length === 1 ? ["CROSSES_INTERNATIONAL_BORDER"] : ["CROSSES_INTERNATIONAL_BORDER", "MULTIPLE_DESTINATION_COUNTRIES"];
  } else {
    reasons = ["GEOGRAPHY_INCOMPLETE"];
  }
  const currency = currencyRelationship(input);
  const signals = essentialSignals(scope, currency, transit, input.drivingTrip);
  return {
    scope,
    originCountryCode: originSide.code || null,
    destinationCountryCodes: destinationCodes,
    transitCountryCodes: transit,
    evidence,
    reasons: unique([...reasons, ...signals.reasons]) as GeographyReason[],
    travelEssentialSignals: signals
  };
}
