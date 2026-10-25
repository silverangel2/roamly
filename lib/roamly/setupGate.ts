import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoamlySetupState } from "@/lib/roamly/setupState";

/*
 * SECOND-TIME GATE TRIGGER (owner law, 2026-10-24 — Junel's free-flow
 * rules, Dylan's sharpened version approved the same day).
 *
 * The setup gate renders ONLY when all three hold:
 *   1. the traveler is signed in (guests never meet the gate — the free
 *      itinerary page has no setup wall),
 *   2. the three setup steps are not all complete, and
 *   3. the account already has ANOTHER trip — this trip is not the
 *      account's first trip.
 *
 * Why "another trip" is the trigger: it is the one second-time fact the
 * existing account state can actually distinguish. A first trip shows in
 * full (the free-first experience); from the second trip on, the
 * generated itinerary stays behind the setup steps until they are done
 * — or the traveler skips for now (see below). It is deliberately NOT
 * "second visit" (visit count is not persisted anywhere) and NOT
 * "second device" (device identity would be new tracking — rejected).
 * Guest history is invisible to a later account: a guest trip lives
 * under a different user id and the signup flow does not transfer it,
 * so a converted guest's first account trip is not gated. The guest
 * delivery email (lib/roamly/guestDelivery.ts) is the bridge that lets
 * the traveler recover that first trip; it does not retroactively gate
 * the new account.
 *
 * The gate is NEVER a wall: skip-for-now always reveals the itinerary
 * (see skipSetupGate on the trip page), skip is per-visit and never
 * remembered, and skipping never counts as completing a step. Steps
 * complete once, on server-verifiable evidence, and are remembered
 * forever (see lib/roamly/setupState.ts).
 */

export function setupGateApplies({
  setupComplete,
  hasQaAccess,
  hasPriorTrip
}: {
  setupComplete: boolean;
  hasQaAccess: boolean;
  hasPriorTrip: boolean;
}): boolean {
  return !setupComplete && !hasQaAccess && hasPriorTrip;
}

/**
 * True when the account already has a trip other than this one. A query
 * failure fails OPEN (no gate): a broken read must never wall a traveler
 * out of their own trip, and the failure is logged server-side.
 */
export async function hasPriorTrip(
  supabase: SupabaseClient,
  userId: string,
  currentTripId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("roamly_trips")
      .select("id")
      .eq("user_id", userId)
      .neq("id", currentTripId)
      .limit(1);
    if (error) {
      console.error("[Roamly setup gate] Prior-trip check failed", error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error("[Roamly setup gate] Prior-trip check threw", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

/**
 * True when the account has any trip at all (plan-page disclosure: the
 * next trip this account generates will meet the second-time gate).
 * A query failure fails OPEN (no disclosure): a broken read must never
 * invent a gate warning, and the trip page itself is the enforcement
 * point.
 */
export async function hasAnyTrip(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("roamly_trips")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      console.error("[Roamly setup gate] Any-trip check failed", error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error("[Roamly setup gate] Any-trip check threw", error instanceof Error ? error.message : "unknown");
    return false;
  }
}
/**
 * Plain-word list of what is limited right now, from CURRENT capability
 * (not once-flags): a step done once but currently off still limits its
 * feature, and the banner must say so. Empty only when everything works
 * — which is also when the gate never renders.
 */
export function setupGateLimitedFeatures(state: RoamlySetupState): string[] {
  const limited: string[] = [];
  if (!state.gmailConnected) limited.push("Booking Recon — needs Gmail");
  if (!state.appInstalledOnce) limited.push("Live Companion alerts — needs the app");
  if (!(state.locationGranted && state.locationEnabled)) limited.push("Companion goes live — needs location");
  return limited;
}
