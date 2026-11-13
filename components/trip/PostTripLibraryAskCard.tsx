import { getItinerarySubmissionForTrip, isTripCompletedForLibrary } from "@/lib/roamly/itineraryLibrary";
import { translateExactText } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { BuiCard } from "@/components/boardui/Card";

/**
 * Post-trip ask moment on completed trips. Carries BOTH asks:
 *  (a) rate your booked items → the existing post-trip feedback form
 *  (b) share your proven itinerary → the Itinerary Library intake
 *
 * Each ask hides once done. Fail-soft: any error renders nothing so the trip
 * page never breaks because of this card.
 */
export async function PostTripLibraryAskCard({ tripId }: { tripId: string }) {
  const locale = await getServerLocale();
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
      <BuiCard role="region" aria-label={translateExactText(locale, "Share your trip experience")} className="bui-enter mt-4 px-5 py-6 sm:px-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">{translateExactText(locale, "Trip completed")}</p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{translateExactText(locale, "How was it, really?")}</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-cgray">
          {translateExactText(locale, "Your experience is booking-proof \u2014 it helps Roamly suggest proven options to future travelers.")}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {needsRating ? (
            <a
              href={`/trip/${tripId}/feedback`}
              className="bui-press bui-tap bui-squircle block rounded-bui-card border border-chair bg-csoft px-5 py-4 shadow-bui-card transition hover:bg-mist focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
            >
              <p className="text-sm font-black text-ink">{translateExactText(locale, "Rate your booked items")}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-cgray">
                {translateExactText(locale, "Tell Roamly what worked and what didn\u2019t \u2014 it tunes your future trips.")}
              </p>
              <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-cblue px-4 text-sm font-bold text-white">
                {translateExactText(locale, "Leave feedback")}
              </span>
            </a>
          ) : null}
          {needsSharing ? (
            <a
              href={`/trips/share?trip=${tripId}`}
              className="bui-press bui-tap bui-squircle block rounded-bui-card border border-chair bg-csoft px-5 py-4 shadow-bui-card transition hover:bg-mist focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
            >
              <p className="text-sm font-black text-ink">{translateExactText(locale, "Share your proven itinerary")}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-cgray">
                {translateExactText(locale, "Publish this trip to the Itinerary Library so future travelers learn from real bookings.")}
              </p>
              <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-cblue px-4 text-sm font-bold text-white">
                {translateExactText(locale, "Share itinerary")}
              </span>
            </a>
          ) : null}
        </div>
      </BuiCard>
    );
  } catch {
    return null;
  }
}
