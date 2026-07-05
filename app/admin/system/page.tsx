import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { DemoSeedButton } from "@/components/admin/DemoSeedButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";

const tables = [
  "roamly_trips",
  "roamly_trip_days",
  "roamly_activities",
  "roamly_trip_events",
  "roamly_location_settings",
  "roamly_app_events",
  "roamly_price_discoveries",
  "roamly_bookings",
  "roamly_trip_companion_events",
  "roamly_push_subscriptions",
  "roamly_notifications"
];

const environmentChecks = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ROAMLY_STRIPE_ITINERARY_PRICE_ID",
  "ROAMLY_STRIPE_FEATURES_PRICE_ID",
  "ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID",
  "ROAMLY_NOTIFICATION_CRON_SECRET",
  "ROAMLY_AFFILIATES_ENABLED"
];

export default async function AdminSystemPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const checks = await Promise.all(
    tables.map(async (table) => {
      const { error } = await state.admin!.from(table).select("id", { count: "exact", head: true });
      return { table, ok: !error, error: error?.message };
    })
  );
  const [pushSubscriptions, notifications, companionEvents, lastNotification, lastFailure, locationSettings, lastLocation] =
    await Promise.all([
      state.admin.from("roamly_push_subscriptions").select("id", { count: "exact", head: true }).eq("enabled", true),
      state.admin.from("roamly_notifications").select("id", { count: "exact", head: true }),
      state.admin.from("roamly_trip_companion_events").select("id", { count: "exact", head: true }),
      state.admin.from("roamly_notifications").select("id,title,created_at,sent_at,push_status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      state.admin
        .from("roamly_notifications")
        .select("id,title,created_at,push_error,push_status")
        .not("push_error", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      state.admin.from("roamly_location_settings").select("id", { count: "exact", head: true }),
      state.admin
        .from("roamly_location_settings")
        .select("id,last_seen_at,last_permission_state")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);
  const affiliateReadiness = getAffiliateReadiness();

  return (
    <main className="safe-bottom">
      <Badge>System</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Diagnostics.</h1>
      <section className="mt-6 grid gap-3">
        {checks.map((check) => (
          <Card key={check.table} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-ink">{check.table}</h2>
              <span className={`rounded-full px-3 py-2 text-xs font-black ${check.ok ? "bg-ocean/10 text-ocean" : "bg-coral/10 text-coral"}`}>
                {check.ok ? "Ready" : "Missing"}
              </span>
            </div>
            {check.error ? <p className="mt-2 text-sm font-bold text-coral">{check.error}</p> : null}
          </Card>
        ))}
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2">
        {environmentChecks.map((key) => (
          <Card key={key} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{key}</p>
            <p className={`mt-2 text-lg font-black ${process.env[key] ? "text-ocean" : "text-coral"}`}>
              {process.env[key] ? "Configured" : "Missing"}
            </p>
          </Card>
        ))}
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Push subscriptions", `${pushSubscriptions.count || 0}`],
          ["Notifications", `${notifications.count || 0}`],
          ["Companion events", `${companionEvents.count || 0}`],
          ["Last notification", lastNotification.data?.created_at || "None"],
          ["Last notification failure", lastFailure.data?.push_error || "None"],
          ["Location settings", `${locationSettings.count || 0}`],
          ["Last location update", lastLocation.data?.last_seen_at || "None"],
          ["Affiliates", affiliateReadiness.affiliatesEnabled ? "Enabled" : "Disabled"],
          ["Hotel provider", affiliateReadiness.hotelProviderConfigured ? "Configured" : "Not configured"],
          ["Flight provider", affiliateReadiness.flightProviderConfigured ? "Configured" : "Not configured"],
          ["Attractions provider", affiliateReadiness.attractionsProviderConfigured ? "Configured" : "Not configured"]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Demo seed</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Toronto Weekend tester</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Creates a dev/admin demo trip with CN Tower, Ripley&apos;s Aquarium, Harbourfront, ROM, and Kensington Market coordinates.
          </p>
          <div className="mt-4">
            <DemoSeedButton />
          </div>
        </Card>
      </section>
    </main>
  );
}
