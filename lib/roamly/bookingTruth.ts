/**
 * bookingTruth — the ONE booking-truth rule every surface uses
 * (Workstream A, 2026-10-29 release candidate).
 *
 * Owner semantics (his words, overriding the audit's attach behaviour):
 * attaching an email to a trip is PLACEMENT, not provider verification,
 * and a confirmation number ALONE is not independent provider
 * verification. "Confirmed" is a verified-record state, earned only
 * when credible provider-confirmation evidence, a genuine traveler
 * confirmation, an active canonical status, and a non-test record all
 * hold at the same time (see isConfirmed).
 *
 * Evidence grades (owner ruling 2026-10-30, Round 2 Lane E2 — this
 * ABOLISHES the round-1 legacy compromise, under which a row with NO
 * recorded source and traveler_confirmed=true was accepted as
 * origin-evidenced and received the full "Confirmed" presentation):
 *  - providerConfirmationEvidence: patterned confirmation identifier
 *    + real provider identity + a RECORDED provider-issued origin
 *    (email source, traveler-entered/screenshot source, email_import
 *    / email_lookback provenance, or an email: source reference) +
 *    traveler_confirmed + active status + non-test, non-superseded.
 *    NO legacy exception at this tier: a no-source row can never
 *    reach it, even with a code and provider stored.
 *  - travelerConfirmedOnly: traveler_confirmed === true + active
 *    canonical status + non-test + non-superseded, but NOT
 *    providerConfirmationEvidence. Its honest label is
 *    "Confirmed by you".
 *  - unverified: everything else (needs_confirmation /
 *    email_unverified / planned keep their meanings).
 *
 * Round 3 (owner ruling 2026-10-30, Lane T): this grade is earned by
 * evidence CONTAINED IN traveler-supplied material (an email in the
 * traveler's mailbox, a screenshot, details the traveler entered) —
 * Roamly never checks the booking with the provider through an
 * independent channel (see TERMINOLOGY-AUDIT.md: no class-(a)
 * verification exists in this codebase). Display therefore NEVER
 * calls this tier "verified": bookingDisplayLabel /
 * bookingProvenanceLabel state the true provenance instead, e.g.
 * "Confirmed · from your Agoda email" (email), "Confirmed · from
 * your screenshot" (screenshot), "Confirmed · from details you
 * provided" (manual entry), "Confirmed · reported by {Provider}"
 * (provider/affiliate-reported). The internal grade name was
 * renamed isProviderVerified -> hasProviderConfirmationEvidence
 * (EvidenceGrade "providerVerified" -> "providerConfirmationEvidence")
 * so the code stops claiming independent verification too.
 * Terminal states (cancelled/refunded/superseded) and test keep
 * precedence: they render as neither tier.
 *
 * Evidence tiers stay distinct: this module reads ONLY verified-record
 * inputs (provider identity + patterned confirmation identifier +
 * provider-issued origin + the traveler_confirmed flag + canonical
 * status). Planned, time-eligible, and location-verified facts are
 * never inputs here, so nothing in this module can promote them to
 * confirmed.
 *
 * Pure and unit-testable: every function takes a plain booking-shaped
 * object (DB row shape, serialized wallet shape, or TripBookingInput
 * shape — field-name aliases are all accepted) and performs no I/O.
 */

import { isTestBooking } from "@/lib/roamly/testBooking";

export type BookingTruthState =
  | "confirmed"
  | "traveler_confirmed"
  | "cancelled"
  | "refunded"
  | "superseded"
  | "discarded"
  | "test"
  | "needs_confirmation"
  | "email_unverified"
  | "planned";

export type BookingLike = {
  id?: unknown;
  booking_status?: unknown;
  status?: unknown;
  traveler_confirmed?: unknown;
  travelerConfirmed?: unknown;
  confirmation_number?: unknown;
  confirmation_code?: unknown;
  confirmationCode?: unknown;
  provider_booking_id?: unknown;
  providerBookingId?: unknown;
  provider_name?: unknown;
  provider?: unknown;
  title?: unknown;
  source_type?: unknown;
  sourceType?: unknown;
  source_reference?: unknown;
  sourceReference?: unknown;
  superseded_by_booking_id?: unknown;
  metadata?: unknown;
  is_test_booking?: unknown;
  is_discarded?: unknown;
  isDiscarded?: unknown;
  reservation_requirements?: unknown;
  [key: string]: unknown;
};

