import { NextResponse } from "next/server";
import {
  getActiveOrUpcomingTrip,
  getCheckedActivities,
  getCurrentDayRecord,
  getUpNextActivity
} from "@/lib/roamly/tripActivation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const tripResult = await getActiveOrUpcomingTrip(supabase, data.user.id);
  if (!tripResult.trip) {
    return NextResponse.json({ ok: true, activeTrip: null, currentDay: null, nearbyActivities: [], checkedActivities: [] });
  }

  const [currentDay, checked, upNext, nearby] = await Promise.all([
    getCurrentDayRecord(supabase, tripResult.trip),
    getCheckedActivities(supabase, tripResult.trip.id),
    getUpNextActivity(supabase, tripResult.trip.id),
    supabase
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
