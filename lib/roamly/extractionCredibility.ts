/**
 * Workstream B (2026-10-29 release candidate): read-time re-evaluation
 * of LEGACY stored booking extractions against the NEW evidence bar.
 *
 * Rows in `booking_extraction_results` were persisted under the old
 * admission rules (see the production-recovery audit, Critical
 * Finding 1 / G9): GitHub notification mail scored 91-97%, promo mail
 * scored 100%, and the synthetic QA stay scored 100% — and the review
 * list re-served every stored unmatched / needs_confirmation row with
 * no quality floor, so that junk kept appearing as a credible booking
 * suggestion forever.
 *
 * This module is the code-side remedy. It is PURE (no imports, no I/O,
 * no clock): it re-evaluates ONE stored row, exactly as persisted, and
 * decides whether that row may still be presented as a credible
 * booking suggestion. It never writes, deletes, or mutates anything;
 * the read path demotes non-credible rows to a separate collection.
 *
 * The stored overall_confidence number is NEVER consulted. Parse
 * confidence was the defect: it is a keyword count (deterministic
 * path) or a model's self-report (AI path), not verification.
 *
 * Mirrored rule sources (kept local, like bookingExtraction.ts keeps
 * its test-pattern mirror local, so this module stays loadable in
 * restricted test sandboxes with no import graph):
 *  - NON_BOOKING_SENDER_DOMAINS and PROMO_SUBJECT_PATTERNS mirror
 *    lib/roamly/travelEmailFiltering.ts (the audit-fix admission
 *    exclusions). If that file's lists grow, grow these too.
 *  - The confirmation-code shape mirrors the filter's booking
 *    reference rule: 5-64 chars of [A-Z0-9-], must contain a digit,
 *    and a bare label word ("CONFIRMATION", "BOOKING", ...) is not a
 *    code.
 *  - The test/QA patterns extend lib/roamly/testBooking.ts
 *    (/\bQA\b|test stay|test provider/i on title/provider, plus the
 *    metadata.qa_test flag) with the concrete fixture family named in
 *    the audit: TEST-RMLY codes, "QA TEST", and "NOT A REAL
 *    RESERVATION" text.
 *
 * Reason codes (stable strings; the UI maps them to plain language):
 *  - "missing_confirmation_code"  no confirmation code in the stored
 *    extracted JSON or in the stored field-confidence entry.
 *  - "invalid_confirmation_code"  a code string is present but fails
 *    the booking-reference shape (too short/long, no digit, illegal
 *    characters, or a bare label word).
 *  - "non_booking_sender"         sender domain (or sender-domain fact,
 *    or provider identity) is an excluded non-booking class
 *    (github.com).
 *  - "promotional_subject"        subject (or, when no subject is
 *    stored, the title the extraction fell back to) matches a
 *    marketing-subject pattern.
 *  - "non_booking_notification"   subject/title is subscription or
 *    notification mail (newsletter, digest, subscription notice),
 *    not a booking confirmation.
 *  - "test_or_qa_record"          TEST-RMLY / QA TEST / NOT A REAL
 *    RESERVATION / test-stay patterns, or metadata.qa_test === true.
 *  - "missing_provider"           no provider identity stored at all:
 *    there is nothing to attribute the supposed booking to.
 *  - "traveler_discarded"         (Tombstone workstream, 2026-10-31)
 *    the row's source_reference is in the caller-supplied tombstone
 *    set (booking_email_suppressions): the traveler discarded this
 *    email import, so it is never a credible suggestion again, no
 *    matter how genuine its evidence looks. The set is loaded by the
 *    caller (this module stays pure); when no set is supplied the
 *    reason never fires and behaviour is exactly as before.
 */

export type StoredExtractionBookingJson = {
  bookingType?: unknown;
  bookingStatus?: unknown;
  provider?: unknown;
  providerBookingId?: unknown;
  confirmationCode?: unknown;
  confirmation_code?: unknown;
  sourceType?: unknown;
  sourceReference?: unknown;
  title?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  origin?: unknown;
  destination?: unknown;
  locationName?: unknown;
  flightNumber?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
};

export type StoredExtractionFieldConfidence = {
  value?: unknown;
  confidence?: unknown;
  verified?: unknown;
  [key: string]: unknown;
};

/**
 * One stored `booking_extraction_results` row, in the shape the
 * email-imports GET route loads it (DB column names), with the
 * camelCase aliases the route / test fixtures may use, plus the
 * OPTIONAL linked-message evidence the route joins from
 * `travel_email_messages` via email_message_id (sender / subject /
 * filter facts). Every field is optional and unknown-typed on
 * purpose: legacy rows are untrusted data, and missing evidence must
 * degrade to "not credible", never throw.
 */
