import { buildAmazonSearchUrl, getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { buildAiraloEsimUrl, getEsimProviderConfig } from "@/lib/roamly/esim";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type AffiliateCategory =
  | "flight"
  | "hotel"
  | "activity"
  | "attraction"
  | "ticket"
  | "tour"
  | "transport"
  | "car_rental"
  | "restaurant"
  | "product"
  | "esim"
  | "insurance";

export type AffiliateResolverInput = {
  category: AffiliateCategory;
  destination?: string | null;
  origin?: string | null;
  title?: string | null;
  query?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelers?: number | { adults?: number | null; children?: number | null; infants?: number | null } | null;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
  neighborhood?: string | null;
  roomType?: string | null;
  activityType?: string | null;
  productKeyword?: string | null;
  route?: string | null;
  currency?: string | null;
  locale?: string | null;
};

export type AffiliateLinkResolution = {
  category: AffiliateCategory;
  provider: string;
  finalUrl: string;
  ctaLabel: string;
  disclosureRequired: boolean;
  disclosure: string;
  trackingMetadata: Record<string, string | boolean>;
  fallbackBehavior: "affiliate" | "internal_discovery" | "hidden";
  configured: boolean;
  missingConfiguration: string[];
};

type ProviderStatus = {
  provider: string;
  category: AffiliateCategory;
  enabled: boolean;
  configured: boolean;
  priority: number;
  missingConfiguration: string[];
  defaultFallback: string;
  test: AffiliateLinkResolution;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function affiliatesEnabled() {
  const value = clean(process.env.ROAMLY_AFFILIATES_ENABLED).toLowerCase();
  return value !== "false" && value !== "0" && value !== "disabled";
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

function travelersCount(value: AffiliateResolverInput["travelers"], fallback = 1) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (value && typeof value === "object" && typeof value.adults === "number" && value.adults > 0) return Math.round(value.adults);
  return fallback;
}

function primaryPlace(input: AffiliateResolverInput) {
  return clean(input.destination) || clean(input.neighborhood) || clean(input.title) || clean(input.query) || "travel";
}

function searchText(input: AffiliateResolverInput) {
  return clean(input.query) || clean(input.activityType) || clean(input.title) || clean(input.destination) || "travel";
}

function result(
  input: AffiliateResolverInput,
  provider: string,
  finalUrl: string,
  ctaLabel: string,
  configured: boolean,
  missingConfiguration: string[] = []
): AffiliateLinkResolution {
  const isAffiliate = affiliatesEnabled() && configured && Boolean(safeExternalUrl(finalUrl));
  return {
    category: input.category,
    provider: isAffiliate ? provider : providerNameForCategory(input.category),
    finalUrl: isAffiliate ? finalUrl : "",
    ctaLabel,
    disclosureRequired: isAffiliate,
    disclosure: isAffiliate ? ROAMLY_AFFILIATE_DISCLOSURE : "",
    trackingMetadata: {
      provider: isAffiliate ? provider : providerNameForCategory(input.category),
      category: input.category,
      affiliate: isAffiliate
    },
    fallbackBehavior: isAffiliate ? "affiliate" : "hidden",
    configured,
    missingConfiguration
  };
}

function stay22Configured() {
  return Boolean(clean(process.env.ROAMLY_STAY22_PARTNER_ID) || safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL));
}

function klookConfigured() {
  return Boolean(clean(process.env.ROAMLY_KLOOK_PARTNER_ID) || safeExternalUrl(process.env.ROAMLY_KLOOK_REFERRAL_URL));
}

function travelpayoutsConfigured() {
  return Boolean(clean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER));
}

function stay22Url(input: AffiliateResolverInput) {
  const referral = safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL);
  const partnerId = clean(process.env.ROAMLY_STAY22_PARTNER_ID);
  if (partnerId) {
    return withParams("https://www.stay22.com/search", {
      address: [clean(input.neighborhood), primaryPlace(input)].filter(Boolean).join(", "),
      checkin: input.startDate || undefined,
      checkout: input.endDate || undefined,
      guests: input.adults || travelersCount(input.travelers),
      aid: partnerId
    });
  }
  return referral;
}

