import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { createFieldTestCapability } from "@/lib/roamly/fieldTestAccess";
import { localDateInTimeZone } from "@/lib/roamly/liveCompanion";

const SAINT_JOHN_TIMEZONE = "America/Moncton";

const activities = [
  {
    title: "King's Square",
    address: "King's Square, Saint John, NB",
    latitude: 45.2720,
    longitude: -66.0587,
    sort_order: 101
  },
  {
    title: "Saint John City Market",
    address: "47 Charlotte St, Saint John, NB",
    latitude: 45.2735,
    longitude: -66.0604,
    sort_order: 102
  },
  {
    title: "AREA 506 Waterfront Container Village",
    address: "85 Water St, Saint John, NB",
    latitude: 45.2700,
    longitude: -66.0646,
    sort_order: 103
  }
];

export async function POST() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ROAMLY_ENABLE_DEMO_SEED !== "true"
  ) {
    return NextResponse.json(
      { ok: false, error: "Field-test seed is disabled in production." },
      { status: 403 }
    );
  }

  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const preparedAt = new Date();
  const now = preparedAt.toISOString();
  // The seed destination determines this test trip's local calendar date.
  const saintJohnDate = localDateInTimeZone(preparedAt, SAINT_JOHN_TIMEZONE);
  let capability;
  try {
    capability = createFieldTestCapability();
  } catch (error) {
    if (error instanceof Error && error.message === "ROAMLY_FIELD_TEST_SECRET_NOT_CONFIGURED") {
      return NextResponse.json(
        { ok: false, error: "Field-test preparation is unavailable: ROAMLY_FIELD_TEST_SECRET is not configured." },
        { status: 500 }
      );
    }
    throw error;
  }

  const previous = await guard.admin
    .from("roamly_trips")
    .select("id")
    .eq("user_id", guard.user.id)
    .contains("metadata", { admin_test: true, field_test: true })
    .neq("trip_companion_status", "completed");
  const previousIds = (previous.data || []).map((row) => row.id).filter(Boolean);
  if (previousIds.length) {
    await guard.admin
      .from("roamly_trips")
      .update({ status: "completed", trip_companion_status: "completed" })
      .in("id", previousIds);
  }

  const { data: trip, error: tripError } = await guard.admin
    .from("roamly_trips")
    .insert({
      user_id: guard.user.id,
      title: "Saint John Live Companion Field Test",
      destination_name: "Saint John",
      destination_country: "Canada",
      destination_region: "New Brunswick",
      destination_city: "Saint John",
      start_date: saintJohnDate,
      end_date: saintJohnDate,
      status: "locked",
      itinerary_status: "locked",
      itinerary_locked: true,
      itinerary_locked_at: now,
      itinerary_generated_at: now,
      tracking_unlocked: true,
      tracking_unlock_source: "admin",
      tracking_paid_at: now,
      live_companion_unlocked: true,
      live_companion_unlocked_at: now,
      live_companion_source: "admin",
      trip_companion_status: "scheduled",
      metadata: {
        admin_test: true,
        field_test: true,
        field_test_capability_hash: capability.capabilityHash,
        field_test_capability_expires_at: capability.expiresAt,
        real_location_required: true,
        timezone: SAINT_JOHN_TIMEZONE,
        planning: {
          destination: "Saint John",
          destinationCity: "Saint John",
          destinationCountry: "Canada",
          destinationRegion: "New Brunswick",
          timezone: SAINT_JOHN_TIMEZONE,
          daysCount: 1,
          budgetCurrency: "CAD"
        }
      }
    })
    .select("id")
    .single();

  if (tripError || !trip) {
    return NextResponse.json(
      { ok: false, error: tripError?.message || "Could not create field-test trip." },
      { status: 500 }
    );
  }

  const { data: day, error: dayError } = await guard.admin
    .from("roamly_trip_days")
    .insert({
      trip_id: trip.id,
      day_number: 1,
      title: "Saint John Live Companion Field Test",
      summary: "Three real Saint John stops for physical Live Companion testing."
    })
    .select("id")
    .single();

  if (dayError || !day) {
    return NextResponse.json(
      { ok: false, error: dayError?.message || "Could not create test day." },
      { status: 500 }
    );
  }

  // Real field-test schedule.
  // Production Live Companion still evaluates these timestamps using the
  // trip timezone. No simulated GPS or lifecycle clock is used by field mode.
  const base = new Date(preparedAt.getTime() + 5 * 60 * 1000);

  const rows = activities.map((activity, index) => {
    const start = new Date(base.getTime() + index * 45 * 60 * 1000);
    const end = new Date(start.getTime() + 40 * 60 * 1000);

    return {
      trip_id: trip.id,
      trip_day_id: day.id,
      title: activity.title,
      description: "Real-location Live Companion field-test stop.",
      category: "Field Test",
      address: activity.address,
      city: "Saint John",
      region: "New Brunswick",
      country: "Canada",
      latitude: activity.latitude,
      longitude: activity.longitude,
      radius_meters: 250,
      sort_order: activity.sort_order,
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      status: "planned",
      metadata: {
        admin_test: true,
        field_test: true,
        real_location_required: true
      }
    };
  });

  const { error: activityError } = await guard.admin
    .from("roamly_activities")
    .insert(rows);

  if (activityError) {
    return NextResponse.json(
      { ok: false, error: activityError.message },
      { status: 500 }
    );
  }

  const displayRows = rows.map((row) => ({
    trip_id: trip.id,
    day_number: 1,
    time_label: new Intl.DateTimeFormat("en-CA", { timeZone: SAINT_JOHN_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(row.scheduled_start)),
    title: row.title,
    description: row.description,
    location_name: row.address,
    category: row.category,
    map_query: row.address,
    status: "planned",
    metadata: row.metadata
  }));
  const { error: displayError } = await guard.admin.from("roamly_trip_activities").insert(displayRows);
  if (displayError) {
    return NextResponse.json({ ok: false, error: displayError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    mode: "real_field_test",
    timezone: SAINT_JOHN_TIMEZONE,
    simulatedLocation: false,
    mobileLink: `/field-test/${trip.id}?capability=${encodeURIComponent(capability.capability)}`,
    retiredFieldTestTrips: previousIds.length,
    activities: activities.map((a) => a.title)
  });
}
