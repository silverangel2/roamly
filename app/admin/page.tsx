import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { isEmailConfigured } from "@/lib/roamly/email";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";

type Section = {
  title: string;
  href: string;
  status: "Ready" | "Needs attention" | "Not configured" | "Error";
  working: string;
  attention: string;
  activity: string;
  next: string;
  control: string;
};

function statusClass(status: Section["status"]) {
  if (status === "Ready") return "bg-ocean/10 text-ocean";
  if (status === "Needs attention") return "bg-sun/20 text-amber-800";
  if (status === "Not configured") return "bg-slate-100 text-slate-600";
  return "bg-coral/10 text-coral";
}

function SectionCard({ section }: { section: Section }) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-ink">{section.title}</h2>
          <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(section.status)}`}>
            {section.status}
          </span>
        </div>
        <Button href={section.href} tone="secondary">{section.control}</Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          ["Working", section.working],
          ["Needs attention", section.attention],
          ["Latest activity", section.activity],
          ["Next scheduled action", section.next]
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-mist px-4 py-3">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-700">{value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default async function AdminPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const email = isEmailConfigured();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    social,
    users,
    trips,
    pageViews,
    notifications,
    failedEmails,
    supportMessages
  ] = await Promise.all([
    getFacebookAutomationSummary(state.admin),
    state.admin.from("roamly_profiles").select("id", { count: "exact", head: true }),
    state.admin.from("roamly_trips").select("id", { count: "exact", head: true }),
    state.admin.from("roamly_app_events").select("id", { count: "exact", head: true }).eq("event_type", "page_view").gte("created_at", today.toISOString()),
    state.admin.from("roamly_notifications").select("id", { count: "exact", head: true }),
    state.admin.from("roamly_email_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    state.admin.from("roamly_support_messages").select("id", { count: "exact", head: true }).eq("status", "new")
  ]);

  const socialAttention = social.env.blockingIssues[0] || (social.counts.queueSize < social.settings.minimumQueueSize ? "Queue is below target." : "No action needed.");
  const socialStatus: Section["status"] = social.env.publishingReady
    ? "Ready"
    : social.env.facebookConnected
      ? "Needs attention"
      : "Not configured";

  const sections: Section[] = [
    {
      title: "Facebook Autopost",
      href: "/admin/social",
      status: socialStatus,
      working: `${social.counts.queueSize} future posts, ${social.counts.published} published, ${social.counts.retrying} retrying.`,
      attention: socialAttention,
      activity: social.lastCron?.finished_at || social.recentActivity[0]?.updated_at || "No automation run yet.",
      next: social.nextPost?.scheduled_for || social.nextAutomationRun,
      control: "Open autopost"
    },
    {
      title: "Content Library",
      href: "/admin/social/library",
      status: social.counts.mediaAssets ? "Ready" : "Needs attention",
      working: `${social.counts.mediaAssets} media assets available to review.`,
      attention: social.counts.mediaAssets ? "Keep approving fresh media for rotation." : "Add or approve media for image posts and Reels.",
      activity: social.recentActivity[0]?.draft?.hook || "No social content yet.",
      next: social.nextPost?.draft?.content_type || "Generate the initial queue.",
      control: "Review library"
    },
    {
      title: "SEO Pages",
      href: "/admin/seo",
      status: "Needs attention",
      working: "SEO drafts and published guide pages are supported.",
      attention: "Generate destination, itinerary, packing, budget, and checklist pages.",
      activity: "No SEO run shown on overview.",
      next: "Create the next useful travel guide.",
      control: "Open SEO"
    },
    {
      title: "Email Center",
      href: "/admin/email",
      status: email.configured ? "Ready" : "Not configured",
      working: email.configured ? `${email.provider} is configured.` : "Email logs are still recorded when sending is skipped.",
      attention: email.configured ? `${failedEmails.count || 0} failed sends need review.` : email.reason,
      activity: `${supportMessages.count || 0} new contact messages.`,
      next: "Send a test email to support@roamlyhq.com.",
      control: "Open email"
    },
    {
      title: "Users",
      href: "/admin/users",
      status: "Ready",
      working: `${users.count || 0} user profiles.`,
      attention: "Watch for support requests and login issues.",
      activity: "Profiles update automatically after login.",
      next: "Review new users as needed.",
      control: "View users"
    },
    {
      title: "Trips",
      href: "/admin/trips",
      status: "Ready",
      working: `${trips.count || 0} trips in Roamly.`,
      attention: "Investigate failed itinerary generations from Traffic or Launch Readiness.",
      activity: "Trip records are created by the planner.",
      next: "Review recent trips.",
      control: "View trips"
    },
    {
      title: "Traffic",
      href: "/admin/traffic",
      status: "Ready",
      working: `${pageViews.count || 0} page views today.`,
      attention: "Look for broken funnels or missing events.",
      activity: "App events are tracked in Supabase.",
      next: "Review today traffic.",
      control: "Open traffic"
    },
    {
      title: "Notifications",
      href: "/admin/notifications",
      status: "Ready",
      working: `${notifications.count || 0} notifications stored.`,
      attention: "Check push/email failures before launch.",
      activity: "Trip reminders run from cron.",
      next: "Review notification queue.",
      control: "Open notifications"
    },
    {
      title: "Launch Readiness",
      href: "/admin/launch",
      status: social.env.publishingReady && email.configured ? "Ready" : "Needs attention",
      working: "Launch checks hide secret values and show direct next actions.",
      attention: "Confirm auth, email, Meta, cron, sitemap, legal, and affiliate disclosure.",
      activity: "Readiness updates from current environment.",
      next: "Resolve remaining checks.",
      control: "Check launch"
    },
    {
      title: "Settings",
      href: "/admin/settings",
      status: "Ready",
      working: "Admin settings and launch values are grouped in one place.",
      attention: "Production-only secrets should stay in Vercel and Supabase.",
      activity: "Settings are read server-side.",
      next: "Review Facebook and email settings.",
      control: "Open settings"
    }
  ];

  return (
    <main className="safe-bottom">
      <Badge>Overview</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">Roamly admin dashboard</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        A simple operations view for launch, Facebook automation, content, email, users, trips, traffic, and settings.
      </p>

      <section className="mt-6 grid gap-4">
        {sections.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}
      </section>
    </main>
  );
}
