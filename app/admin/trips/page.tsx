import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminTripsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const [{ data }, { data: bookings }, { data: companionEvents }] = await Promise.all([
    state.admin
      .from("roamly_trips")
      .select("id,user_id,title,destination,destination_city,destination_country,status,itinerary_status,itinerary_locked,itinerary_unlock_source,itinerary_payment_status,tracking_unlocked,live_companion_unlocked,live_companion_source,itinerary_generated_at,itinerary_locked_at,tracking_paid_at,live_companion_unlocked_at,start_date,end_date,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    state.admin.from("roamly_bookings").select("trip_id"),
    state.admin.from("roamly_trip_companion_events").select("trip_id,status,scheduled_for")
  ]);

  const bookingsByTrip = new Map<string, number>();
  for (const booking of bookings || []) {
    bookingsByTrip.set(booking.trip_id, (bookingsByTrip.get(booking.trip_id) || 0) + 1);
  }
  const eventsByTrip = new Map<string, number>();
  const nextByTrip = new Map<string, string>();
  for (const event of companionEvents || []) {
    eventsByTrip.set(event.trip_id, (eventsByTrip.get(event.trip_id) || 0) + 1);
    if (event.scheduled_for && event.status === "scheduled" && !nextByTrip.get(event.trip_id)) {
      nextByTrip.set(event.trip_id, event.scheduled_for);
    }
  }

  return (
    <main className="safe-bottom">
      <Badge>Trips</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Trip operations.</h1>
      <div className="mt-6 grid gap-3">
        {(data || []).map((trip) => (
          <Card key={trip.id} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
                  {trip.itinerary_locked ? "Locked itinerary" : trip.itinerary_status || trip.status}
                </p>
                <h2 className="mt-1 text-xl font-black text-ink">{trip.title || trip.destination}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  {trip.destination_city || trip.destination} {trip.destination_country ? `· ${trip.destination_country}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  <span className="rounded-full bg-mist px-3 py-2">{trip.itinerary_payment_status || "unpaid"}</span>
                  <span className="rounded-full bg-mist px-3 py-2">{trip.itinerary_unlock_source || "no source"}</span>
                  <span className="rounded-full bg-mist px-3 py-2">
                    {trip.live_companion_unlocked || trip.tracking_unlocked ? "companion unlocked" : "companion locked"}
                  </span>
                  <span className="rounded-full bg-mist px-3 py-2">bookings {bookingsByTrip.get(trip.id) || 0}</span>
                  <span className="rounded-full bg-mist px-3 py-2">events {eventsByTrip.get(trip.id) || 0}</span>
                </div>
              </div>
              <div className="text-sm font-black text-slate-500">
                <p>{trip.itinerary_locked_at ? `Locked ${new Date(trip.itinerary_locked_at).toLocaleDateString()}` : "Not locked yet"}</p>
                <p>{nextByTrip.get(trip.id) ? `Next ${new Date(nextByTrip.get(trip.id)!).toLocaleDateString()}` : "No reminder"}</p>
              </div>
            </div>
          </Card>
        ))}
        {!data?.length ? <Card>No trips yet.</Card> : null}
      </div>
    </main>
  );
}
