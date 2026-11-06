import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getLiveStatusReadback } from "@/lib/roamly/liveStatus";

/*
 * GET /api/roamly/live-status?tripId=<id> — the read-back endpoint
 * for lib/roamly/liveStatus.ts, the one server source for the
 * notification-subscription fact and the selected trip's Live
 * Companion activation fact. Surfaces consume THIS instead of
 * inferring either fact from install state, pushManager state, or a
 * button tap. Read-only; never writes.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const tripId = request.nextUrl.searchParams.get("tripId") || undefined;
  const status = await getLiveStatusReadback(auth.supabase, auth.user.id, { tripId });
  return NextResponse.json(
    { ok: true, status },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
