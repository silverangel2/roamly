import type { Metadata } from "next";
import { TripPlanForm } from "@/components/plan/TripPlanForm";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Plan a Trip by Budget — AI Itinerary Planner",
  description: "Roamly builds a realistic, budget-aware day-by-day trip itinerary around your pace, interests, and budget. Start with one free itinerary.",
  openGraph: {
    title: "Roamly — Plan a trip by budget | AI itinerary planner",
    description: "Build a realistic, budget-aware day-by-day itinerary with Roamly's AI trip planner. Start with one free itinerary.",
    url: "https://roamlyhq.com/plan",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function PlanPage() {
  const current = await getCurrentUser();
  const supabase = current.user ? await createSupabaseServerClient() : null;
  const [, free] =
    supabase && current.user
      ? await Promise.all([
          ensureRoamlyProfileBestEffort(current.user, {}, supabase, "plan_page"),
          hasUsedFreeItinerary(supabase, current.user.id)
        ])
      : [null, null];
  const freeItineraryUsed = Boolean(free?.used);
  const access = getRoamlyAccessForUser(current.user?.email);
  const apiAuthToken = createRoamlySessionToken(current.user, [
    { method: "POST", path: "/api/roamly/price-discovery" },
    { method: "POST", path: "/api/trips/draft" },
    { method: "POST", path: "/api/stripe/create-trip-checkout" },
    { method: "POST", path: "/api/trips/generate" }
  ]);

  return (
    <div className="safe-bottom min-w-0 bg-[#fbf8ef]">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
        <header className="mb-4">
          <h1 className="text-sm font-semibold text-[#526b6c]">Plan a trip</h1>
        </header>
        <TripPlanForm freeItineraryUsed={freeItineraryUsed} testerAccess={access.hasQaAccess} apiAuthToken={apiAuthToken} />
      </div>
    </div>
  );
}
