// roamly-ux-conditional-checks.mjs — conditional-acceptance round
// proofs (owner conditionally approved the Roamly repair direction;
// production deployment remains on HOLD). Self-contained node +
// fixture imports from the tree's own modules (strip-types register
// handles TS + @/ aliases). No live network calls.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-conditional-checks.mjs [root]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIME_PROVENANCE_LABELS,
  isClockTime,
  provenanceForHomeRow,
  provenanceForPreTripRow
} from "@/lib/roamly/timeProvenance.ts";
import {
  ALERTS_BADGE_MEANING,
  alertsBadgeRendersOnAlertsScreen,
  countAlertsBadgeNotifications,
  isAlertsBadgeNotification
} from "@/lib/roamly/alertsBadge.ts";
import { selectNotificationTrip } from "@/lib/roamly/notificationTrip.ts";

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

// ---- Files under test ----
const liveClient = read("components/trip/LiveTripClient.tsx");
const homePanel = read("components/trip/ItineraryHomePanel.tsx");
const dayPlan = read("components/trip/ItineraryDayPlan.tsx");
const alertsPage = read("app/notifications/page.tsx");
const appShell = read("components/AppShellClient.tsx");
const directionsPanel = read("components/trip/DirectionsPanel.tsx");
const directionsScreen = read("components/trip/DirectionsScreen.tsx");
const safePhoto = read("components/roamly/SafePhotoImg.tsx");

// ================= ITEM 1 — live timing labels =================
check("item1-label-set-is-exactly-the-four-kinds", "UNIT",
  TIME_PROVENANCE_LABELS.planned === "Planned" &&
  TIME_PROVENANCE_LABELS.estimated === "Estimated" &&
  TIME_PROVENANCE_LABELS.live === "Live-updated" &&
  TIME_PROVENANCE_LABELS.confirmed === "Confirmed" &&
  Object.keys(TIME_PROVENANCE_LABELS).length === 4);
check("item1-pretrip-mapping-planned-vs-confirmed", "UNIT",
  provenanceForPreTripRow(true) === "planned" && provenanceForPreTripRow(false) === "confirmed");
check("item1-home-mapping-booked-planned-retimed", "UNIT",
  // Repair round: the old "live" default for a stored plan time was
  // the owner's defect. Stored plan time, unchanged → Planned;
  // retimed (recalculated) → Estimated; booking → Confirmed.
  provenanceForHomeRow({ planned: false, booked: true }) === "confirmed" &&
  provenanceForHomeRow({ planned: true, booked: false }) === "planned" &&
  provenanceForHomeRow({ planned: false, booked: false }) === "planned" &&
  provenanceForHomeRow({ planned: false, booked: false, retimed: true }) === "estimated" &&
  provenanceForHomeRow({ planned: false, booked: false, timeFromBooking: true }) === "confirmed");
check("item1-flexible-carries-no-label", "UNIT",
  isClockTime("Flexible") === false && isClockTime("") === false && isClockTime("8:00 AM") === true);
check("item1-banner-conflict-gone", "STATIC",
  !liveClient.includes("Times below are your planned times") &&
  liveClient.includes("Times below are estimates unless labeled otherwise") &&
  liveClient.includes("Live-updated only with a fresh location fix or check-in") &&
  liveClient.includes("Confirmed only for a verified booking"));
check("item1-live-pretrip-rows-label-every-time", "STATIC",
  liveClient.includes("TimeProvenanceLabel kind={provenanceForPreTripRow(row.planned)}") &&
  liveClient.includes('className="flex w-[88px] shrink-0 flex-col'));
check("item1-live-inprogress-rows-label-every-time", "STATIC",
  // Repair round: rows go through the evidence gate helper, not the
  // old unconditional call — featured + upcoming, two render sites.
  liveClient.includes("liveDayProvenanceFor(featuredActivity)") &&
  liveClient.includes("liveDayProvenanceFor(activity)") &&
  liveClient.includes("verifiedLiveEvidence"));
check("item1-home-rows-label-every-clock-time", "STATIC",
  homePanel.includes("TimeProvenanceLabel") &&
  homePanel.includes("provenanceForHomeRow(row)") &&
  homePanel.includes("isClockTime(row.time)"));
check("item1-day-cards-carry-the-same-discipline", "STATIC",
  // Repair round: day cards no longer label stored times
  // "Live-updated" — Confirmed (booking) / Estimated (retimed) /
  // Planned (stored plan time), and no unconditional live label.
  dayPlan.includes("Confirmed · booking time") &&
  dayPlan.includes(">Estimated<") &&
  dayPlan.includes(">Planned<") &&
  !dayPlan.includes(">Live-updated<"));
