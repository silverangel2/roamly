import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Badge scope: when the shell passes the active trip id, the badge
  // counts that trip's rows only — the same trip the Alerts list shows
  // when an active trip exists. Without tripId the route keeps its old
  // all-trips behavior (see AppShellClient for why that fallback stays).
  const tripId = request.nextUrl.searchParams.get("tripId")?.trim() || "";
  let query = auth.supabase
    .from("roamly_notifications")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(80);
  if (tripId) query = query.eq("trip_id", tripId);

  const { data: notifications, error } = await query;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, notifications: notifications || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
  if (!notificationId) return NextResponse.json({ ok: false, error: "Notification is required." }, { status: 400 });

  const { error } = await auth.supabase
    .from("roamly_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
