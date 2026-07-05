import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const { data: settings, error } = await supabase
    .from("roamly_location_settings")
    .select("*")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    settings: settings || {
      location_tracking_enabled: false,
      notification_enabled: true,
      last_permission_state: null
    }
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locationTrackingEnabled = Boolean(body.locationTrackingEnabled);
  const notificationEnabled = body.notificationEnabled == null ? true : Boolean(body.notificationEnabled);

  const { data: settings, error } = await supabase
    .from("roamly_location_settings")
    .upsert(
      {
        user_id: data.user.id,
        location_tracking_enabled: locationTrackingEnabled,
        notification_enabled: notificationEnabled
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settings });
}
