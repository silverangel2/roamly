import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: notifications, error } = await auth.supabase
    .from("roamly_notifications")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(80);

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
