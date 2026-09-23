import type { SupabaseClient } from "@supabase/supabase-js";

const INACTIVE_TRIP_STATUSES = new Set(["archived", "cancelled", "completed"]);

export type CompanionTripLifecycleState = "active" | "inactive" | "unavailable";

export function companionTripLifecycleState(params: {
  found: boolean;
  status?: unknown;
  itineraryStatus?: unknown;
  error?: unknown;
}): CompanionTripLifecycleState {
  if (params.error) return "unavailable";
  if (!params.found) return "inactive";

  const status = typeof params.status === "string" ? params.status.trim().toLowerCase() : "";
  const itineraryStatus = typeof params.itineraryStatus === "string"
    ? params.itineraryStatus.trim().toLowerCase()
    : "";
  if (!status) return "unavailable";
  if (INACTIVE_TRIP_STATUSES.has(status) || itineraryStatus === "cancelled") return "inactive";
  return "active";
}

export async function loadCompanionTripLifecycle(
  supabase: SupabaseClient,
  params: { tripId: string; userId: string }
) {
  const result = await supabase
    .from("roamly_trips")
    .select("id,status,itinerary_status,metadata")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();

  return {
    result,
    state: companionTripLifecycleState({
      found: Boolean(result.data),
      status: result.data?.status,
      itineraryStatus: result.data?.itinerary_status,
      error: result.error
    })
  };
}
