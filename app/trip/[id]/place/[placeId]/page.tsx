import { redirect } from "next/navigation";
import { PlaceDetailPanel } from "@/components/roamly/PlaceDetailPanel";
import {
  buildPlaceDetail,
  fallbackPlaceId,
  isTransferLikeItem,
  isUsablePlaceTitle,
  itemCoordinates,
  resolvePlaceInItinerary,
  type PlaceDayInput
} from "@/lib/roamly/placeDetail";
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";
import { getTripDestinationLabel, getTripOriginLabel } from "@/lib/roamly/tripMetadata";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, isMissingTableError } from "@/lib/trips";

/*
 * Place detail — panel 6 of the owner mock (correct-4-pages-part2.jpg,
 * 2nd panel). The place shown is ALWAYS one live_timeline item of
 * THIS trip's own itinerary, resolved by item_id (or the deterministic
 * fallback id d<day>-<index>) inside this trip's bundle only — never
 * another trip's data, never a search result, never a pack candidate.
 * An unknown id renders a not-found state, never a guessed place.
 *
 * Photos: the existing destination-photo pipeline only. A stop with
 * coordinates gets a coordinate-gated lookup; a stop without them
 * gets a label-only lookup with the full plan title verbatim (never
 * shortened or guessed). The pipeline returns at most one photo, so the
 * panel's count badge is "1/1" when one exists, never the mock's "1/6".
 *
 * About fields: Address comes only from an exactly-title-matched
 * confirmed booking row (see placeDetail.findConfirmedBookingForPlace);
 * opening hours and ticket info have no traveler-facing source for a
 * plan item and render as unavailable. No calendar export and no
 * saved-places store exist, so those two actions render disabled with
 * an explanation (see PlaceDetailPanel).
 *
 * Localized itinerary text is deliberately NOT applied here: the
 * panel renders the stored plan's own language, so no translated
 * string can drift from the plan of record.
 *
 * PICTURE 6 OVERHAUL (2026-10-26, sequential picture pass): the panel
 * now follows the picture literally — centered Day header + destination
 * subtitle (no date-range/origin line, no location line under the title);
 * About is a single chevron card whose rows render only when expanded;
 * Nearby is capped at 2 cards with real pipeline sibling photos and no
 * heart (no saved-places store); Tips is a plain checklist; the
 * "See the full itinerary" button is gone from this screen (the back
 * chevron is the way back to the trip's itinerary home).
 */

type PlacePageProps = {
  params: Promise<{ id: string; placeId: string }>;
};

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

