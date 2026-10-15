import { redirect } from "next/navigation";
import { ItineraryShareForm } from "@/components/trip/ItineraryShareForm";
import {
  getCompletedTripsForSharing,
  getItinerarySubmissionForTrip,
  getTripBookedSegments
} from "@/lib/roamly/itineraryLibrary";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ trip?: string | string[] }>;
};

export default async function ShareItineraryPage({ searchParams }: PageProps) {
  const current = await getCurrentUser();
  if (!current.configured) {
    return (
      <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-black text-ink">Supabase setup required.</h1>
      </div>
    );
  }
  if (!current.user) redirect("/login?next=/trips/share");

  const resolvedParams = await searchParams;
  const requestedTrip = Array.isArray(resolvedParams.trip) ? resolvedParams.trip[0] : resolvedParams.trip;

  const supabase = await createSupabaseServerClient();
  const completed = supabase
    ? await getCompletedTripsForSharing({ supabase, userId: current.user.id })
    : { trips: [], error: "Supabase is unavailable." };

  const selectedTrip = requestedTrip
    ? completed.trips.find((trip) => trip.id === requestedTrip) || null
    : null;

  const segments = supabase && selectedTrip
    ? await getTripBookedSegments({ supabase, userId: current.user.id, tripId: selectedTrip.id })
    : { segments: [], error: null as string | null };

  const existing = supabase && selectedTrip
    ? await getItinerarySubmissionForTrip({ supabase, userId: current.user.id, tripId: selectedTrip.id })
    : { submission: null, error: null as string | null };

  return (
    <div className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Itinerary Library</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-ink">Share your proven itinerary</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Completed a trip worth repeating? Share it so future travelers get suggestions proven by real
          bookings — not scraped reviews. Rate the hotels, flights, and activities you actually booked;
          only items from your own booking wallet can be rated.
        </p>
      </div>
      {completed.error ? (
        <p className="rounded-2xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm font-bold text-coral">
          Could not load your trips: {completed.error}
        </p>
      ) : (
        <ItineraryShareForm
          trips={completed.trips}
          selectedTripId={selectedTrip?.id || null}
          bookedSegments={segments.error ? [] : segments.segments}
          segmentsError={segments.error}
          existingSubmission={existing.submission}
        />
      )}
    </div>
  );
}
