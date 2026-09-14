import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DeleteTripButton } from "@/components/trip/DeleteTripButton";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { getTripDaysCount, getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { formatRoamlyDate, type RoamlyLocale } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";

type DashboardTrip = {
  id: string;
  title: string | null;
  destination?: string | null;
  destination_name?: string | null;
  start_date: string | null;
  end_date: string | null;
  days_count?: number | null;
  status: string;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_generated_at?: string | null;
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

function formatDate(value: string | null, locale: RoamlyLocale) {
  if (!value) return "Flexible dates";
  return formatRoamlyDate(value, locale, { month: "short", day: "numeric", year: "numeric" });
}

function TripCard({ trip, locale }: { trip: DashboardTrip; locale: RoamlyLocale }) {
  const locked = isTripLocked(trip);
  const hasTracking = tripHasTrackingUnlock(trip);
  const href = hasTracking ? `/trip/${trip.id}/live` : `/trip/${trip.id}`;
  const destination = getTripDestinationLabel(trip) || "Trip";
  const daysCount = getTripDaysCount(trip);

  return (
    <article className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
            {hasTracking ? "Live Trip Companion" : locked ? "Locked itinerary" : trip.status}
          </p>
          <h3 className="mt-2 text-xl font-black text-ink">{trip.title || destination}</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {formatDate(trip.start_date, locale)} · {daysCount || "?"} days
          </p>
        </div>
        <span className="rounded-full bg-mist px-3 py-2 text-xs font-black text-slate-600">
          {hasTracking ? "Live" : locked ? "Itinerary" : "Draft"}
        </span>
      </div>
      <div className="mt-4">
        <Button href={href} className="w-full">
          {hasTracking ? "Open companion" : locked ? "Open itinerary" : "Open trip"}
        </Button>
        <DeleteTripButton
          tripId={trip.id}
          tripTitle={trip.title || destination}
        />
      </div>
    </article>
  );
}

export default async function DashboardPage() {
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (!current.configured) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup needed</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">Dashboard needs Supabase.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            Once Supabase env vars are set, Roamly shows only this user&apos;s trips.
          </p>
        </Card>
      </main>
    );
  }

  if (!current.user) {
    redirect("/login?next=/dashboard");
  }
  const supabase = await createSupabaseServerClient();
  const [, { data: trips }, free] = await Promise.all([
    supabase ? ensureRoamlyProfileBestEffort(current.user, {}, supabase, "dashboard_page") : Promise.resolve(null),
    supabase
      ? supabase
          .from("roamly_trips")
          .select("id,title,destination_name,start_date,end_date,status,itinerary_status,itinerary_locked,itinerary_generated_at,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,metadata,created_at")
          .eq("user_id", current.user.id)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] },
    supabase ? hasUsedFreeItinerary(supabase, current.user.id) : Promise.resolve({ used: false, entitlement: null, error: null })
  ]);

  const typedTrips = (trips || []) as DashboardTrip[];
  const locked = typedTrips.filter((trip) => isTripLocked(trip));
  const drafts = typedTrips.filter((trip) => !isTripLocked(trip));
  const liveTrips = typedTrips.filter((trip) => tripHasTrackingUnlock(trip));
  const activeNow = liveTrips[0];
  const primaryTrip = activeNow || typedTrips[0];

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="grid gap-5 lg:grid-cols-[1fr_0.85fr] lg:items-end">
        <div>
          <Badge>Trips</Badge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Your trips.</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-600">
            Start with the trip that needs your attention, then open the rest when you need them.
          </p>
        </div>
      </section>

      {primaryTrip ? (
        <section className="mt-7 rounded-[1.5rem] border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_60%,#fff7ed_100%)] p-5 shadow-soft sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{activeNow ? "Current trip" : "Most recent trip"}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-ink">{primaryTrip.title || getTripDestinationLabel(primaryTrip) || "Your trip"}</h2>
          <p className="mt-2 text-sm font-bold text-slate-600">
            {formatDate(primaryTrip.start_date, locale)} · {getTripDaysCount(primaryTrip) || "Flexible"} days
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button href={activeNow ? `/trip/${activeNow.id}/live` : `/trip/${primaryTrip.id}`}>
              {activeNow ? "Open today" : isTripLocked(primaryTrip) ? "Open itinerary" : "Continue trip"}
            </Button>
            <Button href="/plan" tone="ghost">Plan another trip</Button>
          </div>
        </section>
      ) : null}

      <section className="mt-7 grid gap-4 md:grid-cols-3">
        {[
          ["Free itinerary", free.used ? "Used" : "Available"],
          ["Locked itineraries", String(locked.length)],
          ["Draft trips", String(drafts.length)]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{label}</p>
            <p className="mt-2 text-2xl font-black text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-ink">Recent trips</h2>
          <Button href="/plan" tone="ghost">New trip</Button>
        </div>
        {typedTrips.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {typedTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} locale={locale} />
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">No trips yet</p>
            <h2 className="mt-2 text-2xl font-black text-ink">Start your first itinerary.</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              Generate your free itinerary, or unlock a paid itinerary for a new trip.
            </p>
            <div className="mt-5">
              <Button href="/plan">Create trip</Button>
            </div>
          </Card>
        )}
      </section>
    </main>
  );
}
