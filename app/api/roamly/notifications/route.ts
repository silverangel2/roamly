import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const { data: notifications, error } = await supabase
    .from("roamly_notifications")
    .select("*")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, notifications: notifications || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
  if (!notificationId) return NextResponse.json({ ok: false, error: "Notification is required." }, { status: 400 });

  const { error } = await supabase
    .from("roamly_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", data.user.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
