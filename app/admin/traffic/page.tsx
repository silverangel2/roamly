import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function topCounts(rows: Array<Record<string, unknown>>, key: string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = typeof row[key] === "string" && row[key] ? String(row[key]) : "Unknown";
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

export default async function AdminTrafficPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const since = todayStart();
  const [pageViews, appRows, tripEvents] = await Promise.all([
    state.admin
      .from("roamly_app_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "page_view")
      .gte("created_at", since),
    state.admin
      .from("roamly_app_events")
      .select("visitor_key,path,device_type,browser,platform")
      .gte("created_at", since)
      .limit(500),
    state.admin
      .from("roamly_trip_events")
      .select("event_type,event_title,event_body,created_at")
      .order("created_at", { ascending: false })
      .limit(30)
  ]);

  const appData = (appRows.data || []) as Array<Record<string, unknown>>;
  const uniqueVisitors = new Set(appData.map((row) => row.visitor_key).filter(Boolean)).size;

  return (
    <main className="safe-bottom">
      <Badge>Traffic</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Traffic and trip events.</h1>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <AdminStatCard label="Page views today" value={pageViews.count || 0} />
        <AdminStatCard label="Unique visitors today" value={uniqueVisitors} />
        <AdminStatCard
          label="Live Companion starts"
          value={(tripEvents.data || []).filter((event) => event.event_type === "trip_activated").length}
        />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Top pages</p>
          <div className="mt-4 grid gap-2">
            {topCounts(appData, "path").map(([label, count]) => (
              <p key={label} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                {label} · {count}
              </p>
            ))}
            {!appData.length ? <p className="text-sm font-bold text-slate-500">No page views yet.</p> : null}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Device/browser</p>
          <div className="mt-4 grid gap-2">
            {[...topCounts(appData, "device_type"), ...topCounts(appData, "browser")].slice(0, 10).map(([label, count]) => (
              <p key={label} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                {label} · {count}
              </p>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Recent trip events</p>
          <div className="mt-4 grid gap-2">
            {(tripEvents.data || []).map((event) => (
              <div key={`${event.created_at}-${event.event_type}`} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{event.event_title || event.event_type}</p>
                <p className="text-xs font-bold text-slate-500">{event.event_body}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
