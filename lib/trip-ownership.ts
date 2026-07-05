import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnedTripSummary = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  status: "draft" | "preview" | "activated" | "archived" | string | null;
  is_activated: boolean | null;
  activated_at?: string | null;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_generated_at?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export type TripOwnershipResult = {
  allowed: boolean;
  trip: OwnedTripSummary | null;
  error?: string;
};

export async function checkTripOwnership(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<TripOwnershipResult> {
  if (!userId || !tripId) {
    return { allowed: false, trip: null, error: "Missing user or trip id." };
  }

  const { data, error } = await supabase
    .from("roamly_trips")
    .select("id,user_id,title,destination,status,is_activated,activated_at,itinerary_status,itinerary_locked,itinerary_generated_at,tracking_unlocked,live_companion_unlocked,metadata")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { allowed: false, trip: null, error: error.message };
  if (!data) return { allowed: false, trip: null, error: "Trip not found for this account." };

  return { allowed: true, trip: data as OwnedTripSummary };
}
