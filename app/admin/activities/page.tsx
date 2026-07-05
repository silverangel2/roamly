import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminActivitiesPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const { data } = await state.admin
    .from("roamly_activities")
    .select("id,trip_id,title,category,city,country,status,checked_in_at,completed_at,sort_order,created_at")
    .order("created_at", { ascending: false })
    .limit(150);

  return (
    <main className="safe-bottom">
      <Badge>Activities</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Activity tracking.</h1>
      <section className="mt-6 grid gap-3">
        {(data || []).map((activity) => (
          <Card key={activity.id} className="p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{activity.status}</p>
                <h2 className="mt-1 text-xl font-black text-ink">{activity.title}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{activity.category || "Activity"} · {activity.city || "No city"}</p>
              </div>
              <p className="rounded-full bg-mist px-3 py-2 text-xs font-black text-slate-500">Trip {activity.trip_id.slice(0, 8)}</p>
            </div>
          </Card>
        ))}
        {!data?.length ? <Card>No activities yet.</Card> : null}
      </section>
    </main>
  );
}
