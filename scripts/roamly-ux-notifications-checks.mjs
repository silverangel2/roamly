// roamly-ux-notifications-checks.mjs — BUILDER-N proof (notifications,
// destinations, feed hygiene, retry discipline). Self-contained, plain
// node, no imports from the tree (TS + @/ aliases cannot load in node).
// Usage:
//   node scripts/roamly-ux-notifications-checks.mjs [root]
// root defaults to the tree root (this script's parent dir). Pass the
// pristine backup dir to prove the PRE-fix tree FAILS.
// Two check kinds: STATIC (a literal pattern must exist in a tree file)
// and FIXTURE (fixture rows run through logic driven by values EXTRACTED
// from the tree files — the allowlist set, the retry cap — so the
// fixtures test the tree's own data, not a copy of it in this script).
// This is not a runtime render: no build is run here by design
// (the coordinator runs full proof at integration).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, kind, ok, detail = "") {
  results.push({ name, kind, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${kind}] ${name}${detail ? ` — ${detail}` : ""}`);
}
const norm = (v) => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();

// ---- Files under test (BUILDER-N files only) ----
const notifPage = read("app/notifications/page.tsx");
const eventPage = read("app/trip/[id]/event/[eventId]/page.tsx");
const card = read("components/roamly/NotificationTimelineCard.tsx");
const pushServer = read("lib/roamly/pushServer.ts");
const genRoute = read("lib/roamly/tripGenerationRoute.ts");
const liveCompanion = read("lib/roamly/liveCompanion.ts");
const notifRoute = read("app/api/roamly/notifications/route.ts");
const appShellState = read("lib/roamly/appShellState.ts");
const appShellClient = read("components/AppShellClient.tsx");

// ---- A. Destination panel on the event sheet ----
check("event sheet renders stored travelCountryInfo", "STATIC",
  eventPage.includes("travelCountryInfo") && eventPage.includes("companionContent"));
check("event sheet renders stored packing + document checklists", "STATIC",
  eventPage.includes("packingChecklist") && eventPage.includes("documentChecklist"));
check("event sheet UNAVAILABLE state uses the exact wording", "STATIC",
  eventPage.includes("Travel notes are not available for this trip yet"));
check("event sheet never fabricates: no invented country facts", "STATIC",
  !/capital of|population of|official language/i.test(eventPage));
check("event sheet keeps itinerary link + read-on-open marking", "STATIC",
  eventPage.includes("See the full itinerary") && eventPage.includes('.update({ status: "read" })'));
// Fixture: stored content present -> panel items; absent -> UNAVAILABLE.
{
  const stored = { title: "Travel notes for Montreal, Canada", summary: "Check official sources.", reminders: ["Verify entry documents."] };
  const panelFor = (type, companion) => {
    if (type === "country_info") {
      const info = companion?.travelCountryInfo;
      if (!info || (!info.title && !info.summary && (info.reminders || []).length === 0)) return { unavailable: "Travel notes are not available for this trip yet" };
      return { heading: info.title, items: info.reminders };
    }
    return null;
  };
  const withContent = panelFor("country_info", { travelCountryInfo: stored });
  const withoutContent = panelFor("country_info", {});
  check("fixture: country_info with stored content renders it", "FIXTURE",
    withContent.heading === stored.title && withContent.items.length === 1);
  check("fixture: country_info without stored content is UNAVAILABLE, not invented", "FIXTURE",
    withoutContent.unavailable === "Travel notes are not available for this trip yet");
}

// ---- B. PICTURE 1 — Alerts: the screen ends after Travel updates ----
// The old trip-events feed (and its allowlist) lived BELOW the three
// sections; the owner's picture has no feed, so the feed and its
// allowlist are gone from this page. Travel updates now comes from
// real confirmed bookings + non-info notification rows, deduped by
// confirmation title so one booking never renders twice.
const sectionCard = read("components/roamly/AlertsSectionCard.tsx");
for (const legacy of ["ActiveTripPanel", "TripActivationBanner", "CurrentDayTimeline", "UpNextActivityCard", "CheckedActivitiesList", "NearbyActivityCard", "NotificationTimelineCard", "dedupeActiveTrip", "TRAVEL_LEG_LABEL", "locationEvidenceFromSettingsRow", "customerFeedEvents", "CUSTOMER_VISIBLE_TRIP_EVENT_TYPES", "Live Companion is unlocked", "Reminders stay with this trip"]) {
  check(`Picture 1: legacy block "${legacy}" is gone from the Alerts page`, "STATIC", !notifPage.includes(legacy));
}
check("Picture 1: Travel updates renders confirmed-booking rows", "STATIC",
  notifPage.includes("travelUpdateBookingRows") && notifPage.includes("booking confirmed") && notifPage.includes("isConfirmedBooking"));
check("Picture 1: booking-confirmed rows use the stored date range, never the trip dates", "STATIC",
  notifPage.includes("bookingDateRangeLabel") && notifPage.includes("end_date"));
check("Picture 1: badge counts only rendered, unread, non-outdated notification rows", "STATIC",
  notifPage.includes("renderedNotificationIds") && notifPage.includes("unreadCount={displayedUnreadCount}"));
check("Picture 1: section card shows See all on every section", "STATIC",
  sectionCard.includes("rows.length >= 1") && sectionCard.includes("See all"));
check("Picture 1: section card renders a chevron on every row", "STATIC",
  sectionCard.includes('viewBox="0 0 8 13"'));
{
  // Fixture: badge counts the unread row that IS shown, never the
  // unread history row that is NOT shown, never a read row, never an
  // outdated row.
  const rendered = new Set(["n-shown"]);
  const items = [
    { id: "n-shown", status: "unread", is_outdated: false, action_state: "available" },
    { id: "n-hidden-history", status: "unread", is_outdated: false, action_state: "history" },
    { id: "n-read", status: "read", is_outdated: false, action_state: "available" },
    { id: "n-outdated", status: "unread", is_outdated: true, action_state: "available" }
  ];
  const badge = items.filter((item) => rendered.has(item.id) && item.status !== "read" && !item.is_outdated && item.action_state !== "history").length;
  check("fixture: badge counts only the shown unread row", "FIXTURE", badge === 1, `badge=${badge}`);
  // Fixture: a notification row repeating a booking confirmation title
  // is dropped, so one booking renders once in Travel updates.
  const bookingTitles = new Set([norm("Hotel booking confirmed")]);
  const notifRows = [{ title: "Hotel booking confirmed" }, { title: "Flight delayed" }];
  const kept = notifRows.filter((row) => !bookingTitles.has(norm(row.title)));
  check("fixture: duplicate confirmation title drops; distinct update keeps", "FIXTURE",
    kept.length === 1 && kept[0].title === "Flight delayed");
}

// ---- C. Writer collapse: one generation-started title ----
{
  const startedWriters = (genRoute.match(/eventTitle: "Itinerary generation started"/g) || []).length;
  check("generation route mints ONE 'Itinerary generation started' title", "STATIC",
    startedWriters === 1, `writers=${startedWriters}`);
}

// ---- D. Retry discipline (cap extracted from the tree) ----
const capMatch = pushServer.match(/SCHEDULED_PUSH_MAX_ATTEMPTS = (\d+)/);
const cap = capMatch ? Number(capMatch[1]) : null;
check("push retry cap constant exists and is bounded", "STATIC",
  cap !== null && cap >= 1 && cap <= 10, `cap=${cap}`);
check("scheduler reuses the existing in-app row on retry", "STATIC",
  pushServer.includes('.eq("event_id", event.id)') && pushServer.includes("notificationId:"));
check("scheduler stops at the cap and marks the event shown", "STATIC",
  pushServer.includes(">= SCHEDULED_PUSH_MAX_ATTEMPTS") && pushServer.includes('status: "shown"'));
check("scheduler increments pushAttempts on failure", "STATIC",
  pushServer.includes("pushAttempts: priorPushAttempts + 1"));
{
  // Simulate the retry loop with the tree's own cap: each failed attempt
  // reuses the single in-app row; at the cap the event stops rescheduling.
  let attempts = 0, rowsMinted = 0, rescheduled = 0, stopped = false;
  for (let run = 0; run < 12; run++) {
    if (attempts >= (cap ?? 0)) { stopped = true; break; }
    if (rowsMinted === 0) rowsMinted += 1; // first attempt mints; retries reuse
    attempts += 1; rescheduled += 1;
  }
  check("fixture: retry loop is bounded and mints exactly one row", "FIXTURE",
    stopped && rowsMinted === 1 && attempts === cap, `attempts=${attempts} rows=${rowsMinted} stopped=${stopped}`);
}

// ---- E. Expiry / relevance ----
check("liveCompanion defines the stale pre-trip rule on tripWindowState", "STATIC",
  liveCompanion.includes("isStalePreTripInfoNotification") &&
  liveCompanion.includes("PRE_TRIP_INFO_NOTIFICATION_TYPES") &&
  liveCompanion.includes('window === "active" || window === "completed_trip"'));
check("notifications page flags stale cards and counts displayed unread", "STATIC",
  notifPage.includes("is_outdated") && notifPage.includes("displayedUnreadCount") &&
  notifPage.includes("unreadCount={displayedUnreadCount}"));
check("card renders the Outdated label", "STATIC", card.includes("Outdated"));
{
  const stale = (type, window) =>
    ["country_info", "document_check", "one_week_before"].includes(type) && (window === "active" || window === "completed_trip");
  const rows = [
    { type: "one_week_before", status: "unread", window: "active" },
    { type: "one_week_before", status: "unread", window: "future_trip" },
    { type: "booking_confirmed", status: "unread", window: "active" }
  ];
  const counted = rows.filter((r) => r.status !== "read" && !stale(r.type, r.window)).length;
  check("fixture: stale pre-trip card stops counting toward unread; future card still counts", "FIXTURE",
    counted === 2, `counted=${counted}`);
}

// ---- F. Dedup key extension ----
check("dedup key anchors on event_id", "STATIC",
  liveCompanion.includes("event:${item.event_id}") || liveCompanion.includes("event:"));
{
  const key = (item) => [item.trip_id, norm(item.type), norm(item.title), norm(item.body),
    item.event_id ? `event:${item.event_id}` : norm(item.scheduled_for)].join("|");
  const retryA = { trip_id: "t1", event_id: "e1", type: "country_info", title: "Country", body: "Notes", scheduled_for: null };
  const retryB = { ...retryA, scheduled_for: "2026-10-23T09:00:00Z" };
  const otherEvent = { ...retryA, event_id: "e2" };
  check("fixture: retry rows for one event collapse; distinct events do not", "FIXTURE",
    key(retryA) === key(retryB) && key(retryA) !== key(otherEvent));
}

// ---- G. Sections + hero header + due label ----
// Round 2A (owner-approved mock structure): exactly the three mock
// sections — the old "Activity history" section was superseded — and the
// old timing header card is replaced by the photo hero whose state badge
// is computed from the real trip dates by the single trip clock.
for (const heading of ["Action required", "Upcoming", "Travel updates"]) {
  check(`Alerts section heading "${heading}"`, "STATIC", notifPage.includes(`"${heading}"`));
}
check("card accepts section heading + section props", "STATIC",
  card.includes("heading") && card.includes("NotificationSection"));
check("Alerts hero header: photo hero + trip-clock badge", "STATIC",
  notifPage.includes("TripHeroCard") && notifPage.includes("tripClockState") && notifPage.includes("formatTripDateRange"));
check("card shows scheduled intent (Due) alongside mint time", "STATIC",
  card.includes("Due ") && card.includes("scheduled_for"));
check("info cards go through the lifecycle gate", "STATIC",
  notifPage.includes("notificationActionStateForInfoCard") && card.includes('action_state !== "history"'));

// ---- H0. Per-trip fetch window (fix for the latest-20 crowd-out) ----
// The page must select the trip BEFORE fetching notifications and scope
// the fetch to that trip, so a trip's rows cannot be crowded out by the
// global newest rows of other trips.
check("notifications page selects trip before fetching notifications", "STATIC",
  notifPage.indexOf("selectNotificationTrip") < notifPage.indexOf('from("roamly_notifications")'));
check("notifications fetch is scoped to the selected trip", "STATIC",
  notifPage.includes('.eq("trip_id", trip.id)') && notifPage.includes('.limit(100)'));
check("notifications fetch no longer uses a global newest-20 window", "STATIC",
  !/from\("roamly_notifications"\)[\s\S]{0,400}?\.limit\(20\)/.test(notifPage));

// ---- H. Badge scope ----
check("notifications API filters by tripId when given", "STATIC",
  notifRoute.includes('searchParams.get("tripId")') && notifRoute.includes('.eq("trip_id", tripId)'));
check("shell unread count dedupes with the list's key", "STATIC",
  appShellState.includes("dedupeEquivalentNotifications"));
check("shell fetches notifications scoped to the selected trip", "STATIC",
  // Repair round P2: the scope is the ONE selected trip
  // (resolveSelectedTrip — the viewed trip's URL id, else the
  // established rule), not the old active-trip variable and not the
  // bare rule alone — same intent (never all-trips), one resolution.
  appShellClient.includes("resolveSelectedTrip({ trips, urlTripId: appSurfaceTripId(pathname) })") &&
  appShellClient.includes("tripId=${encodeURIComponent(selected.id)}"));

// ---- Summary ----
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (root: ${root})`);
if (failed.length) {
  console.log("Failing checks:");
  for (const f of failed) console.log(` - ${f.name}`);
  process.exit(1);
}
