import type { TripNotificationPayload } from "@/lib/roamly/tripActivation";

export function TripActivationBanner({
  notification,
  dayNumber
}: {
  notification?: TripNotificationPayload | null;
  dayNumber?: number | null;
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_56%,#fff7ed_100%)] p-5 text-ink shadow-soft sm:p-6">
      <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-cyan-300/30 blur-3xl" />
      <div className="relative">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Roamly notification</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
          {notification?.title || "Live Trip Companion ready"}
        </h1>
        <p className="mt-3 text-lg font-black text-orange-600">Day {dayNumber || 1}</p>
        <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-slate-600">
          {notification?.body ||
            "You are near your first planned area. Roamly has prepared today’s activities from your locked itinerary."}
        </p>
      </div>
    </section>
  );
}
