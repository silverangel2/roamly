import type { SupabaseClient, User } from "@supabase/supabase-js";
import { readGmailGateView } from "@/lib/roamly/gateService";

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
 */

export interface RoamlySetupMemory {
  gmail?: boolean;
  app?: boolean;
  location?: boolean;
}

export interface RoamlySetupState {
  /** Gmail is connected right now (reconciliation is being fed). */
  gmailConnected: boolean;
  /** Last successful Gmail sync, when connected. Drives the stale-sync
      trip line only — a stale date never flips gmailConnected itself. */
  gmailLastSyncedAt: string | null;
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
    location: mem.location === true
  };
}

export async function getRoamlySetupState(
  supabase: SupabaseClient,
  user: User
): Promise<RoamlySetupState> {
  const memory = setupMemoryFromUser(user);
  const [gmailView, locationResult] = await Promise.all([
    readGmailGateView(supabase, user.id).catch(() => null),
    supabase
      .from("roamly_location_settings")
      .select("location_tracking_enabled,last_permission_state")
      .eq("user_id", user.id)
      .maybeSingle()
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

  return {
    gmailConnected,
    gmailLastSyncedAt: gmailConnected ? gmailView?.lastSyncedAt ?? null : null,
    gmailEmail: gmailView?.emailAddress ?? null,
    gmailOnce,
    appInstalledOnce,
    locationGranted,
    locationOnce,
    locationEnabled,
    complete: gmailOnce && appInstalledOnce && locationOnce
  };
}
