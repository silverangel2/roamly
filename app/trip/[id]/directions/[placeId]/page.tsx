import { redirect } from "next/navigation";
import { DirectionsScreen } from "@/components/trip/DirectionsScreen";
import {
  fallbackPlaceId,
  itemCoordinates,
  resolvePlaceInItinerary,
  stripPlaceTitleEcho
} from "@/lib/roamly/placeDetail";
import type { DirectionsRouteEvidence } from "@/lib/roamly/directionsPanel";
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";
import { getTripDestinationLabel, getTripOriginLabel } from "@/lib/roamly/tripMetadata";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

/*
 * Directions — the Picture 7 STANDALONE screen (owner mock
 * correct-4-pages-part2.jpg, 3rd panel: "Getting to your next stop").
 * Route: /trip/[id]/directions/[placeId] — created by this picture;
 * no dedicated directions route existed before (Picture 4's named
 * gap). Entry points:
 *  - Live companion: the Live page's Directions button opens the
 *    embedded directions panel, whose "Open full directions screen"
 *    link lands here for that next stop (?from=live).
 *  - Place detail: that screen's Directions action links here for
 *    its place (?from=place); the external-maps link it used to
 *    carry is one tap away on this screen (Open in Maps).
 * The back chevron returns to the entry page (?from=place → the
 * place page, anything else → the live page).
 *
 * The stop shown is ALWAYS one live_timeline item of THIS trip's
 * own itinerary, resolved by item_id (or the deterministic fallback
 * id d<day>-<index>) inside this trip's bundle only — never another
 * trip's data. An unknown id renders a not-found state, never a
 * guessed place. Route evidence is read ONLY from this stop's own
 * route_evidence field, and only when its from/to item ids match
 * this exact leg (previous same-day item → this stop); anything
 * else is ignored, so one leg's route can never leak into another.
 * The photo strip is the existing destination-photo pipeline only,
 * and only when the stop carries coordinates (the pipeline's own
 * honesty gate cannot protect a bare-label lookup); the pipeline
 * returns at most one photo, so the strip holds one photo when one
 * exists and renders nothing at all when it returns none — never a
 * broken image, never a mock photo, never the mock's two-photo
 * strip as if real. No embedded map, no step-by-step source, and no
 * terrain/sidewalk source exist in this codebase (see
 * lib/roamly/directionsPanel.ts); those slots render the panel's
 * honest unavailable states, and the live Distance Matrix source
 * (duration only, no streets or turns) is not wired here because
 * this screen carries no live-companion location state — the panel
 * requests a fresh browser position through its own retry control.
 */

