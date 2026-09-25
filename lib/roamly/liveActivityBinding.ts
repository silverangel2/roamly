import type { RoamlyActivitySeed, RoamlyItinerary } from "@/lib/itinerary";

export type BindableActivity = {
  id: string;
  day_number: number;
  time_label: string | null;
  title: string;
  description: string | null;
  location_name: string | null;
  estimated_cost: number | null;
  category: string | null;
  map_query: string | null;
  created_at?: string | null;
};

function normalizeBindingText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function hasBindingTitle(title: string | null | undefined) {
  const text = normalizeBindingText(title);
  return Boolean(text && text !== "unresolved place");
}

function bindingKey(title: string | null | undefined, timeLabel: string | null | undefined) {
  return `${normalizeBindingText(timeLabel)}|${normalizeBindingText(title)}`;
}

function dayTimeline(itinerary: RoamlyItinerary | null | undefined, dayNumber: number) {
  return itinerary?.daily_itinerary.find((day) => day.day_number === dayNumber)?.live_timeline || [];
}

function timelineRankByDay(itinerary: RoamlyItinerary | null | undefined) {
  const ranks = new Map<number, Map<string, number>>();
  for (const day of itinerary?.daily_itinerary || []) {
    const byKey = new Map<string, number>();
    day.live_timeline.forEach((item, index) => {
      if (!hasBindingTitle(item.title)) return;
      const key = bindingKey(item.title, item.time_label);
      if (!byKey.has(key)) byKey.set(key, index);
    });
    ranks.set(day.day_number, byKey);
  }
  return ranks;
}

function takeTimelineIndex(items: RoamlyActivitySeed[], activity: BindableActivity, used: Set<number>) {
  if (!hasBindingTitle(activity.title)) return -1;
  const exactKey = bindingKey(activity.title, activity.time_label);
  const title = normalizeBindingText(activity.title);
  const exact: number[] = [];
  const titleOnly: number[] = [];
  items.forEach((item, index) => {
    if (used.has(index) || !hasBindingTitle(item.title)) return;
    const itemTitle = normalizeBindingText(item.title);
    if (bindingKey(item.title, item.time_label) === exactKey) exact.push(index);
    else if (itemTitle === title) titleOnly.push(index);
  });
  if (exact.length) return exact[0];
  if (titleOnly.length === 1) return titleOnly[0];
  return -1;
}

function localizedTimelineItem(baseItems: RoamlyActivitySeed[], localizedItems: RoamlyActivitySeed[], index: number) {
  const baseItem = baseItems[index];
  if (!baseItem) return null;
  if (baseItems === localizedItems) return baseItem;
  const baseId = baseItem.item_id?.trim();
  if (baseId) {
    const matches = localizedItems.filter((item) => item.item_id?.trim() === baseId);
    return matches.length === 1 ? matches[0] : null;
  }
  if (baseItems.length !== localizedItems.length) return null;
  return localizedItems[index] || null;
}

/**
 * Batch inserts share created_at, so day_number + created_at is not a stable
 * timeline order. Rank matched rows by itinerary identity, then created_at, then id.
 */
export function orderActivitiesByItinerary<T extends BindableActivity>(
  activities: T[],
  itinerary: RoamlyItinerary | null | undefined
): T[] {
  const ranks = timelineRankByDay(itinerary);
  return [...activities].sort((a, b) => {
    if (a.day_number !== b.day_number) return a.day_number - b.day_number;
    const aRank = hasBindingTitle(a.title) ? ranks.get(a.day_number)?.get(bindingKey(a.title, a.time_label)) : undefined;
    const bRank = hasBindingTitle(b.title) ? ranks.get(b.day_number)?.get(bindingKey(b.title, b.time_label)) : undefined;
    if (aRank != null && bRank != null && aRank !== bRank) return aRank - bRank;
    if (aRank != null && bRank == null) return -1;
    if (aRank == null && bRank != null) return 1;
    const created = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    if (created) return created;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Copy localized timeline text onto the activity row that owns that stop.
 * Never pair live_timeline[index] with activities[index]: row order can
 * diverge from the timeline and would move titles off their ids and statuses.
 */
export function localizeActivityRecords<T extends BindableActivity>(
  activities: T[],
  localized: RoamlyItinerary | null | undefined,
  base?: RoamlyItinerary | null
): T[] {
  if (!localized) return activities;
  const source = base || localized;
  const usedByDay = new Map<number, Set<number>>();
  return activities.map((activity) => {
    const used = usedByDay.get(activity.day_number) || new Set<number>();
    usedByDay.set(activity.day_number, used);
    const baseItems = dayTimeline(source, activity.day_number);
    const localizedItems = dayTimeline(localized, activity.day_number);
    const index = takeTimelineIndex(baseItems, activity, used);
    if (index < 0) return activity;
    used.add(index);
    const overlay = localizedTimelineItem(baseItems, localizedItems, index);
    if (!overlay) return activity;
    return {
      ...activity,
      title: overlay.title || activity.title,
      description: overlay.description || activity.description,
      location_name: overlay.location_name || activity.location_name,
      estimated_cost: overlay.estimated_cost ?? activity.estimated_cost,
      category: overlay.category || activity.category,
      map_query: overlay.map_query || activity.map_query
    };
  });
}
