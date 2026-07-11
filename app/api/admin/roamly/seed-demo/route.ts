import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

const torontoTestActivities = [
  {
    day: 1,
    title: "CN Tower",
    description: "Start with Toronto's most recognizable view.",
    category: "Sightseeing",
    address: "290 Bremner Blvd",
    latitude: 43.6426,
    longitude: -79.3871,
    sort_order: 101
  },
  {
    day: 1,
    title: "Ripley's Aquarium",
    description: "A nearby indoor stop that pairs well with the CN Tower area.",
    category: "Attraction",
    address: "288 Bremner Blvd",
    latitude: 43.6424,
    longitude: -79.3860,
    sort_order: 102
  },
  {
    day: 1,
    title: "Harbourfront",
    description: "Easy waterfront walk and food break.",
    category: "Walk",
    address: "235 Queens Quay W",
    latitude: 43.6387,
    longitude: -79.3822,
    sort_order: 103
  },
  {
    day: 2,
    title: "Royal Ontario Museum",
    description: "Museum anchor stop with flexible timing.",
    category: "Museum",
    address: "100 Queens Park",
    latitude: 43.6677,
    longitude: -79.3948,
    sort_order: 201
  },
  {
    day: 2,
    title: "Kensington Market",
    description: "Food, cafes, vintage shops, and a strong local feel.",
    category: "Neighborhood",
    address: "Kensington Market",
    latitude: 43.6545,
    longitude: -79.4015,
    sort_order: 202
  }
];

export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ROAMLY_ENABLE_DEMO_SEED !== "true") {
    return NextResponse.json({ ok: false, error: "Demo seed is disabled in production." }, { status: 403 });
  }

  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data: trip, error: tripError } = await guard.admin
    .from("roamly_trips")
    .insert({
      user_id: guard.user.id,
      title: "Toronto Test Trip",
      destination_name: "Toronto",
      destination_country: "Canada",
      destination_region: "Ontario",
      destination_city: "Toronto",
      start_date: new Date().toISOString().slice(0, 10),
      status: "locked",
      itinerary_status: "locked",
      itinerary_locked: true,
      itinerary_locked_at: new Date().toISOString(),
      itinerary_generated_at: new Date().toISOString(),
      tracking_unlocked: true,
      tracking_unlock_source: "admin",
      metadata: {
        admin_test: true,
        planning: {
          destination: "Toronto",
          destinationCity: "Toronto",
          destinationCountry: "Canada",
          destinationRegion: "Ontario",
          daysCount: 2,
          budgetCurrency: "CAD"
        }
      }
    })
    .select("id")
    .single();

  if (tripError) return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });

  const { data: days, error: daysError } = await guard.admin
    .from("roamly_trip_days")
    .insert([
      {
        trip_id: trip.id,
        day_number: 1,
        title: "Downtown icons",
        summary: "CN Tower, Aquarium, and Harbourfront."
      },
      {
        trip_id: trip.id,
        day_number: 2,
        title: "Museum and market day",
        summary: "ROM first, then Kensington Market."
      }
    ])
    .select("id,day_number");

  if (daysError) return NextResponse.json({ ok: false, error: daysError.message }, { status: 500 });

  const dayIdByNumber = new Map((days || []).map((day) => [day.day_number, day.id]));

  const activityResult = await guard.admin.from("roamly_activities").insert(
    torontoTestActivities.map((activity) => ({
      trip_id: trip.id,
      trip_day_id: dayIdByNumber.get(activity.day) || null,
      title: activity.title,
      description: activity.description,
      category: activity.category,
      address: activity.address,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      latitude: activity.latitude,
      longitude: activity.longitude,
      radius_meters: 350,
      sort_order: activity.sort_order,
      status: "planned",
      metadata: { admin_test: true }
    }))
  );

  if (activityResult.error) {
    return NextResponse.json({ ok: false, error: activityResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tripId: trip.id });
}
