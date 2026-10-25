import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { searchOlderGmail } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

/**
 * Traveler-triggered search for OLD mail (last 90 days) that the normal
 * sync windows miss. Same session pattern as the manual sync route:
 * the caller's own connection only, never another traveler's mail, never
 * a cron for everyone. Never writes the sync cursor or last_synced_at.
 */
export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const result = await searchOlderGmail({ supabase: auth.supabase, userId: auth.user.id });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "We could not search your older mail right now. Your saved trips are safe."
      },
      { status: 400 }
    );
  }
}
