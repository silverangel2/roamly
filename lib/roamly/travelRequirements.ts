export const REQUIREMENT_CATEGORIES = [
  "PASSPORT",
  "VISA_OR_AUTHORIZATION",
  "ENTRY_FORM",
  "TRANSIT",
  "HEALTH_ENTRY",
  "DESTINATION_DOCUMENT"
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const REQUIREMENT_STATUSES = ["SATISFIED", "ACTION_REQUIRED", "REVIEW_REQUIRED", "UNKNOWN", "NOT_APPLICABLE"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type EvidenceFreshness = "CURRENT" | "STALE" | "UNKNOWN";

export type TravelRequirement = {
  id: string;
  category: RequirementCategory;
  title: string;
  status: RequirementStatus;
  summary: string;
  authority: string | null;
  sourceUrl: string | null;
  actionUrl: string | null;
  checkedAt: string | null;
  travelDateContext: string | null;
  completeness: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  freshness: EvidenceFreshness;
  accountHolderOnly: boolean;
  acknowledgmentDoesNotVerify: boolean;
};

type OfficialSource = {
  countryCode: string;
  authority: string;
  sourceUrl: string;
  actionUrl: string;
};

// These links are official starting points, not a legal decision table. Exact
// applicability remains unknown until an authoritative, nationality-aware
// check exists.
export const CURATED_OFFICIAL_SOURCES: Readonly<Record<string, OfficialSource>> = {
  CA: {
    countryCode: "CA",
    authority: "Government of Canada",
    sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html",
    actionUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html"
  },
  GB: {
    countryCode: "GB",
    authority: "GOV.UK",
    sourceUrl: "https://www.gov.uk/check-uk-visa",
    actionUrl: "https://www.gov.uk/check-uk-visa"
  },
  US: {
    countryCode: "US",
    authority: "U.S. Department of State",
    sourceUrl: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit.html",
    actionUrl: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit.html"
  },
  FR: {
    countryCode: "FR",
    authority: "France-Visas",
    sourceUrl: "https://france-visas.gouv.fr/en/",
    actionUrl: "https://france-visas.gouv.fr/en/"
  }
};

export type TravelRequirementInput = {
  destinationCountry?: string | null;
  originCountry?: string | null;
  passportIssuingCountry?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number | null;
  knownTransitCountries?: string[] | null;
  now?: string | null;
  evidenceFreshness?: EvidenceFreshness;
};

/** Common country names to ISO codes. Unknown names return null —
 *  never guessed — so the non-domestic path is preserved. Only
 *  unambiguous names are listed; a name not here stays unknown. */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  "canada": "CA",
  "united states": "US", "united states of america": "US", "usa": "US", "america": "US",
  "united kingdom": "GB", "uk": "GB", "great britain": "GB", "england": "GB",
  "philippines": "PH", "france": "FR", "germany": "DE", "japan": "JP",
  "australia": "AU", "mexico": "MX", "india": "IN", "china": "CN",
  "spain": "ES", "italy": "IT", "portugal": "PT", "netherlands": "NL",
  "brazil": "BR", "ireland": "IE", "switzerland": "CH", "austria": "AT",
  "belgium": "BE", "greece": "GR", "turkey": "TR", "thailand": "TH",
  "vietnam": "VN", "indonesia": "ID", "malaysia": "MY", "singapore": "SG",
  "south korea": "KR", "korea": "KR", "new zealand": "NZ", "poland": "PL",
  "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
  "iceland": "IS", "morocco": "MA", "egypt": "EG", "israel": "IL",
  "ukraine": "UA", "costa rica": "CR", "colombia": "CO", "argentina": "AR",
  "chile": "CL", "peru": "PE", "jamaica": "JM", "bahamas": "BS",
  "dominican republic": "DO", "united arab emirates": "AE", "uae": "AE",
  "saudi arabia": "SA", "pakistan": "PK", "bangladesh": "BD",
  "sri lanka": "LK", "nepal": "NP", "kenya": "KE", "south africa": "ZA",
  "nigeria": "NG", "czech republic": "CZ", "czechia": "CZ", "hungary": "HU",
  "romania": "RO", "croatia": "HR", "russia": "RU", "taiwan": "TW",
  "hong kong": "HK"
};

/** ISO country code from a code ("CA"), a name ("Canada"), or a
 *  "City, Country" label ("Saint John, Canada"). Correction phase
 *  (2026-10-28): trips carry country NAMES, so the old code-only
 *  check never fired domestic detection and every domestic trip
 *  prompted for a passport country. Unknown names still return null. */
function cleanCountry(value?: string | null) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const last = raw.split(",").pop()!.trim().toLowerCase();
  return COUNTRY_NAME_TO_ISO[last] || null;
}

