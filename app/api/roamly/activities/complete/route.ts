import { NextRequest, NextResponse } from "next/server";
import { performActivityAction } from "@/lib/roamly/activityActions";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const tripId = typeof body.tripId === "string" ? body.tripId : "";

  if (!activityId || !tripId) {
    return NextResponse.json({ ok: false, error: "Activity and trip are required." }, { status: 400 });
  }

  const result = await performActivityAction(auth.supabase, {
    userId: auth.user.id,
    userEmail: auth.user.email,
    tripId,
    activityId,
    action: "complete",
    source: "user_mark_done"
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, activity: result.activity, upNextActivity: result.upNextActivity });
}