export default async function TripPlaceDetailPage({ params }: PlacePageProps) {
  const { id, placeId } = await params;
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(`/trip/${id}/place/${placeId}`)}`);
  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const trip = bundle.data.trip;
  const itinerary = bundle.data.itinerary?.full_json ?? null;
  const destination = getTripDestinationLabel(trip) || trip.destination || "Your trip";
  const origin = getTripOriginLabel(trip) || null;

  if (!itinerary) {
    return notFoundPanel(
      id,
      "No plan to show yet.",
      "This trip has no itinerary saved, so there is no place detail to open. Generate or save the itinerary first, then come back."
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

  const { day, item } = resolved;
  const dayInput: PlaceDayInput = {
    day_number: day.day_number,
    date: day.date ?? null,
    live_timeline: (day.live_timeline || []) as unknown as Record<string, unknown>[]
  };
  const siblings = (day.live_timeline || []).map((sibling, siblingIndex) => ({
    item: sibling as unknown as Record<string, unknown>,
    id:
      (typeof (sibling as { item_id?: unknown }).item_id === "string" &&
      (sibling as { item_id: string }).item_id.trim()
        ? (sibling as { item_id: string }).item_id
        : fallbackPlaceId(day.day_number, siblingIndex))
  }));

  // Confirmed bookings for this trip only (same query shape as the trip
  // page). Only an exact title match can anchor a Confirmed badge or
  // supply an address — see placeDetail.findConfirmedBookingForPlace.
  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("start_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const bookings =
    bookingsResult.error && isMissingTableError(bookingsResult.error.message)
      ? []
      : ((bookingsResult.data || []) as unknown as Record<string, unknown>[]);

  // Photo: coordinates when the stop has them, else a label-only
  // lookup (exactness pass 2026-10-26). The pipeline's own scoring
  // still applies, and a miss degrades to the bare header, never a
  // broken image. The full plan title is passed verbatim — never
  // shortened or guessed — so a merged title that matches nothing
  // stays bare, honestly, and any returned photo is verified
  // against the place before it is called done.
  const coords = itemCoordinates(item as unknown as Record<string, unknown>);
  const photo = await getDestinationPhoto({
    label: String((item as { title?: unknown }).title || ""),
    country: trip.destination_country ?? null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null
  }).catch(() => null);

  // Nearby sibling photos (Picture 6 shows two cards): the SAME
  // eligibility the view-model applies — same-day, usable title, not
  // a travel leg, not this stop — capped at 2, coords-gated, real
  // pipeline only. A sibling without a photo gets no photo element.
  const selfId =
    (typeof (item as { item_id?: unknown }).item_id === "string" &&
    (item as { item_id: string }).item_id.trim()
      ? (item as { item_id: string }).item_id
      : fallbackPlaceId(day.day_number, resolved.index));
  const nearbyCandidates = siblings.filter((sibling) => {
    if (sibling.item === (item as unknown as Record<string, unknown>)) return false;
    if (sibling.id === selfId) return false;
    const siblingTitle = sibling.item.title;
    if (typeof siblingTitle !== "string" || !isUsablePlaceTitle(siblingTitle)) return false;
    if (isTransferLikeItem(sibling.item)) return false;
    return true;
  }).slice(0, 2);
  const nearbyPhotoEntries = await Promise.all(
    nearbyCandidates.map(async (sibling) => {
      const siblingCoords = itemCoordinates(sibling.item);
      if (!siblingCoords) return [sibling.id, null] as const;
      const siblingPhoto = await getDestinationPhoto({
        label: String(sibling.item.title || ""),
        country: trip.destination_country ?? null,
        latitude: siblingCoords.latitude,
        longitude: siblingCoords.longitude
      }).catch(() => null);
      return [sibling.id, siblingPhoto] as const;
    })
  );
  const siblingPhotos: Record<string, { imageUrl: string; credit: string | null; pageUrl: string | null }> = {};
  for (const [siblingId, siblingPhoto] of nearbyPhotoEntries) {
    if (siblingPhoto) {
      siblingPhotos[siblingId] = {
        imageUrl: siblingPhoto.imageUrl,
        credit: siblingPhoto.credit,
        pageUrl: siblingPhoto.pageUrl
      };
    }
  }

  const detail = buildPlaceDetail({
    item: item as unknown as Record<string, unknown>,
    day: dayInput,
    siblings,
    trip: {
      destination,
      origin,
      start_date: trip.start_date,
      end_date: trip.end_date
    },
    tripTips: Array.isArray(itinerary.local_tips) ? itinerary.local_tips : [],
    confirmedBookings: bookings,
    photo: photo ? { imageUrl: photo.imageUrl, credit: photo.credit, pageUrl: photo.pageUrl } : null,
    siblingPhotos
  });

  if (!detail) {
    return notFoundPanel(
      id,
      "This stop is not in this trip's plan.",
      "The link may be for a different trip, or the stop may have been removed. Your itinerary holds everything still planned for this trip."
    );
  }

  return (
    <div className="min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] bg-cbg">
      <PlaceDetailPanel
        detail={detail}
        tripId={id}
        directionsScreenHref={`/trip/${id}/directions/${placeId}?from=place`}
      />
    </div>
  );
}
