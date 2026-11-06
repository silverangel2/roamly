import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import type { TripBookingInput } from "@/lib/roamly/bookingWallet";
import { evaluateExtractionCredibility } from "@/lib/roamly/extractionCredibility";
import { loadSuppressedSourceReferences } from "@/lib/roamly/bookingEmailTombstone";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Lists email-extracted bookings that still need the traveler's review:
 * extractions that could not be matched to a trip ("unmatched"), plus ones
 * matched to this trip but held back for confirmation ("needs_confirmation").
 *
 * G13: also lists quarantined messages — travel_email_messages rows
 * with processing_result "error", which the sync loop writes when a
 * single message fails processing instead of stalling the cursor on
 * it. They carry no booking (the message could not be read), so they
 * are returned separately as `quarantined`, never merged into
 * `imports` and never silently dropped. A later successful reprocess
 * (reconnect backfill) overwrites the row and it leaves this list.
 *
 * Workstream B: every candidate row is re-evaluated at READ time
 * against the current evidence bar (lib/roamly/extractionCredibility).
 * Rows persisted under the old admission rules (GitHub mail at
 * 91-97%, promo mail at 100%, the QA test stay) fail that bar no
 * matter how high their stored parse confidence is. Credible rows are
 * returned as `imports`, exactly as before. Non-credible rows are NOT
 * deleted and NOT silently dropped: they are returned separately as
 * `keptAside` with per-row `credibilityReasons`, so their display
 * history stays visible without presenting them as booking
 * suggestions. The sender/subject evidence for the re-evaluation is
 * joined from the linked travel_email_messages row (extraction rows
 * store no sender/subject of their own); that join fails soft — a row
 * whose message evidence cannot be loaded is evaluated on its stored
 * extraction fields alone, and missing confirmation evidence already
 * makes a row non-credible.
 *
 * Tombstone (2026-10-31): rows whose source_reference the traveler
 * discarded (booking_email_suppressions) are the ONE exception to
 * the keptAside rule — the traveler explicitly removed them, so they
 * are returned in NEITHER list, only counted in `discardedCount`.
 * (Discarded rows are normally already match_status "rejected" and
 * never reach this query; this covers rows re-created by a sync that
 * raced or predated the tombstone gate.) The tombstone load fails
 * soft exactly like the joins above.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const { data, error } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,trip_id,email_message_id,source_reference,match_status,overall_confidence,match_reasons,extracted_booking_json,field_confidence_json,created_at")
    .eq("user_id", auth.user.id)
    .in("match_status", ["unmatched", "needs_confirmation"])
    .or(`trip_id.eq.${id},trip_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "We could not load email imports right now." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  // Quarantined messages fail soft: if this query fails, the imports
  // above still render and the list is empty rather than erroring.
  const { data: quarantinedRows } = await auth.supabase
    .from("travel_email_messages")
    .select("id,provider_message_id,subject,filter_reasons,created_at")
    .eq("user_id", auth.user.id)
    .eq("provider", "gmail")
    .eq("processing_result", "error")
    .order("created_at", { ascending: false })
    .limit(20);
  const quarantined = ((quarantinedRows || []) as Array<{
    id: unknown;
    provider_message_id: unknown;
    subject: unknown;
    filter_reasons: unknown;
    created_at: unknown;
  }>).map((row) => ({
    id: String(row.id),
    providerMessageId: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
    subject: text(row.subject),
    reasons: Array.isArray(row.filter_reasons)
      ? row.filter_reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    createdAt: typeof row.created_at === "string" ? row.created_at : null
  }));

  type ExtractionRow = {
    id: unknown;
    trip_id: unknown;
    email_message_id: unknown;
    source_reference: unknown;
    overall_confidence: unknown;
    match_reasons: unknown;
    extracted_booking_json: unknown;
    field_confidence_json: unknown;
  };
  const extractionRows = (data || []) as ExtractionRow[];

  // Linked-message evidence for the credibility re-evaluation. Fails
  // soft like the quarantined query above: on error the map stays
  // empty and rows are judged on their stored extraction fields.
  const messageIds = [
    ...new Set(
      extractionRows
        .map((row) => (typeof row.email_message_id === "string" ? row.email_message_id : ""))
        .filter(Boolean)
    )
  ];
  const messageById = new Map<
    string,
    { sender: string | null; subject: string | null; extractedFacts: Record<string, unknown> | null }
  >();
  if (messageIds.length) {
    const { data: messageRows } = await auth.supabase
      .from("travel_email_messages")
      .select("id,sender,subject,extracted_booking_facts")
      .eq("user_id", auth.user.id)
      .in("id", messageIds);
    for (const messageRow of (messageRows || []) as Array<{
      id: unknown;
      sender: unknown;
      subject: unknown;
      extracted_booking_facts: unknown;
    }>) {
      if (typeof messageRow.id !== "string") continue;
      messageById.set(messageRow.id, {
        sender: text(messageRow.sender),
        subject: text(messageRow.subject),
        extractedFacts:
          messageRow.extracted_booking_facts &&
          typeof messageRow.extracted_booking_facts === "object" &&
          !Array.isArray(messageRow.extracted_booking_facts)
            ? (messageRow.extracted_booking_facts as Record<string, unknown>)
            : null
      });
    }
  }

  // Tombstone set for these candidates (fail-soft: empty when the
  // table is absent or the read fails).
  const candidateReferences = extractionRows.flatMap((row) => {
    const bookingJson = (row.extracted_booking_json || {}) as Partial<TripBookingInput>;
    return [
      typeof row.source_reference === "string" ? row.source_reference : "",
      typeof bookingJson.sourceReference === "string" ? bookingJson.sourceReference : ""
    ].filter(Boolean);
  });
  const suppressedReferences = await loadSuppressedSourceReferences(
    auth.supabase,
    auth.user.id,
    candidateReferences
  );

  const evaluated = extractionRows.map((row) => {
    const booking = ((row.extracted_booking_json || {}) as Partial<TripBookingInput>) || {};
    const item = {
      id: String(row.id),
      tripId: typeof row.trip_id === "string" ? row.trip_id : null,
      bookingType: text(booking.bookingType),
      title: text(booking.title),
      provider: text(booking.provider),
      confirmationCode: text(booking.confirmationCode),
      flightNumber: text(booking.flightNumber),
      startTime: text(booking.startTime) || text(booking.checkInTime),
      endTime: text(booking.endTime) || text(booking.checkOutTime),
      origin: text(booking.origin),
      destination: text(booking.destination),
      overallConfidence: typeof row.overall_confidence === "number" ? row.overall_confidence : null,
      matchReasons: Array.isArray(row.match_reasons)
        ? row.match_reasons.filter((reason): reason is string => typeof reason === "string")
        : []
    };
    const linked =
      typeof row.email_message_id === "string" ? messageById.get(row.email_message_id) : undefined;
    const verdict = evaluateExtractionCredibility({
      extracted_booking_json: (row.extracted_booking_json || {}) as Record<string, unknown>,
      field_confidence_json:
        row.field_confidence_json && typeof row.field_confidence_json === "object"
          ? (row.field_confidence_json as Record<string, { value?: unknown }>)
          : null,
      source_reference: typeof row.source_reference === "string" ? row.source_reference : null,
      suppressedSourceReferences: suppressedReferences,
      message: linked
        ? {
            sender: linked.sender,
            subject: linked.subject,
            extracted_booking_facts: linked.extractedFacts
          }
        : null
    });
    return { item, verdict };
  });

  const discarded = evaluated.filter((entry) => entry.verdict.reasons.includes("traveler_discarded"));
  const imports = evaluated
    .filter((entry) => entry.verdict.credible && !entry.verdict.reasons.includes("traveler_discarded"))
    .map((entry) => entry.item);
  const keptAside = evaluated
    .filter((entry) => !entry.verdict.credible && !entry.verdict.reasons.includes("traveler_discarded"))
    .map((entry) => ({ ...entry.item, credibilityReasons: entry.verdict.reasons }));

  return NextResponse.json(
    { ok: true, imports, keptAside, quarantined, discardedCount: discarded.length },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
