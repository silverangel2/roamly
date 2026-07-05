import type { TrackingActivity, TrackingDay } from "@/lib/roamly/tripActivation";

function statusClass(status: string) {
  if (status === "completed" || status === "checked_in") return "bg-ocean/10 text-ocean";
  if (status === "nearby") return "bg-sun/20 text-amber-700";
  return "bg-mist text-slate-500";
}

export function CurrentDayTimeline({
  day,
  dayNumber,
  activities
}: {
  day: TrackingDay | null;
  dayNumber: number;
  activities: TrackingActivity[];
}) {
  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Current day</p>
      <h2 className="mt-2 text-2xl font-black text-ink">{day?.title || `Day ${dayNumber}`}</h2>
      {day?.summary ? <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{day.summary}</p> : null}
      <div className="mt-4 grid gap-3">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="rounded-2xl bg-mist p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-ink">{activity.title}</h3>
                  <p className="mt-1 text-sm font-bold leading-5 text-slate-500">{activity.description}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(activity.status)}`}>
                  {activity.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            No timeline activities are saved for this day yet.
          </p>
        )}
      </div>
    </section>
  );
}
