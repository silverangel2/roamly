import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";
import { isEmailConfigured } from "@/lib/roamly/email";

export default async function AdminSettingsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;
  const affiliates = getAffiliateReadiness();
  const email = isEmailConfigured();

  return (
    <main className="safe-bottom">
      <Badge>Settings</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Launch settings.</h1>
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {[
          ["Free generation limit", "1 free itinerary per account, lifetime"],
          ["Trip pricing", "$4.99 itinerary, $3.99 Live Trip Companion, $7.99 Complete Trip Pack"],
          ["Location permission", "User opt-in only, account setting can disable anytime"],
          ["Notifications", "Live Trip Companion ready, activity nearby, permission events"],
          ["Affiliate readiness", affiliates.affiliatesEnabled ? "Enabled with Roamly internal fallbacks" : "Disabled - booking CTAs use Roamly internal discovery fallbacks"],
          ["Affiliate providers", `Hotels: ${affiliates.hotelProviderConfigured ? "ready" : "not set"} · Flights: ${affiliates.flightProviderConfigured ? "ready" : "not set"} · Activities: ${affiliates.attractionsProviderConfigured ? "ready" : "not set"}`],
          ["Email provider", email.configured ? `${email.provider} ready` : email.reason],
          ["Email reminders", email.remindersEnabled ? "Enabled for Live Trip Companion notifications" : "Disabled"],
          ["Email sender", `${email.fromEmail} · reply-to ${email.replyToEmail}`],
          ["AI generation", process.env.OPENAI_API_KEY ? "Configured" : "Missing OPENAI_API_KEY"],
          ["Admin emails", process.env.ROAMLY_ADMIN_EMAILS ? "Configured" : "Missing ROAMLY_ADMIN_EMAILS"]
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{label}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{value}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
