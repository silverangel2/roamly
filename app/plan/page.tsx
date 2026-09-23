import { TripPlanForm } from "@/components/plan/TripPlanForm";
import { getServerLocale } from "@/lib/i18n-server";
import { translateKey } from "@/lib/i18n";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export default async function PlanPage() {
  const locale = await getServerLocale();
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
        <header className="mb-7 flex min-w-0 items-start justify-between gap-4 sm:mb-9">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{translateKey(locale, "ui.nav.planTrip", "Plan trip")}</Badge>
              {access.hasQaAccess ? <Badge tone="ocean">Tester access</Badge> : null}
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-black leading-[1.05] tracking-[-0.035em] text-ink sm:text-5xl">
              Build a trip that feels like yours.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              A few thoughtful choices now. Roamly will shape the route, pace, and budget around you.
            </p>
          </div>
        </header>
        <TripPlanForm freeItineraryUsed={freeItineraryUsed} testerAccess={access.hasQaAccess} apiAuthToken={apiAuthToken} />
      </div>
    </div>
  );
}