check("item1-no-bare-time-render-site-remains", "STATIC",
  // Every timed-row render site in Live + Home references a provenance
  // label: pre-trip map, featured, upcoming map, home panel map.
  liveClient.includes("provenanceForPreTripRow") &&
  liveClient.includes("provenanceForLiveDayRow") &&
  homePanel.includes("provenanceForHomeRow"));

// ================= ITEM 2 — unified badge semantics =================
const badgeBase = {
  trip_id: "trip-montreal", event_id: null, title: "T", body: null,
  created_at: "2026-10-26T10:00:00Z", scheduled_for: null, status: "unread"
};
const docUnread = { ...badgeBase, id: "n1", type: "document_check" };
const packUnread = { ...badgeBase, id: "n2", type: "packing_check" };
const packRead = { ...badgeBase, id: "n3", type: "packing_check", status: "read" };
const infoUnread = { ...badgeBase, id: "n4", type: "one_week_before" };
const updateUnread = { ...badgeBase, id: "n5", type: "booking_update" };
const historyUnread = { ...badgeBase, id: "n6", type: "booking_update", action_state: "history" };
const outdatedUnread = { ...badgeBase, id: "n7", type: "document_check", is_outdated: true };
const dupDoc = { ...badgeBase, id: "n8", type: "document_check" };
check("item2-meaning-is-one-definition", "UNIT",
  ALERTS_BADGE_MEANING === "Unread alerts shown on the Alerts screen for the selected trip");
check("item2-rendered-rule-action-and-travel-count-info-does-not", "UNIT",
  alertsBadgeRendersOnAlertsScreen("document_check") === true &&
  alertsBadgeRendersOnAlertsScreen("packing_check") === true &&
  alertsBadgeRendersOnAlertsScreen("booking_update") === true &&
  alertsBadgeRendersOnAlertsScreen("one_week_before") === false &&
  alertsBadgeRendersOnAlertsScreen("daily_briefing") === false);
check("item2-count-unread-rendered-only", "UNIT",
  countAlertsBadgeNotifications([docUnread, packUnread, packRead, infoUnread, updateUnread]) === 3);
check("item2-count-excludes-history-and-outdated", "UNIT",
  isAlertsBadgeNotification(historyUnread) === false &&
  isAlertsBadgeNotification(outdatedUnread) === false &&
  countAlertsBadgeNotifications([docUnread, historyUnread, outdatedUnread]) === 1);
check("item2-count-dedupes-equivalent-rows", "UNIT",
  countAlertsBadgeNotifications([docUnread, dupDoc]) === 1);
check("item2-count-zero-when-nothing-counts", "UNIT",
  countAlertsBadgeNotifications([packRead, infoUnread, historyUnread]) === 0);
check("item2-page-uses-the-shared-helper-and-bridge", "STATIC",
  alertsPage.includes("countAlertsBadgeNotifications(notificationItems, renderedNotificationIds)") &&
  alertsPage.includes("unreadCount={displayedUnreadCount}") &&
  alertsPage.includes("unread alerts for this trip"));
check("item2-page-info-set-is-the-shared-one", "STATIC",
  alertsPage.includes('from "@/lib/roamly/alertsNotificationTypes"') &&
  !alertsPage.includes("const INFO_NOTIFICATION_TYPES = new Set(["));
check("item2-shell-uses-same-trip-rule-and-helper", "STATIC",
  // Repair round P2: the shell resolves via the ONE resolution
  // (viewed trip's URL id, else the rule) — same helper family,
  // same badge counting, same trips endpoint.
  appShell.includes("resolveSelectedTrip({ trips, urlTripId: appSurfaceTripId(pathname) })") &&
  appShell.includes("countAlertsBadgeNotifications(annotated)") &&
  appShell.includes('fetch("/api/roamly/trips")'));
check("item2-shell-has-no-all-trips-fallback", "STATIC",
  !appShell.includes('fetch("/api/roamly/notifications")') &&
  appShell.includes("/api/roamly/notifications?tripId=") &&
  appShell.includes("all-trips fallback"));

// ================= ITEM 3 — selected-trip consistency =================
// Fixtures mirror the tester account on 2026-10-26: Montreal Oct 26–30
// (companion-unlocked, active window) and Toronto Nov 10–14 (gate trip,
// not unlocked, future window). "now" is pinned so the result is
// timezone-free.
const NOW3 = new Date("2026-10-26T15:00:00Z");
const montreal = {
  id: "trip-montreal", status: "active", start_date: "2026-10-26", end_date: "2026-10-30",
  tracking_unlocked: true, live_companion_unlocked: true, metadata: null
};
const torontoGate = {
  id: "trip-toronto", status: "planned", start_date: "2026-11-10", end_date: "2026-11-14",
  tracking_unlocked: false, live_companion_unlocked: false, metadata: null
};
check("item3-rule-picks-the-active-unlocked-trip", "UNIT",
  selectNotificationTrip([torontoGate, montreal], NOW3)?.id === "trip-montreal");
