import { redirect } from "next/navigation";
import { ExploreDiscovery } from "@/components/roamly/ExploreDiscovery";
import { TripContextNav } from "@/components/roamly/TripContextNav";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
import { buildExploreCandidates } from "@/lib/roamly/exploreViewModel";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { formatRoamlyDate } from "@/lib/i18n";
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
  const destination = getTripDestinationLabel(trip) || "Your trip";
  const dates = trip.start_date && trip.end_date
    ? `${formatRoamlyDate(trip.start_date, locale, { month: "short", day: "numeric" })} - ${formatRoamlyDate(trip.end_date, locale, { month: "short", day: "numeric" })}`
    : "Dates flexible";
  const localized = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const tripTitle = localized?.trip_title || trip.title || destination;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 sm:pt-8">
        <TripContextNav tripId={id} title={tripTitle} destination={destination} dates={dates} status="Explore" />
      </div>
      <ExploreDiscovery
        tripId={id}
        tripTitle={tripTitle}
        destination={destination}
        dates={dates}
        candidates={buildExploreCandidates(localized)}
      />
    </>
  );
}
