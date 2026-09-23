import { NextRequest, NextResponse } from "next/server";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";

export async function GET() {
  const auth = await requireUserOrFieldTest();
  if (!auth.ok) return auth.response;

  const { data: settings, error } = await auth.supabase
    .from("roamly_location_settings")
    .select("location_tracking_enabled,notification_enabled,last_permission_state")
    .eq("user_id", auth.userId)
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
  const auth = await requireUserOrFieldTest();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locationTrackingEnabled = Boolean(body.locationTrackingEnabled);
  const notificationEnabled = body.notificationEnabled == null ? true : Boolean(body.notificationEnabled);
  const update: Record<string, unknown> = {
    user_id: auth.userId,
    location_tracking_enabled: locationTrackingEnabled,
    notification_enabled: notificationEnabled
  };
  if (!locationTrackingEnabled) {
    update.last_seen_latitude = null;
    update.last_seen_longitude = null;
    update.last_seen_at = null;
  }

  const { data: settings, error } = await auth.supabase
    .from("roamly_location_settings")
    .upsert(update, { onConflict: "user_id" })
    .select("location_tracking_enabled,notification_enabled,last_permission_state")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settings });
}
