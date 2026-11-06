/**
 * bookingEmailTombstone — durable suppression for discarded email
 * imports (Tombstone workstream, 2026-10-31 integrated RC).
 *
 * THE DEFECT (blocker-closure Item 1f): discarding an email import
 * HARD-DELETED its `booking_extraction_results` row. That row is the
 * Gmail sync's upsert dedupe target (unique on
 * user_id + source_type + source_reference), so deleting it destroyed
 * the only record that the traveler had ever seen — and removed — the
 * message. A later sync, and especially a reconnect backfill that
 * re-feeds trip-window mail, re-extracted the same email and
 * re-surfaced or re-applied it. "Deleted" did not stay deleted.
 *
 * THE FIX: a discard now writes a TOMBSTONE — a suppression record in
 * `booking_email_suppressions` (migration
 * 20261031000100_roamly_booking_email_suppressions.sql, OWNER-APPLIED)
 * keyed to the email's STABLE identity, the source reference
 * `email:<provider>:<provider message id>` (e.g.
 * "email:gmail:1a16f3b4a79c3bdf") — the same identity the extraction
 * writer mints (`bookingExtraction.ts`) and the dedupe index keys on.
 * The tombstone is keyed on the EMAIL, never on the stay: a different
 * message id from the same provider, or a genuinely new booking email
 * about the same stay, is a different identity and is NOT suppressed.
 *
 * Audit evidence is preserved, never destroyed:
 *  - the tombstone row itself is the durable removal record;
 *  - the extraction row is NOT deleted — the discard route moves it
 *    to match_status "rejected" with the "traveler_discarded" reason
 *    appended (the "rejected" status already exists in the schema
 *    CHECK), so the extraction audit trail survives alongside it;
 *  - a wallet booking created from the import is NOT deleted either —
 *    it is flagged discarded in its metadata (see bookingTruth's
 *    "discarded" state), which ends its customer-facing presentation
 *    across wallet / itinerary / Alerts while the row and its history
 *    stay readable.
 *
 * Enforcement points (all consult the tombstone BEFORE acting):
 *  - Gmail sync / reconnect backfill / auto-apply:
 *    `extractAndMatchTravelEmailBooking` (bookingExtraction.ts keeps a
 *    local mirror of the lookup, like its test-pattern mirror, so the
 *    module gains no new import) returns status "suppressed" and
 *    creates/applies nothing for a tombstoned message;
 *    `persistExtraction` additionally refuses to upsert over a
 *    discarded ("rejected") row, so the dedupe target can never be
 *    silently resurrected by a write path that missed the gate.
 *  - Email-imports list (GET): tombstoned rows are excluded from both
 *    `imports` and `keptAside` and counted in `discardedCount`;
 *    `evaluateExtractionCredibility` also gains the
 *    "traveler_discarded" reason when handed the suppressed set.
 *  - Attach (POST): a tombstoned (or already-rejected) extraction is
 *    refused — it can never be placed onto a trip after removal.
 *
 * Failure posture (deliberate): every lookup here FAILS OPEN. Until
 * the owner applies the migration the table does not exist, and a
 * missing table must not break Gmail sync or the review list. In
 * that window the loaders below fall back to the "rejected"
 * extraction row in the already-shipped booking_extraction_results
 * table (the discard route is the only writer of that status, so a
 * rejected row IS a discard record) — suppression therefore holds
 * with or without the new table, and a tombstone-table read error
 * degrades to the fallback rather than to no suppression at all.
 * Only if BOTH reads fail does a call degrade to pre-tombstone
 * behaviour, rather than stalling the traveler's whole sync.
 */

export const EMAIL_IMPORT_DISCARD_REASON = "traveler_discarded";

/** The metadata flag the discard route stamps on a wallet booking
 *  created from a discarded import (bookingTruth reads the same
 *  shape — keep the two in lockstep). */
