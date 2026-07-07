import { NextRequest, NextResponse } from "next/server";
import { performActivityAction, type RoamlyActivityAction } from "@/lib/roamly/activityActions";
import { requireUser } from "@/lib/roamly/auth";

const actionByStatus: Record<string, RoamlyActivityAction | null> = {
  active: "check_in",
  nearby: "check_in",
  checked_in: "check_in",
  completed: "complete",
  skipped: "skip",
  planned: null
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!activityId || !(status in actionByStatus)) {
    return NextResponse.json({ ok: false, error: "Activity and status are required." }, { status: 400 });
  }

  const action = actionByStatus[status];
  if (!action) {
    return NextResponse.json({ ok: false, error: "Live Trip Companion can only check in, skip, or mark done." }, { status: 400 });
  }

  const result = await performActivityAction(auth.supabase, {
    userId: auth.user.id,
    tripId: id,
    activityId,
    action,
    source: "legacy_activity_status_route"
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, activity: result.activity, upNextActivity: result.upNextActivity });
}
