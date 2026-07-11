import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

export function ActiveTripPanel({ trip }: { trip: TrackingTrip | null }) {
  if (!trip) {
    return (
      <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">No active trip</p>
        <h2 className="mt-2 text-2xl font-black text-ink">Nothing is live yet.</h2>
        <p className="mt-2 text-sm font-bold text-slate-500">Unlock Live Trip Companion first, then Roamly can guide the day.</p>
      </div>
    );
  }
  const destination = getTripDestinationLabel(trip) || "Destination ready";

  return (
    <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Live Trip Companion</p>
      <h2 className="mt-2 text-2xl font-black text-ink">{trip.title || destination}</h2>
      <p className="mt-2 text-sm font-bold text-slate-500">
        {trip.destination_city || destination} · {trip.status}
      </p>
    </div>
  );
}
