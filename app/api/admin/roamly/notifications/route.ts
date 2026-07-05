import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("roamly_trip_events")
    .select("id,user_id,trip_id,activity_id,event_type,event_title,event_body,created_at,metadata")
    .in("event_type", [
      "trip_activated",
      "activity_nearby",
      "notification_shown",
      "location_permission_granted",
      "location_permission_denied"
    ])
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, notifications: data || [] });
}
