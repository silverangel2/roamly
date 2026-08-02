import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { LiveCompanionQaConsole } from "@/components/admin/LiveCompanionQaConsole";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminLiveCompanionTestPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const { data: trips } = await state.admin
    .from("roamly_trips")
    .select("id,title,destination,destination_name,destination_city,destination_country,start_date,end_date,metadata")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(30);

  const tripIds = (trips || []).map((trip) => trip.id);
  const [{ data: activities }, { data: bookings }] = await Promise.all([
    tripIds.length
      ? state.admin
          .from("roamly_trip_activities")
          .select("id,trip_id,title,description,day_number,time_label,location_name,map_query,status")
          .in("trip_id", tripIds)
          .order("day_number", { ascending: true })
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? state.admin
          .from("roamly_bookings")
          .select("id,trip_id,title,booking_type,provider_name,confirmation_number,address,start_date,start_time,end_date,end_time")
          .in("trip_id", tripIds)
          .order("start_date", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] })
  ]);

  return (
    <main className="safe-bottom">
      <Badge>Live Companion QA</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink">Live Companion mobile test lab.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Test date windows, simulated location, route failure, offline mode, notification cooldowns, suppression reasons,
        and phone-width previews without mutating a traveler&apos;s real trip.
      </p>

      {!trips?.length ? (
        <Card className="mt-6">
          No trips found. Create or seed a trip, then return to this QA screen.
        </Card>
      ) : (
        <section className="mt-6">
          <LiveCompanionQaConsole
            trips={trips || []}
            activities={(activities || []).map((activity, index) => ({
              ...activity,
              latitude: null,
              longitude: null,
              status: activity.status || "planned",
              id: activity.id || `${activity.trip_id}-${index}`
            }))}
            bookings={bookings || []}
          />
        </section>
      )}
    </main>
  );
}
