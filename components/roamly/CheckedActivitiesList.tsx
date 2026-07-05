import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function CheckedActivitiesList({ activities }: { activities: TrackingActivity[] }) {
  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Checked activities</p>
      <div className="mt-4 grid gap-3">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="rounded-2xl bg-mist px-4 py-3">
              <p className="text-sm font-black text-ink">{activity.title}</p>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                {activity.status.replace("_", " ")}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            No activities checked yet.
          </p>
        )}
      </div>
    </section>
  );
}
