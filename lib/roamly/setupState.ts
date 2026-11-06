import type { SupabaseClient, User } from "@supabase/supabase-js";
import { readGmailGateView } from "@/lib/roamly/gateService";
import { gmailSyncFailureNeedsReconnect, isGmailSyncPersistentlyFailing } from "@/lib/roamly/emailSyncHealth";
import { readPushSubscriptionStatus } from "@/lib/roamly/liveStatus";

/*
 * Roamly setup state — the cascade behind "everything works"
 * (owner design, 2026-10-23): three steps, each powering one flagship
 * feature, completed ONCE per account and remembered forever.
 *
 *   1. Gmail connected   -> Booking Recon (booking emails matched to the trip)
 *   2. App installed     -> Roamly can reach you in the moment (push)
 *   3. Location granted  -> Companion goes live
 *
 * The gate keys on this persisted state, never on a trip: a step counts
 * as done once it has been verified complete at least once (the
 * "once" flags below). Current on/off state (Gmail disconnected later,
 * location switched off) is reported separately and surfaces as a quiet
 * state line — it never re-opens the gate. Location has two layers by
 * design: the GRANT (recorded in roamly_location_settings
 * .last_permission_state) and the current ON/OFF switch
 * (location_tracking_enabled).
 *
 * Alerts (2026-10-31, L9): step 2's promise — "Roamly can reach you" —
 * is a push SUBSCRIPTION fact, not an install fact. This state carries
 * it as a read-back from roamly_push_subscriptions (via
 * lib/roamly/liveStatus.ts): notificationsSubscribed is the current
 * truth, alertsOnce the remembered completion. Install state never
 * feeds either field.
 */

export interface RoamlySetupMemory {
  gmail?: boolean;
  app?: boolean;
  location?: boolean;
  /** Alerts verified once by server read-back (a subscription row
   *  existed for this account — see the "alerts" completion step).
   *  Install alone never sets this: L9 (2026-10-31). */
  alerts?: boolean;
}

export interface RoamlySetupState {
  /** Gmail is connected right now (reconciliation is being fed). */
  gmailConnected: boolean;
  /** Last successful Gmail sync, when connected. Drives the stale-sync
      trip line only — a stale date never flips gmailConnected itself. */
  gmailLastSyncedAt: string | null;
  /** Autosync, display only: the Gmail sync is persistently failing
      (row in "error" + last success over 24h old). Never flips
      gmailConnected and never gates anything — it only decides which
      words the trip/account surfaces show next to "connected". */
  gmailSyncFailing: boolean;
  /** Autosync, display only: the persistent failure is a refresh/auth
      failure, so the honest advice is reconnecting, not retrying. */
  gmailSyncFailureReconnect: boolean;
  gmailEmail: string | null;
  /** Step 1 completed at least once. */
  gmailOnce: boolean;
  /** Step 2 completed at least once (recorded from a real standalone detection). */
  appInstalledOnce: boolean;
  /** The location grant is currently recorded as granted. */
  locationGranted: boolean;
  /** Step 3 completed at least once. */
  locationOnce: boolean;
  /** The persisted location on/off switch. */
  locationEnabled: boolean;
  /** Alerts completed at least once, on read-back evidence only. */
  alertsOnce: boolean;
  /** READ BACK from roamly_push_subscriptions right now (enabled row
   *  for this account) — never inferred from install state. */
  notificationsSubscribed: boolean;
  /** The server's reason when not subscribed; null when subscribed. */
  notificationsReason: string | null;
  /** All three steps completed at least once — no gate ever renders. */
  complete: boolean;
}

export function setupMemoryFromUser(user: User | null | undefined): RoamlySetupMemory {
  const raw = (user?.user_metadata as Record<string, unknown> | undefined)?.roamly_setup;
  if (!raw || typeof raw !== "object") return {};
  const mem = raw as Record<string, unknown>;
  return {
    gmail: mem.gmail === true,
    app: mem.app === true,
    location: mem.location === true,
    alerts: mem.alerts === true
  };
}

export async function getRoamlySetupState(
  supabase: SupabaseClient,
  user: User
): Promise<RoamlySetupState> {
  const memory = setupMemoryFromUser(user);
  const [gmailView, locationResult, pushStatus] = await Promise.all([
    readGmailGateView(supabase, user.id).catch(() => null),
    supabase
      .from("roamly_location_settings")
      .select("location_tracking_enabled,last_permission_state")
      .eq("user_id", user.id)
      .maybeSingle(),
    readPushSubscriptionStatus(supabase, user.id).catch(() => null)
  ]);

  const gmailConnected =
    gmailView?.state === "CONNECTED" || gmailView?.state === "RECONCILIATION_ARMED";
  // A connection row in any live state (connected, syncing, revoked,
  // reauth) proves the step was completed once; the metadata memory
  // covers the fully-disconnected case.
  const gmailOnce =
    Boolean(memory.gmail) || gmailConnected || (gmailView != null && gmailView.state !== "NOT_CONNECTED");

  const locationRow = locationResult.data as {
    location_tracking_enabled?: boolean;
    last_permission_state?: string | null;
  } | null;
  const locationGranted = locationRow?.last_permission_state === "granted";
  const locationOnce = Boolean(memory.location) || locationGranted;
  const locationEnabled = locationRow?.location_tracking_enabled === true;
  const appInstalledOnce = Boolean(memory.app);
  // Alerts read-back (L9): a failed read proves nothing, so it reports
  // not subscribed with the server's reason — never "subscribed".
  const notificationsSubscribed = pushStatus?.subscribed === true;
  const notificationsReason = notificationsSubscribed ? null : pushStatus?.reason || "No push subscription found.";
  const alertsOnce = Boolean(memory.alerts) || notificationsSubscribed;

  // Autosync: persistent-failure flags are display only. They are computed
  // from the gate view's raw row fields and never feed gmailConnected,
  // gmailOnce, or complete above.
  const gmailSyncFailing = isGmailSyncPersistentlyFailing({
    connectionStatus: gmailView?.connectionStatus ?? null,
    lastSyncedAt: gmailConnected ? gmailView?.lastSyncedAt ?? null : null
  });
  return {
    gmailConnected,
    gmailLastSyncedAt: gmailConnected ? gmailView?.lastSyncedAt ?? null : null,
    gmailSyncFailing,
    gmailSyncFailureReconnect: gmailSyncFailing && gmailSyncFailureNeedsReconnect(gmailView?.lastSyncErrorCode ?? null),
    gmailEmail: gmailView?.emailAddress ?? null,
    gmailOnce,
    appInstalledOnce,
    locationGranted,
    locationOnce,
    locationEnabled,
    alertsOnce,
    notificationsSubscribed,
    notificationsReason,
    complete: gmailOnce && appInstalledOnce && locationOnce
  };
}
