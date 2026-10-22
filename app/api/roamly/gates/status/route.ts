import { NextRequest, NextResponse } from "next/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { resolveGateCaller } from "@/lib/roamly/gateRouteAuth";
import { emptyGateRecord, readGmailGateView } from "@/lib/roamly/gateService";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const runtime = "nodejs";

/**
 * GET /api/roamly/gates/status?deviceId=...&platform=...
 * The EntryGate component's bootstrap read: is the gate lane on, and
 * what is the server's current record for this (user, device)?
 */
export async function GET(request: NextRequest) {
  if (!build2GatesEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, gate: null });
  }
  const deviceId = (request.nextUrl.searchParams.get("deviceId") || "").trim();
  if (!deviceId || deviceId.length > 200) {
    return NextResponse.json({ ok: false, error: "DEVICE_ID_REQUIRED" }, { status: 400 });
  }
  const platformParam = request.nextUrl.searchParams.get("platform");
  const platform = platformParam === "ios" || platformParam === "android" ? platformParam : "other";

  const resolved = await resolveGateCaller(request);
  if (!resolved.ok) return resolved.response;
  const { caller } = resolved;

  const gmail = await readGmailGateView(caller.readClient, caller.userId);
  const existing = await caller.store.load(caller.userId, deviceId);
  const gate =
    existing ??
    emptyGateRecord({
      userId: caller.userId,
      deviceId,
      platform,
      gmail,
      now: new Date().toISOString() as UtcInstant
    });
  return NextResponse.json({ ok: true, enabled: true, gate });
}
