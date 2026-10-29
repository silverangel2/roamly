"use client";

/**
 * DirectionsScreen — the Picture 7 STANDALONE screen's client host
 * (owner mock correct-4-pages-part2.jpg, 3rd panel: "Getting to your
 * next stop"). It renders the round-2 DirectionsPanel as the whole
 * screen body, with the picture's own additions: the back action to
 * the entry page (live or place detail, chosen by the server page
 * from ?from=), the real pipeline photo strip (or no strip at all),
 * and the opt-in haversine walk estimate.
 *
 * Truth rules (same as the panel): no embedded map exists, so the
 * map slot stays the panel's honest summary card; no step-by-step
 * routing source exists (the live Distance Matrix source returns a
 * duration only), so without a verified location the steps area is
 * the panel's location-needed state with its retry control, and with
 * a verified location but no step producer it is the
 * steps-unavailable state — never invented streets, turns, or
 * distances, never the mock's sample values. The panel requests a
 * fresh browser position itself when the traveler taps its retry
 * control (this host passes no location and no host location action,
 * so the panel's own geolocation fallback runs). Walk time +
 * distance: a verified live route or exactly-matching itinerary
 * route evidence first; otherwise, only here, the haversine
 * estimate from the verified origin, always labeled "(est.)".
 * Terrain/sidewalk claims have no source and are never asserted.
 * All data comes from this trip's own server-page props — a
 * directions request for another trip's stop never renders here
 * (the server page resolves the stop inside this trip's bundle only).
 */

import { useRouter } from "next/navigation";
import { DirectionsPanel } from "@/components/trip/DirectionsPanel";
import { SafePhotoImg } from "@/components/roamly/SafePhotoImg";
import type { DirectionsDestination, DirectionsRouteEvidence } from "@/lib/roamly/directionsPanel";
import type { LiveLocationPermission } from "@/lib/roamly/liveCompanion";

export type DirectionsScreenPhoto = {
  imageUrl: string;
  alt: string;
  credit?: string | null;
  pageUrl?: string | null;
};

export type DirectionsScreenProps = {
  tripId: string;
  destination: DirectionsDestination;
  originItemId?: string | null;
  dayNumber?: number | null;
  dayDate?: string | null;
  tripDestinationLabel?: string | null;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  tripOriginLabel?: string | null;
  routeEvidence?: DirectionsRouteEvidence | null;
  /** Real pipeline photo (coords-gated, server-fetched). Null =
   *  no strip element at all, never a broken or mock image. */
  photo?: DirectionsScreenPhoto | null;
  /** Where the back chevron returns: the entry page that linked
   *  here (live companion or place detail). */
  backHref: string;
  /** Display-only unverified flag, threaded to the panel (see its
   *  prop comment): the panel shows "Unverified stop", never the
   *  raw plan title as a venue. Maps routing is untouched. */
  unverified?: boolean;
  /** Stored plan title, kept only when unverified; null otherwise. */
  planTitle?: string | null;
};

function DirectionsPhotoStrip({ photo }: { photo: DirectionsScreenPhoto }) {
  return (
    <div>
      <div className="flex gap-2">
        <SafePhotoImg
          src={photo.imageUrl}
          alt={photo.alt}
          className="h-40 w-full flex-1 rounded-[12px] object-cover"
        />
      </div>
      {photo.credit && photo.pageUrl ? (
        <p className="mt-1.5 text-right text-[12px] font-normal leading-[1.4] text-cgray">
          Photo:{" "}
          <a className="underline" href={photo.pageUrl} target="_blank" rel="noreferrer">
            {photo.credit}
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function DirectionsScreen(props: DirectionsScreenProps) {
  const router = useRouter();
  // The standalone screen has no live-companion location state of
  // its own: permission starts ungranted and location starts empty,
  // so the panel shows its location-needed state + retry control
  // until the traveler grants a fresh position through it.
  const permission: LiveLocationPermission = "prompt";
  return (
    <div className="mx-auto w-full max-w-2xl">
      <DirectionsPanel
        tripId={props.tripId}
        destination={props.destination}
        originItemId={props.originItemId ?? null}
        dayNumber={props.dayNumber ?? null}
        dayDate={props.dayDate ?? null}
        tripDestinationLabel={props.tripDestinationLabel ?? null}
        tripStartDate={props.tripStartDate ?? null}
        tripEndDate={props.tripEndDate ?? null}
        tripOriginLabel={props.tripOriginLabel ?? null}
        mode="walking"
        permission={permission}
        location={null}
        liveRoute={null}
        routeEvidence={props.routeEvidence ?? null}
        steps={null}
        onBack={() => router.push(props.backHref)}
        unverified={props.unverified ?? false}
        planTitle={props.planTitle ?? null}
        allowWalkEstimate
        photoStrip={props.photo ? <DirectionsPhotoStrip photo={props.photo} /> : undefined}
      />
    </div>
  );
}
