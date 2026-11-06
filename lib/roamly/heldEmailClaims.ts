import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Held/ambiguous companion-email claims (visibility round 2026-10-31).
 * Read-only enumeration for the admin Email Center: events whose delivery
 * marker is claimed / in_flight / ambiguous (same states + same per-state
 * query shape as reconcileCompanionEmailDeliveries in pushServer.ts).
 * provider_accepted / provider_failed / released are NOT held.
 */
export const HELD_EMAIL_CLAIM_STATES = ["claimed", "in_flight", "ambiguous"] as const;

export type HeldEmailClaim = {
  claimId: string | null;
  eventId: string;
  tripId: string | null;
  state: string;
  claimedAt: string | null;
  ageMs: number | null;
};

export async function listHeldCompanionEmailClaims(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<{ count: number; claims: HeldEmailClaim[] }> {
  const claims: HeldEmailClaim[] = [];
  for (const state of HELD_EMAIL_CLAIM_STATES) {
    const { data, error } = await supabase
      .from("roamly_trip_companion_events")
      .select("id,trip_id,created_at,metadata")
      .filter("metadata->>emailDeliveryState", "eq", state)
      .limit(50);
    if (error) continue;
    for (const event of data || []) {
      const metadata = (event.metadata || {}) as Record<string, unknown>;
      const claimedAt =
        typeof metadata.emailClaimedAt === "string" ? metadata.emailClaimedAt : typeof event.created_at === "string" ? event.created_at : null;
      const claimedMs = claimedAt ? new Date(claimedAt).getTime() : NaN;
      claims.push({
        claimId: typeof metadata.emailClaimId === "string" ? metadata.emailClaimId : null,
        eventId: event.id,
        tripId: event.trip_id || null,
        state,
        claimedAt,
        ageMs: Number.isNaN(claimedMs) ? null : Math.max(0, now.getTime() - claimedMs)
      });
    }
  }
  claims.sort((a, b) => (a.claimedAt || "").localeCompare(b.claimedAt || ""));
  return { count: claims.length, claims };
}