export function deriveTravelRequirements(input: TravelRequirementInput): TravelRequirement[] {
  const destination = cleanCountry(input.destinationCountry);
  const origin = cleanCountry(input.originCountry);
  const passport = cleanCountry(input.passportIssuingCountry);
  // Domestic travel (origin and destination in the same country) has no
  // international entry requirement: mark it not applicable instead of asking
  // for passport-country review.
  const domestic = Boolean(origin && destination && origin === destination);
  const source = destination ? CURATED_OFFICIAL_SOURCES[destination] : null;
  const freshness = input.evidenceFreshness || "UNKNOWN";
  const travelDateContext = input.startDate && input.endDate ? `${input.startDate} to ${input.endDate}` : null;
  const companionReview = (input.travelerCount || 1) > 1;
  const status: RequirementStatus = !destination || !passport
    ? "UNKNOWN"
    : freshness === "STALE" || freshness === "UNKNOWN"
      ? "REVIEW_REQUIRED"
      : "REVIEW_REQUIRED";
  const summary = !passport
    ? "Add your passport issuing country before Roamly can review entry requirements."
    : source
      ? "Review the official entry guidance for your passport and trip details."
      : "Roamly does not have a curated official source for this destination yet.";

  const requirements: TravelRequirement[] = [domestic ? {
    id: `entry-${destination || "unknown"}`,
    category: "VISA_OR_AUTHORIZATION",
    title: "Travel authorization and entry requirements",
    status: "NOT_APPLICABLE" as RequirementStatus,
    summary: "This is domestic travel within the same country, so no passport or visa entry requirement applies. Carry a photo ID for check-in.",
    authority: null,
    sourceUrl: null,
    actionUrl: null,
    checkedAt: null,
    travelDateContext,
    completeness: "COMPLETE" as const,
    freshness,
    accountHolderOnly: true,
    acknowledgmentDoesNotVerify: true
  } : {
    id: `entry-${destination || "unknown"}`,
    category: "VISA_OR_AUTHORIZATION",
    title: passport ? "Travel authorization and entry requirements" : "Passport country needed",
    status,
    summary,
    authority: source?.authority || null,
    sourceUrl: source?.sourceUrl || null,
    actionUrl: source?.actionUrl || null,
    checkedAt: null,
    travelDateContext,
    completeness: passport && source ? "INCOMPLETE" : "UNKNOWN",
    freshness,
    accountHolderOnly: true,
    acknowledgmentDoesNotVerify: true
  }];

  if (companionReview) requirements.push({
    id: `companions-${destination || "unknown"}`,
    category: "DESTINATION_DOCUMENT",
    title: "Companion requirements",
    status: "REVIEW_REQUIRED",
    summary: "Only the account holder has been evaluated. Companion requirements need their own passport details.",
    authority: source?.authority || null,
    sourceUrl: source?.sourceUrl || null,
    actionUrl: source?.actionUrl || null,
    checkedAt: null,
    travelDateContext,
    completeness: "INCOMPLETE",
    freshness,
    accountHolderOnly: false,
    acknowledgmentDoesNotVerify: true
  });

  if (input.knownTransitCountries?.some((country) => !cleanCountry(country))) requirements.push({
    id: "transit-unknown",
    category: "TRANSIT",
    title: "Transit requirements",
    status: "UNKNOWN",
    summary: "Transit countries are not fully known, so Roamly cannot review transit requirements yet.",
    authority: null,
    sourceUrl: null,
    actionUrl: null,
    checkedAt: null,
    travelDateContext,
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    accountHolderOnly: true,
    acknowledgmentDoesNotVerify: true
  });

  return requirements;
}

export function countMaterialTravelRequirements(requirements: TravelRequirement[]) {
  return requirements.filter((item) => item.status === "ACTION_REQUIRED" || item.status === "REVIEW_REQUIRED" || item.status === "UNKNOWN").length;
}
