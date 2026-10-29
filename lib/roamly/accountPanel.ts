/**
 * Account panel (panel G) — pure display derivations for /account.
 *
 * HARD RULES (owner decision, panel G build):
 * - NOTHING here knows a person's name, email, or count. Every value is
 *   derived from the signed-in user's live session + real queries on the
 *   page; anything the code cannot determine is an honest unavailable
 *   state, never a copied or invented value.
 * - This module never changes entitlements. The plan card DISPLAYS plan
 *   state (account type + the one-free-itinerary-per-account gate read);
 *   the gate itself lives in lib/roamly/billing.ts and is untouched.
 * - "Connected" for the Booking Wallet is earned only by a real Gmail
 *   row whose connection_status is exactly "connected". Any other
 *   status, and any query failure, is shown honestly, never as connected.
 * - Traveler companions are per-trip rows (roamly_trip_travelers) with no
 *   cross-trip identity, so summing them across trips would invent
 *   people. The traveler party is therefore the LARGEST recorded party
 *   across the user's non-archived trips (slot rows when recorded,
 *   otherwise the trip's travelers_count), minimum 1 — the account
 *   holder themself. For a one-traveler account that renders exactly
 *   "You • 1 traveler"; for a multi-trip account it never double-counts
 *   the same companion across trips.
 */

export type BookingWalletState = {
  /** Subtitle shown on the Booking Wallet row. */
  label: string;
  /** True only when a real Gmail row is status "connected" (green dot). */
  connected: boolean;
  /** True when the connection query itself failed. */
  unavailable: boolean;
};

export function accountInitials(displayName: string, email: string): string {
  const nameParts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2) {
    return `${nameParts[0][0] || ""}${nameParts[1][0] || ""}`.toUpperCase();
  }
  if (nameParts.length === 1) {
    const part = nameParts[0];
    return part.length >= 2 ? part.slice(0, 2).toUpperCase() : part.toUpperCase();
  }
  const local = (email || "").split("@")[0] || "";
  const letters = local.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return letters.toUpperCase();
  return "?";
}

export function bookingWalletState(
  statuses: string[] | null,
  queryError: boolean
): BookingWalletState {
  if (queryError) {
    return { label: "Connection status unavailable", connected: false, unavailable: true };
  }
  const rows = statuses || [];
  if (rows.includes("connected")) {
    return { label: "Connected to Gmail", connected: true, unavailable: false };
  }
  if (rows.includes("syncing")) {
    return { label: "Syncing Gmail", connected: false, unavailable: false };
  }
  if (rows.some((status) => status === "error" || status === "needs_reauth" || status === "revoked")) {
    return { label: "Gmail needs reconnecting", connected: false, unavailable: false };
  }
  return { label: "Not connected", connected: false, unavailable: false };
}

export type AccountTripParty = {
  /** Slots recorded in roamly_trip_travelers for this trip (0 = none recorded). */
  slotCount: number;
  /** Fallback: the trip's own travelers_count column (null = unknown). */
  travelersCount: number | null;
};

export function travelerPartySize(trips: AccountTripParty[]): number {
  let party = 1; // The account holder themself, always.
  for (const trip of trips) {
    const slots = Number.isInteger(trip.slotCount) && trip.slotCount > 0 ? trip.slotCount : 0;
    const counted =
      typeof trip.travelersCount === "number" && Number.isInteger(trip.travelersCount) && trip.travelersCount >= 1
        ? trip.travelersCount
        : null;
    const thisTrip = slots > 0 ? slots : counted;
    if (thisTrip !== null && thisTrip > party) party = thisTrip;
  }
  return party;
}

export function travelerSubtitle(partySize: number, queryError: boolean): string {
  if (queryError) return "Traveler info unavailable";
  return `You • ${partySize} traveler${partySize === 1 ? "" : "s"}`;
}

export type AccountPlanCard = {
  title: string;
  subtitle: string;
};

export function accountPlanCard(hasQaAccess: boolean, freeItineraryUsed: boolean): AccountPlanCard {
  if (hasQaAccess) {
    return {
      title: "Tester access",
      subtitle: "Tester access unlocks paid feature checks without creating Stripe revenue."
    };
  }
  return {
    title: "Free Plan",
    subtitle: freeItineraryUsed ? "Free itinerary used" : "1 free itinerary per account"
  };
}
