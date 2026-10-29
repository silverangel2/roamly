import { dedupeEquivalentNotifications } from "@/lib/roamly/liveCompanion";

export type ShellNotificationSummary = {
  status?: string | null;
  id?: string;
  trip_id?: string | null;
  event_id?: string | null;
  type?: string;
  title?: string;
  body?: string | null;
  created_at?: string;
  scheduled_for?: string | null;
};

export function shouldLoadShellState(authenticated: boolean, pathname: string) {
  return authenticated && pathname !== "/notifications";
}

/*
 * Legacy badge count (kept for the G-A22 unit check): unread rows
 * only, collapsed by the same logical key the Alerts list uses, so
 * retry-minted duplicates no longer inflate the badge. Rows that lack
 * the dedup fields fall back to the plain unread count rather than
 * being dropped. NOTE (conditional-acceptance item 2): this is NOT the
 * live tab-bar count anymore — the live count is
 * countAlertsBadgeNotifications in lib/roamly/alertsBadge.ts, which
 * additionally excludes history/outdated rows and notification types
 * that never render on the Alerts screen, scoped to the
 * selectNotificationTrip trip. Do not reintroduce this function as the
 * badge source: it counts rows the Alerts screen never shows.
 */
export function countUnreadNotifications(notifications: readonly ShellNotificationSummary[]) {
  const unread = notifications.filter((notification) => notification.status !== "read");
  const dedupable = unread.every(
    (notification) =>
      typeof notification.id === "string" &&
      Boolean(notification.trip_id) &&
      typeof notification.type === "string" &&
      typeof notification.title === "string" &&
      typeof notification.created_at === "string"
  );
  if (!dedupable) return unread.length;
  return dedupeEquivalentNotifications(
    unread.map((notification) => ({
      id: notification.id as string,
      trip_id: notification.trip_id as string,
      event_id: notification.event_id || null,
      type: notification.type as string,
      title: notification.title as string,
      body: notification.body || null,
      created_at: notification.created_at as string,
      scheduled_for: notification.scheduled_for || null
    }))
  ).length;
}
