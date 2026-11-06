import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  EMAIL_IMPORT_DISCARD_REASON,
  recordEmailImportTombstone,
  sourceReferenceForEmail
} from "@/lib/roamly/bookingEmailTombstone";
import { markBookingNotificationsWithdrawn } from "@/lib/roamly/bookingNotificationWithdrawal";
import { applyStoredItineraryBookingOverride } from "@/lib/roamly/itineraryBookingOverrides";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Discards an email-import suggestion — durably (Tombstone
 * workstream, 2026-10-31). The original email is untouched.
 *
 * This route used to HARD-DELETE the extraction row. That row is the
 * Gmail sync's upsert dedupe target, so the delete destroyed the only
 * record of the traveler's removal and a later sync / reconnect
 * backfill re-extracted and re-surfaced (or re-applied) the same
 * email (blocker-closure Item 1f). Nothing is deleted any more:
 *
 *  1. TOMBSTONE: a suppression record keyed to the email's stable
 *     identity (source_reference = email:<provider>:<message id>) is
 *     written to booking_email_suppressions. Gmail sync, reconnect
 *     backfill, and auto-apply consult it BEFORE creating or
 *     applying an extraction, so the removal survives reconnects.
 *  2. AUDIT PRESERVED: the extraction row is moved to match_status
 *     "rejected" with the traveler_discarded reason appended — it
 *     stays as evidence and as the dedupe target (persistExtraction
 *     refuses to upsert over a rejected row).
 *  3. ONE REMOVAL, EVERY SURFACE: if the import already produced a
 *     wallet booking (attach or auto-apply), that booking is flagged
 *     discarded in its metadata (never deleted). bookingTruth grades
 *     it "discarded", so the wallet stops presenting it as active,
 *     itinerary re-stamping + read-path reconcile neutralise its
 *     stored items, its scheduled companion reminders are cancelled,
 *     and its Alerts notifications are marked withdrawn — the same
 *     secondary machinery the wallet cancel path uses. Secondary
 *     failures are flagged in the response, never rolled back: the
 *     removal itself (steps 1–2) is the primary result.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  await context.params;

  const body = await request.json().catch(() => null);
  const extractionId =
    body && typeof body === "object" && typeof body.extractionId === "string" ? body.extractionId : "";
  if (!extractionId) {
    return NextResponse.json({ ok: false, error: "Choose an import to discard." }, { status: 400 });
  }

  const { data: row, error: lookupError } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,trip_id,match_status,source_reference,email_message_id,matched_booking_id,match_reasons,extracted_booking_json")
    .eq("id", extractionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (lookupError || !row) {
    return NextResponse.json({ ok: false, error: "That import could not be found." }, { status: 404 });
  }

  // Resolve the email's stable identity from every place it is
  // recorded: the row's source_reference, the extracted booking JSON,
  // or the linked travel_email_messages row (provider + provider
  // message id). Without one there is nothing durable to key the
  // tombstone to — the rejected transition below still ends the
  // presentation and keeps the dedupe target in place.
  const extractedJson = recordOf(row.extracted_booking_json);
  let sourceReference =
    text(row.source_reference) || text(extractedJson.sourceReference) || text(extractedJson.source_reference);
  if (!sourceReference && typeof row.email_message_id === "string" && row.email_message_id) {
    const { data: messageRow } = await auth.supabase
      .from("travel_email_messages")
      .select("provider,provider_message_id")
      .eq("user_id", auth.user.id)
      .eq("id", row.email_message_id)
      .maybeSingle();
    if (messageRow) {
      sourceReference = sourceReferenceForEmail(messageRow.provider, messageRow.provider_message_id) || "";
    }
  }

  const discardedAt = new Date().toISOString();
  const matchedBookingId = typeof row.matched_booking_id === "string" ? row.matched_booking_id : null;
  const tripId = typeof row.trip_id === "string" ? row.trip_id : null;

  // Step 1 — the tombstone (fail-soft by design: while the
  // owner-applied migration is outstanding the table may not exist,
  // and the discard itself must still work via step 2).
  let tombstoneRecorded = false;
  if (sourceReference) {
    const tombstone = await recordEmailImportTombstone(auth.supabase, {
      userId: auth.user.id,
      sourceReference,
      extractionId,
      matchedBookingId,
      tripId
    });
    tombstoneRecorded = tombstone.ok;
  }

  // Step 2 — transition the extraction row to "rejected" (NEVER
  // delete). Idempotent: discarding an already-discarded import is a
  // harmless success.
  if (String(row.match_status) !== "rejected") {
    const reasons = Array.isArray(row.match_reasons)
      ? row.match_reasons.filter((reason): reason is string => typeof reason === "string")
      : [];
    if (!reasons.includes(EMAIL_IMPORT_DISCARD_REASON)) reasons.push(EMAIL_IMPORT_DISCARD_REASON);
    const { error: updateError } = await auth.supabase
      .from("booking_extraction_results")
      .update({ match_status: "rejected", match_reasons: reasons })
      .eq("id", extractionId)
      .eq("user_id", auth.user.id);
    if (updateError) {
      return NextResponse.json({ ok: false, error: "We could not discard that import." }, { status: 500 });
    }
  }

  // Step 3 — propagate the one removal to any wallet booking this
  // import produced (by the extraction's matched id, and by the
  // shared source reference, which is how auto-apply links them).
  const bookingIds = new Set<string>();
  if (matchedBookingId) bookingIds.add(matchedBookingId);
  if (sourceReference) {
    const { data: linkedBookings } = await auth.supabase
      .from("roamly_bookings")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("source_reference", sourceReference);
    for (const linked of (linkedBookings || []) as Array<{ id?: unknown }>) {
      if (typeof linked.id === "string" && linked.id) bookingIds.add(linked.id);
    }
  }

  const discardedBookingIds: string[] = [];
  let walletMarkingFailed = false;
  for (const bookingId of bookingIds) {
    try {
      const { data: bookingRow } = await auth.supabase
        .from("roamly_bookings")
        .select("*")
        .eq("id", bookingId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!bookingRow) continue;
      const booking = bookingRow as Record<string, unknown>;
      const metadata = recordOf(booking.metadata);
      const alreadyMarked = Boolean(
        metadata.emailImportDiscarded && typeof metadata.emailImportDiscarded === "object"
      );
      if (!alreadyMarked) {
        const { error: markError } = await auth.supabase
          .from("roamly_bookings")
          .update({
            metadata: {
              ...metadata,
              reviewState: "dismissed",
              reviewDismissed: { dismissedAt: discardedAt, reason: "email_import_discarded" },
              emailImportDiscarded: {
                discardedAt,
                sourceReference: sourceReference || null,
                extractionId
              }
            }
          })
          .eq("id", bookingId)
          .eq("user_id", auth.user.id);
        if (markError) {
          walletMarkingFailed = true;
          continue;
        }
        booking.metadata = {
          ...metadata,
          emailImportDiscarded: {
            discardedAt,
            sourceReference: sourceReference || null,
            extractionId
          }
        };
      }
      discardedBookingIds.push(bookingId);
      const bookingTripId = typeof booking.trip_id === "string" ? booking.trip_id : tripId;
      if (!bookingTripId) continue;
      // Itinerary: re-stamp the stored override from the booking's
      // new truth ("discarded" neutralises any Confirmed stamp) —
      // but ONLY when a stored item for this booking already exists:
      // the override writer creates an item when none is found, and a
      // removal must never ADD itinerary presentation. (The trip
      // page's read-path reconcile neutralises linked items at
      // render either way.)
      const { data: itineraryRow } = await auth.supabase
        .from("roamly_itineraries")
        .select("full_json")
        .eq("trip_id", bookingTripId)
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const fullJson = recordOf(itineraryRow?.full_json);
      const days = Array.isArray(fullJson.daily_itinerary) ? fullJson.daily_itinerary : [];
      const hasLinkedItem = days.some((day) => {
        const timeline = recordOf(day).live_timeline;
        return (
          Array.isArray(timeline) &&
          timeline.some((item) => text(recordOf(item).booking_id) === bookingId)
        );
      });
      if (hasLinkedItem) {
        await applyStoredItineraryBookingOverride({
          supabase: auth.supabase,
          userId: auth.user.id,
          tripId: bookingTripId,
          booking
        }).catch(() => null);
      }
      // Reminders: cancel still-scheduled companion events, exactly
      // as the wallet cancel path does ('processing' rows untouched).
      await auth.supabase
        .from("roamly_trip_companion_events")
        .update({ status: "cancelled" })
        .eq("booking_id", bookingId)
        .eq("trip_id", bookingTripId)
        .eq("status", "scheduled");
      // Alerts: mark this booking's notifications withdrawn (never
      // deleted — audit history preserved).
      await markBookingNotificationsWithdrawn(auth.supabase, {
        userId: auth.user.id,
        tripId: bookingTripId,
        bookingId,
        reason: "email_import_discarded"
      }).catch(() => null);
    } catch {
      walletMarkingFailed = true;
    }
  }

  return NextResponse.json({
    ok: true,
    tombstoneRecorded,
    discardedBookingIds,
    ...(walletMarkingFailed ? { walletMarkingFailed: true } : {})
  });
}
