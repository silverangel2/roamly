import { NextRequest, NextResponse } from "next/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseHandoffStore,
  handoffConfigured,
  mintHandoffPass
} from "@/lib/roamly/handoffTokens";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const runtime = "nodejs";

/**
 * POST /api/roamly/handoff/mint { tripId }
 * Mints the desktop→phone pass (M6) for a trip the caller owns. The
 * response carries the one-time URL for the QR code; only the token's
 * hash is ever stored.
 */
export async function POST(request: NextRequest) {
  if (!build2GatesEnabled()) {
    return NextResponse.json({ ok: false, error: "GATES_DISABLED" }, { status: 404 });
  }
  if (!handoffConfigured()) {
    return NextResponse.json({ ok: false, error: "HANDOFF_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { tripId?: unknown };
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "TRIP_ID_REQUIRED" }, { status: 400 });

  const { data: trip } = await auth.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "HANDOFF_NOT_CONFIGURED" }, { status: 503 });

  try {
    const minted = await mintHandoffPass(createSupabaseHandoffStore(admin), {
      userId: auth.user.id,
      tripId,
      origin: request.nextUrl.origin,
      now: new Date().toISOString() as UtcInstant
    });
    return NextResponse.json({ ok: true, url: minted.url, expiresAt: minted.record.expiresAt });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "HANDOFF_MINT_FAILED", message: error instanceof Error ? error.message : "Could not create a handoff code." },
      { status: 500 }
    );
  }
}
