import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data: trips, error } = await guard.admin
    .from("roamly_trips")
    .select("id,user_id,title,destination_name,destination_city,destination_country,start_date,end_date,status,itinerary_status,itinerary_locked,itinerary_unlock_source,itinerary_payment_status,tracking_unlocked,itinerary_generated_at,itinerary_locked_at,tracking_paid_at,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const tripIds = (trips || []).map((trip) => trip.id);
  const [{ data: events }, { data: activities }, { data: bookings }, { data: companionEvents }] = await Promise.all([
    tripIds.length
      ? guard.admin
          .from("roamly_trip_events")
          .select("trip_id,event_type,event_title,created_at")
          .in("trip_id", tripIds)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? guard.admin.from("roamly_activities").select("trip_id,status").in("trip_id", tripIds)
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? guard.admin.from("roamly_bookings").select("trip_id").in("trip_id", tripIds)
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? guard.admin
          .from("roamly_trip_companion_events")
          .select("trip_id,status,scheduled_for")
          .in("trip_id", tripIds)
      : Promise.resolve({ data: [] })
  ]);

  return NextResponse.json({
    ok: true,
    trips: (trips || []).map((trip) => {
      const tripEvents = (events || []).filter((event) => event.trip_id === trip.id);
      const tripActivities = (activities || []).filter((activity) => activity.trip_id === trip.id);
      const tripBookings = (bookings || []).filter((booking) => booking.trip_id === trip.id);
      const tripCompanionEvents = (companionEvents || []).filter((event) => event.trip_id === trip.id);
      return {
        ...trip,
        checkedActivities: tripActivities.filter((activity) => activity.status === "checked_in").length,
        completedActivities: tripActivities.filter((activity) => activity.status === "completed").length,
        bookingCount: tripBookings.length,
        companionEventCount: tripCompanionEvents.length,
        nextReminder: tripCompanionEvents.find((event) => event.status === "scheduled") || null,
        latestEvent: tripEvents[0] || null
      };
    })
  });
}
