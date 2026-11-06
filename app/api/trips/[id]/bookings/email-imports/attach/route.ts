import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createTripBooking, type TripBookingInput } from "@/lib/roamly/bookingWallet";
import { evaluateExtractionCredibility } from "@/lib/roamly/extractionCredibility";
import { loadSuppressedSourceReferences } from "@/lib/roamly/bookingEmailTombstone";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PENDING_STATUSES = new Set(["unmatched", "needs_confirmation"]);

/**
 * Workstream B hard-refusal classes: a stored extraction in one of
 * these classes must never create a booking at all — not even an
 * unverified one. Recreating a TEST-RMLY booking through a direct
 * POST (bypassing the review list, which now demotes these rows to
 * kept-aside with no Attach button) is exactly the incident being
 * fixed. A row that merely lacks a confirmation code is NOT in this
 * set: it may still attach as placement (see below).
 */
const ATTACH_REFUSAL_REASONS = new Set([
  "test_or_qa_record",
  "non_booking_sender",
  "promotional_subject",
  "non_booking_notification"
]);

/**
 * Attaches an email-extracted booking to this trip.
 *
 * Owner semantics (Workstream A, overriding the audit behaviour):
 * attach is PLACEMENT ONLY. It never sets traveler_confirmed — not
 * even when the email carried a real confirmation code — because
 * placement is not independent provider verification. Attached email
 * bookings land in the unverified needs_confirmation state, which
 * bookingTruth renders as "From your email — not verified".
 *
 * Workstream B addition: before any booking is created, the stored
 * extraction row is re-evaluated with evaluateExtractionCredibility
 * (the same verdict, on the same linked-message evidence, that the
 * email-imports GET uses to demote rows). Test/QA records and
 * excluded non-booking classes are refused with no booking created.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const extractionId =
    body && typeof body === "object" && typeof body.extractionId === "string" ? body.extractionId : "";
  if (!extractionId) {
    return NextResponse.json({ ok: false, error: "Choose an import to attach." }, { status: 400 });
  }

  const { data: row, error: lookupError } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,user_id,trip_id,match_status,source_reference,email_message_id,extracted_booking_json,field_confidence_json")
    .eq("id", extractionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (lookupError || !row) {
    return NextResponse.json({ ok: false, error: "That import could not be found." }, { status: 404 });
  }
  if (!PENDING_STATUSES.has(String(row.match_status))) {
    return NextResponse.json({ ok: false, error: "That import was already handled." }, { status: 409 });
  }
  // Audit fix: an extraction already bound to a DIFFERENT trip must
  // never attach here. Unmatched rows (trip_id null) are offered on
  // every trip by design; a bound row is not.
  if (row.trip_id && String(row.trip_id) !== id) {
    return NextResponse.json({ ok: false, error: "That import belongs to a different trip." }, { status: 409 });
  }

  // Workstream B: credibility re-evaluation BEFORE creating any
  // booking, on the same evidence as the GET (stored extraction
  // fields + the linked travel_email_messages row, joined fail-soft).
  let linkedMessage: { sender: string | null; subject: string | null; extractedFacts: Record<string, unknown> | null } | null = null;
  if (typeof row.email_message_id === "string" && row.email_message_id) {
    const { data: messageRow } = await auth.supabase
      .from("travel_email_messages")
      .select("sender,subject,extracted_booking_facts")
      .eq("user_id", auth.user.id)
      .eq("id", row.email_message_id)
      .maybeSingle();
    if (messageRow) {
      linkedMessage = {
        sender: typeof messageRow.sender === "string" ? messageRow.sender : null,
        subject: typeof messageRow.subject === "string" ? messageRow.subject : null,
        extractedFacts:
          messageRow.extracted_booking_facts &&
          typeof messageRow.extracted_booking_facts === "object" &&
          !Array.isArray(messageRow.extracted_booking_facts)
            ? (messageRow.extracted_booking_facts as Record<string, unknown>)
            : null
      };
    }
  }
  // Tombstone (2026-10-31): a discarded import can never be attached
  // after removal. The row is normally already match_status
  // "rejected" (refused above as already handled); this also covers
  // a row re-created by a sync that raced the tombstone gate. The
  // load fails soft, like the credibility join below.
  const suppressedReferences = await loadSuppressedSourceReferences(auth.supabase, auth.user.id, [
    typeof row.source_reference === "string" ? row.source_reference : ""
  ]);
  const verdict = evaluateExtractionCredibility({
    extracted_booking_json: (row.extracted_booking_json || {}) as Record<string, unknown>,
    field_confidence_json:
      row.field_confidence_json && typeof row.field_confidence_json === "object"
        ? (row.field_confidence_json as Record<string, { value?: unknown }>)
        : null,
    source_reference: typeof row.source_reference === "string" ? row.source_reference : null,
    suppressedSourceReferences: suppressedReferences,
    message: linkedMessage
      ? {
          sender: linkedMessage.sender,
          subject: linkedMessage.subject,
          extracted_booking_facts: linkedMessage.extractedFacts
        }
      : null
  });
  if (verdict.reasons.includes("traveler_discarded")) {
    return NextResponse.json(
      { ok: false, error: "That import was removed.", credibilityReasons: ["traveler_discarded"] },
      { status: 409 }
    );
  }
  const refusalReasons = verdict.reasons.filter((reason) => ATTACH_REFUSAL_REASONS.has(reason));
  if (refusalReasons.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "That import is not a real booking and cannot be attached.",
        credibilityReasons: refusalReasons
      },
      { status: 422 }
    );
  }

  const extracted = ((row.extracted_booking_json || {}) as Partial<TripBookingInput>) || {};
  const attachedAt = new Date().toISOString();

  const saved = await createTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    input: {
      ...extracted,
      sourceType: "email",
      sourceReference:
        extracted.sourceReference ||
        (typeof row.source_reference === "string" ? row.source_reference : null) ||
        (typeof row.email_message_id === "string" ? row.email_message_id : null),
      // Placement only: an extracted terminal state (a cancellation /
      // refund notice for an existing booking) keeps its state so
      // reconciliation still works; every other attach lands in the
      // unverified needs_confirmation state, and travelerConfirmed is
      // hardcoded false — this route is incapable of setting it.
      bookingStatus:
        extracted.bookingStatus === "cancelled" || extracted.bookingStatus === "refunded"
          ? extracted.bookingStatus
          : "needs_confirmation",
      travelerConfirmed: false,
      lastSyncedAt: attachedAt,
      reservationRequirements: {
        ...(extracted.reservationRequirements && typeof extracted.reservationRequirements === "object"
          ? extracted.reservationRequirements
          : {}),
        email_import: {
          attached_by: "traveler",
          extraction_id: extractionId,
          attached_at: attachedAt
        }
      }
    }
  });

  if (saved.error || !saved.booking) {
    return NextResponse.json(
      { ok: false, error: "We could not save that booking. Your trip is unchanged." },
      { status: 400 }
    );
  }

  await auth.supabase
    .from("booking_extraction_results")
    .update({
      trip_id: id,
      match_status: "attached",
      matched_booking_id: saved.booking.id,
      applied_at: attachedAt
    })
    .eq("id", extractionId)
    .eq("user_id", auth.user.id);

  await reconcileTripBookings({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    sourceBookingId: saved.booking.id
  }).catch(() => null);

  return NextResponse.json({ ok: true, bookingId: saved.booking.id });
}
