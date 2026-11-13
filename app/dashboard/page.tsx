import { redirect } from "next/navigation";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiChip } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { DeleteTripButton } from "@/components/trip/DeleteTripButton";
import { hasUsedFreeItinerary, isTripLocked } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { getTripDaysCount, getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { formatRoamlyDate, translateExactText, type RoamlyLocale } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import { selectActiveTrip } from "@/lib/roamly/liveCompanion";
import { compareDashboardTrips, dashboardTripPresentation, dashboardTripSortRank } from "@/lib/roamly/dashboardTripPresentation";

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
  const presentation = dashboardTripPresentation(trip);
  const destination = getTripDestinationLabel(trip) || "Trip";
  const daysCount = getTripDaysCount(trip);

  return (
    <BuiCard interactive data-bui-trip-card className="bui-enter p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">
            {presentation.eyebrow === "Draft" && locked ? "Locked itinerary" : presentation.eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-black text-ink">{trip.title || destination}</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {formatDate(trip.start_date, locale)} · {daysCount || "?"} days
          </p>
        </div>
        <BuiChip tone="neutral" className="shrink-0">
          {locked && presentation.lifecycle !== "completed" && presentation.lifecycle !== "archived" ? "Itinerary" : presentation.badge}
        </BuiChip>
      </div>
      <div className="mt-4">
        <BuiButtonLink href={presentation.href} className="w-full sm:w-auto">
          {locked && presentation.lifecycle !== "completed" && presentation.lifecycle !== "archived" ? "Open plan" : presentation.action}
        </BuiButtonLink>
        <DeleteTripButton
          tripId={trip.id}
          tripTitle={trip.title || destination}
        />
      </div>
    </BuiCard>
  );
}

export default async function DashboardPage() {
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (!current.configured) {
    return (
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <BuiCard className="p-5">
          <BuiBadge tone="warm">{translateExactText(locale, "Setup needed")}</BuiBadge>
          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">{translateExactText(locale, "Dashboard needs Supabase.")}</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            {translateExactText(locale, "Once Supabase env vars are set, Roamly shows only this user's trips.")}
          </p>
        </BuiCard>
      </div>
    );
  }

  if (!current.user) {
    redirect("/login?next=/dashboard");
  }
  const supabase = await createSupabaseServerClient();
  const [, tripResult, free] = await Promise.all([
    supabase ? ensureRoamlyProfileBestEffort(current.user, {}, supabase, "dashboard_page") : Promise.resolve(null),
    supabase
      ? supabase
          .from("roamly_trips")
          .select("id,title,destination_name,start_date,end_date,status,itinerary_status,itinerary_locked,itinerary_generated_at,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,metadata,created_at")
          .eq("user_id", current.user.id)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
      : { data: null, error: new Error("Trip history is unavailable.") },
    supabase ? hasUsedFreeItinerary(supabase, current.user.id) : Promise.resolve({ used: false, entitlement: null, error: null })
  ]);

  const tripQueryError = tripResult.error;
  const typedTrips = ([...(tripResult.data || [])] as DashboardTrip[]).sort((a, b) => compareDashboardTrips(a, b));
  const locked = typedTrips.filter((trip) => isTripLocked(trip));
  const drafts = typedTrips.filter((trip) => !isTripLocked(trip));
  const activeNow = selectActiveTrip(typedTrips);
  const primaryTrip = typedTrips[0] || null;
  const upcomingTrips = typedTrips.filter((trip) => dashboardTripSortRank(trip) < 300);
  const planningTrips = typedTrips.filter((trip) => {
    const rank = dashboardTripSortRank(trip);
    return rank >= 300 && rank < 400;
  });
  const pastTrips = typedTrips.filter((trip) => dashboardTripSortRank(trip) >= 400);
  const primaryRank = primaryTrip ? dashboardTripSortRank(primaryTrip) : 300;

  if (tripQueryError) {
    return (
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <BuiCard className="p-5">
          <BuiBadge tone="warm">Trips unavailable</BuiBadge>
          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">We couldn&apos;t load your trip history.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            Your trips are still safe. Try again in a moment.
          </p>
          <div className="mt-5">
            <BuiButtonLink href="/dashboard">Try again</BuiButtonLink>
          </div>
        </BuiCard>
      </div>
    );
  }

  return (
    <div className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="grid gap-5 lg:grid-cols-[1fr_0.85fr] lg:items-end">
        <div>
          <BuiBadge tone="primary">Trips</BuiBadge>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.03em] text-ink sm:text-5xl">Your trips.</h1>
          <p className="mt-2 max-w-2xl text-base font-medium leading-7 text-slate-600">
            Start with the trip that needs your attention, then open the rest when you need them.
          </p>
        </div>
      </section>

      {primaryTrip ? (
        <section className="bui-enter mt-6 rounded-bui-panel border border-chair bg-white p-5 shadow-bui-card sm:p-7">
          <p className="text-[0.75rem] font-medium text-slate-500">{activeNow && activeNow.id === primaryTrip?.id ? "Current trip" : primaryRank < 300 ? "Upcoming trip" : primaryRank >= 400 ? "Past trip" : "Planning"}</p>
          <h2 className="mt-1 text-[1.65rem] font-semibold tracking-[-0.03em] text-ink">{primaryTrip.title || getTripDestinationLabel(primaryTrip) || "Your trip"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {formatDate(primaryTrip.start_date, locale)} · {getTripDaysCount(primaryTrip) || "Flexible"} days
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <BuiButtonLink href={`/trip/${primaryTrip.id}`}>
              {isTripLocked(primaryTrip) ? "Open plan" : "Continue trip"}
            </BuiButtonLink>
            <BuiButtonLink href="/plan" variant="ghost">Plan another trip</BuiButtonLink>
          </div>
        </section>
      ) : null}

      <section className="mt-7 grid gap-3 border-y border-cloud py-4 md:grid-cols-3 md:divide-x md:divide-cloud">
        {[
          ["Free itinerary", free.used ? "Used" : "Available", "One full itinerary per account."],
          ["Saved itineraries", String(locked.length), "Trips with an itinerary you can open."],
          ["Draft trips", String(drafts.length), "Plans that are not unlocked yet. They stay below a trip you can travel."]
        ].map(([label, value, hint]) => (
          <div key={label} className="px-0 md:px-4 md:first:pl-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">{label}</p>
            <p className="bui-display-number mt-2 text-2xl font-black text-ink">{value}</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{hint}</p>
          </div>
        ))}
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-ink">Recent trips</h2>
          <BuiButtonLink href="/plan" variant="ghost">New trip</BuiButtonLink>
        </div>
        {typedTrips.length ? (
          <div className="grid gap-8">
            {upcomingTrips.length ? (
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-cblue">Upcoming</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {typedTrips.map((trip) => (
                    dashboardTripSortRank(trip) < 300 ? <TripCard key={trip.id} trip={trip} locale={locale} /> : null
                  ))}
                </div>
              </div>
            ) : null}
            {planningTrips.length ? (
              <details open={upcomingTrips.length === 0} className="border-y border-cloud py-3">
                <summary className="bui-touch flex cursor-pointer items-center text-sm font-black uppercase tracking-[0.16em] text-slate-500">Planning · {planningTrips.length}</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {planningTrips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} locale={locale} />
                  ))}
                </div>
              </details>
            ) : null}
            {pastTrips.length ? (
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">Past</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pastTrips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} locale={locale} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <BuiCard className="p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">No trips yet</p>
            <h2 className="mt-2 text-2xl font-black text-ink">Start your first itinerary.</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              Generate your free itinerary, or unlock a paid itinerary for a new trip.
            </p>
            <div className="mt-5">
              <BuiButtonLink href="/plan">Create trip</BuiButtonLink>
            </div>
          </BuiCard>
        )}
      </section>
    </div>
  );
}
