import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

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

  const today = new Date().toISOString().slice(0, 10);

  const { data: trip, error: tripError } = await guard.admin
    .from("roamly_trips")
    .insert({
      user_id: guard.user.id,
      title: "Saint John Live Companion Field Test",
      destination_name: "Saint John",
      destination_country: "Canada",
      destination_region: "New Brunswick",
      destination_city: "Saint John",
      start_date: today,
      end_date: today,
      status: "locked",
      itinerary_status: "locked",
      itinerary_locked: true,
      itinerary_locked_at: new Date().toISOString(),
      itinerary_generated_at: new Date().toISOString(),
      tracking_unlocked: true,
      tracking_unlock_source: "admin",
      metadata: {
        admin_test: true,
        field_test: true,
        real_location_required: true,
        timezone: "America/Moncton",
        planning: {
          destination: "Saint John",
          destinationCity: "Saint John",
          destinationCountry: "Canada",
          destinationRegion: "New Brunswick",
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
  const base = new Date();
  base.setMinutes(base.getMinutes() + 10, 0, 0);

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

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    mode: "real_field_test",
    timezone: "America/Moncton",
    simulatedLocation: false,
    activities: activities.map((a) => a.title)
  });
}
