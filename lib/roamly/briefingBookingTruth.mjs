/**
 * briefingBookingTruth — import-free MIRROR of the ONE booking-truth
 * rule (lib/roamly/bookingTruth.ts) for the briefing content modules
 * (Round 3, Lane T).
 *
 * Why a mirror: the briefing suites load the content modules with
 * plain Node type-stripping and no path-alias register, so these
 * modules may only import sibling files with explicit extensions —
 * the same reason placeDetail.ts and bookingExtraction keep local
 * mirrors. This file implements, for the field shapes a briefing
 * booking row carries, exactly:
 *  - bookingTruth.bookingTruthState restricted to the two states the
 *    briefings include ("confirmed" = provider confirmation
 *    evidence, "traveler_confirmed" = traveler assertion only), and
 *  - bookingTruth.bookingProvenanceSuffix.
 * LOCKSTEP NOTE: keep in lockstep with bookingTruth.ts (patterned
 * code, real provider, recorded origin sets) and placeDetail.ts's
 * mirror. The evidence tier's provenance is traveler-supplied
 * material (email / screenshot / manual / provider-reported) —
 * never an independent provider verification by Roamly, and no
 * string produced here claims one.
 */

const ACTIVE_STATUSES = new Set([
  "booked", "paid", "reserved", "confirmed", "modified", "completed", "ticketed", "issued"
]);
const PSEUDO_PROVIDERS = new Set([
  "", "unknown", "unknown provider", "test", "test provider", "qa", "qa test", "qa test provider",
  "roamly", "roamly qa", "roamly qa test provider", "self", "traveler", "manual", "gmail", "email",
  "provider", "n/a", "none", "tbd"
]);
const PLACEHOLDER_CODES = new Set(["unknown", "pending", "none", "null", "n/a", "tbd", "1234", "0000", "12345"]);
const EMAIL_SOURCES = new Set(["email", "gmail", "outlook"]);
const TRAVELER_SOURCES = new Set([
  "manual", "screenshot", "upload", "provider", "provider_sync", "live_provider", "affiliate", "affiliate_conversion"
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
function recordOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isTestBooking(booking) {
  if (booking.is_test_booking === true) return true;
  const metadata = recordOf(booking.metadata);
  if (metadata.qa_test === true) return true;
  const pattern = /\bQA\b|test stay|test provider/i;
  if (pattern.test(clean(booking.title)) || pattern.test(clean(booking.provider_name) || clean(booking.provider))) return true;
  const code = clean(booking.confirmation_number) || clean(booking.confirmation_code) || clean(booking.provider_booking_id);
  return /TEST-RMLY/i.test(code);
}

function isPatternedCode(code) {
  const value = clean(code);
  if (value.length < 4 || value.length > 64) return false;
  if (PLACEHOLDER_CODES.has(value.toLowerCase())) return false;
  if (/TEST-RMLY/i.test(value)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(value)) return false;
  if (!/\d/.test(value) && value.length < 6) return false;
  return true;
}

function isRealProvider(provider) {
  const name = clean(provider);
  if (name.length < 2) return false;
  if (PSEUDO_PROVIDERS.has(name.toLowerCase())) return false;
  if (/\bqa\b|test stay|test provider/i.test(name)) return false;
  return true;
}

function provenanceClass(booking) {
  const source = clean(booking.source_type || booking.sourceType).toLowerCase();
  if (EMAIL_SOURCES.has(source)) return "email";
  const metadata = recordOf(booking.metadata);
  const requirements = recordOf(booking.reservation_requirements);
  if (
    metadata.email_import || metadata.email_lookback ||
    requirements.email_import || requirements.email_lookback ||
    clean(booking.source_reference || booking.sourceReference).startsWith("email:")
  ) {
    return "email";
  }
  if (source === "screenshot") return "screenshot";
  if (source === "upload") return "upload";
  if (source === "manual") return "manual";
  if (source === "provider" || source === "provider_sync" || source === "live_provider" || source === "affiliate" || source === "affiliate_conversion") {
    return "provider_reported";
  }
  return "none";
}

function hasRecordedOrigin(booking) {
  const source = clean(booking.source_type || booking.sourceType).toLowerCase();
  if (EMAIL_SOURCES.has(source) || TRAVELER_SOURCES.has(source)) return true;
  return provenanceClass(booking) === "email";
}

function hasProviderConfirmationEvidence(booking) {
  if (!booking || typeof booking !== "object") return false;
  if (booking.superseded_by_booking_id != null) return false;
  if (isTestBooking(booking)) return false;
  if (!ACTIVE_STATUSES.has(clean(booking.booking_status || booking.status).toLowerCase())) return false;
  if (booking.traveler_confirmed !== true && booking.travelerConfirmed !== true) return false;
  const code = clean(booking.confirmation_number) || clean(booking.confirmation_code) || clean(booking.provider_booking_id);
  if (!isPatternedCode(code)) return false;
  if (!isRealProvider(booking.provider_name || booking.provider)) return false;
  return hasRecordedOrigin(booking);
}

function isTravelerConfirmedOnly(booking) {
  if (!booking || typeof booking !== "object") return false;
  if (booking.superseded_by_booking_id != null) return false;
  if (isTestBooking(booking)) return false;
  if (!ACTIVE_STATUSES.has(clean(booking.booking_status || booking.status).toLowerCase())) return false;
  if (booking.traveler_confirmed !== true && booking.travelerConfirmed !== true) return false;
  return !hasProviderConfirmationEvidence(booking);
}

/** "confirmed" | "traveler_confirmed" | "other" for a briefing row. */
export function briefingBookingState(booking) {
  if (hasProviderConfirmationEvidence(booking)) return "confirmed";
  if (isTravelerConfirmedOnly(booking)) return "traveler_confirmed";
  return "other";
}

/** Mirror of bookingTruth.bookingProvenanceSuffix. */
export function briefingProvenanceSuffix(booking) {
  const provider = clean(booking.provider_name || booking.provider);
  const realProvider = isRealProvider(provider) ? provider : "";
  switch (provenanceClass(booking)) {
    case "email":
      return realProvider ? `from your ${realProvider} email` : "from your email";
    case "screenshot":
      return "from your screenshot";
    case "upload":
      return "from your upload";
    case "manual":
      return "from details you provided";
    case "provider_reported":
      return realProvider ? `reported by ${realProvider}` : "provider-reported";
    default:
      return "from your booking details";
  }
}
