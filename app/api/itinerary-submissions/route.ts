import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { submitItinerarySubmission, type ItemVerdictInput } from "@/lib/roamly/itineraryLibrary";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function toVerdictInput(value: unknown): ItemVerdictInput {
  const row = record(value);
  const rating = typeof row.rating === "number" ? row.rating : null;
  return {
    segmentId: cleanString(row.segmentId, 80) || null,
    bookingId: cleanString(row.bookingId, 80) || null,
    itemType: cleanString(row.itemType, 20) || null,
    itemLabel: cleanString(row.itemLabel, 240) || null,
    location: cleanString(row.location, 160) || null,
    rating,
    verdict: cleanString(row.verdict, 20) || null,
    note: cleanString(row.note, 1000) || null
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = record(await request.json().catch(() => ({})));

  const result = await submitItinerarySubmission({
    supabase: auth.supabase,
    userId: auth.user.id,
    input: {
      tripId: cleanString(body.tripId, 80),
      title: cleanString(body.title, 160) || null,
      destination: cleanString(body.destination, 200) || null,
      startDate: cleanString(body.startDate, 10) || null,
      endDate: cleanString(body.endDate, 10) || null,
      highlights: cleanString(body.highlights, 4000) || null,
      consentAnonymizedReuse: body.consentAnonymizedReuse === true,
      itemVerdicts: Array.isArray(body.itemVerdicts) ? body.itemVerdicts.map(toVerdictInput) : []
    }
  });

  if (!result.ok) {
    const status = result.error === "TRIP_NOT_FOUND"
      ? 404
      : result.error === "ALREADY_SUBMITTED"
        ? 409
        : result.error === "ITINERARY_LIBRARY_TABLES_NOT_READY"
          ? 503
          : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // ── Itinerary Ingester (fail-soft; the share response never waits on it) ──
  // bookingProven is set ONLY by the share adapter — this is the one path
  // that can mark a plan pattern-eligible (the ingester's gate enforces it).
  try {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { adaptSharedSubmission, ingestItinerary } = await import("@/lib/roamly/itineraryIngester");
    const admin = createSupabaseAdminClient();
    if (admin) {
      const verdictRows = Array.isArray(body.itemVerdicts)
        ? body.itemVerdicts.map((value) => {
            const row = record(value);
            return {
              item_type: cleanString(row.itemType, 40) || null,
              rating: typeof row.rating === "number" ? row.rating : null,
              item_label: cleanString(row.itemLabel, 160) || null,
              location: cleanString(row.location, 160) || null,
              verdict: cleanString(row.verdict, 20) || null,
              note: cleanString(row.note, 1000) || null
            };
          })
        : [];
      await ingestItinerary(
        admin,
        adaptSharedSubmission({ submission: result.submission, trip: null, verdicts: verdictRows }),
        "shared"
      );
    }
  } catch {
    // The library feed is advisory — the share response stands.
  }

  return NextResponse.json({
    ok: true,
    submission: result.submission,
    verdictsWritten: result.verdictsWritten
  });
}
