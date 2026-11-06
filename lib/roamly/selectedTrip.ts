import { selectActiveTrip } from "@/lib/roamly/liveCompanion";
import {
  isOpenNotificationTrip,
  selectNotificationTrip,
  type NotificationTripCandidate
} from "@/lib/roamly/notificationTrip";

/**
 * ONE selected-trip resolver (Lane N, release-candidate round 2 —
 * closes finding F4 / audit item N5: three coexisting "current trip"
 * rules made the Alerts page show one trip while the tab bar's
 * Itinerary/Live pointed at another, or fell back to /dashboard).
 *
 * THE THREE PRE-EXISTING RULES THIS UNIFIES (as found, round 2):
 *  1. Route-param rule — app/trip/[id]/page.tsx and
 *     app/trip/[id]/live/page.tsx render exactly the trip named by
 *     `const { id } = await params`; the shell mirrored this with
 *     appSurfaceTripId(pathname) for the bar's hrefs.
 *  2. Companion-active rule — liveCompanion.selectActiveTrip, served
 *     by GET /api/roamly/trips/active (tripActivation
 *     .getActiveOrUpcomingTrip): only trips that are itinerary-locked,
 *     companion-unlocked (tracking or live), in status
 *     locked/active/planned/generated, AND with today inside the trip
 *     dates; ranked status active < locked < planned < other, then
 *     earliest start. The shell used this alone for the bar's
 *     Itinerary/Live hrefs (frameTripId = route id || this id), so a
 *     trip the companion rule cannot see (not unlocked, not locked,
 *     or not in its window) left the bar on /dashboard.
 *  3. Notification selected-trip rule — notificationTrip
 *     .resolveSelectedTrip / selectNotificationTrip: the URL/?trip=
 *     id wins when it names an open trip; otherwise open trips
 *     (cancelled/archived excluded), companion-unlocked pool first,
 *     ranked by window in the trip's own timezone (active, then
 *     future by earliest start, then missing dates, then completed
 *     by latest start). The Alerts page and the shell badge used
 *     this one — but NOT the bar hrefs, and on a fresh /notifications
 *     load the page's bridge event could fire before the shell's
 *     listener registered, so the bar never learned the page's trip.
 *
 * THE ONE PRIORITY ORDER (this module, every consumer):
 *  1. "route" — an explicit route param: the /trip/[id] segment, or
 *     the ?trip= id the Alerts tab carries. It wins when it names an
 *     OPEN trip — either in the supplied list, or as a directly
 *     fetched row (routeTrip) for ids outside the list's 40-row
 *     window. A cancelled/archived/unknown id never wins.
 *  2. "companion" — the companion-active trip (rule 2, computed here
 *     from the same candidate fields when the rows carry them): the
 *     trip Live Companion is actually running for today.
 *  3. "page" — a trip a server page has already selected and handed
 *     to the shell (the Alerts page's bridge value). It ranks below
 *     an explicit route param and the companion trip only as a
 *     STALENESS guard: the shell accepts it solely while it still
 *     names an open trip in the freshly fetched list, so a bridge
 *     value left over from an earlier view can never resurrect a
 *     trip the current data no longer supports. When the Alerts page
 *     itself is the surface, its own selection IS this value and
 *     steps 1–3 agree by construction (the page resolves ?trip=
 *     first, then this same resolver).
 *  4. "rule" — the notification rule (rule 3's fallback): the most
 *     relevant open trip — active window first, then the soonest
 *     upcoming, then missing-dates, then the most recent completed.
 *  5. "none" — no open trip exists. Consumers fall back to
 *     /dashboard ONLY in this case (or when signed out / the trip
 *     list could not be loaded, which is reported as no resolution,
 *     never as a different trip).
 *
 * Pure function; `now` injectable for tests. No data fetching, no
 * schema changes: consumers keep their existing fetches and pass the
 * rows they already have.
 */

export type SelectedTripCandidate = NotificationTripCandidate & {
  itinerary_locked?: boolean | null;
  itinerary_generated_at?: string | null;
};

export type SelectedTripSource = "route" | "companion" | "page" | "rule" | "none";

export type SelectedTripResolution<T extends SelectedTripCandidate = SelectedTripCandidate> = {
  trip: T | null;
  tripId: string;
  source: SelectedTripSource;
};

function openFromList<T extends SelectedTripCandidate>(trips: readonly T[], id: string | null | undefined): T | null {
  if (!id) return null;
  const found = trips.find((trip) => trip.id === id);
  return found && isOpenNotificationTrip(found) ? found : null;
}

export function resolveRoamlySelectedTrip<T extends SelectedTripCandidate>(params: {
  trips: readonly T[];
  /** Explicit route param: /trip/[id] segment or ?trip= value. */
  routeTripId?: string | null;
  /** Directly fetched row for routeTripId (Alerts server path), for
   *  ids outside the list window. Used only when it is open AND its
   *  id matches routeTripId. */
  routeTrip?: T | null;
  /** Companion-active trip id (from /api/roamly/trips/active or
   *  getActiveOrUpcomingTrip), when the caller already has it —
   *  including an explicit null, which means "the companion rule
   *  was consulted and found none". Only when the key is omitted
   *  entirely is the companion trip computed from the list itself
   *  via selectActiveTrip. */
  companionTripId?: string | null;
  /** Trip handed up by the page being rendered (shell bridge). */
  pageTripId?: string | null;
  now?: Date;
}): SelectedTripResolution<T> {
  const { trips } = params;
  const now = params.now ?? new Date();

  // 1. Explicit route param wins.
  if (params.routeTripId) {
    const fromList = openFromList(trips, params.routeTripId);
    if (fromList) return { trip: fromList, tripId: fromList.id, source: "route" };
    if (
      params.routeTrip &&
      params.routeTrip.id === params.routeTripId &&
      isOpenNotificationTrip(params.routeTrip)
    ) {
      return { trip: params.routeTrip, tripId: params.routeTrip.id, source: "route" };
    }
  }

  // 2. Companion-active trip: the caller's server-computed id when
  //    supplied, else the same rule computed over the list. Either
  //    way it must still name an open trip in the current list.
  const companionId =
    params.companionTripId !== undefined
      ? params.companionTripId
      : selectActiveTrip([...trips], now)?.id ?? null;
  const companionTrip = openFromList(trips, companionId);
  if (companionTrip) return { trip: companionTrip, tripId: companionTrip.id, source: "companion" };

  // 3. Page-selected trip (bridge), staleness-guarded by the list.
  const pageTrip = openFromList(trips, params.pageTripId);
  if (pageTrip) return { trip: pageTrip, tripId: pageTrip.id, source: "page" };

  // 4. The notification rule over the same list.
  const ruleTrip = selectNotificationTrip(trips, now);
  if (ruleTrip) return { trip: ruleTrip, tripId: ruleTrip.id, source: "rule" };

  // 5. No open trip exists.
  return { trip: null, tripId: "", source: "none" };
}

/**
 * The tab bar's hrefs for a resolution: Itinerary/Live point at the
 * ONE selected trip, and /dashboard is reachable ONLY when the
 * resolution is "none" (no open trip exists).
 */
export function selectedTripBarHrefs(resolution: SelectedTripResolution): {
  itineraryHref: string;
  liveHref: string;
} {
  return resolution.tripId
    ? { itineraryHref: `/trip/${resolution.tripId}`, liveHref: `/trip/${resolution.tripId}/live` }
    : { itineraryHref: "/dashboard", liveHref: "/dashboard" };
}
