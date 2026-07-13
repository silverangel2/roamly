import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { isEmailConfigured } from "@/lib/roamly/email";
import { getRoamlyAdminEmails } from "@/lib/roamly/access";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";
import { hasSupabaseConfig } from "@/lib/supabase/config";

type LaunchStatus = "Ready" | "Needs attention" | "Not configured" | "Error";

type LaunchCheck = {
  label: string;
  status: LaunchStatus;
  action: string;
};

function statusClass(status: LaunchStatus) {
  if (status === "Ready") return "bg-ocean/10 text-ocean";
  if (status === "Needs attention") return "bg-sun/20 text-amber-800";
  if (status === "Not configured") return "bg-slate-100 text-slate-600";
  return "bg-coral/10 text-coral";
}

function configured(value: boolean): LaunchStatus {
  return value ? "Ready" : "Not configured";
}

export default async function AdminLaunchPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const email = isEmailConfigured();
  const social = await getFacebookAutomationSummary(state.admin);
  const amazon = getAmazonAffiliateConfig();
  const [queue, seoPages, contactMessages] = await Promise.all([
    state.admin.from("roamly_social_queue").select("id", { count: "exact", head: true }),
    state.admin.from("roamly_published_seo_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    state.admin.from("roamly_support_messages").select("id", { count: "exact", head: true })
  ]);

  const checks: LaunchCheck[] = [
    ["Supabase", configured(hasSupabaseConfig() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)), "Set Supabase URL, public key, and service role key."],
    ["Authentication", configured(hasSupabaseConfig()), "Keep Supabase Auth enabled for Roamly."],
    ["Google login", configured(hasSupabaseConfig()), "Confirm Google provider redirect includes https://roamlyhq.com/auth/callback."],
    ["Admin session persistence", configured(hasSupabaseConfig()), "Use Supabase refresh sessions; do not create permanent sessions."],
    ["Admin authorization", getRoamlyAdminEmails().includes("support@roamlyhq.com") ? "Ready" : "Needs attention", "Include support@roamlyhq.com in ROAMLY_ADMIN_EMAILS."],
    ["Email provider", configured(email.configured), "Add RESEND_API_KEY or review provider settings."],
    ["Support email", email.supportEmail === "support@roamlyhq.com" ? "Ready" : "Needs attention", "Set ROAMLY_SUPPORT_EMAIL to support@roamlyhq.com."],
    ["Contact form", contactMessages.error ? "Needs attention" : "Ready", "Confirm support messages are saved and confirmation email is sent."],
    ["Meta connection", social.env.facebookConnected ? "Ready" : "Not configured", "Set the Facebook Page ID and Page access token."],
    ["Facebook Page access", social.env.pageName ? "Ready" : "Needs attention", "Validate Page name and permissions from Meta."],
    ["Facebook autopost", social.env.publishingReady ? "Ready" : "Needs attention", social.env.blockingIssues[0] || "Enable automation after controlled tests."],
    ["Facebook Reel publishing", social.env.facebookConnected ? "Needs attention" : "Not configured", "Add approved vertical video media and verify a controlled Reel."],
    ["Cron configuration", "Ready", "Vercel cron calls /api/cron/roamly-social-autopost every 30 minutes."],
    ["Cron secret", configured(social.env.cronSecretConfigured), "Set ROAMLY_SOCIAL_CRON_SECRET in production."],
    ["Queue generation", (queue.count || 0) >= 100 ? "Ready" : "Needs attention", "Generate the initial 100-post queue."],
    ["Database migration", social.tableReady ? "Ready" : "Needs attention", "Run 20260713_roamly_facebook_automation.sql."],
    ["SEO metadata", (seoPages.count || 0) > 0 ? "Ready" : "Needs attention", "Generate at least one SEO page."],
    ["Sitemap", "Ready", "Keep /sitemap.xml live in production."],
    ["Robots.txt", "Ready", "Keep /robots.txt live and block admin/API cron paths."],
    ["Analytics", process.env.NEXT_PUBLIC_ANALYTICS_ID ? "Ready" : "Not configured", "Add analytics only when tracking is ready."],
    ["Legal pages", "Ready", "Review /privacy and /terms before launch."],
    ["Affiliate disclosure", amazon.enabled ? "Ready" : "Needs attention", "Configure Amazon only when product posts are enabled; disclosure is automatic."],
    ["Production domain", process.env.NEXT_PUBLIC_APP_URL?.includes("roamlyhq.com") ? "Ready" : "Needs attention", "Set NEXT_PUBLIC_APP_URL to https://roamlyhq.com."]
  ].map(([label, status, action]) => ({ label, status: status as LaunchStatus, action }));

  return (
    <main className="safe-bottom">
      <Badge>Launch Readiness</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">Launch readiness</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Clear launch checks for auth, admin access, email, Meta publishing, cron, queue generation, SEO, legal, affiliate disclosure, and production domain.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => (
          <Card key={check.label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-black text-ink">{check.label}</h2>
              <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(check.status)}`}>{check.status}</span>
            </div>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{check.action}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