function travelpayoutsUrl(input: AffiliateResolverInput) {
  return withParams("https://www.aviasales.com/search", {
    marker: clean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    origin: clean(input.origin),
    destination: clean(input.destination) || clean(input.route),
    depart_date: input.startDate || undefined,
    return_date: input.endDate || undefined,
    adults: input.adults || travelersCount(input.travelers)
  });
}

function klookSearchUrl(input: AffiliateResolverInput) {
  const query = searchText(input);
  const partnerId = clean(process.env.ROAMLY_KLOOK_PARTNER_ID);
  const referral = safeExternalUrl(process.env.ROAMLY_KLOOK_REFERRAL_URL);
  const target = partnerId
    ? withParams("https://www.klook.com/en-CA/search/result/", {
        query,
        aid: partnerId
      })
    : "";
  if (target && referral) {
    const redirect = new URL(referral);
    redirect.searchParams.set("k_site", target);
    return redirect.toString();
  }
  return target || referral;
}

export function resolveAffiliateLink(input: AffiliateResolverInput): AffiliateLinkResolution {
  if (input.category === "flight") {
    const provider = clean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER).toLowerCase();
    const configured = provider === "travelpayouts" && travelpayoutsConfigured();
    return result(
      input,
      "travelpayouts",
      configured ? travelpayoutsUrl(input) : "",
      "Check flights",
      configured,
      configured ? [] : ["ROAMLY_FLIGHT_AFFILIATE_PROVIDER=travelpayouts", "ROAMLY_TRAVELPAYOUTS_MARKER"]
    );
  }

  if (input.category === "hotel") {
    const provider = clean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER).toLowerCase();
    const configured = provider === "stay22" && stay22Configured();
    return result(
      input,
      "stay22",
      configured ? stay22Url(input) : "",
      "Find a hotel",
      configured,
      configured ? [] : ["ROAMLY_HOTEL_AFFILIATE_PROVIDER=stay22", "ROAMLY_STAY22_PARTNER_ID or ROAMLY_STAY22_REFERRAL_URL"]
    );
  }

  if (input.category === "activity" || input.category === "attraction" || input.category === "ticket" || input.category === "tour") {
    const provider = clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER).toLowerCase();
    const configured = provider === "klook" && klookConfigured();
    return result(
      input,
      "klook",
      configured ? klookSearchUrl(input) : "",
      input.category === "tour" ? "Book activity" : "Book activity",
      configured,
      configured ? [] : ["ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER=klook", "ROAMLY_KLOOK_PARTNER_ID or ROAMLY_KLOOK_REFERRAL_URL"]
    );
  }

  if (input.category === "transport") {
    const configured = klookConfigured() && /\b(airport|transfer|shuttle|pass|rail|train|bus|ferry|transport)\b/i.test(searchText(input));
    return result(
      input,
      "klook",
      configured ? klookSearchUrl({ ...input, query: searchText(input) || `${primaryPlace(input)} airport transfer` }) : "",
      "Book transfer",
      configured,
      configured ? [] : ["ROAMLY_KLOOK_PARTNER_ID or ROAMLY_KLOOK_REFERRAL_URL for bookable transfers"]
    );
  }

  if (input.category === "product") {
    const config = getAmazonAffiliateConfig();
    const configured = config.enabled;
    return result(
      input,
      "amazon",
      configured ? buildAmazonSearchUrl(clean(input.productKeyword) || searchText(input) || "travel essentials") : "",
      "Shop travel gear",
      configured,
      configured ? [] : ["ROAMLY_AMAZON_ENABLED=true", "ROAMLY_AMAZON_ASSOCIATE_TAG"]
    );
  }

  if (input.category === "esim") {
    const config = getEsimProviderConfig();
    const configured = config.enabled && Boolean(config.referralUrl || config.affiliateId);
    const esimPayload: TripPlannerPayload = {
      destination: input.destination || primaryPlace(input),
      destinationCountry: input.destination || undefined,
      origin: input.origin || undefined,
      startDate: input.startDate || "",
      endDate: input.endDate || "",
      daysCount: 1,
      budgetAmount: null,
      budgetCurrency: input.currency || "CAD",
      travelStyle: "",
      interests: [],
      pace: "",
      accommodationPreference: "",
      transportationPreference: "",
      specialNotes: ""
    };
    return result(
      input,
      config.providerKey || "airalo",
      configured ? buildAiraloEsimUrl(esimPayload) : "",
      "Get an eSIM",
      configured,
      configured ? [] : ["ROAMLY_ESIM_ENABLED=true", "ROAMLY_ESIM_REFERRAL_URL or ROAMLY_ESIM_AFFILIATE_ID"]
    );
  }

  return result(input, "roamly_internal", "", "View options", false, ["No approved affiliate provider for this category"]);
}

