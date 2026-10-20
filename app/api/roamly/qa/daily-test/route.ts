import { NextRequest, NextResponse } from "next/server";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { requireUser } from "@/lib/roamly/auth";
import { sendScheduledTripNotifications } from "@/lib/roamly/pushServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

// Test-only seam for the automation-owned daily end-to-end test. It lets
// the daily runner drive the companion dispatcher on demand against the
// QA test account's OWN trips, so the email-consolidation proof takes
// minutes instead of waiting on cron ticks and +10-minute reschedules.
// Gated three ways: the ROAMLY_DAILY_TEST_ENABLED flag (default off), a
// signed-in session whose email has QA access, and — for every trip-scoped
// action — trip ownership by the caller.

function dailyTestEnabled() {
  return /^(true|1|enabled)$/i.test((process.env.ROAMLY_DAILY_TEST_ENABLED || "").trim());
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  if (!dailyTestEnabled()) {
    return NextResponse.json({ ok: false, error: "DAILY_TEST_DISABLED" }, { status: 404 });
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const access = getRoamlyAccessForUser(auth.user.email);
  if (!access.hasQaAccess) {
    return NextResponse.json({ ok: false, error: "QA_ACCESS_REQUIRED" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = getString(body.action);

  if (action === "dispatch") {
    // The exact function the production cron runs — nothing test-only
    // about the dispatch itself.
    const result = await sendScheduledTripNotifications();
    return NextResponse.json({ ok: true, action, result });
  }

  if (action !== "rewind" && action !== "inspect") {
    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  }

  const tripId = getString(body.tripId);
  if (!tripId) {
    return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_NOT_CONFIGURED" }, { status: 503 });
  }

  const { data: trip, error: tripError } = await admin
    .from("roamly_trips")
    .select(
      "id,user_id,title,status,itinerary_status,itinerary_unlock_source,tracking_unlocked,tracking_unlock_source,live_companion_unlocked,live_companion_source,metadata"
    )
    .eq("id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (tripError) {
    return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  if (action === "rewind") {
    // Rewind ONLY the caller's own test trip's still-scheduled events to
    // now, so the next dispatch run processes them immediately instead of
    // waiting out the dispatcher's +10-minute reschedule.
    const { count, error } = await admin
      .from("roamly_trip_companion_events")
      .update({ scheduled_for: new Date().toISOString() }, { count: "exact" })
      .eq("trip_id", tripId)
      .eq("user_id", auth.user.id)
      .eq("status", "scheduled");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action, tripId, rewound: count ?? 0 });
  }

  // action === "inspect": everything the daily runner asserts on, scoped
  // to the caller's own trip and the caller's own email log rows.
  const since = getString(body.since);
  const [eventsResult, tripLogsResult, itineraryResult, entitlementResult, userLogsResult] = await Promise.all([
    admin
      .from("roamly_trip_companion_events")
      .select("id,event_type,booking_id,status,scheduled_for,metadata,created_at")
      .eq("trip_id", tripId)
      .order("scheduled_for", { ascending: true }),
    admin
      .from("roamly_email_logs")
      .select("id,to_email,provider,status,metadata,created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true }),
    admin
      .from("roamly_itineraries")
      .select("id,full_json")
      .eq("trip_id", tripId)
      .not("full_json", "is", null)
      .limit(1),
    admin.from("roamly_user_entitlements").select("free_itinerary_used_at").eq("user_id", auth.user.id).maybeSingle(),
    since
      ? admin
          .from("roamly_email_logs")
          .select("id,to_email,trip_id,provider,status,metadata,created_at")
          .eq("user_id", auth.user.id)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null })
  ]);

  const failed = [eventsResult, tripLogsResult, itineraryResult, entitlementResult, userLogsResult].find(
    (result) => result.error
  );
  if (failed?.error) {
    return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });
  }

  const itineraryRow = (itineraryResult.data || [])[0] || null;

  return NextResponse.json({
    ok: true,
    action,
    tripId,
    trip,
    events: eventsResult.data || [],
    emailLogs: tripLogsResult.data || [],
    userEmailLogs: userLogsResult.data || [],
    itineraryStored: Boolean(itineraryRow),
    // The full generated itinerary, only when the runner asks for it, so
    // each daily run can archive a complete, gradeable artifact.
    itinerary: body.includeItinerary === true ? (itineraryRow?.full_json ?? null) : undefined,
    freeItineraryUsedAt: entitlementResult.data?.free_itinerary_used_at ?? null
  });
}
