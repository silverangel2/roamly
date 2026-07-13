import { TripPlanForm } from "@/components/plan/TripPlanForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

const promiseCards = [
  ["1 free itinerary", "One full itinerary per account, lifetime"],
  ["More itinerary planning", "Unlock another full itinerary only when you need it"],
  ["Complete Trip Pack", "Itinerary plus Live Trip Companion when it makes sense"],
  ["Mobile first", "Built to follow while traveling"]
];

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
  const apiAuthToken = createRoamlySessionToken(current.user);

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
      <section className="grid gap-4 lg:grid-cols-[0.68fr_1.32fr] lg:items-start">
        <div className="space-y-3 lg:sticky lg:top-20">
          <Badge>Plan trip</Badge>
          {access.hasQaAccess ? <Badge tone="ocean">Tester access</Badge> : null}
          <div>
            <h1 className="max-w-2xl text-3xl font-black leading-tight tracking-tight text-ink sm:text-5xl">
              Tell Roamly what kind of trip you want.
            </h1>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-600 sm:text-base">
              A few clean choices now. Roamly checks trip costs before building the locked itinerary.
            </p>
          </div>

          <div className="hidden gap-2 lg:grid">
            {promiseCards.map(([title, detail]) => (
              <Card key={title} className="p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-ocean">{title}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-600">{detail}</p>
              </Card>
            ))}
          </div>
        </div>

        <TripPlanForm freeItineraryUsed={freeItineraryUsed} testerAccess={access.hasQaAccess} apiAuthToken={apiAuthToken} />
      </section>
    </main>
  );
}
