import Link from "next/link";
import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FacebookAutomationControls } from "@/components/admin/social/FacebookAutomationControls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";

function statusClass(ok: boolean) {
  return ok ? "bg-ocean/10 text-ocean" : "bg-sun/20 text-amber-800";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None scheduled";
}

const tabs = [
  ["/admin/social", "Autopost"],
  ["/admin/social/library", "Library"],
  ["/admin/social/settings", "Settings"],
  ["/admin/social/drafts", "Drafts"],
  ["/admin/social/history", "History"],
  ["/admin/social/automation", "Automation"]
];

export default async function AdminSocialPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const summary = await getFacebookAutomationSummary(state.admin);

  return (
    <main className="safe-bottom">
      <Badge>Facebook Autopost</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">Facebook autopost system</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Generates, schedules, publishes, retries, tracks, and replenishes Roamly Facebook posts and Reels without requiring approval for every post.
      </p>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {tabs.map(([href, label]) => (
          <Link key={href} href={href} className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-black text-ink shadow-soft ring-1 ring-cloud">
            {label}
          </Link>
        ))}
      </nav>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Facebook Page", summary.env.pageName || summary.env.facebookStatusLabel, summary.env.facebookConnected],
          ["Publishing", summary.env.publishingReady ? "Ready" : summary.env.blockingIssues[0] || "Needs attention", summary.env.publishingReady],
          ["Queue size", `${summary.counts.queueSize} future posts`, summary.counts.queueSize >= summary.settings.minimumQueueSize],
          ["Scheduled posts", `${summary.counts.scheduled}`, summary.counts.scheduled > 0],
          ["Published", `${summary.counts.published}`, true],
          ["Failed", `${summary.counts.failed}`, summary.counts.failed === 0],
          ["Retry queue", `${summary.counts.retrying}`, summary.counts.retrying === 0],
          ["Next automation run", formatDate(summary.nextAutomationRun), true]
        ].map(([label, value, ok]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
            <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(Boolean(ok))}`}>
              {ok ? "Working" : "Needs attention"}
            </span>
          </Card>
        ))}
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Next post</p>
          <h2 className="mt-2 text-xl font-black text-ink">{summary.nextPost?.draft.hook || "No post scheduled"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{formatDate(summary.nextPost?.scheduled_for)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Next Reel</p>
          <h2 className="mt-2 text-xl font-black text-ink">{summary.nextReel?.draft.hook || "No Reel scheduled"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{formatDate(summary.nextReel?.scheduled_for)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Last successful autopost</p>
          <h2 className="mt-2 text-xl font-black text-ink">
            {summary.recentActivity.find((item) => item.queue_status === "published")?.draft.hook || "None yet"}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {formatDate(summary.recentActivity.find((item) => item.queue_status === "published")?.published_at)}
          </p>
        </Card>
      </section>

      <section className="mt-5">
        <FacebookAutomationControls summary={summary} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Today&apos;s schedule</p>
          <div className="mt-4 grid gap-3">
            {summary.todaySchedule.map((item) => (
              <div key={item.id} className="rounded-xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{item.draft.hook}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{formatDate(item.scheduled_for)} · {item.draft.post_format}</p>
              </div>
            ))}
            {!summary.todaySchedule.length ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Nothing else scheduled today.</p> : null}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Weekly schedule</p>
          <div className="mt-4 grid gap-3">
            {summary.weekSchedule.slice(0, 10).map((item) => (
              <div key={item.id} className="rounded-xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{item.draft.content_type}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{formatDate(item.scheduled_for)} · {item.draft.post_format}</p>
              </div>
            ))}
            {!summary.weekSchedule.length ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Generate the queue to fill this week.</p> : null}
          </div>
        </Card>
      </section>
    </main>
  );
}
