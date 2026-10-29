/*
 * /notifications active-trip dedup + transport-leg categorization
 * (Roamly UX repair ROUND 2, builder C).
 *
 * Failure: the same activity row fed three claim-cards at once —
 * NearbyActivityCard (nearby[0] || upNext), CurrentDayTimeline
 * (nearby list, or [upNext] as fallback), and UpNextActivityCard
 * (upNext) — so one Saint John → Montreal leg rendered three times,
 * once under a "nearby" eyebrow it had never earned.
 *
 * Rules enforced here (pure, server-safe, no imports):
 *   1. A transport leg appears AT MOST ONCE, in the dedicated travel
 *      slot — never as a nearby activity, never as "up next nearby",
 *      and never as a timeline activity row. It is labeled "Travel
 *      leg", not an activity, and it carries NO distance/proximity
 *      claim: the /notifications page has no fresh user location, so
 *      nothing here is location-verified (evidence boundary 3), and
 *      the leg is not rendered by the Nearby card at all.
 *   2. A non-transport activity shown as Nearby is removed from
 *      Up Next (one claim-card wins); the day timeline keeps its row
 *      because it is a day plan, not a competing now/next claim —
 *      except transport legs, which are extracted from the timeline
 *      too under rule 1.
 *   3. Identity is the activity id; when two sources carry different
 *      ids for the same leg (title + scheduled start identical), the
 *      normalized title+start key collapses them as well.
 *
 * A planned activity is never relabeled nearby by this module: it
 * only removes duplicates and re-homes transport legs. What counts
 * as "nearby" is decided upstream (DB status + location sensing),
 * untouched here.
 */

export type ActiveTripActivity = {
  id: string;
  title: string;
  category: string | null;
  scheduled_start: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export const TRAVEL_LEG_LABEL = "Travel leg";

const TRANSPORT_CATEGORIES = new Set([
  "transport",
  "transportation",
  "transfer",
  "flight",
  "train",
  "bus",
  "ferry",
  "car_rental",
  "rental_car",
  "drive",
  "travel"
]);

function normalized(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when the row is travel between places rather than a place
 * activity. Category is the primary signal; the title is the fallback
 * for legs stored without a transport category (an "A → B" title, or
 * a "Travel/Drive/Fly to …" title, is a leg, not a destination stop).
 * A plain place name, hotel, meal, or attraction title is NOT a leg.
 */
export function isTransportLeg(activity: ActiveTripActivity | null | undefined): boolean {
  if (!activity) return false;
  if (TRANSPORT_CATEGORIES.has(normalized(activity.category))) return true;
  const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
  const itemType = normalized(metadata.item_type);
  if (itemType === "transfer" || itemType === "travel") return true;
  if (normalized(metadata.booking_category) === "transport") return true;
  const title = normalized(activity.title);
  if (title.includes("→") || title.includes("->")) return true;
  return /^(travel|drive|fly|flying|flight|train|bus|ferry) (to|from)\b/.test(title);
}

function dedupKey(activity: ActiveTripActivity): string {
  if (activity.id) return `id:${activity.id}`;
  return `title:${normalized(activity.title)}|${normalized(activity.scheduled_start)}`;
}

export type DedupedActiveTrip<T extends ActiveTripActivity = ActiveTripActivity> = {
  /** The single activity the Nearby card may show (null when none, or when the top row was a leg). */
  nearbyActivity: T | null;
  /** The single activity the Up Next card may show. */
  upNextActivity: T | null;
  /** Timeline rows with transport legs extracted (non-transport rows intact, in order). */
  currentDayActivities: T[];
  /** Each transport leg once, in first-seen order, labeled via TRAVEL_LEG_LABEL. */
  travelLegs: T[];
};

// Generic over the caller's activity row type (TrackingActivity on
// the page) so dedup never narrows rows: the cards receive exactly
// the rows they received before, minus duplicates and legs.
export function dedupeActiveTrip<T extends ActiveTripActivity>(input: {
  nearbyActivities: T[];
  upNextActivity: T | null;
  currentDayActivities: T[];
  tripStarted: boolean;
}): DedupedActiveTrip<T> {
  const travelLegs: T[] = [];
  const seenLegKeys = new Set<string>();
  const takeLeg = (activity: T | null | undefined): boolean => {
    if (!activity || !isTransportLeg(activity)) return false;
    const key = dedupKey(activity);
    if (!seenLegKeys.has(key)) {
      seenLegKeys.add(key);
      travelLegs.push(activity);
    }
    return true;
  };

  // Candidate order matches the page's old priority (nearby first),
  // but legs are diverted before any card can claim them.
  const nearbyCandidates = input.tripStarted ? input.nearbyActivities : [];
  let nearbyActivity: T | null = null;
  for (const activity of nearbyCandidates) {
    if (takeLeg(activity)) continue;
    if (!nearbyActivity) nearbyActivity = activity;
  }
  let upNextActivity: T | null = null;
  if (input.upNextActivity && !takeLeg(input.upNextActivity)) {
    // Same non-transport activity as Nearby must not also be Up Next.
    if (!nearbyActivity || dedupKey(input.upNextActivity) !== dedupKey(nearbyActivity)) {
      upNextActivity = input.upNextActivity;
    }
  }
  // When the trip has not started, the page's old fallback showed
  // Up Next inside the Nearby card; that card is fed by the caller
  // from upNextActivity here, so a pre-trip leg still lands in the
  // travel slot, never in the Nearby card.
  if (!input.tripStarted && input.upNextActivity && isTransportLeg(input.upNextActivity)) {
    takeLeg(input.upNextActivity);
    upNextActivity = null;
  }

  const currentDayActivities = input.currentDayActivities.filter((activity) => !takeLeg(activity));
  // A leg that only lived in the timeline still reaches the travel slot.
  // (takeLeg above already collected it; the filter removed its row.)

  return { nearbyActivity, upNextActivity, currentDayActivities, travelLegs };
}
