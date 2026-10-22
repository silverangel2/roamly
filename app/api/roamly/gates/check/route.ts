import { NextRequest, NextResponse } from "next/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { resolveGateCaller } from "@/lib/roamly/gateRouteAuth";
import {
  evaluateGateEvidence,
  readGmailGateView,
  type GateEvidence
} from "@/lib/roamly/gateService";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const runtime = "nodejs";

/**
 * POST /api/roamly/gates/check
 * The attestation write. The client posts PLATFORM EVIDENCE (the
 * display-mode reading + Notification.permission as read + its push
 * endpoint); the server verifies the push subscription itself,
 * computes the authoritative record (M1), persists it, and returns
 * it. A self-report ("I've installed it") is not an accepted input —
 * there is no field for it.
 */
export async function POST(request: NextRequest) {
  if (!build2GatesEnabled()) {
    return NextResponse.json({ ok: false, error: "GATES_DISABLED" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    deviceId?: unknown;
    platform?: unknown;
    evidence?: {
      standaloneDetected?: unknown;
      notificationPermission?: unknown;
      pushEndpoint?: unknown;
    };
  };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceId || deviceId.length > 200) {
    return NextResponse.json({ ok: false, error: "DEVICE_ID_REQUIRED" }, { status: 400 });
  }
  const platform = body.platform === "ios" || body.platform === "android" ? body.platform : "other";
  const permissionRaw = body.evidence?.notificationPermission;
  const evidence: GateEvidence = {
    standaloneDetected: body.evidence?.standaloneDetected === true,
    notificationPermission:
      permissionRaw === "granted" || permissionRaw === "denied" ? permissionRaw : "default",
    pushEndpoint: typeof body.evidence?.pushEndpoint === "string" ? body.evidence.pushEndpoint : null
  };

  const resolved = await resolveGateCaller(request);
  if (!resolved.ok) return resolved.response;
  const { caller } = resolved;

  try {
    const gmail = await readGmailGateView(caller.readClient, caller.userId);
    const gate = await evaluateGateEvidence(caller.store, {
      userId: caller.userId,
      deviceId,
      platform,
      evidence,
      gmail,
      now: new Date().toISOString() as UtcInstant
    });
    return NextResponse.json({ ok: true, enabled: true, gate });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "GATE_CHECK_FAILED", message: error instanceof Error ? error.message : "Gate check failed." },
      { status: 500 }
    );
  }
}
