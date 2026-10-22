import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { build2UpdaterEnabled } from "@/lib/roamly/build2Flags";
import {
  SupabaseUpdaterStore,
  processClassifiedSignal,
  processDelayEvent
} from "@/lib/roamly/updater";
import type { DelayEventInput, SignalTrust } from "@/lib/roamly/updater";
import type { ClassifiedBookingSignal } from "@/lib/roamly/reconciliationLane";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function lockedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "ITINERARY_LOCKED",
      message: "Live Trip Companion can record progress, but it cannot rebuild a locked itinerary."
    },
    { status: 410 }
  );
}

function asTrust(value: unknown): SignalTrust {
  return value === "OFFICIAL" || value === "INFERRED" ? value : "REPORTED";
}

/**
 * Phase 9 — the Build 2 live-day adjustment endpoint. Behind
 * ROAMLY_BUILD2_UPDATER_ENABLED it supersedes the 410 stub for
 * companion-unlocked trips: it accepts a Phase 8 classified signal
 * or a delay event (companion monitor / Native Flight Watch) and
 * runs the transactional Updater. With the flag off — and for locked
 * trips — the legacy 410 posture stands byte-for-byte.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!build2UpdaterEnabled()) return lockedResponse();

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }
  const at = new Date().toISOString();
  const store = new SupabaseUpdaterStore(auth.supabase, auth.user.id);

  try {
    if (body.kind === "delay") {
      const event = body.event as DelayEventInput | undefined;
      if (!event || typeof body.dayId !== "string" || typeof body.proposalId !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_DELAY_EVENT" }, { status: 400 });
      }
      const result = await processDelayEvent({
        store,
        tripId: id,
        dayId: body.dayId,
        event,
        trust: asTrust(body.trust),
        at,
        proposalId: body.proposalId
      });
      const status = result.outcome === "failed" ? 409 : 200;
      return NextResponse.json({ ok: result.outcome !== "failed", ...result }, { status });
    }
    if (body.kind === "signal") {
      const classified = body.classified as ClassifiedBookingSignal | undefined;
      if (!classified || typeof body.proposalId !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_SIGNAL" }, { status: 400 });
      }
      const result = await processClassifiedSignal({
        store,
        tripId: id,
        classified,
        trust: asTrust(body.trust),
        at,
        proposalId: body.proposalId
      });
      const status = result.outcome === "failed" ? 409 : 200;
      return NextResponse.json({ ok: result.outcome !== "failed", ...result }, { status });
    }
    return NextResponse.json({ ok: false, error: "UNKNOWN_KIND" }, { status: 400 });
  } catch (error) {
    // The Supabase store's parked-proposal seam requires the
    // companion event + impact anchors (companion_repair_proposals
    // FKs); the error names itself rather than failing opaquely.
    const message = error instanceof Error ? error.message : "UPDATER_FAILED";
    const status = message.startsWith("PARKED_PROPOSAL_REQUIRES_EVENT_ANCHORS") ? 501 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
