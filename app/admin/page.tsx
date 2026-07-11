import { redirect } from "next/navigation";
import { getMissingEnvironmentVariables } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminEmails } from "@/lib/roamly/access";

function adminEmails() {
  return getRoamlyAdminEmails();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{label}</p>
      <p className="mt-2 text-3xl font-black text-ink">{value}</p>
    </Card>
  );
}

export default async function AdminPage() {
  const current = await getCurrentUser();
  const allowedEmails = adminEmails();

  if (current.configured && !current.user) redirect("/login?next=/admin");

  if (!current.user || !allowedEmails.includes((current.user.email || "").toLowerCase())) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="coral">Admin protected</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink">Roamly admin is private.</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Add your email to ROAMLY_ADMIN_EMAILS to open this operation panel.
          </p>
        </Card>
      </main>
    );
  }

  const admin = createSupabaseAdminClient();
  const missing = getMissingEnvironmentVariables();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    users,
    trips,
    qaTesterTrips,
    lockedTrips,
    payments,
    freeUsed,
    paidItineraries,
    companionAddOns,
    bundles,
    recentTrips,
    activeToday,
    tripActivations,
    checkIns,
    locationOptIns,
    pageViews,
    topTrips,
    bookingCount,
    priceDiscoveryCount,
    notificationCount,
    pushSubscriptionCount,
    affiliateClicks,
    affiliateProviderMissing,
    failedAppGenerations,
    failedTripGenerations,
    checkoutCompleted,
    recentAppEvents
  ] = admin
    ? await Promise.all([
        admin.from("roamly_profiles").select("id", { count: "exact", head: true }),
        admin.from("roamly_trips").select("id", { count: "exact", head: true }),
        admin.from("roamly_trips").select("id", { count: "exact", head: true }).contains("metadata", { qa_tester: true }),
        admin.from("roamly_trips").select("id", { count: "exact", head: true }).eq("itinerary_locked", true),
        admin.from("roamly_itinerary_purchases").select("amount_cents,status,created_at").eq("status", "paid").limit(200),
        admin.from("roamly_user_entitlements").select("id", { count: "exact", head: true }).not("free_itinerary_used_at", "is", null),
        admin.from("roamly_itinerary_purchases").select("id", { count: "exact", head: true }).eq("status", "paid").in("purchase_type", ["itinerary", "itinerary_unlock"]),
        admin.from("roamly_itinerary_purchases").select("id", { count: "exact", head: true }).eq("status", "paid").in("purchase_type", ["features", "tracking_addon"]),
        admin.from("roamly_itinerary_purchases").select("id", { count: "exact", head: true }).eq("status", "paid").in("purchase_type", ["complete_trip", "bundle"]),
        admin
          .from("roamly_trips")
          .select("id,title,destination,status,itinerary_status,itinerary_locked,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,live_companion_unlocked,itinerary_generated_at,itinerary_locked_at,metadata,created_at")
          .order("created_at", { ascending: false })
          .limit(8),
        admin.from("roamly_trips").select("id", { count: "exact", head: true }).eq("status", "active"),
        admin
          .from("roamly_trip_events")
          .select("id", { count: "exact", head: true })
          .eq("event_type", "trip_activated")
          .gte("created_at", todayIso),
        admin
          .from("roamly_trip_events")
          .select("id", { count: "exact", head: true })
          .eq("event_type", "activity_checked_in")
          .gte("created_at", todayIso),
        admin
          .from("roamly_location_settings")
          .select("id", { count: "exact", head: true })
          .eq("location_tracking_enabled", true),
        admin
          .from("roamly_app_events")
          .select("id", { count: "exact", head: true })
          .eq("event_type", "page_view")
          .gte("created_at", todayIso),
        admin
          .from("roamly_trips")
          .select("destination,destination_city,destination_country,metadata")
          .order("created_at", { ascending: false })
          .limit(200),
        admin.from("roamly_bookings").select("id", { count: "exact", head: true }),
        admin.from("roamly_price_discoveries").select("id", { count: "exact", head: true }),
        admin.from("roamly_notifications").select("id", { count: "exact", head: true }),
        admin.from("roamly_push_subscriptions").select("id", { count: "exact", head: true }).eq("enabled", true),
        admin.from("roamly_app_events").select("id", { count: "exact", head: true }).eq("event_type", "booking_link_clicked"),
        admin.from("roamly_app_events").select("id", { count: "exact", head: true }).eq("event_type", "affiliate_provider_missing"),
        admin.from("roamly_app_events").select("id", { count: "exact", head: true }).eq("event_type", "itinerary_generation_failed"),
        admin.from("roamly_trip_events").select("id", { count: "exact", head: true }).eq("event_type", "itinerary_generation_failed"),
        admin.from("roamly_app_events").select("id", { count: "exact", head: true }).eq("event_type", "checkout_completed"),
        admin.from("roamly_app_events").select("event_type,metadata,created_at").order("created_at", { ascending: false }).limit(500)
      ])
    : [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null];

  const paidRows = (payments?.data || []) as Array<{ amount_cents: number }>;
  const revenue = paidRows.reduce((sum, row) => sum + (row.amount_cents || 0), 0) / 100;
  const topDestinations = new Map<string, number>();
  const topMultiCityRoutes = new Map<string, number>();
  ((topTrips?.data || []) as Array<{
    destination?: string;
    destination_city?: string | null;
    destination_country?: string | null;
    metadata?: Record<string, unknown> | null;
  }>).forEach(
    (trip) => {
      const label = trip.destination_city || trip.destination || trip.destination_country || "Unknown";
      topDestinations.set(label, (topDestinations.get(label) || 0) + 1);
      const planning = trip.metadata && typeof trip.metadata === "object" ? (trip.metadata.planning as Record<string, unknown> | undefined) : undefined;
      const stops = Array.isArray(planning?.destinationStops) ? planning.destinationStops : [];
      const route = stops
        .map((stop) => (stop && typeof stop === "object" ? (stop as Record<string, unknown>).value || (stop as Record<string, unknown>).label : ""))
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .join(" → ");
      if (route) topMultiCityRoutes.set(route, (topMultiCityRoutes.get(route) || 0) + 1);
    }
  );
  const recentEventRows = (recentAppEvents?.data || []) as Array<{ event_type?: string; metadata?: Record<string, unknown> | null }>;
  const eventCounts = recentEventRows.reduce<Record<string, number>>((acc, event) => {
    if (event.event_type) acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});
  const failedGenerationCount = (failedAppGenerations?.count || 0) + (failedTripGenerations?.count || 0);

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section>
        <Badge>Admin</Badge>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Roamly control center.</h1>
        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-600">
          A clean single-operator view for launch readiness, settings, usage, and revenue checks.
        </p>
      </section>

      <section className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={users?.count ?? "Setup"} />
        <Stat label="Trips generated" value={trips?.count ?? "Setup"} />
        <Stat label="Locked itineraries" value={lockedTrips?.count ?? "Setup"} />
        <Stat label="Revenue estimate" value={`$${revenue.toFixed(2)}`} />
        <Stat label="Tester trips" value={qaTesterTrips?.count ?? 0} />
        <Stat label="Free itineraries used" value={freeUsed?.count ?? 0} />
        <Stat label="Paid itineraries unlocked" value={paidItineraries?.count ?? 0} />
        <Stat label="Affiliate clicks" value={affiliateClicks?.count ?? 0} />
        <Stat label="Failed generations" value={failedGenerationCount} />
        <Stat label="Active trips today" value={activeToday?.count ?? 0} />
        <Stat label="Live starts today" value={tripActivations?.count ?? 0} />
        <Stat label="Check-ins today" value={checkIns?.count ?? 0} />
        <Stat label="Page views today" value={pageViews?.count ?? 0} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Today</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Itinerary and companion sales</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Tester activity is excluded from revenue totals where possible.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Free itinerary used", `${freeUsed?.count ?? 0} accounts`],
              ["Paid itineraries", `${paidItineraries?.count ?? 0}`],
              ["Live Companion add-ons", `${companionAddOns?.count ?? 0}`],
              ["Bundles", `${bundles?.count ?? 0}`],
              ["Pricing", "$4.99 itinerary · $3.99 companion · $7.99 complete"],
              ["Booking imports", `${bookingCount?.count ?? 0}`],
              ["Budget checks", `${priceDiscoveryCount?.count ?? 0}`],
              ["Checkout completions", `${checkoutCompleted?.count ?? 0}`],
              ["Tester activity", `${qaTesterTrips?.count ?? 0} QA trips marked`],
              ["Affiliate clicks", `${affiliateClicks?.count ?? 0}`],
              ["Affiliate provider missing", `${affiliateProviderMissing?.count ?? 0}`],
              ["Notifications", `${notificationCount?.count ?? 0}`],
              ["Push opt-ins", `${pushSubscriptionCount?.count ?? 0}`],
              ["Location opt-in", `${locationOptIns?.count ?? 0} users enabled`],
              ["AI generation", process.env.OPENAI_API_KEY ? "Configured" : "Missing key"],
              ["OpenAI usage/cost estimate", eventCounts.openai_usage ? `${eventCounts.openai_usage} usage events` : "Not tracked yet"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-mist p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-black text-ink">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Environment</p>
          <h2 className="mt-2 text-2xl font-black text-ink">
            {missing.length ? "Needs attention" : "Launch values present"}
          </h2>
          <div className="mt-4 grid gap-2">
            {(missing.length ? missing : ["No missing required values detected"]).map((item) => (
              <p key={item} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                {item}
              </p>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button href="/admin/live-test" tone="secondary">Live test</Button>
        <Button href="/admin/email" tone="secondary">Email center</Button>
        <Button href="/admin/system" tone="secondary">System diagnostics</Button>
        <Button href="/admin/settings" tone="secondary">Launch settings</Button>
      </section>

      <section className="mt-5">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Top destinations</p>
          <div className="mt-4 grid gap-3">
            {[...topDestinations.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([destination, count]) => (
                <p key={destination} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                  {destination} · {count}
                </p>
              ))}
            {!topDestinations.size ? (
              <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No destinations yet.</p>
            ) : null}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Popular multi-city routes</p>
          <div className="mt-4 grid gap-3">
            {[...topMultiCityRoutes.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([route, count]) => (
                <p key={route} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                  {route} · {count}
                </p>
              ))}
            {!topMultiCityRoutes.size ? (
              <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No multi-city routes yet.</p>
            ) : null}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Recent trips</p>
          <div className="mt-4 grid gap-3">
            {((recentTrips?.data || []) as Array<{
              id: string;
              title: string | null;
              destination: string;
              status: string;
              itinerary_status?: string | null;
              itinerary_locked?: boolean | null;
              itinerary_payment_status?: string | null;
              itinerary_unlock_source?: string | null;
              tracking_unlocked?: boolean | null;
              live_companion_unlocked?: boolean | null;
              itinerary_generated_at?: string | null;
              itinerary_locked_at?: string | null;
              metadata?: Record<string, unknown> | null;
            }>).map((trip) => (
              <div key={trip.id} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{trip.title || trip.destination}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                  {trip.itinerary_locked ? "Locked" : trip.itinerary_status || trip.status} · {trip.itinerary_payment_status || "unpaid"} ·{" "}
                  {trip.live_companion_unlocked || trip.tracking_unlocked ? "companion" : "no companion"}
                  {trip.metadata?.qa_tester ? " · tester" : ""}
                </p>
              </div>
            ))}
            {!recentTrips?.data?.length ? (
              <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
                No recent trip records yet.
              </p>
            ) : null}
          </div>
        </Card>
        </div>
      </section>
    </main>
  );
}
