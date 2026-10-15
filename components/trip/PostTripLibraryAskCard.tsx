import { getItinerarySubmissionForTrip, isTripCompletedForLibrary } from "@/lib/roamly/itineraryLibrary";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Post-trip ask moment on completed trips. Carries BOTH asks:
 *  (a) rate your booked items → the existing post-trip feedback form
 *  (b) share your proven itinerary → the Itinerary Library intake
 *
 * Each ask hides once done. Fail-soft: any error renders nothing so the trip
 * page never breaks because of this card.
 */
export async function PostTripLibraryAskCard({ tripId }: { tripId: string }) {
  try {
    const current = await getCurrentUser();
    if (!current.configured || !current.user) return null;
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;

    const trip = await supabase
      .from("roamly_trips")
      .select("id,status,end_date")
      .eq("id", tripId)
      .eq("user_id", current.user.id)
      .maybeSingle();
    if (trip.error || !trip.data) return null;
    const tripRow = trip.data as Record<string, unknown>;
    if (!isTripCompletedForLibrary({ status: tripRow.status, endDate: tripRow.end_date as string | null })) return null;

    const [feedbackResult, submissionResult] = await Promise.all([
      supabase
        .from("trip_feedback")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", current.user.id)
        .eq("feedback_type", "post_trip")
        .limit(1),
      getItinerarySubmissionForTrip({ supabase, userId: current.user.id, tripId })
    ]);
    if (feedbackResult.error) return null;

    const needsRating = !feedbackResult.data?.length;
    const needsSharing = !submissionResult.submission;
    if (!needsRating && !needsSharing) return null;

    return (
      <section aria-label="Share your trip experience" className="roamly-enter mt-4 rounded-3xl border border-ocean/25 bg-white/90 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.06)] sm:px-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Trip completed</p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-ink">How was it, really?</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Your experience is booking-proof — it helps Roamly suggest proven options to future travelers.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {needsRating ? (
            <a
              href={`/trip/${tripId}/feedback`}
              className="rounded-2xl border border-ocean/25 bg-ocean/5 px-5 py-4 transition hover:bg-ocean/10"
            >
              <p className="text-sm font-black text-ink">Rate your booked items</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                Tell Roamly what worked and what didn&apos;t — it tunes your future trips.
              </p>
              <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ocean px-4 text-sm font-bold text-white">
                Leave feedback
              </span>
            </a>
          ) : null}
          {needsSharing ? (
            <a
              href={`/trips/share?trip=${tripId}`}
              className="rounded-2xl border border-ocean/25 bg-ocean/5 px-5 py-4 transition hover:bg-ocean/10"
            >
              <p className="text-sm font-black text-ink">Share your proven itinerary</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                Publish this trip to the Itinerary Library so future travelers learn from real bookings.
              </p>
              <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ocean px-4 text-sm font-bold text-white">
                Share itinerary
              </span>
            </a>
          ) : null}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}
