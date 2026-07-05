import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function GET(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const tripId = searchParams.get("tripId");

  let query = guard.admin
    .from("roamly_activities")
    .select("id,trip_id,title,category,city,country,status,checked_in_at,completed_at,scheduled_start,sort_order,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (tripId) query = query.eq("trip_id", tripId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const counts = (data || []).reduce<Record<string, number>>((acc, activity) => {
    acc[activity.status] = (acc[activity.status] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, activities: data || [], counts });
}
