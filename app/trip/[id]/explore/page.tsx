import { redirect } from "next/navigation";
import { ExploreDiscovery } from "@/components/roamly/ExploreDiscovery";
import { TripContextNav } from "@/components/roamly/TripContextNav";
import { BackHeader } from "@/components/roamly/BackHeader";
import { getLocalizedItinerary, getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { TranslateItineraryButton } from "@/components/trip/TranslateItineraryButton";
import { buildExploreCandidates } from "@/lib/roamly/exploreViewModel";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { formatRoamlyDate, translateExactText } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

export default async function TripExplorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(`/trip/${id}/explore`)}`);
  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const trip = bundle.data.trip;
  const locale = await getServerLocale();
  const destination = getTripDestinationLabel(trip) || translateExactText(locale, "Your trip");
  const dates = trip.start_date && trip.end_date
    ? `${formatRoamlyDate(trip.start_date, locale, { month: "short", day: "numeric" })} - ${formatRoamlyDate(trip.end_date, locale, { month: "short", day: "numeric" })}`
    : translateExactText(locale, "Dates flexible");
  const localizedResult = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale })
    : null;
  const localized = localizedResult?.itinerary ?? null;
  // Auto-translate wiring (2026-11-12, audit §2): same button as the
  // trip page, same displayed-language derivation.
  const displayedItineraryLanguage = localizedResult?.language || getTripItineraryLanguage(trip.metadata);
  const tripTitle = localized?.trip_title || trip.title || destination;

  return (
    <>
      <div className="bui-enter mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 sm:pt-8">
        <div className="mb-3">
          <BackHeader href={`/trip/${id}`} label={translateExactText(locale, "Trip")} />
        </div>
        <TripContextNav tripId={id} title={tripTitle} destination={destination} dates={dates} status={translateExactText(locale, "Explore")} />
        {/* Auto-translate (2026-11-12): same button as the trip page —
            renders nothing when the stored translation already matches
            the picked language, auto-fires once otherwise. */}
        <div className="mb-4">
          <TranslateItineraryButton tripId={id} displayedLanguage={displayedItineraryLanguage} />
        </div>
      </div>
      <ExploreDiscovery
        tripId={id}
        destination={destination}
        candidates={buildExploreCandidates(localized)}
      />
    </>
  );
}
