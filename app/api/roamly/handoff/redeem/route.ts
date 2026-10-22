import { NextRequest, NextResponse } from "next/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  HANDOFF_COOKIE_MAX_AGE_SECONDS,
  HANDOFF_COOKIE_NAME,
  HANDOFF_UNAVAILABLE_ERROR,
  HANDOFF_UNAVAILABLE_MESSAGE,
  createHandoffSessionCookieValue,
  createSupabaseHandoffStore,
  handoffConfigured,
  redeemHandoffPass
} from "@/lib/roamly/handoffTokens";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const runtime = "nodejs";

/**
 * POST /api/roamly/handoff/redeem { token, deviceId }
 * Unauthenticated by design — the pass IS the proof. On success the
 * token burns (atomically, in the store) and the response binds the
 * phone session to the account + trip with a signed httpOnly cookie.
 * EVERY failure — used, expired, invalid, tampered — returns the same
 * plain fresh-code state; the internal reason never reaches the
 * traveler.
 */
export async function POST(request: NextRequest) {
  const unavailable = () =>
    NextResponse.json(
      { ok: false, error: HANDOFF_UNAVAILABLE_ERROR, message: HANDOFF_UNAVAILABLE_MESSAGE },
      { status: 410 }
    );

  if (!build2GatesEnabled() || !handoffConfigured()) return unavailable();
  const admin = createSupabaseAdminClient();
  if (!admin) return unavailable();

  const body = (await request.json().catch(() => ({}))) as { token?: unknown; deviceId?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!token || !deviceId || deviceId.length > 200) return unavailable();

  const now = new Date().toISOString() as UtcInstant;
  const result = await redeemHandoffPass(createSupabaseHandoffStore(admin), { token, now }).catch(() => null);
  if (!result || !result.ok) return unavailable();

  const cookieValue = createHandoffSessionCookieValue(
    { userId: result.userId, tripId: result.tripId, deviceId },
    { now }
  );
  if (!cookieValue) return unavailable();

  const response = NextResponse.json({ ok: true, tripId: result.tripId });
  response.cookies.set(HANDOFF_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: HANDOFF_COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