export type EmailImportDiscardMark = {
  discardedAt: string;
  sourceReference: string | null;
  extractionId: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The stable source reference for one provider email message:
 * `email:<provider>:<messageId>` — exactly the shape
 * bookingExtraction.ts mints into `sourceReference` and the
 * booking_extraction_results dedupe index keys on. Returns null when
 * either half is missing (no stable identity, nothing to tombstone).
 */
export function sourceReferenceForEmail(provider: unknown, messageId: unknown): string | null {
  const providerText = clean(provider).toLowerCase();
  const messageText = clean(messageId);
  if (!providerText || !messageText) return null;
  return `email:${providerText}:${messageText}`;
}

/** Inverse of sourceReferenceForEmail. The provider is the segment
 *  between "email:" and the next ":"; the message id is the remainder
 *  (provider message ids do not contain ":" in practice, and taking
 *  the remainder keeps the parse lossless if one ever did). */
export function parseEmailSourceReference(
  sourceReference: unknown
): { provider: string; messageId: string } | null {
  const text = clean(sourceReference);
  if (!text.startsWith("email:")) return null;
  const rest = text.slice("email:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const provider = rest.slice(0, separator).trim().toLowerCase();
  const messageId = rest.slice(separator + 1).trim();
  if (!provider || !messageId) return null;
  return { provider, messageId };
}

/**
 * True when a booking-shaped record carries the traveler's discard
 * mark. Accepts the DB row shape, the serialized wallet shape, and
 * the TripBookingInput shape. Mirrors bookingTruth's
 * isTravelerDiscardedBooking (kept local so this module stays
 * import-free, like bookingNotificationWithdrawal).
 */
export function bookingCarriesDiscardMark(booking: unknown): boolean {
  if (!booking || typeof booking !== "object") return false;
  const record = booking as Record<string, unknown>;
  if (record.is_discarded === true || record.isDiscarded === true) return true;
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : null;
  if (!metadata) return false;
  const mark = metadata.emailImportDiscarded;
  return Boolean(mark && typeof mark === "object") || metadata.email_import_discarded === true;
}

type TombstoneClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Load the caller's tombstoned source references (optionally narrowed
 * to a candidate set). Fails soft on ANY error — including the table
 * not existing yet (migration not yet applied).
 *
 * Missing-schema fallback (release gate item 3, 2026-10-31): the
 * result is the UNION of the tombstone table and the discarded
 * extraction rows in the already-shipped booking_extraction_results
 * table (match_status "rejected" — written only by the discard
 * route, always alongside the tombstone attempt). Each read is
 * failure-isolated: a missing/erroring tombstone table still yields
 * the rejected-row set, and a fallback failure never discards
 * tombstone rows already loaded. Before this fallback existed, the
 * imports list and the attach route lost suppression entirely
 * whenever the tombstone read failed open and a live duplicate row
 * for the discarded identity existed (sync raced the gate).
 */
export async function loadSuppressedSourceReferences(
  supabase: TombstoneClient,
  userId: string,
  candidates?: readonly string[]
): Promise<Set<string>> {
  const wanted = candidates ? [...new Set(candidates.map(clean).filter(Boolean))] : null;
  if (wanted && !wanted.length) return new Set();
  const suppressed = new Set<string>();
  try {
    let query = supabase
      .from("booking_email_suppressions")
      .select("source_reference")
      .eq("user_id", userId);
    if (wanted) query = query.in("source_reference", wanted);
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const reference = clean((row as Record<string, unknown>)?.source_reference);
        if (reference) suppressed.add(reference);
      }
    }
  } catch {
    // Tombstone table missing or unreadable — the fallback below
    // still applies; suppression must not silently vanish.
  }
  try {
    let query = supabase
      .from("booking_extraction_results")
      .select("source_reference")
      .eq("user_id", userId)
      .eq("source_type", "email")
      .eq("match_status", "rejected");
    if (wanted) query = query.in("source_reference", wanted);
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const reference = clean((row as Record<string, unknown>)?.source_reference);
        if (reference) suppressed.add(reference);
      }
    }
  } catch {
    // Fallback unavailable too — return whatever the tombstone read
    // produced (possibly empty), preserving the fail-soft contract.
  }
  return suppressed;
}

/** True when this exact source reference is tombstoned for the user.
 *  Fails open (false) on any error — see the module header. */
export async function isSourceReferenceSuppressed(
  supabase: TombstoneClient,
  userId: string,
  sourceReference: string | null | undefined
): Promise<boolean> {
  const reference = clean(sourceReference);
  if (!reference) return false;
  const suppressed = await loadSuppressedSourceReferences(supabase, userId, [reference]);
  return suppressed.has(reference);
}

/**
 * Write (or refresh) the tombstone for one discarded import.
 * Idempotent: the unique (user_id, source_reference) index makes a
 * repeat discard a no-op upsert. A failure is REPORTED, not thrown —
 * the discard route still transitions the extraction row to
 * "rejected" so presentation ends even while the table is missing.
 */
export async function recordEmailImportTombstone(
  supabase: TombstoneClient,
  params: {
    userId: string;
    sourceReference: string;
    extractionId?: string | null;
    matchedBookingId?: string | null;
    tripId?: string | null;
  }
): Promise<{ ok: boolean; error: string | null }> {
  const parsed = parseEmailSourceReference(params.sourceReference);
  try {
    const { error } = await supabase.from("booking_email_suppressions").upsert(
      {
        user_id: params.userId,
        source_reference: params.sourceReference,
        provider: parsed?.provider || null,
        provider_message_id: parsed?.messageId || null,
        extraction_id: params.extractionId || null,
        matched_booking_id: params.matchedBookingId || null,
        trip_id: params.tripId || null,
        reason: EMAIL_IMPORT_DISCARD_REASON
      },
      { onConflict: "user_id,source_reference" }
    );
    if (error) return { ok: false, error: String(error.message || error) };
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "TOMBSTONE_WRITE_FAILED" };
  }
}
