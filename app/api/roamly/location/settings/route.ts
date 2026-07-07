import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: settings, error } = await auth.supabase
    .from("roamly_location_settings")
    .select("*")
    .eq("user_id", auth.user.id)
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
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locationTrackingEnabled = Boolean(body.locationTrackingEnabled);
  const notificationEnabled = body.notificationEnabled == null ? true : Boolean(body.notificationEnabled);

  const { data: settings, error } = await auth.supabase
    .from("roamly_location_settings")
    .upsert(
      {
        user_id: auth.user.id,
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