export function getAffiliateProviderStatuses(): ProviderStatus[] {
  const samples: AffiliateResolverInput[] = [
    { category: "flight", origin: "Toronto", destination: "Lisbon", startDate: "2026-09-01", endDate: "2026-09-08" },
    { category: "hotel", destination: "Lisbon", neighborhood: "Baixa", startDate: "2026-09-01", endDate: "2026-09-08", adults: 2, rooms: 1 },
    { category: "tour", destination: "Lisbon", title: "Lisbon food tour", startDate: "2026-09-02" },
    { category: "product", productKeyword: "carry-on luggage lightweight travel" },
    { category: "esim", destination: "Portugal", origin: "Canada" }
  ];
  return samples.map((sample, index) => {
    const test = resolveAffiliateLink(sample);
    return {
      provider: test.provider === "roamly_internal" ? providerNameForCategory(sample.category) : test.provider,
      category: sample.category,
      enabled: affiliatesEnabled(),
      configured: test.configured,
      priority: index + 1,
      missingConfiguration: test.missingConfiguration,
      defaultFallback: test.fallbackBehavior === "affiliate" ? "Affiliate link" : "Hidden until configured",
      test
    };
  });
}

function providerNameForCategory(category: AffiliateCategory) {
  if (category === "flight") return "travelpayouts";
  if (category === "hotel") return "stay22";
  if (category === "tour" || category === "activity" || category === "attraction" || category === "ticket") return "klook";
  if (category === "product") return "amazon";
  if (category === "esim") return "airalo";
  return "roamly_internal";
}

export function testAffiliateLinks() {
  const statuses = getAffiliateProviderStatuses();
  return {
    testedAt: new Date().toISOString(),
    ok: statuses.every((status) => status.test.fallbackBehavior === "hidden" || Boolean(safeExternalUrl(status.test.finalUrl))),
    statuses: statuses.map((status) => ({
      provider: status.provider,
      category: status.category,
      configured: status.configured,
      enabled: status.enabled,
      priority: status.priority,
      finalUrlValid: status.test.fallbackBehavior === "hidden" || Boolean(safeExternalUrl(status.test.finalUrl)),
      disclosureRequired: status.test.disclosureRequired,
      fallbackBehavior: status.defaultFallback,
      missingConfiguration: status.missingConfiguration
    }))
  };
}

export function isLegacyBookingUrl(value?: string | null) {
  const raw = clean(value).toLowerCase();
  return Boolean(
    raw &&
      (/\/\/(?:www\.)?booking\.com\b/.test(raw) ||
        /\/\/(?:www\.)?google\.com\/travel\/flights\b/.test(raw) ||
        /\/\/(?:www\.)?(?:viator|getyourguide)\.com\b/.test(raw) ||
        (/\/\/(?:www\.)?google\.com\/search\b/.test(raw) && /\b(flight|hotel|tour|ticket|activity|reservation|booking)\b/.test(raw)))
  );
}