export type StoredExtractionRow = {
  id?: unknown;
  trip_id?: unknown;
  tripId?: unknown;
  match_status?: unknown;
  matchStatus?: unknown;
  overall_confidence?: unknown;
  overallConfidence?: unknown;
  match_reasons?: unknown;
  matchReasons?: unknown;
  email_event_types?: unknown;
  extracted_booking_json?: StoredExtractionBookingJson | null;
  extractedBookingJson?: StoredExtractionBookingJson | null;
  booking?: StoredExtractionBookingJson | null;
  field_confidence_json?: Record<string, StoredExtractionFieldConfidence> | null;
  fieldConfidenceJson?: Record<string, StoredExtractionFieldConfidence> | null;
  fields?: Record<string, StoredExtractionFieldConfidence> | null;
  source_reference?: unknown;
  sourceReference?: unknown;
  /** Tombstone set (source references the traveler discarded),
   *  loaded by the caller from booking_email_suppressions. */
  suppressedSourceReferences?: ReadonlySet<string> | readonly string[] | null;
  email_message_id?: unknown;
  /** Linked travel_email_messages evidence (joined by the caller). */
  sender?: unknown;
  subject?: unknown;
  emailSender?: unknown;
  emailSubject?: unknown;
  message?: {
    sender?: unknown;
    subject?: unknown;
    filter_reasons?: unknown;
    filterReasons?: unknown;
    extracted_booking_facts?: unknown;
    extractedBookingFacts?: unknown;
  } | null;
  [key: string]: unknown;
};

export type ExtractionCredibility = {
  credible: boolean;
  /** Demotion reason codes; empty when credible. */
  reasons: string[];
  /** The confirmation code the verdict rested on (null if none). */
  confirmationCode: string | null;
  /** The provider identity the verdict rested on (null if none). */
  provider: string | null;
};

// --- Mirrored exclusions from lib/roamly/travelEmailFiltering.ts ---

const NON_BOOKING_SENDER_DOMAINS = ["github.com"];

// Provider *names* for the same excluded classes. Stored extraction
// rows do not always carry the sender (see lane note), but the
// deterministic extractor derived `provider` from the sender domain,
// so a GitHub row's provider is the string "Github". Matching the
// provider name is matching the same sender class, not an allowlist.
const NON_BOOKING_PROVIDER_NAMES = ["github"];

const PROMO_SUBJECT_PATTERNS = [
  /\d{1,3}%\s*off/i,
  /\bbonus points\b/i,
  /\bearn\b[^.]{0,40}\bpoints\b/i,
  /\bpoints offer\b/i,
  /\bfor less\b/i
];

// Subscription / notification mail classes named in the workstream
// brief. Deliberately narrow: booking senders are usually no-reply
// too, so a bare "notification" or "noreply" is NOT excluded — only
// subject/title language that describes a subscription or digest
// product rather than a reservation.
const NON_BOOKING_SUBJECT_PATTERNS = [
  /\bnewsletter\b/i,
  /\b(?:daily|weekly|monthly)\s+digest\b/i,
  /\bsubscription\s+(?:confirmation|confirmed|renewal|renewed|receipt|update|notice)\b/i,
  /\byour\s+subscription\b/i
];

const NON_CODE_WORDS = new Set([
  "CONFIRMATION",
  "CONFIRMED",
  "BOOKING",
  "RESERVATION",
  "OPTIONS",
  "NUMBER",
  "REFERENCE",
  "ITINERARY"
]);

// Test/QA patterns: testBooking.ts mirror (\bQA\b on title/provider,
// "test stay", "test provider") plus the audit's concrete fixture
// family. Applied to confirmation code, title, provider, subject,
// sender, and source reference.
const TEST_CODE_PATTERN = /TEST-RMLY/i;
const TEST_TEXT_PATTERNS = [
  /TEST-RMLY/i,
  /NOT A REAL RESERVATION/i,
  /ROAMLY\s+QA\s+TEST/i,
  /\bQA\s+TEST\b/i,
  /\bQA\b/,
  /test stay/i,
  /test provider/i,
  /test booking/i
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function senderDomainOf(sender: string): string {
  const match = sender.toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
  return (match?.[1] || "").replace(/^mail\./, "");
}

function isExcludedDomain(domain: string): boolean {
  return Boolean(
    domain &&
      NON_BOOKING_SENDER_DOMAINS.some(
        (blocked) => domain === blocked || domain.endsWith(`.${blocked}`)
      )
  );
}

function looksLikeConfirmationCode(code: string): boolean {
  if (code.length < 5 || code.length > 64) return false;
  if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(code)) return false;
  if (!/\d/.test(code)) return false;
  if (NON_CODE_WORDS.has(code.toUpperCase())) return false;
  return true;
}

