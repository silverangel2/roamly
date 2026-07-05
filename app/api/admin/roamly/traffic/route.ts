import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function topCounts<T extends Record<string, unknown>>(rows: T[], key: keyof T, limit = 8) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    const label = typeof value === "string" && value ? value : "Unknown";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const since = todayStart();
  const [pageViews, visitors, tripActivations, checkIns, nearby, notifications, appRows, tripEvents] =
    await Promise.all([
      guard.admin
        .from("roamly_app_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "page_view")
        .gte("created_at", since),
      guard.admin
        .from("roamly_app_events")
        .select("visitor_key")
        .eq("event_type", "page_view")
        .gte("created_at", since)
        .limit(5000),
      guard.admin
        .from("roamly_trip_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "trip_activated")
        .gte("created_at", since),
      guard.admin
        .from("roamly_trip_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "activity_checked_in")
        .gte("created_at", since),
      guard.admin
        .from("roamly_trip_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "activity_nearby")
        .gte("created_at", since),
      guard.admin
        .from("roamly_trip_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "notification_shown")
        .gte("created_at", since),
      guard.admin
        .from("roamly_app_events")
        .select("path,device_type,browser,platform,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      guard.admin
        .from("roamly_trip_events")
        .select("event_type,event_title,event_body,created_at,trip_id,activity_id")
        .order("created_at", { ascending: false })
        .limit(25)
    ]);

  const uniqueVisitors = new Set((visitors.data || []).map((row) => row.visitor_key).filter(Boolean)).size;
  const appData = appRows.data || [];

  return NextResponse.json({
    ok: true,
    cards: {
      pageViewsToday: pageViews.count || 0,
      uniqueVisitorsToday: uniqueVisitors,
      tripActivationsToday: tripActivations.count || 0,
      checkInsToday: checkIns.count || 0,
      nearbyDetectionsToday: nearby.count || 0,
      notificationsShownToday: notifications.count || 0
    },
    topPages: topCounts(appData, "path"),
    devices: topCounts(appData, "device_type"),
    browsers: topCounts(appData, "browser"),
    platforms: topCounts(appData, "platform"),
    recentTripEvents: tripEvents.data || []
  });
}
