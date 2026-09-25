import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { localizeActivityRecords, mergePersistedSkipStatuses, orderActivitiesByItinerary } from "../lib/roamly/liveActivityBinding.ts";
import {
  mergeLiveActivityStatuses,
  persistSkippedActivityIds,
  readPersistedSkippedActivityIds,
  selectNowAndNextActivity
} from "../lib/roamly/liveCompanion.ts";

const tiedCreatedAt = "2026-09-25T12:00:00.000Z";

function activity(overrides) {
  return {
    description: "",
    location_name: "Providence",
    estimated_cost: null,
    category: "activity",
    map_query: "Providence",
    created_at: tiedCreatedAt,
    ...overrides
  };
}

const hotel = activity({
  id: "hotel-id",
  day_number: 1,
  time_label: "12:00 PM",
  title: "Providence hotel search",
  description: "Search for a hotel",
  category: "hotel",
  status: "skipped"
});
const nightlife = activity({
  id: "night-id",
  day_number: 1,
  time_label: "8:00 PM",
  title: "Events festivals concerts nightlife",
  description: "Evening plans",
  status: "planned"
});

function timelineItem(title, timeLabel, extra = {}) {
  return {
    time_label: timeLabel,
    title,
    description: title,
    location_name: "Providence",
    estimated_cost: null,
    category: "activity",
    map_query: "Providence",
    ...extra
  };
}

const itinerary = {
  daily_itinerary: [
    {
      day_number: 1,
      live_timeline: [
        timelineItem("Providence hotel search", "12:00 PM", { description: "Search for a hotel", category: "hotel" }),
        timelineItem("Events festivals concerts nightlife", "8:00 PM", { description: "Evening plans" })
      ]
    }
  ]
};

const reversed = [nightlife, hotel];
const ordered = orderActivitiesByItinerary(reversed, itinerary);
assert.deepEqual(ordered.map((item) => item.id), ["hotel-id", "night-id"], "tied created_at still follows timeline identity");
assert.deepEqual(
  orderActivitiesByItinerary(reversed, null).map((item) => item.id),
  ["hotel-id", "night-id"],
  "without an itinerary, id is a stable tie-break"
);

const bound = localizeActivityRecords(reversed, itinerary, itinerary);
const boundHotel = bound.find((item) => item.id === "hotel-id");
const boundNight = bound.find((item) => item.id === "night-id");
assert.equal(boundHotel.title, "Providence hotel search");
assert.equal(boundHotel.status, "skipped");
assert.equal(boundHotel.time_label, "12:00 PM");
assert.equal(boundNight.title, "Events festivals concerts nightlife");
assert.equal(boundNight.status, "planned");

const selection = selectNowAndNextActivity({
  activities: bound.map((item) => ({
    id: item.id,
    title: item.title,
    timeLabel: item.time_label,
    dayNumber: item.day_number,
    status: item.status
  })),
  tripStartDate: "2026-09-25",
  timezone: "America/New_York",
  now: "2026-09-26T02:00:00.000Z"
});
assert.equal(selection.now?.id, "night-id");
assert.equal(selection.now?.title, "Events festivals concerts nightlife");
assert.notEqual(selection.now?.title, "Providence hotel search");

