import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { DemoSeedButton } from "@/components/admin/DemoSeedButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";
import { isEmailConfigured } from "@/lib/roamly/email";
import { getRoamlyLaunchReadiness, type ReadinessStatus } from "@/lib/roamly/launchReadiness";
import { getRoamlySocialEnvStatus } from "@/lib/roamly/social";
import { ensureRoamlyProfile, getRoamlyProfileTableStatus, getRoamlyUserAppStatus } from "@/lib/roamly/profile";

const tables = [
  "roamly_profiles",
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
  "roamly_notifications",
  "roamly_email_logs",
  "roamly_support_messages",
  "roamly_social_media_assets",
  "roamly_social_posts",
  "roamly_social_settings",
  "roamly_social_post_history"
];

function statusClass(status: ReadinessStatus) {
  if (status === "Ready") return "bg-ocean/10 text-ocean";
  if (status === "Optional") return "bg-slate-100 text-slate-500";
  if (status === "Needs setup") return "bg-sun/20 text-amber-700";
  return "bg-coral/10 text-coral";
}

function requiredStatus(configured: boolean): ReadinessStatus {
  return configured ? "Ready" : "Missing";
}

function optionalStatus(configured: boolean, enabled = false): ReadinessStatus {
  if (configured) return "Ready";
  return enabled ? "Needs setup" : "Optional";
}

