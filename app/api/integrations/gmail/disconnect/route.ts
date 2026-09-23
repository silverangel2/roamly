import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { disconnectEmailConnection } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const result = await disconnectEmailConnection({
    supabase: auth.supabase,
    userId: auth.user.id,
    provider: "gmail"
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: "Gmail could not be disconnected from Roamly. Please try again." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({
    ok: true,
    pushStopped: result.pushStopped,
    revocationConfirmed: result.revocationConfirmed
  }, { headers: { "Cache-Control": "private, no-store" } });
}