const staleAfterSkip = mergeLiveActivityStatuses(
  [
    { id: "hotel-id", status: "skipped" },
    { id: "food-id", status: "planned" }
  ],
  new Set(["food-id"])
);
assert.equal(staleAfterSkip.find((item) => item.id === "food-id").status, "skipped", "stale refreshed props cannot restore a skipped Now stop");
assert.equal(staleAfterSkip.find((item) => item.id === "hotel-id").status, "skipped");

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) ?? null,
  removeItem: (key) => storageValues.delete(key),
  setItem: (key, value) => storageValues.set(key, value)
};
const persisted = new Set(["food-id"]);
persistSkippedActivityIds("trip-id", persisted, storage);
const remountedSkippedIds = readPersistedSkippedActivityIds("trip-id", storage);
const remountedActivities = mergeLiveActivityStatuses(
  [
    { id: "food-id", title: "Providence attraction ticket", status: "planned", timeLabel: "3:15 PM" },
    { id: "restaurant-id", title: "Providence restaurants", status: "planned", timeLabel: "5:00 PM" }
  ],
  remountedSkippedIds
);
const remountedSelection = selectNowAndNextActivity({
  activities: remountedActivities,
  tripStartDate: "2026-09-25",
  timezone: "America/New_York",
  now: "2026-09-25T20:00:00.000Z"
});
assert.equal(remountedSelection.now?.id, "restaurant-id", "persisted skip survives stale planned props on remount");

const serverReconciledActivities = mergePersistedSkipStatuses(
  [
    { id: "display-food", day_number: 1, time_label: "3:15 PM", title: "Providence attraction ticket", status: "planned" },
    { id: "display-food-next", day_number: 1, time_label: "5:00 PM", title: "Providence restaurants", status: "planned" }
  ],
  [
    { day_number: 1, time_label: "3:15 PM", title: "Providence attraction ticket", status: "skipped" },
    { day_number: 1, time_label: "5:00 PM", title: "Providence restaurants", status: "planned" }
  ]
);
assert.equal(serverReconciledActivities[0].status, "skipped", "server tracking status must override stale display status after a full reload");
assert.equal(serverReconciledActivities[1].status, "planned", "server skip reconciliation must not alter other activities");

const duplicateServerSkips = mergePersistedSkipStatuses(
  [
    { id: "day-one-stop", day_number: 1, time_label: "3:15 PM", title: "City museum", status: "planned" },
    { id: "day-two-stop", day_number: 2, time_label: "3:15 PM", title: "City museum", status: "planned" }
  ],
  [{ day_number: 2, time_label: "3:15 PM", title: "City museum", status: "skipped" }]
);
assert.equal(duplicateServerSkips[0].status, "planned", "a skipped title on another day must not alter this stop");
assert.equal(duplicateServerSkips[1].status, "skipped", "the exact day/time identity receives the persisted skip");

const ambiguousServerSkip = mergePersistedSkipStatuses(
  [
    { id: "museum-day-one", day_number: 1, time_label: null, title: "City museum", status: "planned" },
    { id: "museum-day-two", day_number: 2, time_label: null, title: "City museum", status: "planned" }
  ],
  [{ day_number: null, time_label: null, title: "City museum", status: "skipped" }]
);
assert.deepEqual(ambiguousServerSkip.map((activity) => activity.status), ["planned", "planned"], "ambiguous legacy identity must not skip duplicate display stops");

const baseItineraryForServerSkip = {
  daily_itinerary: [{
    day_number: 1,
    live_timeline: [{ title: "City museum", time_label: "3:15 PM", description: "Visit the museum" }]
  }]
};
const translatedItineraryForServerSkip = {
  daily_itinerary: [{
    day_number: 1,
    live_timeline: [{ title: "Musée de la ville", time_label: "3:15 PM", description: "Visitez le musée" }]
  }]
};
const translatedServerSkip = localizeActivityRecords(
  mergePersistedSkipStatuses(
    [{ id: "display-museum", day_number: 1, time_label: "3:15 PM", title: "City museum", status: "planned" }],
    [{ day_number: 1, time_label: "3:15 PM", title: "City museum", status: "skipped" }]
  ),
  translatedItineraryForServerSkip,
  baseItineraryForServerSkip
);
assert.equal(translatedServerSkip[0].title, "Musée de la ville");
assert.equal(translatedServerSkip[0].status, "skipped", "server status reconciliation must survive customer-language localization");

