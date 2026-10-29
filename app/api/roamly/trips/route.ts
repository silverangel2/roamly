import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

/**
 * Minimal trip list for the app shell (conditional-acceptance round,
 * item 2): the shell resolves the SAME selected trip as the Alerts
 * page (selectNotificationTrip) so the tab-bar badge counts that
 * trip's unread alerts — never an all-trips fallback. Only the fields
 * the selection rule and the badge lifecycle gate need, plus the
 * destination columns (timezone round: the rule-path outdated gate
 * resolves the trip's zone through the destination registry); same
 * query shape (user, start_date desc, 40) as the Alerts page itself.
 * NOTE: the 40-row cap still bounds this LIST — the badge for a
 * viewed trip no longer depends on it (see /api/roamly/badge, a
 * direct trip lookup keyed by trip id).
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("roamly_trips")
    .select("id,status,itinerary_status,start_date,end_date,tracking_unlocked,live_companion_unlocked,metadata,destination,destination_name,destination_city")
    .eq("user_id", auth.user.id)
    .order("start_date", { ascending: false })
    .limit(40);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, trips: data || [] });
}
