/*
 * Build 2 Live Companion — push dispatch for the panel (DESIGN-
 * PRODUCTION.md Phase 7 proof: "push round-trip captured on the
 * daily-test account via the per-recipient capture override").
 *
 * This module builds the OS push from the panel's OWN push view
 * model (so the notification the traveler receives is the same
 * object the panel renders — one headline, one practical line) and
 * dispatches it through the EXISTING push stack
 * (lib/roamly/pushServer.ts): createInAppNotification +
 * sendPushNotification. The PR #57 email discipline lives in that
 * stack and is reused, never forked: the panel path sends NO email
 * at all (sendEmail is never enabled here), so the per-event cap of
 * 3 and the same-trip collapse — which govern the scheduled
 * dispatcher's email lane — cannot be bypassed or duplicated by the
 * panel. Email remains exclusively the scheduled dispatcher's job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompactPushView } from "./companionPanel";
import {
  createInAppNotification,
  sendPushNotification,
  type NotificationPayload
} from "./pushServer";

function activityActionUrl(tripId: string, activityId: string, action: "check-in" | "skip"): string {
  const route = action === "check-in" ? "/api/roamly/activities/check-in" : "/api/roamly/activities/skip";
  const url = new URL(route, "https://roamly.invalid");
  url.searchParams.set("tripId", tripId);
  url.searchParams.set("activityId", activityId);
  return `${url.pathname}${url.search}`;
}

export function buildPanelPushPayload(
  push: CompactPushView,
  opts: { tripId: string }
): NotificationPayload {
  const activityId = push.itemId;
  return {
    title: push.headline,
    body: push.practicalLine,
    type: "next_activity",
    tripId: opts.tripId,
    activityId,
    tag: activityId ? `roamly-panel-${opts.tripId}-${activityId}` : `roamly-panel-${opts.tripId}`,
    actionUrl: activityId
      ? `/trip/${opts.tripId}/live?activity=${encodeURIComponent(activityId)}`
      : `/trip/${opts.tripId}/live`,
    checkInUrl: activityId ? activityActionUrl(opts.tripId, activityId, "check-in") : null,
    skipUrl: activityId ? activityActionUrl(opts.tripId, activityId, "skip") : null
  };
}

export async function dispatchPanelPush(
  supabase: SupabaseClient,
  params: { userId: string; tripId: string; push: CompactPushView }
): Promise<{ notificationId: string | null; payload: NotificationPayload }> {
  const payload = buildPanelPushPayload(params.push, { tripId: params.tripId });
  const notification = await createInAppNotification(supabase, {
    userId: params.userId,
    tripId: params.tripId,
    type: payload.type || "next_activity",
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl,
    metadata: { activityId: payload.activityId || null, source: "companion-panel-v2" }
  });
  const notificationId = notification.data?.id ?? null;
  await sendPushNotification(supabase, params.userId, payload, {
    notificationId,
    createNotification: false,
    sendEmail: false
  });
  return { notificationId, payload };
}
