"use client";

/**
 * Directions panel — "Getting to your next stop" (Roamly UX repair,
 * round 2, panel 7). Faithful to the mock's iOS structure on the calm
 * design tokens (light grouped ground, deep navy-slate ink, system
 * blue spent sparingly, zero black), with one deliberate, honest
 * departure the mock cannot grant: the codebase has NO embedded map,
 * NO step-by-step source, and NO terrain/sidewalk source, so those
 * slots render unavailable states instead of a faked map, invented
 * streets, or the mock's terrain claim. See lib/roamly/directionsPanel.ts
 * for the sourcing rules. All content comes from this trip's own props
 * — the panel never reads another trip's data (per-trip isolation by
 * construction: pure props, no global or fetched state).
 *
 * The bottom tab bar is NOT rendered here: it belongs to the app shell
 * (it would duplicate inside the live page, and the standalone
 * directions route gains it from the shell's app-surface set).
 * The mock's photo strip renders ONLY when the host passes a real
 * photo node as `photoStrip` (the standalone screen's pipeline photo);
 * the embedded live panel passes none, so it renders no strip.
 * PICTURE 7 STANDALONE (2026-10-26): this same panel IS the
 * standalone screen's body, hosted by
 * app/trip/[id]/directions/[placeId]/page.tsx via DirectionsScreen.
 * The standalone host passes `photoStrip`, `allowWalkEstimate`, and
 * a back action to its entry page; the live host passes
 * `standaloneHref` so its embedded panel links out to that screen.
 */

import { useMemo, useState, type ReactNode } from "react";
import { calculateDistanceMeters } from "@/lib/roamly/location";
import type {
  LiveCoordinates,
  LiveLocationPermission,
  LiveRouteStatus
} from "@/lib/roamly/liveCompanion";
import {
  buildDirectionsMapsLinks,
  formatDirectionsDayLabel,
  formatDistanceMeters,
  formatTripIdentity,
  resolveDirectionsLocationGate,
  resolveDirectionsSteps,
  resolveWalkSummary,
  type DirectionsDestination,
  type DirectionsMode,
  type DirectionsRouteEvidence,
  type DirectionsStep
} from "@/lib/roamly/directionsPanel";

export type DirectionsPanelProps = {
  tripId: string;
  destination: DirectionsDestination;
  /** Previous stop's item id, for matching itinerary route evidence to
   *  THIS leg. Null when unknown — evidence then cannot match and is
   *  ignored rather than borrowed from another leg. */
  originItemId?: string | null;
  dayNumber?: number | null;
  dayDate?: string | null;
  tripDestinationLabel?: string | null;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  tripOriginLabel?: string | null;
  mode?: DirectionsMode;
  permission: LiveLocationPermission;
  location?: LiveCoordinates | null;
  liveRoute?: LiveRouteStatus | null;
  routeEvidence?: DirectionsRouteEvidence | null;
  /** No producer exists in the codebase today; null renders the honest
   *  steps-unavailable state. A future routing source passes real steps
   *  here and the ready state renders them verbatim. */
  steps?: DirectionsStep[] | null;
  onBack?: () => void;
  /** Host-supplied location action (e.g. the live page's enableLocation).
   *  When absent, the panel requests a fresh browser position itself. */
  onRequestLocation?: () => void;
  /** Real photo strip node, rendered between the steps and the
   *  "Show all directions" button (the mock's position). Absent =
   *  no strip element at all, never a placeholder or mock photo. */
  photoStrip?: ReactNode;
  /** Link to the standalone directions screen for this stop, shown
   *  only in the embedded (live-page) host. The standalone screen
   *  itself passes none — it IS that screen. */
  standaloneHref?: string | null;
  /** Picture 7 standalone only: allow the haversine walking-speed
   *  estimate (from the verified gate origin) when no live route and
   *  no grounded evidence serve the leg. Default false, so the live
   *  host's summary behavior is unchanged. */
  allowWalkEstimate?: boolean;
  /** Acceptance-review round (2026-10-28), DISPLAY ONLY: true when
   *  the destination is an unverified stop (bare-acronym title, no
   *  real description). The panel then renders "Unverified stop"
   *  with the stored plan title kept for traceability, instead of
   *  presenting the raw title as a normal venue. The destination
   *  object (coordinates, maps links) is NOT changed: maps still
   *  route to the stop's real coordinates. */
  unverified?: boolean;
  /** Stored plan title, kept only when unverified; null otherwise. */
  planTitle?: string | null;
};

