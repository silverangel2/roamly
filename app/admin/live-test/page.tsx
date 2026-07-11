import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminLiveTestConsole } from "@/components/admin/AdminLiveTestConsole";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminLiveTestPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const { data: trips } = await state.admin
    .from("roamly_trips")
    .select("id,user_id,title,destination_name,start_date,itinerary_status,tracking_unlocked,metadata")
    .order("created_at", { ascending: false })
    .limit(30);

  const tripIds = (trips || []).map((trip) => trip.id);
  const userIds = Array.from(new Set((trips || []).map((trip) => trip.user_id).filter(Boolean)));
  const [{ data: activities }, { data: bookings }, { data: pushSubscriptions }, { data: recentNotifications }] = await Promise.all([
    tripIds.length
      ? state.admin
          .from("roamly_activities")
          .select("id,trip_id,title,category,address,scheduled_start,latitude,longitude,status")
          .in("trip_id", tripIds)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? state.admin
          .from("roamly_bookings")
          .select("id,trip_id,title,booking_type,address,start_date,start_time,latitude,longitude")
          .in("trip_id", tripIds)
          .order("start_date", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    userIds.length
      ? state.admin
          .from("roamly_push_subscriptions")
          .select("id,user_id,enabled,user_agent,created_at,updated_at")
          .in("user_id", userIds)
          .order("updated_at", { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? state.admin
          .from("roamly_notifications")
          .select("id,user_id,trip_id,title,push_status,push_error,sent_at,created_at")
          .in("trip_id", tripIds)
          .order("created_at", { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [] })
  ]);

  return (
    <main className="safe-bottom">
      <Badge>Live test</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Live Trip Companion test mode.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Simulate reminders, location, nearby detection, push/in-app notifications, check-ins, skips, and up-next behavior
        without physically traveling.
      </p>

      {!trips?.length ? (
        <Card className="mt-6">
          No trips found yet. Create or seed a locked trip with Live Trip Companion enabled, then return here.
        </Card>
      ) : (
        <section className="mt-6">
          <AdminLiveTestConsole
            trips={trips || []}
            activities={activities || []}
            bookings={bookings || []}
            pushSubscriptions={pushSubscriptions || []}
            notifications={recentNotifications || []}
          />
        </section>
      )}
    </main>
  );
}