export const BOOKING_TRUTH_LABELS: Record<BookingTruthState, string> = {
  // State-only base label. The BOOKING-level display label for this
  // state is provenance-aware — use bookingDisplayLabel(booking),
  // never this map alone, on any user-visible surface.
  confirmed: "Confirmed",
  traveler_confirmed: "Confirmed by you",
  cancelled: "Cancelled",
  refunded: "Refunded",
  superseded: "Superseded",
  discarded: "Removed",
  test: "Test booking",
  needs_confirmation: "Needs your confirmation",
  email_unverified: "From your email — not verified",
  planned: "Planned"
};

export function bookingTruthLabel(state: BookingTruthState): string {
  return BOOKING_TRUTH_LABELS[state];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Raw status text, lowercased, from either naming convention. */
export function rawBookingStatus(booking: BookingLike): string {
  return clean(booking.booking_status || booking.status).toLowerCase();
}

/**
 * Canonical active family. The DB stores booked/paid/reserved/
 * cancelled/unknown; the wallet serializer reports confirmed/modified/
 * completed for the same rows. Both vocabularies name the same active
 * set here. needs_confirmation is deliberately NOT active.
 */
const ACTIVE_STATUSES = new Set([
  "booked",
  "paid",
  "reserved",
  "confirmed",
  "modified",
  "completed",
  "ticketed",
  "issued"
]);

export function isActiveBookingStatus(booking: BookingLike): boolean {
  return ACTIVE_STATUSES.has(rawBookingStatus(booking));
}

export function travelerConfirmedFlag(booking: BookingLike): boolean {
  return booking.traveler_confirmed === true || booking.travelerConfirmed === true;
}

export function confirmationIdentifier(booking: BookingLike): string {
  return (
    clean(booking.confirmation_number) ||
    clean(booking.confirmation_code) ||
    clean(booking.confirmationCode) ||
    clean(booking.provider_booking_id) ||
    clean(booking.providerBookingId)
  );
}

export function providerIdentity(booking: BookingLike): string {
  return clean(booking.provider_name) || clean(booking.provider);
}

export function sourceTypeOf(booking: BookingLike): string {
  return clean(booking.source_type || booking.sourceType).toLowerCase();
}

/** Test/QA detection: the shared testBooking predicate plus the
 *  serialized flag and the concrete TEST-RMLY fixture family. */
export function isTestTruthBooking(booking: BookingLike): boolean {
  if (booking.is_test_booking === true) return true;
  const metadata = recordOf(booking.metadata);
  if (
    isTestBooking({
      title: clean(booking.title) || null,
      provider: providerIdentity(booking) || null,
      metadata
    })
  ) {
    return true;
  }
  const code = confirmationIdentifier(booking);
  return Boolean(code && /TEST-RMLY/i.test(code));
}

/**
 * Traveler-discarded (Tombstone workstream, 2026-10-31): the
 * traveler discarded the email import this booking came from, and
 * the discard path stamped the mark into the booking's metadata
 * (metadata.emailImportDiscarded, written by
 * lib/roamly/bookingEmailTombstone's discard flow) — or a serializer
 * exposed it as the is_discarded flag. A discarded booking is a
 * REMOVED record: it keeps its row and history (audit evidence is
 * never destroyed) but it is presented nowhere as travel — it earns
 * neither evidence tier, is never active, and its truth state is
 * "discarded", which isInactiveTruthState treats as inactive so
 * wallet, itinerary, and Alerts all honour the one removal.
 * Distinct from "cancelled": a cancellation is a provider/traveler
 * booking event with its own X1 behaviour; a discard is the
 * traveler's removal of an import Roamly surfaced.
 */
export function isTravelerDiscardedBooking(booking: BookingLike): boolean {
  if (!booking || typeof booking !== "object") return false;
  if (booking.is_discarded === true || booking.isDiscarded === true) return true;
  const metadata = recordOf(booking.metadata);
  const mark = metadata.emailImportDiscarded;
  return Boolean(mark && typeof mark === "object") || metadata.email_import_discarded === true;
}

const PSEUDO_PROVIDERS = new Set([
  "",
  "unknown",
  "unknown provider",
  "test",
  "test provider",
  "qa",
  "qa test",
  "qa test provider",
  "roamly",
  "roamly qa",
  "roamly qa test provider",
  "self",
  "traveler",
  "manual",
  "gmail",
  "email",
  "provider",
  "n/a",
  "none",
  "tbd"
]);

/** A real provider identity: named, and not a test/QA/self pseudo-provider. */
export function isRealProviderIdentity(provider: string): boolean {
  const name = provider.trim();
  if (name.length < 2) return false;
  if (PSEUDO_PROVIDERS.has(name.toLowerCase())) return false;
  if (/\bqa\b|test stay|test provider/i.test(name)) return false;
  return true;
}

const PLACEHOLDER_CODES = new Set([
  "unknown",
  "pending",
  "none",
  "null",
  "n/a",
  "tbd",
  "1234",
  "0000",
  "12345"
]);

/**
 * A patterned confirmation identifier: 4–64 chars of code characters,
 * carrying a digit (or, for longer alphabetic codes, at least 6 chars),
 * never a placeholder and never a TEST-RMLY fixture code.
 */
export function isPatternedConfirmationCode(code: string): boolean {
  const value = code.trim();
  if (value.length < 4 || value.length > 64) return false;
  if (PLACEHOLDER_CODES.has(value.toLowerCase())) return false;
  if (/TEST-RMLY/i.test(value)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(value)) return false;
  if (!/\d/.test(value) && value.length < 6) return false;
  return true;
}

const EMAIL_SOURCES = new Set(["email", "gmail", "outlook"]);
const TRAVELER_SOURCES = new Set([
  "manual",
  "screenshot",
  "upload",
  "provider",
  "provider_sync",
  "live_provider",
  "affiliate",
  "affiliate_conversion"
]);

/**
 * A RECORDED provider-issued origin — one of the existing origin
 * forms, present on the record itself:
 *  - an email source (email/gmail/outlook), or a traveler-entered /
 *    screenshot source (manual / screenshot / upload / provider /
 *    provider_sync / live_provider / affiliate /
 *    affiliate_conversion), OR
 *  - email_import / email_lookback provenance in metadata or
 *    reservation_requirements, OR
 *  - a source_reference starting "email:".
 * A row with NO recorded origin returns false here — always. The
 * round-1 legacy compromise (no source + traveler_confirmed flag ⇒
 * origin attested) is abolished by the owner's 2026-10-30 ruling:
 * missing provenance bookkeeping must not manufacture verification.
 */
export function hasProviderIssuedOrigin(booking: BookingLike): boolean {
  const source = sourceTypeOf(booking);
  if (EMAIL_SOURCES.has(source) || TRAVELER_SOURCES.has(source)) return true;
  const metadata = recordOf(booking.metadata);
  const requirements = recordOf(booking.reservation_requirements);
  return Boolean(
    metadata.email_import ||
    metadata.email_lookback ||
    requirements.email_import ||
    requirements.email_lookback ||
    clean(booking.source_reference || booking.sourceReference).startsWith("email:")
  );
}

/**
 * Credible provider-confirmation evidence — ALL of:
 *  - a patterned confirmation identifier (confirmation number or
 *    provider booking id), AND
 *  - a real provider identity (not a test/QA/self pseudo-provider), AND
 *  - a recorded provider-issued origin (hasProviderIssuedOrigin).
 * A confirmation number with none of this around it is NOT evidence,
 * and neither is a code + provider with no recorded origin.
 */
export function hasCredibleProviderEvidence(booking: BookingLike): boolean {
  const code = confirmationIdentifier(booking);
  if (!code || !isPatternedConfirmationCode(code)) return false;
  if (!isRealProviderIdentity(providerIdentity(booking))) return false;
  if (isTestTruthBooking(booking)) return false;
  return hasProviderIssuedOrigin(booking);
}

/** The explicit evidence grade (owner ruling 2026-10-30). */
export type EvidenceGrade = "providerConfirmationEvidence" | "travelerConfirmedOnly" | "unverified";

/**
 * providerConfirmationEvidence — true ONLY when ALL hold:
 *  (a) credible provider-confirmation evidence
 *      (hasCredibleProviderEvidence — patterned code + real provider
 *      + RECORDED provider-issued origin; no legacy exception);
 *  (b) traveler_confirmed === true;
 *  (c) canonical booking_status is active;
 *  (d) not a test/QA booking, and not superseded.
 * This tier's evidence arrived inside traveler-supplied material
 * (email / screenshot / manual entry / provider-reported conversion);
 * it is NOT an independent check by Roamly against the provider, and
 * no surface may present it as "verified" (Round 3, Lane T).
 */
export function hasProviderConfirmationEvidence(booking: BookingLike): boolean {
  if (!booking || typeof booking !== "object") return false;
  if (booking.superseded_by_booking_id != null) return false;
  if (isTravelerDiscardedBooking(booking)) return false;
  if (isTestTruthBooking(booking)) return false;
  if (!isActiveBookingStatus(booking)) return false;
  if (!travelerConfirmedFlag(booking)) return false;
  return hasCredibleProviderEvidence(booking);
}

/**
 * travelerConfirmedOnly — the traveler confirmed this booking
 * (traveler_confirmed === true, active canonical status, not
 * test/QA, not superseded) but it does NOT have provider
 * confirmation evidence: the evidence is incomplete (most often: no
 * recorded provider-issued origin — the legacy no-source case). It
 * renders with the honest label "Confirmed by you".
 */
export function isTravelerConfirmedOnly(booking: BookingLike): boolean {
  if (!booking || typeof booking !== "object") return false;
  if (booking.superseded_by_booking_id != null) return false;
  if (isTravelerDiscardedBooking(booking)) return false;
  if (isTestTruthBooking(booking)) return false;
  if (!isActiveBookingStatus(booking)) return false;
  if (!travelerConfirmedFlag(booking)) return false;
  return !hasProviderConfirmationEvidence(booking);
}

/** The booking's evidence grade. Terminal states (cancelled /
 *  refunded / superseded) and test rows are neither tier — their
 *  status is not active (or they are superseded/test), so they grade
 *  "unverified" here and keep their own truth states in
 *  bookingTruthState, which checks them first. */
export function evidenceGrade(booking: BookingLike): EvidenceGrade {
  if (hasProviderConfirmationEvidence(booking)) return "providerConfirmationEvidence";
  if (isTravelerConfirmedOnly(booking)) return "travelerConfirmedOnly";
  return "unverified";
}

/**
 * isConfirmed — the confirmation-evidence predicate every surface
 * delegates to. It is EXACTLY hasProviderConfirmationEvidence:
 * credible provider-confirmation evidence (patterned code + real
 * provider + recorded provider-issued origin, no legacy exception)
 * AND traveler_confirmed === true (set by a real traveler
 * confirmation action or the evidence-record path, never by
 * extraction, auto-apply, or attach — those paths are incapable of
 * setting it after Workstream A) AND an active canonical status AND
 * a non-test, non-superseded record. A travelerConfirmedOnly booking
 * is NOT confirmed under this predicate. "Confirmed" here names the
 * evidence tier, not an independent provider verification — displays
 * use bookingDisplayLabel, which states the provenance.
 */
export function isConfirmed(booking: BookingLike): boolean {
  return hasProviderConfirmationEvidence(booking);
}

/** The one display-state derivation every surface renders from. */
export function bookingTruthState(booking: BookingLike): BookingTruthState {
  if (!booking || typeof booking !== "object") return "planned";
  if (booking.superseded_by_booking_id != null) return "superseded";
  if (isTravelerDiscardedBooking(booking)) return "discarded";
  if (isTestTruthBooking(booking)) return "test";
  const status = rawBookingStatus(booking);
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "refunded") return "refunded";
  if (hasProviderConfirmationEvidence(booking)) return "confirmed";
  if (isTravelerConfirmedOnly(booking)) return "traveler_confirmed";
  const source = sourceTypeOf(booking);
  const metadata = recordOf(booking.metadata);
  const requirements = recordOf(booking.reservation_requirements);
  const emailSourced =
    EMAIL_SOURCES.has(source) ||
    Boolean(metadata.email_import || metadata.email_lookback || requirements.email_import || requirements.email_lookback) ||
    clean(booking.source_reference || booking.sourceReference).startsWith("email:");
  if (emailSourced) return "email_unverified";
  if (
    status === "needs_confirmation" ||
    status === "needs_review" ||
    status === "pending" ||
    status === "detected" ||
    status === "unknown" ||
    status === "" ||
    isActiveBookingStatus(booking)
  ) {
    // An active-looking status that failed the confirmed predicate is
    // missing evidence — it is a needs-confirmation record, never a
    // planned-as-if-active one.
    return "needs_confirmation";
  }
  return "planned";
}

