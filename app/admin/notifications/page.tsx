import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminNotificationsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const { data } = await state.admin
    .from("roamly_trip_events")
    .select("id,event_type,event_title,event_body,created_at,trip_id,user_id")
    .in("event_type", [
      "trip_activated",
      "activity_nearby",
      "notification_shown",
      "location_permission_granted",
      "location_permission_denied"
    ])
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="safe-bottom">
      <Badge>Notifications</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Trip notifications.</h1>
      <div className="mt-6 grid gap-3">
        {(data || []).map((event) => (
          <Card key={event.id} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{event.event_type}</p>
            <h2 className="mt-1 text-xl font-black text-ink">{event.event_title || "Notification event"}</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">{event.event_body}</p>
          </Card>
        ))}
        {!data?.length ? <Card>No notification events yet.</Card> : null}
      </div>
    </main>
  );
}
