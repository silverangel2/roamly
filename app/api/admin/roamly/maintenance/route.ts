import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { readMaintenanceMode, setMaintenanceMode } from "@/lib/roamly/maintenanceMode";

export const runtime = "nodejs";

/*
 * Owner-side switch for site maintenance mode. GET reports the stored flag;
 * POST { enabled: boolean } flips it. The flag is a row in
 * roamly_admin_settings, so flipping needs no redeploy; the middleware gate
 * picks the change up within its ~10s cache. Admin routes themselves are
 * never gated, so this switch stays reachable while maintenance is on.
 */

export async function GET() {
  const gate = await requireRoamlyAdmin();
  if (!gate.ok) return gate.response;
  const state = await readMaintenanceMode();
  return NextResponse.json({ ok: true, maintenance: state });
}

export async function POST(request: NextRequest) {
  const gate = await requireRoamlyAdmin();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "ENABLED_BOOLEAN_REQUIRED" }, { status: 400 });
  }

  try {
    const state = await setMaintenanceMode(body.enabled);
    return NextResponse.json({ ok: true, maintenance: state });
  } catch (error) {
    console.error("[Roamly maintenance] flag update failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ ok: false, error: "MAINTENANCE_UPDATE_FAILED" }, { status: 500 });
  }
}
