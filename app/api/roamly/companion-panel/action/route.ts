import { NextRequest, NextResponse } from "next/server";
import { build2CompanionEnabled } from "@/lib/roamly/build2Flags";
import {
  SupabaseCompanionLedgerStore,
  appendCompanionLedgerAction,
  appendCompanionLedgerUndo,
  panelActionProvenance,
  type LedgerAppendResult
} from "@/lib/roamly/companionLedger";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";

export const runtime = "nodejs";

/*
 * Build 2 Live Companion — panel action route (Phase 7).
 *
 * The panel's ledger-native actions: directions-viewed (a map was
 * opened — non-terminal by owner law), undo (an append-only
 * annulment marker), and missed (companion-recorded circumstance).
 * Check-in and Skip do NOT come through here: they ride the existing
 * /api/roamly/activities routes, whose performActivityAction appends
 * the same ledger rows (one write path per action).
 *
 * occurredAt carries the action's TRUE time — offline taps flush
 * late and the ledger records when the traveler acted, never when
 * the flush landed. Future timestamps are clamped to now.
 */

type PanelActionKind = "directions-viewed" | "undo" | "missed";

function isPanelActionKind(value: unknown): value is PanelActionKind {
  return value === "directions-viewed" || value === "undo" || value === "missed";
}

export async function POST(request: NextRequest) {
  if (!build2CompanionEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const kind = body.kind;
  if (!tripId || !activityId || !isPanelActionKind(kind)) {
    return NextResponse.json(
      { ok: false, error: "Trip, activity, and a panel action kind are required." },
      { status: 400 }
    );
  }

  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;

  const now = new Date();
  let occurredAt = now.toISOString();
  if (typeof body.occurredAt === "string") {
    const parsed = Date.parse(body.occurredAt);
    if (Number.isFinite(parsed) && parsed <= now.getTime() + 60_000) {
      occurredAt = new Date(parsed).toISOString();
    }
  }

  const tripResult = await auth.supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", tripId)
    .maybeSingle();
  const timezone = timezoneFromTripMetadata(tripResult.data?.metadata, "UTC");

  const store = new SupabaseCompanionLedgerStore(auth.supabase);
  let result: LedgerAppendResult;
  if (kind === "undo") {
    result = await appendCompanionLedgerUndo(store, {
      tripId,
      activityRef: activityId,
      at: occurredAt,
      timezone,
      provenance: panelActionProvenance(occurredAt)
    });
  } else if (kind === "missed") {
    result = await appendCompanionLedgerAction(store, {
      tripId,
      activityRef: activityId,
      classification: "MISSED",
      at: occurredAt,
      timezone,
      provenance: {
        source: "companion",
        sourceRef: typeof body.circumstance === "string" ? body.circumstance : null,
        recordedAt: occurredAt,
        label: "live companion"
      }
    });
  } else {
    result = await appendCompanionLedgerAction(store, {
      tripId,
      activityRef: activityId,
      classification: "DIRECTIONS_VIEWED",
      at: occurredAt,
      timezone,
      provenance: panelActionProvenance(occurredAt)
    });
  }

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "The panel action could not be recorded." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, entry: result.entry, inserted: result.inserted });
}