const translated = {
  daily_itinerary: [
    {
      day_number: 1,
      live_timeline: [
        timelineItem("Vie nocturne", "20:00", { item_id: "item-night", description: "Soiree traduite" }),
        timelineItem("Recherche d'hotel", "12:00", { item_id: "item-hotel", description: "Hotel traduit" })
      ]
    }
  ]
};
const base = {
  daily_itinerary: [
    {
      day_number: 1,
      live_timeline: [
        timelineItem("Providence hotel search", "12:00 PM", { item_id: "item-hotel" }),
        timelineItem("Events festivals concerts nightlife", "8:00 PM", { item_id: "item-night" })
      ]
    }
  ]
};
const localized = localizeActivityRecords(reversed, translated, base);
assert.equal(localized.find((item) => item.id === "hotel-id").title, "Recherche d'hotel");
assert.equal(localized.find((item) => item.id === "hotel-id").status, "skipped");
assert.equal(localized.find((item) => item.id === "night-id").title, "Vie nocturne");

const shifted = localizeActivityRecords(
  [activity({ id: "extra-id", day_number: 1, time_label: "9:00 AM", title: "Breakfast walk", status: "planned" }), hotel],
  itinerary,
  itinerary
);
assert.equal(shifted.find((item) => item.id === "extra-id").title, "Breakfast walk", "an unmatched row must not inherit the timeline item at its index");
assert.equal(shifted.find((item) => item.id === "hotel-id").title, "Providence hotel search");

const duplicateLunch = {
  daily_itinerary: [
    {
      day_number: 1,
      live_timeline: [
        timelineItem("Lunch", "12:00 PM", { description: "First lunch" }),
        timelineItem("Lunch", "1:00 PM", { description: "Second lunch" })
      ]
    }
  ]
};
const ambiguous = localizeActivityRecords(
  [activity({ id: "flex-lunch", day_number: 1, time_label: "Flexible", title: "Lunch", description: "Keep mine", status: "planned" })],
  duplicateLunch,
  duplicateLunch
);
assert.equal(ambiguous[0].title, "Lunch");
assert.equal(ambiguous[0].description, "Keep mine");

const page = await readFile(new URL("../app/trip/[id]/live/page.tsx", import.meta.url), "utf8");
const trips = await readFile(new URL("../lib/trips.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../components/trip/LiveTripClient.tsx", import.meta.url), "utf8");
assert.doesNotMatch(page, /seenByDay/);
assert.match(page, /mergePersistedSkipStatuses\(\s*bundle\.data\.activities,/);
assert.match(page, /localizeActivityRecords\(\s*activitiesWithServerSkips,/);
assert.match(trips, /order\("day_number"\)\.order\("created_at"\)\.order\("id"\)/);
assert.match(trips, /orderActivitiesByItinerary\(/);
const runAction = client.slice(client.indexOf("const runAction = useCallback"), client.indexOf("const notificationActionHandledRef"));
assert.match(runAction, /item\.id === activityId \? \{ \.\.\.item, status: nextStatus \} : item/);
assert.match(runAction, /action === "skip"\) \{/);
assert.match(runAction, /locallySkippedActivityIdsRef\.current\.add\(activityId\)/);
assert.match(runAction, /persistSkippedActivityIds\(tripId, locallySkippedActivityIdsRef\.current\)/);
assert.doesNotMatch(runAction, /item\.title === updatedTitle/);
assert.match(client, /mergeLiveActivityStatuses\(activities, locallySkippedActivityIdsRef\.current\)/);
assert.match(client, /readPersistedSkippedActivityIds\(tripId\)/);
assert.match(client, /persistSkippedActivityIds\(tripId, locallySkippedActivityIdsRef\.current\)/);
assert.match(runAction, /setNotice\(updatedTitle \? `\$\{confirmation\} \$\{updatedTitle\}` : confirmation\)/);
assert.match(client, /onClick=\{\(\) => void runAction\(currentActivity\.id, "complete"\)\}/);
assert.match(client, /onClick=\{\(\) => void runAction\(currentActivity\.id, "skip"\)\}/);

console.log("Live skip identity checks passed");
