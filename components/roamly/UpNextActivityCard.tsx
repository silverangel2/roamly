import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function UpNextActivityCard({ activity }: { activity: TrackingActivity | null }) {
  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-sun">Up next nearby</p>
      {activity ? (
        <>
          <h2 className="mt-2 text-2xl font-black text-ink">{activity.title}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{activity.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activity.scheduled_start ? (
              <span className="rounded-full bg-mist px-3 py-2 text-xs font-black text-slate-600">
                {new Date(activity.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : null}
            {activity.distance_meters != null ? (
              <span className="rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
                {activity.distance_meters}m away
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm font-bold leading-6 text-slate-500">No next activity is ready yet.</p>
      )}
    </section>
  );
}