export default async function AdminSystemPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const checks = await Promise.all(
    tables.map(async (table) => {
      const { error } = await state.admin!.from(table).select("id", { count: "exact", head: true });
      return { table, ok: !error, error: error?.message };
    })
  );
  const profileTableStatus = await getRoamlyProfileTableStatus(state.admin);
  if (state.user) {
    await ensureRoamlyProfile(state.user, {}, state.admin);
  }
  const appStatus = state.user ? await getRoamlyUserAppStatus(state.user, state.admin) : null;
  const [
    pushSubscriptions,
    notifications,
    companionEvents,
    lastNotification,
    lastFailure,
    locationSettings,
    lastLocation,
    emailLogs,
    lastEmail
  ] =
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
        .maybeSingle(),
      state.admin.from("roamly_email_logs").select("id", { count: "exact", head: true }),
      state.admin
        .from("roamly_email_logs")
        .select("id,status,error,created_at,sent_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);
  const affiliateReadiness = getAffiliateReadiness();
  const emailReadiness = isEmailConfigured();
  const socialReadiness = getRoamlySocialEnvStatus();
  const launchChecks = getRoamlyLaunchReadiness(state.access);
  const affiliatesEnabled = affiliateReadiness.affiliatesEnabled;
  const systemChecks: Array<{ group: string; label: string; status: ReadinessStatus; detail: string }> = [
    {
      group: "Supabase auth",
      label: "Standalone Supabase Auth mode",
      status: "Ready",
      detail: "Roamly uses its own Supabase project, profile records, and trip records."
    },
    {
      group: "Supabase auth",
      label: "Roamly profile table",
      status: profileTableStatus.available ? "Ready" : "Missing",
      detail: "Tracks Roamly-specific identity for users in the standalone Supabase project."
    },
    {
      group: "Supabase auth",
      label: "Current user has Roamly profile",
      status: appStatus?.has_roamly_profile ? "Ready" : "Missing",
      detail: "Roamly creates or updates this profile when a signed-in user opens the app."
    },
    {
      group: "QA access",
      label: "Tester emails",
      status: state.access.testerEmailsConfigured ? "Ready" : "Optional",
      detail: "ROAMLY_TESTER_EMAILS enables private tester access when configured."
    },
    {
      group: "QA access",
      label: "Current user is tester",
      status: state.access.isTester ? "Ready" : "Optional",
      detail: "Admin accounts automatically have tester-style access."
    },
    {
      group: "QA access",
      label: "Current user is admin",
      status: state.access.isAdmin ? "Ready" : "Missing",
      detail: "Admin checks use ROAMLY_ADMIN_EMAILS and never expose configured emails."
    },
    {
      group: "Places",
      label: "Google Places server key",
      status: optionalStatus(Boolean(process.env.GOOGLE_MAPS_API_KEY), process.env.ROAMLY_PLACES_PROVIDER === "google"),
      detail: "Enables provider-backed worldwide autocomplete."
    },
    {
      group: "Places",
      label: "Places provider",
      status: process.env.ROAMLY_PLACES_PROVIDER ? "Ready" : "Optional",
      detail: "Local recommended places work when no provider is set."
    },
    {
      group: "Stripe",
      label: "Itinerary price",
      status: requiredStatus(Boolean(process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID)),
      detail: "Required for the $4.99 CAD itinerary unlock."
    },
    {
      group: "Stripe",
      label: "Companion price",
      status: requiredStatus(Boolean(process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID)),
      detail: "Required for the $3.99 CAD Live Companion add-on."
    },
    {
      group: "Stripe",
      label: "Complete pack price",
      status: requiredStatus(Boolean(process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID)),
      detail: "Required for the $7.99 CAD Complete Trip Pack."
    },
    {
      group: "Stripe",
      label: "Webhook secret",
      status: requiredStatus(Boolean(process.env.STRIPE_WEBHOOK_SECRET)),
      detail: "Required to save successful payment entitlements."
    },
    {
      group: "Affiliate",
      label: "Affiliates enabled",
      status: affiliatesEnabled ? "Ready" : "Optional",
      detail: "Roamly internal discovery fallbacks render when disabled."
    },
    {
      group: "Affiliate",
      label: "Stay22 hotel link",
      status: optionalStatus(affiliateReadiness.stay22PartnerConfigured, affiliatesEnabled),
      detail: "Hotel affiliate links use a partner ID first, then the referral fallback."
    },
    {
      group: "Affiliate",
      label: "Travelpayouts marker",
      status: optionalStatus(affiliateReadiness.travelpayoutsMarkerConfigured, affiliatesEnabled),
      detail: "Flight affiliate links use this only when configured."
    },
    {
      group: "Affiliate",
      label: "Klook activity link",
      status: optionalStatus(affiliateReadiness.klookPartnerConfigured, affiliatesEnabled),
      detail: "Activity links use a Klook search URL first, then the referral fallback."
    },
    {
      group: "Notifications",
      label: "VAPID public key",
      status: requiredStatus(Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)),
      detail: "Required for browser push subscriptions."
    },
    {
      group: "Notifications",
      label: "VAPID private key",
      status: requiredStatus(Boolean(process.env.VAPID_PRIVATE_KEY)),
      detail: "Required for sending push notifications."
    },
    {
      group: "Notifications",
      label: "Notification cron secret",
      status: requiredStatus(Boolean(process.env.ROAMLY_NOTIFICATION_CRON_SECRET)),
      detail: "Required for scheduled notification cron protection."
    },
    {
      group: "AI",
      label: "OpenAI API key",
      status: requiredStatus(Boolean(process.env.OPENAI_API_KEY)),
      detail: "Required for AI itinerary generation."
    },
    {
      group: "AI",
      label: "OpenAI model",
      status: process.env.OPENAI_MODEL ? "Ready" : "Optional",
      detail: "Falls back to the default itinerary model when unset."
    }
  ];

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

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {systemChecks.map((check) => (
          <Card key={`${check.group}-${check.label}`} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{check.group}</p>
                <h2 className="mt-2 text-lg font-black text-ink">{check.label}</h2>
              </div>
              <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(check.status)}`}>
                {check.status}
              </span>
            </div>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{check.detail}</p>
          </Card>
        ))}
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {launchChecks.map((check) => (
          <Card key={`launch-${check.group}-${check.label}`} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Launch readiness</p>
                <h2 className="mt-2 text-lg font-black text-ink">{check.label}</h2>
              </div>
              <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(check.status)}`}>
                {check.status}
              </span>
            </div>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{check.detail}</p>
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
          ["Attractions provider", affiliateReadiness.attractionsProviderConfigured ? "Configured" : "Not configured"],
          ["Email provider", emailReadiness.configured ? `${emailReadiness.provider} configured` : emailReadiness.reason],
          ["Support email configured", emailReadiness.supportEmailConfigured ? "Yes" : "No"],
          ["From email configured", emailReadiness.fromEmailConfigured ? "Yes" : "No"],
          ["Sender name configured", emailReadiness.fromNameConfigured ? "Yes" : "Default Roamly"],
          ["Sender verification", emailReadiness.senderVerificationStatus],
          ["Local capture mode", emailReadiness.captureEnabled ? "Enabled" : "Off"],
          ["Email logs", `${emailLogs.count || 0}`],
          ["Last email status", lastEmail.data?.status || "None"],
          ["Last email error", lastEmail.data?.error || "None"],
          ["Facebook connected", socialReadiness.facebookConnected ? "Yes" : "No"],
          ["Instagram connected", socialReadiness.instagramConnected ? "Yes" : "No"],
          ["Social autopost", socialReadiness.autoPostEnabled ? "Enabled" : "Disabled"],
          ["Social approval", socialReadiness.requireApproval ? "Required" : "Not required"],
          ["Shared Supabase auth mode", "Yes"],
          ["Roamly profile table available", profileTableStatus.available ? "Yes" : "No"],
          ["Current user has Roamly profile", appStatus?.has_roamly_profile ? "Yes" : "No"],
          ["Current auth provider", appStatus?.auth_provider || "Email/password"],
          ["ROAMLY_TESTER_EMAILS", state.access.testerEmailsConfigured ? "Configured" : "Not configured"],
          ["Current user tester", state.access.isTester ? "Yes" : "No"],
          ["Current user admin", state.access.isAdmin ? "Yes" : "No"]
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
          <h2 className="mt-2 text-2xl font-black text-ink">Trip simulator</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Creates an admin-only Toronto test trip with CN Tower, Ripley&apos;s Aquarium, Harbourfront, ROM, and Kensington Market coordinates for Live Companion testing.
          </p>
          <div className="mt-4">
            <DemoSeedButton />
          </div>
        </Card>
      </section>
    </main>
  );
}
