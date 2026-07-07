import { NextResponse } from "next/server";
import {
  getActiveOrUpcomingTrip,
  getCheckedActivities,
  getCurrentDayRecord,
  getUpNextActivity
} from "@/lib/roamly/tripActivation";
import { requireUser } from "@/lib/roamly/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const tripResult = await getActiveOrUpcomingTrip(auth.supabase, auth.user.id);
  if (!tripResult.trip) {
    return NextResponse.json({ ok: true, activeTrip: null, currentDay: null, nearbyActivities: [], checkedActivities: [] });
  }

  const [currentDay, checked, upNext, nearby] = await Promise.all([
    getCurrentDayRecord(auth.supabase, tripResult.trip),
    getCheckedActivities(auth.supabase, tripResult.trip.id),
    getUpNextActivity(auth.supabase, tripResult.trip.id),
    auth.supabase
      .from("roamly_activities")
      .select("*")
      .eq("trip_id", tripResult.trip.id)
      .eq("status", "nearby")
      .order("sort_order")
      .limit(8)
  ]);

  return NextResponse.json({
    ok: true,
    activeTrip: tripResult.trip,
    currentDay,
    nearbyActivities: nearby.data || [],
    checkedActivities: checked.activities,
    upNextActivity: upNext.activity
  });
}
