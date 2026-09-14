import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { detectCrossBorderTrip } from "@/lib/roamly/crossBorder";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export const esimVerificationCopy = "Check coverage, device compatibility, speed limits, and refund rules before buying.";

function clean(value?: string | null) {
  return (value || "").trim();
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
  // Airalo is retained only as legacy configuration. It is not an approved
  // Roamly commercial provider and must never become customer-facing again
  // merely because old environment variables remain configured.
  const enabled = false;
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
  void payload;
  return "";
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
  void payload;
  void label;
  return null;
}
