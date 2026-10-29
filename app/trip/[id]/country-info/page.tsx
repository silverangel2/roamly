import { redirect } from "next/navigation";
import { CountryInfoPanel } from "@/components/roamly/CountryInfoPanel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { buildCountryInfoPanelModel } from "@/lib/roamly/countryInfoPanel";
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";
import { getTripDestinationLabel, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import { getTripBundle } from "@/lib/trips";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/*
 * Country Info page (Picture 2 overhaul, 2026-10-26; Round 2, B2
 * base) — the tabbed page for the owner-approved composite panel:
 * Overview / Entry & Travel / Transport / Safety, photo + weather
 * block, Key information grid, travel-notes checklist,
 * "See full itinerary" button — rebuilt to the owner's picture
 * literally, with every block the picture does not show removed
 * from this screen (see components/roamly/CountryInfoPanel.tsx).
 *
 * Per-trip isolation: the trip is loaded with getTripBundle(user, id)
 * — the same per-user gate as the live page — so this page can only
 * ever show the signed-in traveler's own trip. The model is built
 * from that trip's record alone; nothing from any other trip is read.
 * The photo comes from the existing destination-photo pipeline
 * (Wikimedia/Wikidata, cached, coordinate-gated); a missing photo
 * renders the bare header, never a generated or broken image.
 */

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function TripCountryInfoPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const requestedTab = Array.isArray(search.tab) ? search.tab[0] : search.tab;

  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/country-info`)}`);
  }

  if (!current.configured || !current.user) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup</Badge>
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.018em] text-chead">
            Connect Supabase to use Country Info.
          </h1>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const trip = bundle.data.trip;
  const destinationLabel = getTripDestinationLabel(trip) || "your trip";
  const planning = getTripPlanningMetadata(trip.metadata);
  const destinationPhoto = await getDestinationPhoto({
    label: destinationLabel,
    country: cleanString(planning.destinationCountry) || trip.destination_country || null,
    latitude: cleanNumber(planning.destinationLatitude),
    longitude: cleanNumber(planning.destinationLongitude)
  }).catch(() => null);

  const model = buildCountryInfoPanelModel(trip, destinationPhoto);

  return (
    <div className="calm-bleed mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
      <section className="rounded-2xl bg-white p-4 shadow-calm sm:p-5">
        <CountryInfoPanel model={model} initialTab={requestedTab} />
      </section>
    </div>
  );
}
