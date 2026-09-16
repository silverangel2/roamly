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
  passportIssuingCountry?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number | null;
  knownTransitCountries?: string[] | null;
  now?: string | null;
  evidenceFreshness?: EvidenceFreshness;
};

function cleanCountry(value?: string | null) {
  const code = (value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function deriveTravelRequirements(input: TravelRequirementInput): TravelRequirement[] {
  const destination = cleanCountry(input.destinationCountry);
  const passport = cleanCountry(input.passportIssuingCountry);
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

  const requirements: TravelRequirement[] = [{
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
