import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FacebookAutomationControls } from "@/components/admin/social/FacebookAutomationControls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getFacebookAutomationSummaries } from "@/lib/roamly/socialAutomation";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}

export default async function AdminSocialAutomationPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const summaries = await getFacebookAutomationSummaries(state.admin);
  const brandSummaries = [
    { brand: "roamly" as const, label: "Roamly", summary: summaries.roamly },
    { brand: "reviewintel" as const, label: "ReviewIntel", summary: summaries.reviewintel }
  ];

  return (
    <main className="safe-bottom">
      <Badge>Automation</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook automation controls</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Control the background system that fills each brand queue, publishes due Facebook Reels, retries temporary failures, and records every attempt.
      </p>

      <section className="mt-6 grid gap-6">
        {brandSummaries.map((item) => (
          <FacebookAutomationControls key={item.brand} summary={item.summary} brand={item.brand} title={`${item.label} Facebook Reel controls`} />
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {brandSummaries.map((item) => (
          <Card key={item.brand} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{item.label} status</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Page", item.summary.env.pageName || item.summary.env.facebookStatusLabel],
                ["Page ID", item.summary.env.pageId || "Not configured"],
                ["Token", item.summary.env.tokenConfigured ? "Configured" : "Missing"],
                ["Publishing", item.summary.env.publishingReady ? "Ready" : item.summary.env.blockingIssues[0] || "Needs attention"],
                ["Queue size", `${item.summary.counts.queueSize}`],
                ["Published", `${item.summary.counts.published}`],
                ["Failed", `${item.summary.counts.failed}`],
                ["Retry queue", `${item.summary.counts.retrying}`],
                ["Last run", formatDate(item.summary.lastCron?.finished_at || item.summary.lastCron?.started_at)],
                ["Next run", formatDate(item.summary.nextAutomationRun)]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-mist px-4 py-3">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                  <p className="mt-1 break-words text-sm font-black leading-6 text-ink">{value}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {brandSummaries.map((item) => (
          <Card key={item.brand}>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{item.label} latest cron summary</p>
            <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-ink p-4 text-xs font-bold leading-6 text-white">
              {JSON.stringify(item.summary.lastCron?.summary || { status: "No cron run yet" }, null, 2)}
            </pre>
          </Card>
        ))}
      </section>
    </main>
  );
}
