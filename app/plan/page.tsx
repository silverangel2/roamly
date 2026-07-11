import { TripPlanForm } from "@/components/plan/TripPlanForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfile } from "@/lib/roamly/profile";
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
      ? await Promise.all([ensureRoamlyProfile(current.user, {}, supabase), hasUsedFreeItinerary(supabase, current.user.id)])
      : [null, null];
  const freeItineraryUsed = Boolean(free?.used);
  const access = getRoamlyAccessForUser(current.user?.email);

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div className="space-y-5 lg:sticky lg:top-24">
          <Badge>Plan trip</Badge>
          {access.hasQaAccess ? <Badge tone="ocean">Tester access</Badge> : null}
          <div>
            <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight text-ink sm:text-6xl">
              Tell Roamly what kind of trip you want.
            </h1>
            <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-slate-600">
              A few clean choices now. Roamly checks trip costs before building the locked itinerary.
            </p>
          </div>

          <div className="grid gap-3">
            {promiseCards.map(([title, detail]) => (
              <Card key={title} className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{title}</p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{detail}</p>
              </Card>
            ))}
          </div>
        </div>

        <TripPlanForm freeItineraryUsed={freeItineraryUsed} testerAccess={access.hasQaAccess} />
      </section>
    </main>
  );
}