const INITIAL_VISIBLE_STEPS = 4;

function WalkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13" cy="4" r="1.8" />
      <path d="M13 8.5 11 13l2.5 1.5L12 20M11 13l-2 2.5M13 8.5 16 10l1.5 3" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F2D4D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.5 11.5 3.5M5 3.5h6.5V10" />
    </svg>
  );
}

export function DirectionsPanel(props: DirectionsPanelProps) {
  const [localLocation, setLocalLocation] = useState<LiveCoordinates | null>(null);
  const [localLocationError, setLocalLocationError] = useState<string | null>(null);
  const [locationRequesting, setLocationRequesting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const effectiveLocation = props.location ?? localLocation;
  const effectivePermission: LiveLocationPermission =
    props.permission === "granted" || localLocation != null ? "granted" : props.permission;

  const gate = useMemo(
    () =>
      resolveDirectionsLocationGate({
        permission: effectivePermission,
        location: effectiveLocation,
        destination: props.destination
      }),
    [effectivePermission, effectiveLocation, props.destination]
  );

  // Picture 7 standalone estimate: haversine distance from the
  // verified gate origin at the codebase's walking speed (4.8 km/h,
  // the same constant as placeDetail.estimateWalk), computed only
  // when the host opts in AND the gate verified an origin AND the
  // destination carries coordinates. The lib applies it only when
  // the summary would otherwise be fully unavailable, as "(est.)".
  const fallbackEstimate = useMemo(() => {
    if (!props.allowWalkEstimate) return null;
    if (gate.state !== "verified") return null;
    const destination = props.destination;
    if (
      typeof destination.latitude !== "number" ||
      typeof destination.longitude !== "number"
    ) {
      return null;
    }
    const distanceMeters = calculateDistanceMeters(
      gate.origin.latitude,
      gate.origin.longitude,
      destination.latitude,
      destination.longitude
    );
    const durationMinutes = Math.max(1, Math.round((distanceMeters / 4800) * 60));
    return { durationMinutes, distanceMeters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.allowWalkEstimate, gate, props.destination]);

  const summary = useMemo(
    () =>
      resolveWalkSummary({
        mode: props.mode,
        liveRoute: props.liveRoute,
        routeEvidence: props.routeEvidence,
        originItemId: props.originItemId,
        destinationId: props.destination.id,
        fallbackEstimate
      }),
    [props.mode, props.liveRoute, props.routeEvidence, props.originItemId, props.destination.id, fallbackEstimate]
  );

  const stepsState = useMemo(
    () => resolveDirectionsSteps({ gate, steps: props.steps }),
    [gate, props.steps]
  );

  const mapsLinks = useMemo(
    () =>
      buildDirectionsMapsLinks({
        destination: props.destination,
        verifiedOrigin: gate.state === "verified" ? gate.origin : null,
        mode: props.mode,
        isIOS: typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "")
      }),
    [gate, props.destination, props.mode]
  );

  const dayLabel = formatDirectionsDayLabel(props.dayNumber, props.dayDate);
  const tripIdentity = formatTripIdentity({
    destinationLabel: props.tripDestinationLabel,
    startDate: props.tripStartDate,
    endDate: props.tripEndDate,
    originLabel: props.tripOriginLabel
  });
  const placeTitle = props.destination.placeName || props.destination.title;
  // Display-only unverified rendering: the shown title is the label,
  // never the raw plan title; the maps destination (coordinates) is
  // untouched. An address identical to the raw title is not repeated
  // (it IS the title); the plan-title line below carries traceability.
  const displayTitle = props.unverified ? "Unverified stop" : placeTitle;
  const displayAddress =
    props.destination.address && props.destination.address !== placeTitle
      ? props.destination.address
      : null;
  const durationText = summary.durationLabel
    ? summary.durationKind === "estimated"
      ? `${summary.durationLabel} (est.)`
      : summary.durationLabel
    : null;
  // The fallback estimate is a pair: duration already carries
  // "(est.)" via durationKind, and distance carries it here, so the
  // whole line reads as an estimate, never as a routed walk.
  const distanceText = summary.distanceLabel
    ? summary.fallbackEstimateUsed
      ? `${summary.distanceLabel} (est.)`
      : summary.distanceLabel
    : null;
  // Repair round P3: ONE concise routing explanation on this
  // screen, sitting in the Route row of the summary card below.
  // When no routed duration or distance exists, that row says in
  // customer words where the live routing lives (the maps app, via
  // the single Open in Maps button) — never an "unavailable" dead
  // end. Verified durations still render bare; fallback estimates
  // still carry "(est.)" (item 1 labeling). The walk card and the
  // steps area must NOT repeat this sentence: they show values
  // only, or nothing, so the screen explains routing exactly once.
  const summaryLine =
    durationText || distanceText
      ? [durationText, distanceText].filter(Boolean).join(" · ")
      : "Live routing opens in your maps app";
  const walkValuesLine = [durationText, distanceText].filter(Boolean).join(" · ") || null;

  const requestLocation = () => {
    if (props.onRequestLocation) {
      props.onRequestLocation();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocalLocationError("This browser does not support location sensing.");
      return;
    }
    setLocationRequesting(true);
    setLocalLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocalLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString()
        });
        setLocationRequesting(false);
      },
      (error) => {
        setLocalLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. You can still open Maps for directions."
            : "Location is unavailable right now. Try again."
        );
        setLocationRequesting(false);
      }
    );
  };

  const visibleSteps = stepsState.state === "ready" && !showAll
    ? stepsState.steps.slice(0, INITIAL_VISIBLE_STEPS)
    : stepsState.state === "ready"
      ? stepsState.steps
      : [];
  const hasMoreSteps = stepsState.state === "ready" && stepsState.steps.length > INITIAL_VISIBLE_STEPS;

  return (
    <section
      aria-label="Getting to your next stop"
      data-trip-id={props.tripId}
      className="mx-auto w-full bg-cbg"
    >
      {/* Header — mock structure: back, title + day, map shortcut. */}
      <header className="flex items-start gap-2 px-4 pb-2 pt-3">
        {props.onBack ? (
          <button
            type="button"
            onClick={props.onBack}
            aria-label="Back"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center text-chead"
          >
            <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 1.5 1.5 9l7 7.5" />
            </svg>
          </button>
        ) : (
          <a
            href={`/trip/${props.tripId}/live`}
            aria-label="Back to live trip"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center text-chead"
          >
            <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 1.5 1.5 9l7 7.5" />
            </svg>
          </a>
        )}
        <div className="min-w-0 flex-1 text-center">
          <h2 className="text-[17px] font-bold leading-tight text-chead">Getting to your next stop</h2>
          <p className="mt-0.5 text-[13px] font-normal text-cgray">{dayLabel}</p>
        </div>
        {mapsLinks.primary ? (
          <a
            href={mapsLinks.primary}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in Maps"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center"
          >
            <MapIcon />
          </a>
        ) : (
          <span aria-hidden="true" className="min-h-11 min-w-11 shrink-0" />
        )}
      </header>

      {tripIdentity ? (
        <p className="px-4 pb-2 text-center text-[13px] font-normal leading-5 text-cgray">{tripIdentity}</p>
      ) : null}

      {/* Route summary — NO embedded map exists in the codebase, so
          this is an honest summary card, never a faked map image.
          Repair round P3: the old technical preview block is gone —
          the Route row below is the screen's ONE routing
          explanation. */}
      <div className="px-4">
        <div className="rounded-2xl bg-white px-4 py-4 shadow-calm">
          <div className="grid gap-2">
            <p className="text-sm font-normal leading-6 text-cink">
              <span className="font-semibold text-chead">From: </span>
              {gate.state === "verified" ? "Your current location" : "Starting point not confirmed yet"}
            </p>
            <p className="text-sm font-normal leading-6 text-cink">
              <span className="font-semibold text-chead">To: </span>
              {displayTitle}
              {displayAddress ? <span className="text-cgray"> · {displayAddress}</span> : null}
            </p>
            {props.unverified && props.planTitle ? (
              <p className="text-sm font-normal leading-6 text-cgray">
                Plan title: {props.planTitle}
              </p>
            ) : null}
            <p className="text-sm font-normal leading-6 text-cink">
              <span className="font-semibold text-chead">Route: </span>
              {summaryLine}
            </p>
          </div>
        </div>
      </div>

      {/* Walk summary — mock line, real values only. Terrain and
          sidewalk claims have no source and are never asserted. */}
      <div className="mt-3 px-4">
        <div className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cbg">
            <WalkIcon />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-6 text-chead">
              {summary.modeLabel} to {displayTitle}
            </p>
            {/* Repair round P3: values only here — the Route row
                above already carries the screen's one routing
                explanation, so this card never repeats it. Estimates
                keep their "(est.)" marking on the values themselves. */}
            {walkValuesLine ? (
              <p className="text-sm font-normal leading-6 text-cgray">{walkValuesLine}</p>
            ) : null}
            <p className="text-sm font-normal leading-6 text-cgray">
              Terrain and sidewalk details aren&apos;t available for this stop.
            </p>
          </div>
        </div>
      </div>

      {/* Open in Maps — built from this trip's real destination; the
          origin parameter is present only when the gate verified it. */}
      <div className="mt-3 px-4">
        {mapsLinks.available && mapsLinks.primary ? (
          <a
            href={mapsLinks.primary}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-cblue px-4 text-[17px] font-semibold text-white"
          >
            Open in Maps
            <ExternalIcon />
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-cbg px-4 text-[17px] font-semibold text-cgray"
          >
            Open in Maps
          </button>
        )}
        {!mapsLinks.available ? (
          <p className="mt-2 text-center text-[13px] font-normal leading-5 text-cgray">
            Destination details are missing, so Maps links can&apos;t be built for this stop.
          </p>
        ) : (
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] font-semibold text-cblue">
            {mapsLinks.google ? (
              <a href={mapsLinks.google} target="_blank" rel="noreferrer">Google Maps</a>
            ) : null}
            {mapsLinks.apple ? (
              <a href={mapsLinks.apple} target="_blank" rel="noreferrer">Apple Maps</a>
            ) : null}
            {mapsLinks.citymapper ? (
              <a href={mapsLinks.citymapper} target="_blank" rel="noreferrer">Citymapper</a>
            ) : null}
          </p>
        )}
        {gate.state === "verified" ? (
          <p className="mt-2 text-center text-[13px] font-normal leading-5 text-cgray">
            Maps links start from your verified current location.
          </p>
        ) : null}
      </div>

      {/* Step-by-step directions. */}
      <div className="mt-5 px-4">
        <h3 className="text-[17px] font-bold text-chead">Step-by-step directions</h3>
        {stepsState.state === "location_needed" ? (
          <div className="mt-3 rounded-2xl bg-white px-4 py-4 shadow-calm">
            <p className="text-[15px] font-semibold leading-6 text-chead">Location needed for directions from here</p>
            <p className="mt-1 text-sm font-normal leading-6 text-cink">
              {stepsState.gate.state === "location_needed" ? stepsState.gate.detail : "Your current location is unavailable right now."}{" "}
              Step-by-step directions from your current location can&apos;t be shown until a fresh location is available.
            </p>
            {localLocationError ? (
              <p className="mt-2 text-sm font-normal leading-6 text-cgray">{localLocationError}</p>
            ) : null}
            <button
              type="button"
              onClick={requestLocation}
              disabled={locationRequesting}
              className="mt-3 min-h-11 px-1 text-left text-[15px] font-semibold text-cblue disabled:text-cgray"
            >
              {locationRequesting ? "Checking location…" : "Use my current location"}
            </button>
          </div>
        ) : stepsState.state === "steps_unavailable" ? (
          <div className="mt-3 rounded-2xl bg-white px-4 py-4 shadow-calm">
            <p className="text-[15px] font-semibold leading-6 text-chead">Step-by-step directions aren&apos;t available yet</p>
            <p className="mt-1 text-sm font-normal leading-6 text-cink">
              Your current location is verified for this trip, but Roamly doesn&apos;t have a step-by-step routing source for
              this stop yet. Open in Maps above for turn-by-turn directions — no street names or distances are guessed here.
            </p>
          </div>
        ) : (
          <ol className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
            <li className="flex items-start gap-3 py-2">
              <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-cblue ring-4 ring-cbg" />
              <span className="text-[15px] font-normal leading-6 text-cink">Start from your current location</span>
            </li>
            {visibleSteps.map((step, index) => (
              <li key={`${step.instruction}-${index}`} className="flex items-start gap-3 py-2">
                <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-cblue bg-white" />
                <span className="text-[15px] font-normal leading-6 text-cink">
                  {step.instruction}
                  {step.distanceMeters != null ? (
                    <span className="text-cgray"> ({formatDistanceMeters(step.distanceMeters)})</span>
                  ) : null}
                </span>
              </li>
            ))}
            <li className="flex items-start gap-3 py-2">
              <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-cred ring-4 ring-cbg" />
              <span className="text-[15px] font-normal leading-6 text-cink">Arrive at {displayTitle}</span>
            </li>
          </ol>
        )}

        {/* Photo strip — mock position, between the steps and the
            Show-all button. Renders only when the host passed a real
            photo node; otherwise nothing renders here. */}
        {props.photoStrip ? <div className="mt-3">{props.photoStrip}</div> : null}

        {/* Show all directions — mock position. Conditional-acceptance
            item 5: no dead buttons. The toggle renders ONLY when it
            does something (more steps to reveal, or shown steps to
            collapse). When every step is already visible, a plain-words
            note says so. When no step source exists, nothing renders
            here — the steps card above explains its own state, and
            the single Open in Maps button above is the routed action
            (never a disabled control + a technical reason, and never
            a second copy of that action). */}
        {/* Repair round P3: ONE primary navigation action on this
            screen — the big Open in Maps button above, with Google /
            Apple / Citymapper as secondary links beneath it. The old
            second Open in Maps link + repeated routing note here are
            gone: the steps cards above already explain their own
            state, and the summary's Route row already explains
            routing. This area now only holds the working Show-all
            toggle (or its "all shown" note) for ready step lists. */}
        <div className="mt-3 pb-4 text-center">
          {stepsState.state === "ready" && (hasMoreSteps || showAll) ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="min-h-11 px-2 text-[15px] font-semibold text-cblue"
            >
              {showAll ? "Show fewer directions" : "Show all directions"}
            </button>
          ) : stepsState.state === "ready" ? (
            <p className="text-[13px] font-normal leading-5 text-cgray">
              All directions are shown above.
            </p>
          ) : null}
        </div>
        {/* Standalone-screen link — embedded (live-page) host only.
            The standalone screen passes no standaloneHref, so it
            never links to itself. */}
        {props.standaloneHref ? (
          <div className="pb-4 text-center">
            <a
              href={props.standaloneHref}
              className="min-h-11 px-2 py-2 text-[15px] font-semibold text-cblue"
            >
              Open full directions screen
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