type DirectionsPageProps = {
  params: Promise<{ id: string; placeId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanFrom(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return null;
}

function numberFrom(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function notFoundPanel(tripId: string, heading: string, body: string) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5 sm:px-6">
      <a href={`/trip/${tripId}`} className="text-[15px] font-medium text-cblue">
        <span aria-hidden="true">‹ </span>Itinerary
      </a>
      <h1 className="mt-4 text-[26px] font-bold leading-[1.15] tracking-[-0.018em] text-chead">{heading}</h1>
      <p className="mt-3 text-[16.5px] font-normal leading-[1.5] text-cink">{body}</p>
    </div>
  );
}

export default async function TripDirectionsPage({ params, searchParams }: DirectionsPageProps) {
  const { id, placeId } = await params;
  const search = searchParams ? await searchParams : {};
  const from = typeof search.from === "string" ? search.from : null;
  const directionsPath = `/trip/${id}/directions/${placeId}`;
  const backHref = from === "place" ? `/trip/${id}/place/${placeId}` : `/trip/${id}/live`;

  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(directionsPath)}`);
  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const trip = bundle.data.trip;
  const itinerary = bundle.data.itinerary?.full_json ?? null;
  const destinationLabel = getTripDestinationLabel(trip) || trip.destination || "Your trip";
  const originLabel = getTripOriginLabel(trip) || null;

  if (!itinerary) {
    return notFoundPanel(
      id,
      "No plan to show yet.",
      "This trip has no itinerary saved, so there are no directions to open. Generate or save the itinerary first, then come back."
    );
  }

  const resolved = resolvePlaceInItinerary(itinerary, placeId);
  if (!resolved) {
    return notFoundPanel(
      id,
      "This stop is not in this trip's plan.",
      "The link may be for a different trip, or the stop may have been removed. Your itinerary holds everything still planned for this trip."
    );
  }

  const { day, item, index } = resolved;
  const title = cleanFrom(item as unknown as Record<string, unknown>, "title", "name") || "This stop";
  // Acceptance-review round (2026-10-28), DISPLAY ONLY: the same
  // unverified rule as placeDetail (bare 2–4-char acronym title with
  // no real description once the title echo is stripped). Before
  // this fix the standalone directions screen rendered the raw
  // title ("WIP") as a normal destination — the one directions view
  // that dropped the "Unverified stop" context every other surface
  // carries. The stored item is untouched; only the shown title
  // changes, and maps still route to the item's real coordinates.
  const rawDescription = cleanFrom(item as unknown as Record<string, unknown>, "description", "summary", "details", "notes");
  const unverified = /^[A-Z0-9]{2,4}$/.test(title) && stripPlaceTitleEcho(title, rawDescription) == null;
  const placeLabel = cleanFrom(item as unknown as Record<string, unknown>, "location_name", "location", "place_name");
  const coords = itemCoordinates(item as unknown as Record<string, unknown>);

  const selfId =
    cleanFrom(item as unknown as Record<string, unknown>, "item_id") || fallbackPlaceId(day.day_number, index);
  const previousItem = index > 0 ? (day.live_timeline || [])[index - 1] : null;
  const originItemId = previousItem
    ? cleanFrom(previousItem as unknown as Record<string, unknown>, "item_id") ||
      fallbackPlaceId(day.day_number, index - 1)
    : null;

  // This leg's route evidence only: the stop's own route_evidence
  // field, matched exactly on from/to item ids. Any other shape,
  // any mismatched leg, and any unknown authority/distance kind is
  // dropped here (the panel's resolver re-validates the match too).
  let routeEvidence: DirectionsRouteEvidence | null = null;
  const rawEvidence = (item as unknown as Record<string, unknown>).route_evidence;
  if (rawEvidence && typeof rawEvidence === "object" && !Array.isArray(rawEvidence)) {
    const evidence = rawEvidence as Record<string, unknown>;
    const fromItemId = clean(evidence.fromItemId);
    const toItemId = clean(evidence.toItemId);
    const distanceKind = clean(evidence.distanceKind);
    const authority = clean(evidence.authority);
    if (
      fromItemId != null &&
      toItemId != null &&
      fromItemId === originItemId &&
      originItemId != null &&
      toItemId === selfId &&
      (distanceKind === "GEODESIC_STRAIGHT_LINE" || distanceKind === "ROUTE_DISTANCE" || distanceKind === "UNKNOWN") &&
      (authority === "AUTHORITATIVE_ROUTE" || authority === "GROUNDED_ESTIMATE" || authority === "DETERMINISTIC_BOUND" || authority === "UNKNOWN")
    ) {
      routeEvidence = {
        fromItemId,
        toItemId,
        mode: clean(evidence.mode),
        distanceKm: numberFrom(evidence, "distanceKm"),
        distanceKind: distanceKind as DirectionsRouteEvidence["distanceKind"],
        durationMinutes: numberFrom(evidence, "durationMinutes"),
        durationSource: clean(evidence.durationSource),
        authority: authority as DirectionsRouteEvidence["authority"]
      };
    }
  }
  // Photo strip photo: pipeline only, coords-gated. A miss degrades
  // to no strip element, never a broken image.
  const stopPhoto = coords
    ? await getDestinationPhoto({
        label: title,
        country: trip.destination_country ?? null,
        latitude: coords.latitude,
        longitude: coords.longitude
      }).catch(() => null)
    : null;
  // Originals pass: when the stop itself has no pipeline photo (the
  // Musée's merged plan title matches no entity, with or without
  // coords), the strip falls back to the trip's destination photo —
  // still a real pipeline photo of the destination, never a mock or
  // street-claimed image. Both paths stay null = no strip at all.
  const destinationPhoto = !stopPhoto
    ? await getDestinationPhoto({
        label: destinationLabel,
        country: trip.destination_country ?? null,
        latitude: null,
        longitude: null
      }).catch(() => null)
    : null;
  const photo = stopPhoto
    ? { imageUrl: stopPhoto.imageUrl, alt: unverified ? "Unverified stop" : title, credit: stopPhoto.credit ?? null, pageUrl: stopPhoto.pageUrl ?? null }
    : destinationPhoto
      ? { imageUrl: destinationPhoto.imageUrl, alt: destinationLabel, credit: destinationPhoto.credit ?? null, pageUrl: destinationPhoto.pageUrl ?? null }
      : null;

  return (
    <div className="min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] bg-cbg">
      <DirectionsScreen
        tripId={id}
        destination={{
          id: selfId,
          title,
          address: placeLabel && placeLabel !== title ? placeLabel : null,
          placeName: placeLabel || title,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          radiusMeters: null
        }}
        originItemId={originItemId}
        dayNumber={day.day_number}
        dayDate={day.date ?? null}
        tripDestinationLabel={destinationLabel}
        tripStartDate={trip.start_date ?? null}
        tripEndDate={trip.end_date ?? null}
        tripOriginLabel={originLabel}
        routeEvidence={routeEvidence}
        unverified={unverified}
        planTitle={unverified ? title : null}
        photo={photo ? { imageUrl: photo.imageUrl, alt: photo.alt, credit: photo.credit, pageUrl: photo.pageUrl } : null}
        backHref={backHref}
      />
    </div>
  );
}