export function evaluateExtractionCredibility(
  row: StoredExtractionRow
): ExtractionCredibility {
  const safeRow: StoredExtractionRow = row && typeof row === "object" ? row : {};
  const booking: StoredExtractionBookingJson =
    (safeRow.extracted_booking_json as StoredExtractionBookingJson) ||
    (safeRow.extractedBookingJson as StoredExtractionBookingJson) ||
    (safeRow.booking as StoredExtractionBookingJson) ||
    {};
  const fields =
    safeRow.field_confidence_json ||
    safeRow.fieldConfidenceJson ||
    safeRow.fields ||
    null;
  const message = safeRow.message && typeof safeRow.message === "object" ? safeRow.message : null;

  // --- Gather every piece of identity evidence the row carries. ---
  const provider = text(booking.provider);
  const title = text(booking.title);
  const sender = text(safeRow.sender) || text(safeRow.emailSender) || text(message?.sender);
  const subject = text(safeRow.subject) || text(safeRow.emailSubject) || text(message?.subject);
  const sourceReference =
    text(booking.sourceReference) || text(safeRow.source_reference) || text(safeRow.sourceReference);
  const facts =
    message?.extracted_booking_facts && typeof message.extracted_booking_facts === "object"
      ? (message.extracted_booking_facts as Record<string, unknown>)
      : message?.extractedBookingFacts && typeof message.extractedBookingFacts === "object"
        ? (message.extractedBookingFacts as Record<string, unknown>)
        : null;
  const factDomain = text(facts?.senderDomain).toLowerCase().replace(/^mail\./, "");
  const senderDomain = senderDomainOf(sender) || factDomain;

  // --- (a) A genuine confirmation code from the stored fields. ---
  // The booking JSON's confirmationCode is primary; the stored
  // field-confidence entry for confirmation_code is the second stored
  // source. overall_confidence is deliberately never read here.
  const fieldCode = text(fields?.confirmation_code?.value);
  const bookingCode = text(booking.confirmationCode) || text(booking.confirmation_code);
  const confirmationCode = bookingCode || fieldCode || null;

  const reasons: string[] = [];
  const add = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  // --- (e) Traveler tombstone: a discarded email identity is never
  // credible again. Keyed on the source reference (the email's
  // stable identity), never on the stay, so a different message
  // about the same stay is unaffected. ---
  const suppressed = safeRow.suppressedSourceReferences;
  if (sourceReference && suppressed) {
    // Duck-typed (not instanceof Set): the set may come from another
    // module realm in test harnesses, and membership is all we need.
    const isSuppressed =
      typeof (suppressed as { has?: unknown }).has === "function"
        ? (suppressed as ReadonlySet<string>).has(sourceReference)
        : Array.isArray(suppressed) && suppressed.includes(sourceReference);
    if (isSuppressed) add("traveler_discarded");
  }

  if (!confirmationCode) {
    add("missing_confirmation_code");
  } else if (!looksLikeConfirmationCode(confirmationCode)) {
    add("invalid_confirmation_code");
  }

  // --- (c) Test / QA records are never credible suggestions. ---
  const metadata =
    booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, unknown>)
      : null;
  const testHaystacks = [confirmationCode || "", title, provider, subject, sender, sourceReference];
  if (
    metadata?.qa_test === true ||
    (confirmationCode !== null && TEST_CODE_PATTERN.test(confirmationCode)) ||
    testHaystacks.some((value) => value && TEST_TEXT_PATTERNS.some((pattern) => pattern.test(value)))
  ) {
    add("test_or_qa_record");
  }

  // --- (b) Excluded non-booking sender / subject classes. ---
  if (
    isExcludedDomain(senderDomain) ||
    NON_BOOKING_PROVIDER_NAMES.includes(provider.toLowerCase())
  ) {
    add("non_booking_sender");
  }
  // Promo / notification language is checked on the subject when the
  // stored row carries one. Legacy extraction rows carry no subject
  // of their own, but the deterministic extractor fell back to the
  // subject as the title, so the title is the stored trace of it and
  // is checked as the fallback.
  const subjectLike = subject || title;
  if (subjectLike && PROMO_SUBJECT_PATTERNS.some((pattern) => pattern.test(subjectLike))) {
    add("promotional_subject");
  }
  if (subjectLike && NON_BOOKING_SUBJECT_PATTERNS.some((pattern) => pattern.test(subjectLike))) {
    add("non_booking_notification");
  }

  // --- (d) Provider identity. ---
  // No allowlist: any non-empty provider string is a plausible
  // provider identity for this bar (smaller legitimate providers must
  // survive). Only a wholly missing provider fails — combined with
  // the code requirement above, a garbled domain-derived fragment
  // alone can never make a row credible.
  if (!provider) {
    add("missing_provider");
  }

  return {
    credible: reasons.length === 0,
    reasons,
    confirmationCode,
    provider: provider || null
  };
}
