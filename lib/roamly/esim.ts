import type { BookingUrlType } from "@/lib/roamly/bookingLinks";
import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { detectCrossBorderTrip } from "@/lib/roamly/crossBorder";
import type { TripPlannerPayload } from "@/lib/trip-planner";

const AIRALO_ESIM_STORE_URL = "https://www.airalo.com/esim";

export const esimVerificationCopy = "Check coverage, device compatibility, speed limits, and refund rules before buying.";

function clean(value?: string | null) {
  return (value || "").trim();
}

function disabled(value?: string | null) {
  return /^(false|0|off|disabled)$/i.test(clean(value));
}

function destinationLabel(payload: TripPlannerPayload) {
  if (payload.tripType === "multi_city" && payload.destinationStops?.length) {
    return payload.destinationStops.map((stop) => stop.country || stop.city || stop.value || stop.label).filter(Boolean).join(", ");
  }
  return payload.destinationCountry || payload.destinationCity || payload.destination;
}

function routeText(payload: TripPlannerPayload) {
  const stops = (payload.destinationStops || [])
    .map((stop) => [stop.city, stop.country, stop.value, stop.label].filter(Boolean).join(" "))
    .join(" ");
  return [
    payload.origin,
    payload.originCity,
    payload.originCountry,
    payload.destination,
    payload.destinationCity,
    payload.destinationCountry,
    stops,
    payload.specialNotes
  ]
    .filter(Boolean)
    .join(" ");
}

export function getEsimProviderConfig() {
  const provider = clean(process.env.ROAMLY_ESIM_PROVIDER || "airalo").toLowerCase();
  const enabled = !disabled(process.env.ROAMLY_ESIM_ENABLED) && provider === "airalo";
  const referralUrl = safeExternalUrl(process.env.ROAMLY_ESIM_REFERRAL_URL);
  const affiliateId = clean(process.env.ROAMLY_ESIM_AFFILIATE_ID);

  return {
    enabled,
    provider: "Airalo",
    providerKey: provider,
    referralUrl,
    affiliateId
  };
}

export function buildAiraloEsimUrl(payload: TripPlannerPayload) {
  const config = getEsimProviderConfig();
  if (!config.enabled) return "";
  if (config.referralUrl) return config.referralUrl;

  const url = new URL(AIRALO_ESIM_STORE_URL);
  const destination = destinationLabel(payload);
  if (destination) url.searchParams.set("search", destination);
  url.searchParams.set("utm_source", "roamly");
  url.searchParams.set("utm_medium", "trip_planner");
  url.searchParams.set("utm_campaign", "travel_connectivity");
  if (config.affiliateId) url.searchParams.set("utm_content", config.affiliateId);
  return url.toString();
}

export function isEsimSensitiveTrip(payload: TripPlannerPayload) {
  if (payload.priceDiscovery?.cross_border === true) return true;

  const detected = detectCrossBorderTrip({
    origin: payload.origin || payload.originCity,
    originCountry: payload.originCountry,
    destination: payload.destination || payload.destinationCity,
    destinationCountry: payload.destinationCountry,
    routeText: routeText(payload)
  });
  if (detected.cross_border) return true;

  const text = [payload.specialNotes, payload.transportationPreference, payload.travelStyle, payload.interests.join(" ")].filter(Boolean).join(" ").toLowerCase();
  return /\b(e-?sim|roaming|mobile data|international|cross[- ]?border|offline maps?|live companion)\b/.test(text);
}

export function buildEsimAction(payload: TripPlannerPayload, label = "Compare travel eSIM") {
  const config = getEsimProviderConfig();
  if (!config.enabled) return null;
  const href = buildAiraloEsimUrl(payload);
  if (!href) return null;
  const hasAffiliateUrl = Boolean(config.referralUrl || config.affiliateId);
  const urlType: BookingUrlType = hasAffiliateUrl ? "affiliate" : "normal_search";

  return {
    href,
    label,
    provider: config.provider,
    hasAffiliateUrl,
    urlType,
    verificationNote: esimVerificationCopy
  };
}
