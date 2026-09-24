import type { SupabaseClient } from "@supabase/supabase-js";
import { getTravelerMemory } from "@/lib/roamly/travelerMemory";
import { buildTripTravelerRequirements, listTripTravelers } from "@/lib/roamly/tripTravelers";
import type { RequirementStatus } from "@/lib/roamly/travelRequirements";

export type PreTripRequirementSummary = {
  travelerLabel: string;
  status: Extract<RequirementStatus, "ACTION_REQUIRED" | "REVIEW_REQUIRED" | "UNKNOWN">;
  title: string;
  summary: string;
  actionUrl: string | null;
};

type CurrentTripRequirementInput = {
  id: string;
  travelers_count?: number | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  metadata?: Record<string, unknown> | null;
};

function safeOfficialActionUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function loadCurrentPreTripRequirements(params: {
  supabase: SupabaseClient;
  trip: CurrentTripRequirementInput;
  userId: string;
}) {
  const [travelersResult, memoryResult] = await Promise.all([
    listTripTravelers(params.supabase, params.trip.id),
    getTravelerMemory(params.supabase, params.userId)
  ]);

  if (travelersResult.error || memoryResult.error) {
    return {
      ok: false as const,
      error: travelersResult.error || memoryResult.error || "TRAVEL_REQUIREMENTS_UNAVAILABLE"
    };
  }

  const state = buildTripTravelerRequirements({
    trip: params.trip,
    travelers: travelersResult.travelers,
    accountHolderPassportCountry: memoryResult.profile?.passport_issuing_country
  });

  const requirements = state.evaluations.flatMap((evaluation) =>
    evaluation.requirements
      .filter((requirement): requirement is typeof requirement & { status: PreTripRequirementSummary["status"] } =>
        requirement.status === "ACTION_REQUIRED" || requirement.status === "REVIEW_REQUIRED" || requirement.status === "UNKNOWN"
      )
      .map((requirement) => ({
        travelerLabel: evaluation.label,
        status: requirement.status,
        title: requirement.title,
        summary: requirement.summary,
        actionUrl: safeOfficialActionUrl(requirement.actionUrl)
      }))
  );

  return { ok: true as const, requirements };
}