/**
 * The provenance class of a booking's recorded origin (Round 3,
 * Lane T) — WHERE the confirmation evidence came from:
 *  - "email": an email source (email/gmail/outlook), email_import /
 *    email_lookback provenance, or an "email:" source reference —
 *    provider-issued confirmation evidence contained in an email in
 *    the traveler's mailbox (evidence class b);
 *  - "screenshot" / "upload" / "manual": traveler-supplied material
 *    (evidence class c);
 *  - "provider_reported": a provider/affiliate channel reported the
 *    booking to Roamly (source provider / provider_sync /
 *    live_provider / affiliate / affiliate_conversion) — reported,
 *    not independently checked by Roamly;
 *  - "none": no recorded origin.
 */
export type BookingProvenanceClass = "email" | "screenshot" | "upload" | "manual" | "provider_reported" | "none";

export function bookingProvenanceClass(booking: BookingLike): BookingProvenanceClass {
  const source = sourceTypeOf(booking);
  if (EMAIL_SOURCES.has(source)) return "email";
  const metadata = recordOf(booking.metadata);
  const requirements = recordOf(booking.reservation_requirements);
  if (
    metadata.email_import ||
    metadata.email_lookback ||
    requirements.email_import ||
    requirements.email_lookback ||
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

/** The provenance suffix for a confirmed-tier display label, e.g.
 *  "from your Agoda email". Never contains a verification claim. */
export function bookingProvenanceSuffix(booking: BookingLike): string {
  const provider = providerIdentity(booking);
  const realProvider = isRealProviderIdentity(provider) ? provider : "";
  switch (bookingProvenanceClass(booking)) {
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

/** The provenance-aware label for the confirmation-evidence tier:
 *  "Confirmed · from your {Provider} email" / "Confirmed · from
 *  your screenshot" / "Confirmed · from details you provided" /
 *  "Confirmed · reported by {Provider}". This is the ONLY label a
 *  surface may render for that tier (Round 3, Lane T). */
export function bookingProvenanceLabel(booking: BookingLike): string {
  return `Confirmed · ${bookingProvenanceSuffix(booking)}`;
}

export function bookingDisplayLabel(booking: BookingLike): string {
  const state = bookingTruthState(booking);
  if (state === "confirmed") return bookingProvenanceLabel(booking);
  return BOOKING_TRUTH_LABELS[state];
}

/** True when the booking is in a terminal/inactive truth state whose
 *  reminders and confirmed framing must not render as live travel. */
export function isInactiveTruthState(state: BookingTruthState): boolean {
  return state === "cancelled" || state === "refunded" || state === "superseded" || state === "discarded" || state === "test";
}

/** Strip a baked "Confirmed:" / "Confirmed by you:" / "Cancelled:"
 *  stamp prefix from a stored itinerary/place title, returning the
 *  bare booking title. */
export function stripBookingStampPrefix(title: string): string {
  // Also strips the Round-3 provenance stamp ("Confirmed · from your
  // Agoda email: …"): the "· …" segment runs up to the stamp colon.
  return title.replace(/^(?:confirmed by you|confirmed(?:\s·\s[^:\n]+)?|cancelled|canceled|refunded):\s*/i, "");
}

/**
 * The honest display title for a stored booking-linked item, derived
 * from the booking's CURRENT truth — never from the stored stamp:
 * the confirmation-evidence tier stamps its PROVENANCE label
 * ("Confirmed · from your {Provider} email: …") when the booking is
 * passed (Round 3, Lane T; without a booking it falls back to the
 * plain "Confirmed:" stamp for state-only callers), traveler_confirmed
 * stamps "Confirmed by you:", cancelled/refunded re-stamp honestly,
 * and every other state renders the bare title with no confirmed
 * framing.
 */
export function titleForTruth(title: string, state: BookingTruthState, booking?: BookingLike): string {
  const bare = stripBookingStampPrefix(title || "");
  if (state === "confirmed") return booking ? `${bookingProvenanceLabel(booking)}: ${bare}` : `Confirmed: ${bare}`;
  if (state === "traveler_confirmed") return `Confirmed by you: ${bare}`;
  if (state === "cancelled") return `Cancelled: ${bare}`;
  if (state === "refunded") return `Refunded: ${bare}`;
  return bare;
}
