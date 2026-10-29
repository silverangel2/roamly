/**
 * ONE tab-bar Alerts badge semantics (conditional-acceptance round,
 * item 2) — shared by the Alerts page and the app shell, so no screen
 * can show a badge number whose meaning differs from another's.
 *
 * MEANING: the number of unread alerts shown on the Alerts screen
 * for the selected trip (the selectNotificationTrip trip).
 *
 * A notification counts if and only if ALL of these hold:
 * - it renders on the Alerts screen: Action required carries
 *   document_check + packing_check; Travel updates carries every
 *   non-info type. Other info types render nowhere on Alerts (the
 *   Upcoming section is events + bookings, not notification cards),
 *   so they never count — even unread.
 * - status !== "read" (unread only);
 * - action_state !== "history" (terminal-trip cards are history);
 * - is_outdated !== true (stale pre-trip cards stop counting).
 * Duplicates collapse by the same logical key the Alerts list uses.
 *
 * The weather row is not a notification and never counts. Booking
 * and itinerary-event rows are not notifications and never count.
 *
 * Scope: the shell resolves the SAME selected trip as the Alerts page
 * (selectNotificationTrip over the user's trip list, via
 * /api/roamly/trips) — never the old all-trips fallback. When no
 * selected trip can be resolved, the honest count is 0 and the badge
 * hides; a stale number is never shown.
 *
 * Pure functions only (liveCompanion is import-free); the shell
 * computes action_state/is_outdated from the selected trip's lifecycle
 * before calling, the Alerts page passes its already-computed rows.
 */

import {
  dedupeEquivalentNotifications,
  type CustomerNotificationItem
} from "@/lib/roamly/liveCompanion";
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";

export const ALERTS_BADGE_MEANING =
  "Unread alerts shown on the Alerts screen for the selected trip";

export type AlertsBadgeNotification = {
  id?: string;
  trip_id?: string | null;
  event_id?: string | null;
  type?: string;
  title?: string;
  body?: string | null;
  status?: string | null;
  created_at?: string;
  scheduled_for?: string | null;
  /** Precomputed by the caller (page rows carry it; the shell derives it). */
  action_state?: string;
  /** Precomputed by the caller (page rows carry it; the shell derives it). */
  is_outdated?: boolean;
};

/** True when this notification type renders as a row on Alerts. */
export function alertsBadgeRendersOnAlertsScreen(type: string | undefined): boolean {
  if (!type) return false;
  return type === "document_check" || type === "packing_check" || !INFO_NOTIFICATION_TYPES.has(type);
}

export function isAlertsBadgeNotification(
  notification: AlertsBadgeNotification,
  renderedIds?: ReadonlySet<string>
): boolean {
  if (renderedIds && typeof notification.id === "string" && !renderedIds.has(notification.id)) return false;
  if (!alertsBadgeRendersOnAlertsScreen(notification.type)) return false;
  if (notification.status === "read") return false;
  if (notification.action_state === "history") return false;
  if (notification.is_outdated === true) return false;
  return true;
}

export function countAlertsBadgeNotifications(
  notifications: readonly AlertsBadgeNotification[],
  renderedIds?: ReadonlySet<string>
): number {
  const counted = notifications.filter((notification) => isAlertsBadgeNotification(notification, renderedIds));
  const dedupable = counted.every(
    (notification) =>
      typeof notification.id === "string" &&
      Boolean(notification.trip_id) &&
      typeof notification.type === "string" &&
      typeof notification.title === "string" &&
      typeof notification.created_at === "string"
  );
  if (!dedupable) return counted.length;
  return dedupeEquivalentNotifications(
    counted.map((notification) => ({
      id: notification.id as string,
      trip_id: notification.trip_id as string,
      event_id: notification.event_id || null,
      type: notification.type as string,
      title: notification.title as string,
      body: notification.body || null,
      created_at: notification.created_at as string,
      scheduled_for: notification.scheduled_for || null
    })) as CustomerNotificationItem[]
  ).length;
}