check("item3-rule-prefers-unlocked-pool-over-active-locked", "UNIT",
  selectNotificationTrip([
    { ...montreal, tracking_unlocked: false, live_companion_unlocked: false },
    { ...torontoGate, tracking_unlocked: true, live_companion_unlocked: true }
  ], NOW3)?.id === "trip-toronto");
check("item3-rule-two-active-unlocked-latest-start-wins", "UNIT",
  // Both windows are active on Oct 26 (started on/before today, ending
  // after); the later start wins. A trip starting Oct 27 would be
  // "future", not active, and would lose to the active trip.
  selectNotificationTrip([
    { ...montreal, id: "trip-early", start_date: "2026-10-20", end_date: "2026-10-30" },
    montreal
  ], NOW3)?.id === "trip-montreal");
check("item3-rule-excludes-cancelled-and-archived", "UNIT",
  selectNotificationTrip([
    { ...montreal, id: "trip-cancelled", status: "cancelled" },
    montreal
  ], NOW3)?.id === "trip-montreal");
check("item3-alerts-uses-the-rule-live-and-home-use-the-url", "STATIC",
  alertsPage.includes("selectNotificationTrip(") &&
  read("app/trip/[id]/live/page.tsx").includes("getTripBundle(supabase, current.user.id, id)") &&
  read("app/trip/[id]/page.tsx").includes("tripId"));

// ================= ITEM 5 — customer map guidance =================
check("item5-no-technical-map-unavailable-copy", "STATIC",
  !directionsPanel.includes("Duration and distance unavailable") &&
  !directionsPanel.includes("no routed walk time is available") &&
  !directionsPanel.includes("No additional directions are available for this stop yet."));
check("item5-summary-falls-back-to-customer-words", "STATIC",
  directionsPanel.includes('"Live routing opens in your maps app"'));
check("item5-estimate-note-is-customer-words-with-estimated-label", "STATIC",
  // Repair round P3: the estimate note no longer repeats the routing
  // sentence — estimates are marked on the values themselves with
  // "(est.)" (duration + distance), gated on fallbackEstimateUsed,
  // while the summary Route row stays the one routing explanation.
  directionsPanel.includes("fallbackEstimateUsed") &&
  directionsPanel.includes("(est.)") &&
  !directionsPanel.includes("live routing opens in your maps app below."));
check("item5-no-dead-show-all-button", "STATIC",
  !directionsPanel.includes("disabled={!hasMoreSteps") &&
  directionsPanel.includes("hasMoreSteps || showAll") &&
  directionsPanel.includes("All directions are shown above."));
check("item5-external-action-replaces-the-dead-control", "STATIC",
  // Repair round P3: the bottom duplicate Open in Maps link + its
  // repeated routing note are gone — the single primary Open in
  // Maps button above (with provider links) is the routed action,
  // and the summary Route row is the one routing explanation.
  directionsPanel.includes("Open in Maps") &&
  directionsPanel.includes("Google Maps") &&
  !directionsPanel.includes("tap Open in Maps above for turn-by-turn directions."));

// ================= ITEM 7 — SafePhotoImg strip behavior =================
check("item7-strip-renders-safephtoimg", "STATIC",
  directionsScreen.includes("SafePhotoImg") &&
  directionsScreen.includes("<SafePhotoImg") &&
  directionsScreen.includes('from "@/components/roamly/SafePhotoImg"'));
check("item7-old-inline-pattern-is-gone-from-the-strip", "STATIC",
  !directionsScreen.includes("if (failed) return null"));
check("item7-safephtoimg-failed-renders-null", "STATIC",
  safePhoto.includes('if (state === "failed") return null'));
check("item7-safephtoimg-error-and-load-handlers", "STATIC",
  safePhoto.includes('onError={() => setState("failed")}') &&
  safePhoto.includes('onLoad={() => setState("loaded")}'));
check("item7-safephtoimg-invisible-until-loaded", "STATIC",
  safePhoto.includes("invisible") &&
  safePhoto.includes('state === "loaded" ? "" : " invisible"'));
check("item7-safephtoimg-mount-check-for-settled-images", "STATIC",
  safePhoto.includes("img.complete") && safePhoto.includes("naturalWidth > 0"));

// ---- Summary ----
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name} — ${f.detail}`);
  process.exit(1);
}
